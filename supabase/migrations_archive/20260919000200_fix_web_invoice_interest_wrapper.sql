-- execute_manual_financial_action chamava ai_prepare_action com o payload
-- bruto do cliente ANTES de despachar pay_invoice/reverse_invoice_payment para
-- suas RPCs dedicadas. Isso duplicava uma validação que finance_pay_invoice já
-- faz sozinho (com as regras corretas), e a validação genérica rejeita juros
-- fora do modo carry -- então pagar parcialmente uma fatura com juros no modo
-- "manter nesta fatura" (keep_open), que é exatamente o que a tela web envia,
-- falhava com AI_INTEREST_NOT_APPLICABLE antes mesmo de chegar em
-- finance_pay_invoice. O app mobile não é afetado por chamar a RPC diretamente.
-- Confirmado por teste manual em 2026-09-19.
begin;

create or replace function public.execute_manual_financial_action(
  p_action_type text,
  p_payload jsonb,
  p_idempotency_key uuid,
  p_expected_user_id uuid,
  p_client_created_at timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  request_hash text;
  existing private.offline_action_receipts%rowtype;
  prepared jsonb;
  normalized jsonb;
  execution_result jsonb;
  recent_count integer;
begin
  if caller is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_REQUIRED';
  end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_MISMATCH';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_client_created_at is null
     or p_client_created_at < pg_catalog.clock_timestamp() - interval '30 days'
     or p_client_created_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'OFFLINE_OPERATION_EXPIRED';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 16384 then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_PAYLOAD';
  end if;
  if p_action_type is null or not (p_action_type = any(array[
    'create_account', 'update_account', 'archive_account', 'delete_account', 'reactivate_account',
    'create_category', 'update_category', 'archive_category', 'delete_category', 'reactivate_category',
    'create_goal', 'update_goal', 'archive_goal', 'delete_goal', 'reactivate_goal', 'move_goal',
    'create_transaction', 'transfer_between_accounts', 'update_transaction', 'delete_transaction',
    'complete_transaction', 'reopen_transaction',
    'create_card', 'update_card', 'archive_card', 'delete_card', 'reactivate_card',
    'create_card_purchase', 'update_card_purchase', 'delete_card_purchase',
    'pay_invoice', 'reverse_invoice_payment'
  ]::text[])) then
    raise exception using errcode = 'P0001', message = 'OFFLINE_UNSUPPORTED_ACTION';
  end if;

  request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_action_type, p_payload)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- Serializa operacoes manuais do mesmo usuario e torna o request_id
  -- repetivel sem duplicar lancamentos, parcelas ou transferencias.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text, 81277)
  );

  select * into existing
  from private.offline_action_receipts r
  where r.user_id = caller and r.idempotency_key = p_idempotency_key;

  if found then
    if existing.action_type <> p_action_type or existing.payload_hash <> request_hash then
      raise exception using errcode = 'P0001', message = 'OFFLINE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'receipt_id', existing.id,
      'result', existing.result
    );
  end if;

  select pg_catalog.count(*) into recent_count
  from private.offline_action_receipts r
  where r.user_id = caller
    and r.created_at >= pg_catalog.clock_timestamp() - interval '1 hour';
  if recent_count >= 180 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'OFFLINE_RATE_LIMITED',
      'retry_after_seconds', 3600
    );
  end if;

  -- Pagamento e estorno de fatura possuem RPCs manuais proprias que já fazem
  -- sua própria validação completa (ai_prepare_action interno, locks e
  -- revalidações). Chamar ai_prepare_action aqui também, com o payload bruto,
  -- duplicava essa validação com regras diferentes das da RPC dedicada (ex.:
  -- rejeitava juros fora do modo carry mesmo quando o modo é keep_open, que
  -- finance_pay_invoice trata corretamente sozinho). Por isso essas duas ações
  -- não passam pelo normalizador genérico.
  if p_action_type = 'pay_invoice' then
    execution_result := public.finance_pay_invoice(
      (p_payload ->> 'card_id')::bigint,
      p_payload ->> 'invoice_month',
      (p_payload ->> 'account_id')::bigint,
      (p_payload ->> 'payment_amount')::numeric,
      p_payload ->> 'remainder_mode',
      case when p_payload ? 'interest_value'
        then (p_payload ->> 'interest_value')::numeric else null end,
      case when p_payload ? 'interest_percent'
        then (p_payload ->> 'interest_percent')::numeric else null end,
      p_idempotency_key
    );
  elsif p_action_type = 'reverse_invoice_payment' then
    execution_result := public.finance_reverse_invoice_payment(
      (p_payload ->> 'transaction_id')::bigint,
      p_idempotency_key
    );
  else
    prepared := private.ai_prepare_action(caller, p_action_type, p_payload);
    normalized := prepared -> 'payload';
    -- A leitura com lock impede que uma previa antiga seja aplicada sobre um
    -- saldo ou serie que mudou durante a operacao.
    perform private.ai_action_state_fingerprint(caller, p_action_type, normalized, true);
    execution_result := private.ai_execute_financial_action(
      caller,
      p_action_type,
      normalized,
      -- complete/reopen exigem uma chave canonica nao nula para seus recibos.
      -- Os demais executores ignoram este argumento.
      p_idempotency_key
    );
  end if;

  insert into private.offline_action_receipts (
    user_id,
    idempotency_key,
    action_type,
    payload_hash,
    result,
    client_created_at
  ) values (
    caller,
    p_idempotency_key,
    p_action_type,
    request_hash,
    execution_result,
    p_client_created_at
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'receipt_id', existing.id,
    'result', execution_result
  );
end;
$$;

commit;
