-- FinFlow: endurecimento de webhooks, checkout, SMS e dissoluÃ§Ã£o de parceria.
--
-- Esta migraÃ§Ã£o nÃ£o ativa cobranÃ§as nem limites de plano. Ela falha se uma
-- tabela central esperada nÃ£o existir, em vez de publicar policies inertes.

begin;

create schema if not exists private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- RLS central e dissoluÃ§Ã£o de parceria somente pela RPC transacional.
-- ---------------------------------------------------------------------------

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'contas', 'caixinhas', 'categorias', 'transacoes', 'cartoes',
    'fatura_itens', 'chat_historico', 'feedbacks', 'parcerias'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is null then
      raise exception using
        errcode = '42P01',
        message = format('FINFLOW_CORE_TABLE_MISSING:%s', target_table);
    end if;
    execute format(
      'alter table public.%I enable row level security',
      target_table
    );
  end loop;
end;
$$;

-- Referências financeiras não podem atravessar usuários nem misturar o tipo da
-- categoria. RLS protege a linha principal; este trigger protege as FKs que a
-- linha aponta, inclusive contra requests REST adulterados.
create or replace function private.finflow_validate_financial_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker text[];
  referenced_id bigint;
  operation text;
begin
  if tg_table_name = 'transacoes' then
    if new.user_id is null or new.conta_id is null then
      raise exception using errcode = '23514', message = 'FINFLOW_TRANSACTION_OWNER_ACCOUNT_REQUIRED';
    end if;

    if not exists (
      select 1
      from public.contas account_row
      where account_row.id = new.conta_id
        and (
          account_row.user_id = new.user_id
          or (
            account_row.compartilhado is true
            and exists (
              select 1
              from public.parcerias partnership_row
              where partnership_row.status = 'aceito'
                and (
                  (partnership_row.solicitante_id = account_row.user_id
                    and partnership_row.convidado_id = new.user_id)
                  or
                  (partnership_row.convidado_id = account_row.user_id
                    and partnership_row.solicitante_id = new.user_id)
                )
            )
          )
        )
    ) then
      raise exception using errcode = '23514', message = 'FINFLOW_TRANSACTION_ACCOUNT_INVALID';
    end if;

    if new.categoria_id is not null then
      if coalesce(new.descricao, '') ~ '\[(Destino:|Objetivo:|PagFatura:)' then
        raise exception using errcode = '23514', message = 'FINFLOW_INTERNAL_MOVEMENT_CATEGORY_MUST_BE_NULL';
      end if;
      if not exists (
        select 1
        from public.categorias category_row
        where category_row.id = new.categoria_id
          and category_row.user_id = new.user_id
          and category_row.tipo in (new.tipo, 'ambos')
      ) then
        raise exception using errcode = '23514', message = 'FINFLOW_TRANSACTION_CATEGORY_INVALID';
      end if;
      return new;
    end if;

    -- Permite apenas a recuperacao de um lancamento legado sem categoria. Uma
    -- nova conclusao continua bloqueada pela RPC e qualquer outra alteracao
    -- precisa primeiro atribuir uma categoria valida.
    if tg_op = 'UPDATE'
       and old.categoria_id is null
       and new.categoria_id is null
       and old.status = 'paga'
       and new.status = 'pendente'
       and coalesce(new.descricao, '') !~ '\[(Destino:|Objetivo:|PagFatura:)'
       and coalesce(new.descricao, '') not like '[Transf.] %' then
      return new;
    end if;

    marker := regexp_match(coalesce(new.descricao, ''), '\[Destino:([0-9]+)\]\s*$');
    if marker is not null then
      referenced_id := marker[1]::bigint;
      if new.tipo <> 'despesa' or referenced_id = new.conta_id then
        raise exception using errcode = '23514', message = 'FINFLOW_TRANSFER_REFERENCE_INVALID';
      end if;
      if not exists (
        select 1
        from public.contas destination_row
        where destination_row.id = referenced_id
          and (
            destination_row.user_id = new.user_id
            or (
              destination_row.compartilhado is true
              and exists (
                select 1
                from public.parcerias partnership_row
                where partnership_row.status = 'aceito'
                  and (
                    (partnership_row.solicitante_id = destination_row.user_id
                      and partnership_row.convidado_id = new.user_id)
                    or
                    (partnership_row.convidado_id = destination_row.user_id
                      and partnership_row.solicitante_id = new.user_id)
                  )
              )
            )
          )
      ) then
        raise exception using errcode = '23514', message = 'FINFLOW_TRANSFER_DESTINATION_INVALID';
      end if;
      return new;
    end if;

    marker := regexp_match(
      coalesce(new.descricao, ''),
      '\[Objetivo:([0-9]+):(guardar|resgatar)\]\s*$'
    );
    if marker is not null then
      referenced_id := marker[1]::bigint;
      operation := marker[2];
      if (operation = 'guardar' and new.tipo <> 'despesa')
         or (operation = 'resgatar' and new.tipo <> 'receita') then
        raise exception using errcode = '23514', message = 'FINFLOW_GOAL_MOVEMENT_TYPE_INVALID';
      end if;
      if not exists (
        select 1
        from public.caixinhas goal_row
        where goal_row.id = referenced_id
          and (
            goal_row.user_id = new.user_id
            or (
              goal_row.compartilhado is true
              and exists (
                select 1
                from public.parcerias partnership_row
                where partnership_row.status = 'aceito'
                  and (
                    (partnership_row.solicitante_id = goal_row.user_id
                      and partnership_row.convidado_id = new.user_id)
                    or
                    (partnership_row.convidado_id = goal_row.user_id
                      and partnership_row.solicitante_id = new.user_id)
                  )
              )
            )
          )
      ) then
        raise exception using errcode = '23514', message = 'FINFLOW_GOAL_REFERENCE_INVALID';
      end if;
      return new;
    end if;

    marker := regexp_match(
      coalesce(new.descricao, ''),
      '\[PagFatura:([0-9]+):([0-9]{4}-(0[1-9]|1[0-2])):(total|parcial|saldo_transferido)(?::[0-9]+)?\]\s*$'
    );
    if marker is not null then
      referenced_id := marker[1]::bigint;
      if new.tipo <> 'despesa' or not exists (
        select 1
        from public.cartoes card_row
        where card_row.id = referenced_id
          and card_row.user_id = new.user_id
      ) then
        raise exception using errcode = '23514', message = 'FINFLOW_INVOICE_PAYMENT_REFERENCE_INVALID';
      end if;
      return new;
    end if;

    raise exception using errcode = '23514', message = 'FINFLOW_TRANSACTION_CATEGORY_REQUIRED';
  end if;

  if tg_table_name = 'fatura_itens' then
    if new.user_id is null or new.cartao_id is null or not exists (
      select 1
      from public.cartoes card_row
      where card_row.id = new.cartao_id
        and card_row.user_id = new.user_id
    ) then
      raise exception using errcode = '23514', message = 'FINFLOW_INVOICE_CARD_INVALID';
    end if;

    if new.categoria_id is not null then
      if not exists (
        select 1
        from public.categorias category_row
        where category_row.id = new.categoria_id
          and category_row.user_id = new.user_id
          and category_row.tipo in ('despesa', 'ambos')
      ) then
        raise exception using errcode = '23514', message = 'FINFLOW_INVOICE_CATEGORY_INVALID';
      end if;
      return new;
    end if;

    -- Categoria nula é reservada ao saldo sintético criado pela RPC da fatura.
    -- A policy abaixo impede clientes autenticados de inserir/alterar esse caso;
    -- o trigger ainda restringe backends privilegiados ao formato conhecido.
    if coalesce(new.descricao, '') !~ '^Saldo da fatura anterior( \([0-9]{4}-(0[1-9]|1[0-2])\))?$' then
      raise exception using errcode = '23514', message = 'FINFLOW_INVOICE_CATEGORY_REQUIRED';
    end if;
    return new;
  end if;

  raise exception using errcode = '42P01', message = 'FINFLOW_UNSUPPORTED_FINANCIAL_TABLE';
