-- FinFlow: aplica retenção global da IA fora do caminho crítico das mensagens
-- e amplia a defesa contra segredos no histórico persistido.

begin;

do $$
begin
  if to_regclass('public.ai_conversations') is null
     or to_regclass('public.ai_pending_actions') is null
     or to_regclass('public.ai_action_audit') is null
     or to_regclass('public.ai_request_usage') is null
     or to_regclass('public.ai_messages') is null
     or to_regclass('public.billing_settings') is null
     or to_regclass('public.subscriptions') is null
     or to_regprocedure('private.ai_fail(text)') is null then
    raise exception 'AI_SCHEMA_MISSING_RETENTION_CORE';
  end if;
end;
$$;

create index if not exists ai_conversations_updated_at_idx
  on public.ai_conversations(updated_at);
create index if not exists ai_pending_actions_updated_at_idx
  on public.ai_pending_actions(updated_at);
create index if not exists ai_action_audit_created_at_idx
  on public.ai_action_audit(created_at);
create index if not exists ai_request_usage_created_at_idx
  on public.ai_request_usage(created_at);
create index if not exists ai_messages_created_at_idx
  on public.ai_messages(created_at);

alter table public.billing_settings
  add column if not exists ai_global_requests_per_day integer not null default 900,
  add column if not exists ai_global_requests_per_minute integer not null default 100,
  add column if not exists ai_global_tokens_per_day bigint not null default 5000000,
  add column if not exists ai_global_tokens_per_minute bigint not null default 180000;

alter table public.billing_settings
  alter column ai_global_requests_per_day set default 900,
  alter column ai_global_requests_per_minute set default 100,
  alter column ai_global_tokens_per_day set default 5000000,
  alter column ai_global_tokens_per_minute set default 180000;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.billing_settings'::regclass
      and conname='billing_settings_ai_global_requests_day_check'
  ) then
    alter table public.billing_settings add constraint
      billing_settings_ai_global_requests_day_check
      check(ai_global_requests_per_day between 100 and 1000000) not valid;
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.billing_settings'::regclass
      and conname='billing_settings_ai_global_requests_minute_check'
  ) then
    alter table public.billing_settings add constraint
      billing_settings_ai_global_requests_minute_check
      check(ai_global_requests_per_minute between 10 and 10000) not valid;
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.billing_settings'::regclass
      and conname='billing_settings_ai_global_tokens_day_check'
  ) then
    alter table public.billing_settings add constraint
      billing_settings_ai_global_tokens_day_check
      check(ai_global_tokens_per_day between 10000 and 1000000000000) not valid;
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.billing_settings'::regclass
      and conname='billing_settings_ai_global_tokens_minute_check'
  ) then
    alter table public.billing_settings add constraint
      billing_settings_ai_global_tokens_minute_check
      check(ai_global_tokens_per_minute between 1000 and 1000000000) not valid;
  end if;
end;
$$;

alter table public.billing_settings
  validate constraint billing_settings_ai_global_requests_day_check,
  validate constraint billing_settings_ai_global_requests_minute_check,
  validate constraint billing_settings_ai_global_tokens_day_check,
  validate constraint billing_settings_ai_global_tokens_minute_check;

alter table public.ai_request_usage
  add column if not exists reserved_input_tokens bigint not null default 0,
  add column if not exists reserved_output_tokens bigint not null default 0,
  add column if not exists token_reserved_at timestamptz;

-- Linhas de telemetria anteriores a esta migration usavam `created_at` como a
-- melhor aproximação do instante da chamada externa.
update public.ai_request_usage
set token_reserved_at=created_at
where token_reserved_at is null
  and provider is not null
  and provider<>'not_called';

create index if not exists ai_request_usage_token_reserved_at_idx
  on public.ai_request_usage(token_reserved_at)
  where token_reserved_at is not null;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.ai_request_usage'::regclass
      and conname='ai_request_usage_reserved_input_tokens_check'
  ) then
    alter table public.ai_request_usage add constraint
      ai_request_usage_reserved_input_tokens_check
      check(reserved_input_tokens between 0 and 1000000000) not valid;
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.ai_request_usage'::regclass
      and conname='ai_request_usage_reserved_output_tokens_check'
  ) then
    alter table public.ai_request_usage add constraint
      ai_request_usage_reserved_output_tokens_check
      check(reserved_output_tokens between 0 and 1000000000) not valid;
  end if;
