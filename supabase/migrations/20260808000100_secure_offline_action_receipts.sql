-- FinFlow: execução idempotente do subconjunto seguro de ações criadas offline.
--
-- Esta RPC não é um executor SQL genérico. Ela aceita somente ações de criação
-- já normalizadas/validadas pelo núcleo financeiro da IA. Atualizações,
-- exclusões, conclusões e pagamentos ficam deliberadamente fora até todas as
-- tabelas terem versão otimista para detectar conflitos ocorridos offline.

create schema if not exists private;

create table if not exists private.offline_action_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  action_type text not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  result jsonb not null,
  client_created_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, idempotency_key)
);

create index if not exists offline_action_receipts_user_created_idx
  on private.offline_action_receipts (user_id, created_at desc);

alter table private.offline_action_receipts enable row level security;
revoke all on table private.offline_action_receipts from public, anon, authenticated;
grant all on table private.offline_action_receipts to service_role;

create or replace function public.execute_offline_financial_action(
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
     or pg_catalog.octet_length(p_payload::text) > 8192 then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_PAYLOAD';
  end if;
  if p_action_type is null or not (p_action_type = any(array[
    'create_account',
    'create_category',
    'create_goal',
    'create_card',
    'create_transaction',
    'transfer_between_accounts',
    'move_goal',
    'create_card_purchase'
  ]::text[])) then
    raise exception using errcode = 'P0001', message = 'OFFLINE_UNSUPPORTED_ACTION';
  end if;

  request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_array(p_action_type, p_payload)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- Serializa ações do mesmo usuário. Além de fechar a corrida da chave
  -- idempotente, impede que chamadas paralelas ultrapassem o limite horário.
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

  select count(*) into recent_count
  from private.offline_action_receipts r
  where r.user_id = caller
    and r.created_at >= pg_catalog.clock_timestamp() - interval '1 hour';
  if recent_count >= 120 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'OFFLINE_RATE_LIMITED',
      'retry_after_seconds', 3600
    );
  end if;

  -- Estas funções são o mesmo núcleo que rejeita campos extras, referências de
  -- outro usuário, fatura fechada, limite/cartão inválido e regras de plano.
  prepared := private.ai_prepare_action(caller, p_action_type, p_payload);
  normalized := prepared -> 'payload';

  -- Bloqueia as linhas relacionadas até o fim desta transação. A execução faz
  -- uma segunda validação imediatamente antes do DML.
  perform private.ai_action_state_fingerprint(caller, p_action_type, normalized, true);
  execution_result := private.ai_execute_financial_action(
    caller,
    p_action_type,
    normalized,
    null
  );

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

revoke all on function public.execute_offline_financial_action(text,jsonb,uuid,uuid,timestamptz)
  from public, anon;
grant execute on function public.execute_offline_financial_action(text,jsonb,uuid,uuid,timestamptz)
  to authenticated;

comment on function public.execute_offline_financial_action(text,jsonb,uuid,uuid,timestamptz) is
  'Executa de forma idempotente somente criações financeiras offline validadas no servidor; não aceita JWT/user_id no payload.';