end;
$$;

revoke all on function private.finflow_validate_financial_references()
  from public, anon, authenticated;

drop trigger if exists finflow_validate_transaction_references
  on public.transacoes;
create trigger finflow_validate_transaction_references
before insert or update
on public.transacoes
for each row execute function private.finflow_validate_financial_references();

drop trigger if exists finflow_validate_invoice_item_references
  on public.fatura_itens;
create trigger finflow_validate_invoice_item_references
before insert or update
on public.fatura_itens
for each row execute function private.finflow_validate_financial_references();

drop policy if exists "fatura_itens_owner_all" on public.fatura_itens;
create policy "fatura_itens_owner_all"
  on public.fatura_itens for all to authenticated
  using ((select auth.uid()) = fatura_itens.user_id)
  with check (
    (select auth.uid()) = fatura_itens.user_id
    and fatura_itens.categoria_id is not null
    and exists (
      select 1
      from public.cartoes card_row
      where card_row.id = fatura_itens.cartao_id
        and card_row.user_id = (select auth.uid())
    )
    and exists (
      select 1
      from public.categorias category_row
      where category_row.id = fatura_itens.categoria_id
        and category_row.user_id = (select auth.uid())
        and category_row.tipo in ('despesa', 'ambos')
    )
  );

drop policy if exists "parcerias_participant_delete" on public.parcerias;
create policy "parcerias_participant_delete"
  on public.parcerias for delete to authenticated
  using (
    status = 'pendente'
    and (
      (select auth.uid()) = solicitante_id
      or (select auth.uid()) = convidado_id
      or lower((select auth.jwt() ->> 'email')) = lower(convidado_email)
    )
  );

