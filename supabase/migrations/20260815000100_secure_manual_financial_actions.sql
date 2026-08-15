-- FinFlow web: executor manual idempotente para as mesmas regras financeiras
-- usadas pela IA e pela fila offline.
--
-- A interface web nunca escreve diretamente em saldos ou em series. Ela envia
-- uma intencao fechada, o banco normaliza o payload, valida propriedade/RLS,
-- limites do plano, estado atual e executa a operacao de forma atomica.

begin;

do $$
begin
  if pg_catalog.to_regclass('private.offline_action_receipts') is null
     or pg_catalog.to_regprocedure('private.ai_prepare_action(uuid,text,jsonb)') is null
     or pg_catalog.to_regprocedure('private.ai_action_state_fingerprint(uuid,text,jsonb,boolean)') is null
     or pg_catalog.to_regprocedure('private.ai_execute_financial_action(uuid,text,jsonb,uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_pay_invoice(bigint,text,bigint,numeric,text,numeric,numeric,uuid)') is null
     or pg_catalog.to_regprocedure('public.finance_reverse_invoice_payment(bigint,uuid)') is null then
    raise exception 'FINFLOW_MANUAL_FINANCIAL_CORE_MISSING';
  end if;
end;
$$;

create or replace function public.execute_manual_financial_action(
  p_action_type text,
  p_payload jsonb,
  p_idempotency_key uuid,
  p_expected_user_id uuid,
  p_client_created_at timestamptz
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

  prepared := private.ai_prepare_action(caller, p_action_type, p_payload);
  normalized := prepared -> 'payload';

  -- Pagamento e estorno de fatura possuem RPCs manuais proprias. Alem de
  -- registrarem request_id/source no ledger, elas chamam o executor de cartao
  -- com action_id nulo. Isso e indispensavel: action_id referencia
  -- ai_pending_actions e uma chave manual arbitraria violaria essa FK.
  --
  -- Essas RPCs fazem seus proprios locks e revalidacoes. Chama-las antes do
  -- state_fingerprint tambem preserva a ordem canonica de locks e evita um
  -- deadlock com uma chamada simultanea feita pelo aplicativo mobile.
  if p_action_type = 'pay_invoice' then
    execution_result := public.finance_pay_invoice(
      (normalized ->> 'card_id')::bigint,
      normalized ->> 'invoice_month',
      (normalized ->> 'account_id')::bigint,
      (normalized ->> 'payment_amount')::numeric,
      normalized ->> 'remainder_mode',
      case when normalized ? 'interest_value'
        then (normalized ->> 'interest_value')::numeric else null end,
      case when normalized ? 'interest_percent'
        then (normalized ->> 'interest_percent')::numeric else null end,
      p_idempotency_key
    );
  elsif p_action_type = 'reverse_invoice_payment' then
    execution_result := public.finance_reverse_invoice_payment(
      (normalized ->> 'transaction_id')::bigint,
      p_idempotency_key
    );
  else
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

revoke all on function public.execute_manual_financial_action(text,jsonb,uuid,uuid,timestamptz)
  from public, anon, authenticated;
grant execute on function public.execute_manual_financial_action(text,jsonb,uuid,uuid,timestamptz)
  to authenticated;

comment on function public.execute_manual_financial_action(text,jsonb,uuid,uuid,timestamptz) is
  'Executa acoes financeiras manuais do site com validacao de dominio, lock, auditoria e idempotencia; nunca aceita user_id no payload.';

commit;