end;
$$;

alter table public.ai_request_usage
  validate constraint ai_request_usage_reserved_input_tokens_check,
  validate constraint ai_request_usage_reserved_output_tokens_check;

-- O slot inicial de RPM/RPD é exclusivo da Edge com service_role. A chamada
-- externa só fica autorizada depois do ajuste atômico de TPM/TPD abaixo. Assim,
-- um cliente autenticado não consegue inflar a telemetria nem o disjuntor.
create or replace function public.ai_reserve_model_request_v2(
  p_user_id uuid,
  p_user_limit integer,
  p_window_seconds integer,
  p_estimated_input_tokens bigint,
  p_max_output_tokens bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits_on boolean;
  current_plan text;
  global_daily_limit integer;
  global_minute_limit integer;
  global_daily_token_limit bigint;
  global_minute_token_limit bigint;
  effective_user_limit integer:=least(greatest(coalesce(p_user_limit,8),1),30);
  effective_window integer:=least(greatest(coalesce(p_window_seconds,60),60),3600);
  global_window integer:=60;
  reserved_token_total bigint;
  now_at timestamptz:=clock_timestamp();
  local_day date:=(now_at at time zone 'America/Sao_Paulo')::date;
  day_start timestamptz;
  day_end timestamptz;
  user_daily_limit integer;
  user_daily_used integer;
  user_daily_attempt_limit integer;
  user_daily_attempts integer;
  user_minute_used integer;
  global_daily_used integer;
  global_minute_used integer;
  global_daily_tokens_used bigint;
  global_minute_tokens_used bigint;
  user_oldest_at timestamptz;
  global_oldest_at timestamptz;
  global_newest_at timestamptz;
  retry_after integer:=0;
  reserved_usage_id uuid;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;
  if p_estimated_input_tokens is null
     or p_estimated_input_tokens not between 1 and 1000000000
     or p_max_output_tokens is null
     or p_max_output_tokens not between 1 and 1000000000 then
    perform private.ai_fail('AI_INVALID_TOKEN_ESTIMATE');
  end if;
  reserved_token_total:=p_estimated_input_tokens+p_max_output_tokens;

  select limits_enabled,ai_global_requests_per_day,ai_global_requests_per_minute,
    ai_global_tokens_per_day,ai_global_tokens_per_minute
  into limits_on,global_daily_limit,global_minute_limit,
    global_daily_token_limit,global_minute_token_limit
  from public.billing_settings where id=true;
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;

  select coalesce((
    select s.plan from public.subscriptions s
    where s.user_id=p_user_id
      and (
        s.status in ('active','grace_period')
        or (s.status='cancelled' and s.access_until>now_at)
      )
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc
    limit 1
  ),'free') into current_plan;

  user_daily_limit:=case
    when not coalesce(limits_on,false) then 300
    when current_plan='premium' then 200
    when current_plan='smart' then 60
    else 0
  end;
  user_daily_attempt_limit:=case
    when user_daily_limit<=0 then 0 else user_daily_limit*2
  end;
  day_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  day_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';

  -- Ordem fixa global→usuário evita deadlock entre requisições concorrentes.
  perform pg_advisory_xact_lock(61005,1);
  perform pg_advisory_xact_lock(hashtext(p_user_id::text),61001);

  if reserved_token_total>global_minute_token_limit
     or reserved_token_total>global_daily_token_limit then
    return jsonb_build_object(
      'allowed',false,'reason','request_tokens','retry_after',0,'usage_id',null,
      'daily_limit',user_daily_limit,
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_minute_limit',global_minute_token_limit,
      'estimated_input_tokens',p_estimated_input_tokens,
      'max_output_tokens',p_max_output_tokens,
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*)
  into global_daily_used
  from public.ai_request_usage
  where created_at>=day_start and created_at<day_end;
  select coalesce(sum(greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )),0)::bigint
  into global_daily_tokens_used
  from public.ai_request_usage
  where token_reserved_at>=day_start and token_reserved_at<day_end;
  if global_daily_used>=global_daily_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_daily','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,'daily_remaining',0,
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',0,
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_daily_used',global_daily_tokens_used,
      'global_token_daily_remaining',greatest(global_daily_token_limit-global_daily_tokens_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  if global_daily_tokens_used+reserved_token_total>global_daily_token_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_tokens_daily','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_daily_used',global_daily_tokens_used,
      'global_token_daily_remaining',greatest(global_daily_token_limit-global_daily_tokens_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),min(created_at)
  into global_minute_used,global_oldest_at
  from public.ai_request_usage
  where created_at>now_at-make_interval(secs=>global_window);
  select max(token_reserved_at),coalesce(sum(greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )),0)::bigint
  into global_newest_at,global_minute_tokens_used
  from public.ai_request_usage
  where token_reserved_at>now_at-make_interval(secs=>global_window);
  if global_minute_used>=global_minute_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      global_oldest_at+make_interval(secs=>global_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_minute','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'global_token_minute_limit',global_minute_token_limit,
      'global_token_minute_used',global_minute_tokens_used,
      'global_token_minute_remaining',greatest(global_minute_token_limit-global_minute_tokens_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  if global_minute_tokens_used+reserved_token_total>global_minute_token_limit then
    -- Aguarda a janela inteira desde a reserva mais nova. É conservador, mas
    -- evita ciclos de nova tentativa enquanto ainda há tokens na janela.
    retry_after:=greatest(1,ceil(extract(epoch from (
      global_newest_at+make_interval(secs=>global_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_tokens_minute','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'global_token_minute_limit',global_minute_token_limit,
      'global_token_minute_used',global_minute_tokens_used,
      'global_token_minute_remaining',greatest(global_minute_token_limit-global_minute_tokens_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),count(*) filter(where not (
    request_status='failed' and provider is not distinct from 'not_called'
  ))
  into user_daily_attempts,user_daily_used
  from public.ai_request_usage
  where user_id=p_user_id and created_at>=day_start and created_at<day_end;
  if user_daily_attempt_limit>0
     and user_daily_used<user_daily_limit
     and user_daily_attempts>=user_daily_attempt_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','user_daily_attempts','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,
      'daily_used',user_daily_used,
      'daily_remaining',greatest(user_daily_limit-user_daily_used,0),
      'attempt_limit',user_daily_attempt_limit,
      'attempt_used',user_daily_attempts,
      'timezone','America/Sao_Paulo'
    );
  end if;
  if user_daily_used>=user_daily_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','daily','retry_after',retry_after,'usage_id',null,
      'daily_limit',user_daily_limit,'daily_used',user_daily_used,
      'daily_remaining',0,'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),min(created_at) into user_minute_used,user_oldest_at
  from public.ai_request_usage
  where user_id=p_user_id
    and created_at>now_at-make_interval(secs=>effective_window);
  if user_minute_used>=effective_user_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      user_oldest_at+make_interval(secs=>effective_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','minute','retry_after',retry_after,'usage_id',null,
      'daily_limit',user_daily_limit,'daily_used',user_daily_used,
      'daily_remaining',greatest(user_daily_limit-user_daily_used,0),
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  insert into public.ai_request_usage(
    user_id,created_at,reserved_input_tokens,reserved_output_tokens
  )
  values(p_user_id,now_at,p_estimated_input_tokens,p_max_output_tokens)
  returning usage_id into reserved_usage_id;
  return jsonb_build_object(
    'allowed',true,'reason',null,'retry_after',0,'usage_id',reserved_usage_id,
    'limit',effective_user_limit,'used',user_minute_used+1,
    'remaining',greatest(effective_user_limit-user_minute_used-1,0),
    'window_seconds',effective_window,
    'daily_limit',user_daily_limit,'daily_used',user_daily_used+1,
    'daily_remaining',greatest(user_daily_limit-user_daily_used-1,0),
    'attempt_limit',user_daily_attempt_limit,
    'attempt_used',user_daily_attempts+1,
    'global_daily_limit',global_daily_limit,
    'global_daily_remaining',greatest(global_daily_limit-global_daily_used-1,0),
    'global_token_daily_limit',global_daily_token_limit,
    'global_token_daily_remaining',greatest(
      global_daily_token_limit-global_daily_tokens_used-reserved_token_total,0
    ),
    'global_token_minute_limit',global_minute_token_limit,
    'global_token_minute_remaining',greatest(
      global_minute_token_limit-global_minute_tokens_used-reserved_token_total,0
    ),
    'timezone','America/Sao_Paulo'
  );
end;
$$;

revoke all on function public.ai_reserve_model_request_v2(uuid,integer,integer,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.ai_reserve_model_request_v2(uuid,integer,integer,bigint,bigint)
  to service_role;

-- Segunda fase: depois de montar o contexto, troca o slot mínimo pelo orçamento
-- conservador real. A mesma trava global serializa ajuste, nova reserva e
-- finalização; portanto, nenhuma chamada externa começa sem TPM/TPD reservado.
create or replace function public.ai_adjust_model_request_v2(
  p_usage_id uuid,
  p_estimated_input_tokens bigint,
  p_max_output_tokens bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_row public.ai_request_usage%rowtype;
  usage_user_id uuid;
  global_daily_token_limit bigint;
  global_minute_token_limit bigint;
  desired_token_total bigint;
  global_daily_tokens_used bigint;
  global_minute_tokens_used bigint;
  global_newest_at timestamptz;
  now_at timestamptz:=clock_timestamp();
  local_day date:=(now_at at time zone 'America/Sao_Paulo')::date;
  day_start timestamptz;
  day_end timestamptz;
  retry_after integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  if p_usage_id is null then perform private.ai_fail('AI_INVALID_USAGE_ID'); end if;
  if p_estimated_input_tokens is null
     or p_estimated_input_tokens not between 1 and 1000000000
     or p_max_output_tokens is null
     or p_max_output_tokens not between 1 and 1000000000 then
    perform private.ai_fail('AI_INVALID_TOKEN_ESTIMATE');
  end if;
  desired_token_total:=p_estimated_input_tokens+p_max_output_tokens;

  select u.user_id into usage_user_id
  from public.ai_request_usage u where u.usage_id=p_usage_id;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;

  -- Mantém exatamente a mesma ordem das outras operações do ledger.
  perform pg_advisory_xact_lock(61005,1);
  perform pg_advisory_xact_lock(hashtext(usage_user_id::text),61001);

  select * into usage_row from public.ai_request_usage u
  where u.usage_id=p_usage_id for update;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
  if usage_row.request_status<>'reserved' then
    perform private.ai_fail('AI_USAGE_ADJUSTMENT_CONFLICT');
  end if;
  if usage_row.reserved_input_tokens=p_estimated_input_tokens
     and usage_row.reserved_output_tokens=p_max_output_tokens
     and usage_row.token_reserved_at is not null then
    return jsonb_build_object(
      'allowed',true,'reason',null,'retry_after',0,'usage_id',p_usage_id,
      'replayed',true,'estimated_input_tokens',p_estimated_input_tokens,
      'max_output_tokens',p_max_output_tokens
    );
  end if;
  if usage_row.token_reserved_at is not null then
    perform private.ai_fail('AI_USAGE_ADJUSTMENT_CONFLICT');
  end if;

  select ai_global_tokens_per_day,ai_global_tokens_per_minute
  into global_daily_token_limit,global_minute_token_limit
  from public.billing_settings where id=true;
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;
  if desired_token_total>global_minute_token_limit
     or desired_token_total>global_daily_token_limit then
    return jsonb_build_object(
      'allowed',false,'reason','request_tokens','retry_after',0,
      'usage_id',p_usage_id,'replayed',false,
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_minute_limit',global_minute_token_limit
    );
  end if;

  day_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  day_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';
  select coalesce(sum(greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )),0)::bigint
  into global_daily_tokens_used
  from public.ai_request_usage
  where usage_id<>p_usage_id
    and token_reserved_at>=day_start and token_reserved_at<day_end;
  if global_daily_tokens_used+desired_token_total>global_daily_token_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_tokens_daily','retry_after',retry_after,
      'usage_id',p_usage_id,'replayed',false,
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_daily_used',global_daily_tokens_used,
      'global_token_daily_remaining',greatest(
        global_daily_token_limit-global_daily_tokens_used,0
      )
    );
  end if;

  select coalesce(sum(greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )),0)::bigint,
  max(token_reserved_at) filter(where greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )>0)
  into global_minute_tokens_used,global_newest_at
  from public.ai_request_usage
  where usage_id<>p_usage_id
    and token_reserved_at>now_at-interval '60 seconds';
  if global_minute_tokens_used+desired_token_total>global_minute_token_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      coalesce(global_newest_at,now_at)+interval '60 seconds'-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_tokens_minute','retry_after',retry_after,
      'usage_id',p_usage_id,'replayed',false,
      'global_token_minute_limit',global_minute_token_limit,
      'global_token_minute_used',global_minute_tokens_used,
      'global_token_minute_remaining',greatest(
        global_minute_token_limit-global_minute_tokens_used,0
      )
    );
  end if;

  update public.ai_request_usage
  set reserved_input_tokens=p_estimated_input_tokens,
      reserved_output_tokens=p_max_output_tokens,
      token_reserved_at=clock_timestamp()
  where usage_id=p_usage_id;
  return jsonb_build_object(
    'allowed',true,'reason',null,'retry_after',0,'usage_id',p_usage_id,
    'replayed',false,'estimated_input_tokens',p_estimated_input_tokens,
    'max_output_tokens',p_max_output_tokens,
    'global_token_daily_limit',global_daily_token_limit,
    'global_token_daily_remaining',greatest(
      global_daily_token_limit-global_daily_tokens_used-desired_token_total,0
    ),
    'global_token_minute_limit',global_minute_token_limit,
    'global_token_minute_remaining',greatest(
      global_minute_token_limit-global_minute_tokens_used-desired_token_total,0
    )
  );
end;
$$;

revoke all on function public.ai_adjust_model_request_v2(uuid,bigint,bigint)
  from public,anon,authenticated;
grant execute on function public.ai_adjust_model_request_v2(uuid,bigint,bigint)
  to service_role;

-- Remove uma eventual assinatura v2 anterior, sem reserva de tokens. A remoção
-- é segura porque esta migration ainda não publica a Edge que usa a assinatura nova.
do $$
begin
  if to_regprocedure('public.ai_reserve_model_request_v2(uuid,integer,integer)') is not null then
    revoke all on function public.ai_reserve_model_request_v2(uuid,integer,integer)
      from public,anon,authenticated,service_role;
    drop function public.ai_reserve_model_request_v2(uuid,integer,integer);
  end if;
end;
$$;

-- Ao concluir, a reserva máxima é substituída pelo uso real. Falha comprovada
-- antes do provedor também a libera; falha depois de iniciar a chamada preserva
-- a reserva, pois um 2xx com resposta inválida pode ter consumido tokens.
create or replace function public.ai_finalize_model_request(
  p_usage_id uuid,
  p_provider text,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_status text default 'completed'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  usage_row public.ai_request_usage%rowtype;
  usage_user_id uuid;
  normalized_provider text:=btrim(coalesce(p_provider,''));
  normalized_model text:=btrim(coalesce(p_model,''));
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  if p_usage_id is null then perform private.ai_fail('AI_INVALID_USAGE_ID'); end if;
  if length(normalized_provider) not between 1 and 40
     or length(normalized_model) not between 1 and 120 then
    perform private.ai_fail('AI_INVALID_MODEL_METADATA');
  end if;
  if p_input_tokens is null or p_input_tokens not between 0 and 1000000000
     or p_output_tokens is null or p_output_tokens not between 0 and 1000000000 then
    perform private.ai_fail('AI_INVALID_TOKEN_USAGE');
  end if;
  if p_status not in ('completed','failed') then
    perform private.ai_fail('AI_INVALID_USAGE_STATUS');
  end if;
  if p_status='completed' and (
    normalized_provider not in ('openai','groq')
    or normalized_model in ('not_called','unknown')
    or p_input_tokens<=0 or p_output_tokens<=0
  ) then
    perform private.ai_fail('AI_INVALID_COMPLETED_USAGE');
  end if;
  if p_status='failed' and normalized_provider='not_called' and (
    normalized_model<>'not_called'
    or p_input_tokens<>0 or p_output_tokens<>0
  ) then
    perform private.ai_fail('AI_INVALID_RELEASED_USAGE');
  end if;

  select u.user_id into usage_user_id from public.ai_request_usage u
  where u.usage_id=p_usage_id;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
  -- A finalização usa a mesma ordem global→usuário da reserva. Enquanto ela
  -- espera, o disjuntor continua vendo a reserva máxima, que é o estado seguro.
  perform pg_advisory_xact_lock(61005,1);
  perform pg_advisory_xact_lock(hashtext(usage_user_id::text),61001);

  select * into usage_row from public.ai_request_usage u
  where u.usage_id=p_usage_id for update;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
  if p_status='completed' and usage_row.token_reserved_at is null then
    perform private.ai_fail('AI_USAGE_NOT_ADJUSTED');
  end if;
  if usage_row.request_status<>'reserved' then
    if usage_row.provider=normalized_provider
       and usage_row.model=normalized_model
       and usage_row.input_tokens=p_input_tokens
       and usage_row.output_tokens=p_output_tokens
       and usage_row.request_status=p_status then
      return jsonb_build_object(
        'ok',true,'usage_id',p_usage_id,'status',p_status,'replayed',true
      );
    end if;
    perform private.ai_fail('AI_USAGE_FINALIZATION_CONFLICT');
  end if;

  update public.ai_request_usage
  set provider=normalized_provider,model=normalized_model,
    input_tokens=p_input_tokens,output_tokens=p_output_tokens,
    reserved_input_tokens=case
      when p_status='completed'
        or (normalized_provider='not_called' and normalized_model='not_called')
      then 0 else reserved_input_tokens
    end,
    reserved_output_tokens=case
      when p_status='completed'
        or (normalized_provider='not_called' and normalized_model='not_called')
      then 0 else reserved_output_tokens
    end,
    request_status=p_status,finalized_at=clock_timestamp()
  where usage_id=p_usage_id;
  return jsonb_build_object(
    'ok',true,'usage_id',p_usage_id,'status',p_status,'replayed',false
  );
end;
$$;

revoke all on function public.ai_finalize_model_request(uuid,text,text,bigint,bigint,text)
  from public,anon,authenticated;
grant execute on function public.ai_finalize_model_request(uuid,text,text,bigint,bigint,text)
  to service_role;

-- Consultas que falharam comprovadamente antes de contatar o provedor deixam
-- telemetria técnica, mas não consomem a franquia exibida ao usuário. Reservas
-- em aberto e qualquer tentativa externa continuam contando de forma segura.
create or replace function private.ai_action_quota(caller uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitlement record;
  local_day date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  window_start timestamptz;
  window_end timestamptz;
  action_limit integer;
  used_count integer;
  model_limit integer;
  model_used integer;
begin
  if caller is null or caller is distinct from (select auth.uid()) then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;
  select * into entitlement from public.get_my_entitlement();
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;
  window_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  window_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';
  action_limit:=case
    when not coalesce(entitlement.limits_enabled,false) then -1
    when entitlement.plan='premium' then 50
    when entitlement.plan='smart' then 15
    else 0
  end;
  model_limit:=case
    when not coalesce(entitlement.limits_enabled,false) then 300
    when entitlement.plan='premium' then 200
    when entitlement.plan='smart' then 60
    else 0
  end;
  select count(*) into used_count
  from public.ai_action_audit a
  where a.user_id=caller and a.event_type='succeeded'
    and a.action_id is not null
    and a.created_at>=window_start and a.created_at<window_end;
  select count(*) into model_used
  from public.ai_request_usage u
  where u.user_id=caller
    and u.created_at>=window_start and u.created_at<window_end
    and not (u.request_status='failed' and u.provider is not distinct from 'not_called');
  return jsonb_build_object(
    'plan',coalesce(entitlement.plan,'free'),
    'limits_enabled',coalesce(entitlement.limits_enabled,false),
    'limit',action_limit,
    'used',used_count,
    'remaining',case
      when action_limit<0 then -1 else greatest(action_limit-used_count,0)
    end,
    'model_limit',model_limit,
    'model_used',model_used,
    'model_remaining',greatest(model_limit-model_used,0),
    'window_start',window_start,
    'window_end',window_end,
    'timezone','America/Sao_Paulo'
  );
end;
$$;

revoke all on function private.ai_action_quota(uuid)
  from public,anon,authenticated;

-- A versão antiga aceitava chamada direta do cliente. Ela deixa de ser usada
-- pela Edge e é fechada para impedir reserva falsa e negação de serviço.
revoke all on function public.ai_reserve_model_request(integer,integer)
  from public,anon,authenticated,service_role;

do $$
begin
  if exists(
    select 1 from pg_constraint
    where conrelid='public.ai_messages'::regclass
      and conname='ai_messages_no_sensitive_data_check'
  ) then
    alter table public.ai_messages
      drop constraint ai_messages_no_sensitive_data_check;
  end if;
  alter table public.ai_messages
    add constraint ai_messages_no_sensitive_data_check check (
      content !~* (
        '('
        || 'sb_secret_[A-Za-z0-9_-]*'
        || '|service_role[^[:space:]]{0,8}[=:]'
        || '|gsk_[A-Za-z0-9_-]{20,}'
        || '|authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{20,}'
        || '|xkeysib-[A-Za-z0-9_-]{20,}'
        || '|xai-[A-Za-z0-9_-]{20,}'
        || '|sk-(ant-)?[A-Za-z0-9_-]{20,}'
        || '|AIza[A-Za-z0-9_-]{20,}'
        || '|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
        || '|[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}'
        || '|(senha([[:space:]]+(banc[aá]ria|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|password|pin([[:space:]]+(banc[aá]rio|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|c[oó]digo[[:space:]]+(banc[aá]rio|de[[:space:]]+(acesso|seguran[cç]a|verifica[cç][aã]o|autentica[cç][aã]o)|do[[:space:]]+(app|cart[aã]o|internet[[:space:]]+banking)))[[:space:]]*(é|e|eh|:|=)[[:space:]]*[^[:space:],;]{3,}'
        || '|(minha|meu)[[:space:]]+(senha([[:space:]]+(banc[aá]ria|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|password|pin([[:space:]]+(banc[aá]rio|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|c[oó]digo[[:space:]]+(banc[aá]rio|de[[:space:]]+(acesso|seguran[cç]a|verifica[cç][aã]o|autentica[cç][aã]o)|do[[:space:]]+(app|cart[aã]o|internet[[:space:]]+banking)))[[:space:]]+((é|e|eh)[[:space:]]+)?[^[:space:],;]{3,}'
        || ')'
      )
    ) not valid;
end;
$$;

-- `NOT VALID` evita que um legado inseguro interrompa a implantação. Antes de
-- validar, o conteúdo integral dessas poucas mensagens é substituído: tentar
-- preservar trechos poderia deixar uma segunda credencial não reconhecida.
update public.ai_messages
set content='[Conteúdo removido automaticamente por segurança.]'
where content ~* (
  '('
  || 'sb_secret_[A-Za-z0-9_-]*'
  || '|service_role[^[:space:]]{0,8}[=:]'
  || '|gsk_[A-Za-z0-9_-]{20,}'
  || '|authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{20,}'
  || '|xkeysib-[A-Za-z0-9_-]{20,}'
  || '|xai-[A-Za-z0-9_-]{20,}'
  || '|sk-(ant-)?[A-Za-z0-9_-]{20,}'
  || '|AIza[A-Za-z0-9_-]{20,}'
  || '|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'
  || '|[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}'
  || '|(senha([[:space:]]+(banc[aá]ria|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|password|pin([[:space:]]+(banc[aá]rio|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|c[oó]digo[[:space:]]+(banc[aá]rio|de[[:space:]]+(acesso|seguran[cç]a|verifica[cç][aã]o|autentica[cç][aã]o)|do[[:space:]]+(app|cart[aã]o|internet[[:space:]]+banking)))[[:space:]]*(é|e|eh|:|=)[[:space:]]*[^[:space:],;]{3,}'
  || '|(minha|meu)[[:space:]]+(senha([[:space:]]+(banc[aá]ria|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|password|pin([[:space:]]+(banc[aá]rio|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|c[oó]digo[[:space:]]+(banc[aá]rio|de[[:space:]]+(acesso|seguran[cç]a|verifica[cç][aã]o|autentica[cç][aã]o)|do[[:space:]]+(app|cart[aã]o|internet[[:space:]]+banking)))[[:space:]]+((é|e|eh)[[:space:]]+)?[^[:space:],;]{3,}'
  || ')'
);

alter table public.ai_messages
  validate constraint ai_messages_no_sensitive_data_check;

create or replace function public.finflow_cleanup_ai_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  chat_cutoff timestamptz:=clock_timestamp()-interval '30 days';
  usage_cutoff timestamptz:=clock_timestamp()-interval '90 days';
  deleted_messages bigint:=0;
  deleted_conversations bigint:=0;
  deleted_actions bigint:=0;
  deleted_audit bigint:=0;
  deleted_usage bigint:=0;
begin
  -- Auditoria operacional e propostas contêm cópias de dados financeiros e
  -- seguem a mesma janela de 30 dias do chat. O lançamento confirmado continua
  -- existindo normalmente nas tabelas financeiras canônicas.
  delete from public.ai_action_audit
  where created_at<chat_cutoff;
  get diagnostics deleted_audit=row_count;

  delete from public.ai_pending_actions
  where updated_at<chat_cutoff;
  get diagnostics deleted_actions=row_count;

  -- Uma conversa ativa pode durar meses. A retenção é aplicada a cada mensagem,
  -- e não apenas ao `updated_at` da conversa pai.
  delete from public.ai_messages
  where created_at<chat_cutoff;
  get diagnostics deleted_messages=row_count;

  delete from public.ai_conversations c
  where c.updated_at<chat_cutoff
    and not exists(
      select 1 from public.ai_messages m
      where m.conversation_id=c.id and m.created_at>=chat_cutoff
    );
  get diagnostics deleted_conversations=row_count;

  -- Telemetria não contém prompts nem respostas e tem janela técnica maior.
  delete from public.ai_request_usage
  where created_at<usage_cutoff;
  get diagnostics deleted_usage=row_count;

  return jsonb_build_object(
    'deleted_messages',deleted_messages,
    'deleted_conversations',deleted_conversations,
    'deleted_actions',deleted_actions,
    'deleted_audit',deleted_audit,
    'deleted_usage',deleted_usage
  );
end;
$$;

revoke all on function public.finflow_cleanup_ai_retention()
  from public,anon,authenticated,service_role;

-- Análises já consomem a franquia de consultas ao modelo. Elas não são
-- mutações financeiras e, portanto, não podem reduzir também a cota de ações.
revoke all on function public.ai_consume_analytical_action(text,text)
  from public,anon,authenticated,service_role;

delete from public.ai_action_audit
where action_id is null
  and action_type in ('category_analysis','budget_analysis','financial_projection');

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname='finflow-cleanup-ai-retention';

select cron.schedule(
  'finflow-cleanup-ai-retention',
  '23 3 * * *',
  'select public.finflow_cleanup_ai_retention();'
);

select public.finflow_cleanup_ai_retention();

commit;