create or replace function private.finflow_guard_direct_partnership_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- A RPC SECURITY DEFINER executa como seu proprietÃ¡rio. Apenas DML direto do
  -- cliente Ã© bloqueado aqui, inclusive se uma policy permissiva for criada no
  -- futuro por engano.
  if current_user in ('authenticated', 'anon')
     and old.status = 'aceito' then
    raise exception using
      errcode = '42501',
      message = 'FINFLOW_ACCEPTED_PARTNERSHIP_RPC_REQUIRED';
  end if;
  return old;
end;
$$;

revoke all on function private.finflow_guard_direct_partnership_delete()
  from public, anon, authenticated;

drop trigger if exists finflow_guard_direct_partnership_delete
  on public.parcerias;
create trigger finflow_guard_direct_partnership_delete
before delete on public.parcerias
for each row execute function private.finflow_guard_direct_partnership_delete();

-- ---------------------------------------------------------------------------
-- Claim idempotente de eventos do Mercado Pago.
-- ---------------------------------------------------------------------------

alter table public.subscription_events
  add column if not exists processing_token uuid,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_locked_until timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscription_events'::regclass
      and conname = 'subscription_events_attempt_count_check'
  ) then
    alter table public.subscription_events
      add constraint subscription_events_attempt_count_check
      check (attempt_count between 0 and 10000) not valid;
  end if;
end;
$$;

alter table public.subscription_events
  validate constraint subscription_events_attempt_count_check;

create index if not exists subscription_events_unprocessed_retry_idx
  on public.subscription_events(provider, created_at, processing_locked_until)
  where processed_at is null;
create index if not exists subscription_events_processed_retention_idx
  on public.subscription_events(processed_at)
  where processed_at is not null;
create index if not exists subscription_events_unprocessed_retention_idx
  on public.subscription_events(created_at)
  where processed_at is null;

-- Eventos antigos tambÃ©m passam a guardar somente metadados necessÃ¡rios para
-- reconciliaÃ§Ã£o. Dados de pagador, cartÃ£o e corpo bruto nÃ£o permanecem aqui.
update public.subscription_events
set payload = jsonb_strip_nulls(jsonb_build_object(
  'id', nullif(left(coalesce(payload ->> 'id', ''), 200), ''),
  'type', nullif(left(coalesce(payload ->> 'type', ''), 100), ''),
  'topic', nullif(left(coalesce(payload ->> 'topic', ''), 100), ''),
  'action', nullif(left(coalesce(payload ->> 'action', ''), 100), ''),
  'date_created', nullif(left(coalesce(payload ->> 'date_created', ''), 80), ''),
  'live_mode', case
    when jsonb_typeof(payload -> 'live_mode') = 'boolean' then payload -> 'live_mode'
    else null
  end,
  'api_version', nullif(left(coalesce(payload ->> 'api_version', ''), 40), ''),
  'data', case
    when nullif(left(coalesce(payload #>> '{data,id}', ''), 200), '') is null
      then null
    else jsonb_build_object(
      'id', left(payload #>> '{data,id}', 200)
    )
  end
)),
error = case
  when error is null then null
  when error ~ '^[A-Z][A-Z0-9_]{2,79}$' then error
  else 'LEGACY_REDACTED'
end
where provider = 'mercado_pago';

create or replace function public.claim_subscription_event(
  p_provider text,
  p_event_id text,
  p_event_type text,
  p_payload jsonb,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.subscription_events%rowtype;
  claim_token uuid := gen_random_uuid();
  now_at timestamptz := clock_timestamp();
  retry_after integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_provider <> 'mercado_pago'
     or p_event_id is null or length(p_event_id) not between 1 and 240
     or p_event_type is null or length(p_event_type) not between 1 and 100
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 4096
     or p_lease_seconds is null or p_lease_seconds not between 10 and 300 then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_WEBHOOK_CLAIM';
  end if;

  insert into public.subscription_events (
    provider, provider_event_id, event_type, payload,
    processing_token, processing_started_at, processing_locked_until,
    last_attempt_at, attempt_count
  ) values (
    p_provider, p_event_id, p_event_type, p_payload,
    claim_token, now_at, now_at + make_interval(secs => p_lease_seconds),
    now_at, 1
  )
  on conflict (provider, provider_event_id) do nothing
  returning * into event_row;

  if found then
    return jsonb_build_object(
      'claimed', true,
      'processed', false,
      'event_id', event_row.id,
      'processing_token', claim_token,
      'attempt_count', event_row.attempt_count
    );
  end if;

  select * into event_row
  from public.subscription_events
  where provider = p_provider
    and provider_event_id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'FINFLOW_WEBHOOK_EVENT_NOT_FOUND';
  end if;
  if event_row.processed_at is not null then
    return jsonb_build_object(
      'claimed', false,
      'processed', true,
      'event_id', event_row.id,
      'attempt_count', event_row.attempt_count
    );
  end if;
  if event_row.processing_locked_until is not null
     and event_row.processing_locked_until > now_at then
    retry_after := greatest(
      1,
      ceil(extract(epoch from (event_row.processing_locked_until - now_at)))::integer
    );
    return jsonb_build_object(
      'claimed', false,
      'processed', false,
      'processing', true,
      'event_id', event_row.id,
      'retry_after', retry_after,
      'attempt_count', event_row.attempt_count
    );
  end if;

  update public.subscription_events
  set event_type = p_event_type,
      payload = p_payload,
      processing_token = claim_token,
      processing_started_at = now_at,
      processing_locked_until = now_at + make_interval(secs => p_lease_seconds),
      last_attempt_at = now_at,
      attempt_count = least(attempt_count + 1, 10000),
      error = null
  where id = event_row.id
  returning * into event_row;

  return jsonb_build_object(
    'claimed', true,
    'processed', false,
    'event_id', event_row.id,
    'processing_token', claim_token,
    'attempt_count', event_row.attempt_count
  );
end;
$$;

create or replace function public.finalize_subscription_event(
  p_event_id uuid,
  p_processing_token uuid,
  p_subscription_id uuid default null,
  p_error_code text default null
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_error text := nullif(btrim(coalesce(p_error_code, '')), '');
  changed integer := 0;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_event_id is null or p_processing_token is null then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_WEBHOOK_FINALIZATION';
  end if;
  if normalized_error is not null
     and (length(normalized_error) not between 3 and 80
       or normalized_error !~ '^[A-Z][A-Z0-9_]+$') then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_WEBHOOK_ERROR';
  end if;
  if normalized_error is null and p_subscription_id is null then
    raise exception using errcode = '22023', message = 'FINFLOW_SUBSCRIPTION_REQUIRED';
  end if;

  if normalized_error is null then
    update public.subscription_events
    set subscription_id = p_subscription_id,
        processed_at = clock_timestamp(),
        error = null,
        processing_token = null,
        processing_locked_until = null
    where id = p_event_id
      and processing_token = p_processing_token
      and processed_at is null;
  else
    update public.subscription_events
    set error = normalized_error,
        processing_token = null,
        processing_locked_until = null
    where id = p_event_id
      and processing_token = p_processing_token
      and processed_at is null;
  end if;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$$;

revoke all on function public.claim_subscription_event(text,text,text,jsonb,integer)
  from public, anon, authenticated;
revoke all on function public.finalize_subscription_event(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.claim_subscription_event(text,text,text,jsonb,integer)
  to service_role;
grant execute on function public.finalize_subscription_event(uuid,uuid,uuid,text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Rate limiter atÃ´mico e genÃ©rico para operaÃ§Ãµes externas de custo/abuso.
-- Somente hashes dos sujeitos sÃ£o persistidos.
-- ---------------------------------------------------------------------------

create table if not exists private.edge_rate_limits (
  scope text not null,
  subject_hash text not null,
  window_started_at timestamptz not null,
  attempts integer not null,
  last_attempt_at timestamptz not null,
  primary key (scope, subject_hash),
  constraint edge_rate_limits_scope_check
    check (scope in ('sms_verification', 'subscription_checkout')),
  constraint edge_rate_limits_attempts_check
    check (attempts between 1 and 10000),
  constraint edge_rate_limits_hash_check
    check (subject_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists edge_rate_limits_retention_idx
  on private.edge_rate_limits(last_attempt_at);

revoke all on table private.edge_rate_limits from public, anon, authenticated;
grant all on table private.edge_rate_limits to service_role;

create or replace function public.reserve_edge_rate_limit(
  p_scope text,
  p_subject text,
  p_cooldown_seconds integer,
  p_window_seconds integer,
  p_max_attempts integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_subject_hash text;
  current_row private.edge_rate_limits%rowtype;
  now_at timestamptz := clock_timestamp();
  retry_after integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_scope not in ('sms_verification', 'subscription_checkout')
     or p_subject is null or length(p_subject) not between 8 and 300
     or p_cooldown_seconds is null or p_cooldown_seconds not between 1 and 3600
     or p_window_seconds is null or p_window_seconds not between 60 and 604800
     or p_max_attempts is null or p_max_attempts not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_RATE_LIMIT';
  end if;

  v_subject_hash := encode(
    extensions.digest(convert_to(jsonb_build_array(p_scope, p_subject)::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtext(p_scope), hashtext(v_subject_hash));

  select * into current_row
  from private.edge_rate_limits
  where scope = p_scope and edge_rate_limits.subject_hash = v_subject_hash
  for update;

  if not found or current_row.window_started_at + make_interval(secs => p_window_seconds) <= now_at then
    insert into private.edge_rate_limits (
      scope, subject_hash, window_started_at, attempts, last_attempt_at
    ) values (
      p_scope, v_subject_hash, now_at, 1, now_at
    )
    on conflict (scope, subject_hash) do update
      set window_started_at = excluded.window_started_at,
          attempts = 1,
          last_attempt_at = excluded.last_attempt_at;
    return jsonb_build_object('allowed', true, 'remaining', p_max_attempts - 1);
  end if;

  if current_row.last_attempt_at + make_interval(secs => p_cooldown_seconds) > now_at then
    retry_after := greatest(
      1,
      ceil(extract(epoch from (
        current_row.last_attempt_at + make_interval(secs => p_cooldown_seconds) - now_at
      )))::integer
    );
    return jsonb_build_object(
      'allowed', false,
      'reason', 'cooldown',
      'retry_after', retry_after,
      'remaining', greatest(p_max_attempts - current_row.attempts, 0)
    );
  end if;

  if current_row.attempts >= p_max_attempts then
    retry_after := greatest(
      1,
      ceil(extract(epoch from (
        current_row.window_started_at + make_interval(secs => p_window_seconds) - now_at
      )))::integer
    );
    return jsonb_build_object(
      'allowed', false,
      'reason', 'window',
      'retry_after', retry_after,
      'remaining', 0
    );
  end if;

  update private.edge_rate_limits
  set attempts = attempts + 1,
      last_attempt_at = now_at
  where scope = p_scope and edge_rate_limits.subject_hash = v_subject_hash;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(p_max_attempts - current_row.attempts - 1, 0)
  );
end;
$$;

revoke all on function public.reserve_edge_rate_limit(text,text,integer,integer,integer)
  from public, anon, authenticated;
grant execute on function public.reserve_edge_rate_limit(text,text,integer,integer,integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- IdempotÃªncia observÃ¡vel do checkout.
-- ---------------------------------------------------------------------------

alter table public.subscriptions
  add column if not exists checkout_idempotency_key text,
  add column if not exists checkout_error_code text,
  add column if not exists checkout_last_attempt_at timestamptz,
  add column if not exists checkout_attempt_count integer not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and conname = 'subscriptions_checkout_idempotency_key_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_checkout_idempotency_key_check
      check (
        checkout_idempotency_key is null
        or (
          length(checkout_idempotency_key) between 8 and 160
          and checkout_idempotency_key ~ '^[A-Za-z0-9:_-]+$'
        )
      ) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and conname = 'subscriptions_checkout_attempt_count_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_checkout_attempt_count_check
      check (checkout_attempt_count between 0 and 10000) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.subscriptions'::regclass
      and conname = 'subscriptions_checkout_error_code_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_checkout_error_code_check
      check (
        checkout_error_code is null
        or (
          length(checkout_error_code) between 3 and 80
          and checkout_error_code ~ '^[A-Z][A-Z0-9_]+$'
        )
      ) not valid;
  end if;
end;
$$;

alter table public.subscriptions
  validate constraint subscriptions_checkout_idempotency_key_check,
  validate constraint subscriptions_checkout_attempt_count_check,
  validate constraint subscriptions_checkout_error_code_check;

create unique index if not exists subscriptions_checkout_idempotency_unique
  on public.subscriptions(user_id, product_code, checkout_idempotency_key)
  where checkout_idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- RetenÃ§Ã£o: metadados de eventos por 180 dias e contadores por 8 dias.
-- ---------------------------------------------------------------------------

create or replace function public.finflow_cleanup_external_edge_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_events bigint := 0;
  deleted_limits bigint := 0;
begin
  delete from public.subscription_events
  where (
      processed_at is not null
      and processed_at < clock_timestamp() - interval '180 days'
    ) or (
      processed_at is null
      and created_at < clock_timestamp() - interval '30 days'
      and coalesce(processing_locked_until, '-infinity'::timestamptz) <= clock_timestamp()
    );
  get diagnostics deleted_events = row_count;

  delete from private.edge_rate_limits
  where last_attempt_at < clock_timestamp() - interval '8 days';
  get diagnostics deleted_limits = row_count;

  return jsonb_build_object(
    'deleted_subscription_events', deleted_events,
    'deleted_edge_rate_limits', deleted_limits
  );
end;
$$;

revoke all on function public.finflow_cleanup_external_edge_retention()
  from public, anon, authenticated, service_role;

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname = 'finflow-cleanup-external-edge-retention';

select cron.schedule(
  'finflow-cleanup-external-edge-retention',
  '41 3 * * *',
  'select public.finflow_cleanup_external_edge_retention();'
);

select public.finflow_cleanup_external_edge_retention();

commit;
