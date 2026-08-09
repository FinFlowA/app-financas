-- FinFlow: telemetria mínima de custo da IA. Nenhum prompt, contexto, resposta
-- ou outro conteúdo do usuário é armazenado nesta tabela.

begin;

do $$
begin
  if to_regclass('public.ai_request_usage') is null
     or to_regprocedure('public.get_my_entitlement()') is null
     or to_regprocedure('private.ai_assert_authenticated()') is null then
    raise exception 'AI_SCHEMA_MISSING_MODEL_USAGE_CORE';
  end if;
end;
$$;

alter table public.ai_request_usage
  add column usage_id uuid not null default gen_random_uuid(),
  add column provider text,
  add column model text,
  add column input_tokens bigint,
  add column output_tokens bigint,
  add column request_status text not null default 'reserved',
  add column finalized_at timestamptz,
  add constraint ai_request_usage_usage_id_key unique(usage_id),
  add constraint ai_request_usage_provider_check check(
    provider is null or (
      length(btrim(provider)) between 1 and 40
    )
  ),
  add constraint ai_request_usage_model_check check(
    model is null or (
      length(btrim(model)) between 1 and 120
    )
  ),
  add constraint ai_request_usage_input_tokens_check check(
    input_tokens is null or input_tokens between 0 and 1000000000
  ),
  add constraint ai_request_usage_output_tokens_check check(
    output_tokens is null or output_tokens between 0 and 1000000000
  ),
  add constraint ai_request_usage_status_check check(
    request_status in ('reserved','completed','failed')
  ),
  add constraint ai_request_usage_finalization_check check(
    (request_status='reserved' and finalized_at is null)
    or (request_status in ('completed','failed') and finalized_at is not null)
  );

create index ai_request_usage_status_created_idx
  on public.ai_request_usage(request_status,created_at desc);

alter table public.ai_request_usage enable row level security;
revoke all on public.ai_request_usage from public,anon,authenticated;
grant all on public.ai_request_usage to service_role;

-- Limite de custo independente da cota comercial de ações. A franquia diária é
-- definida exclusivamente pelo entitlement; nenhum parâmetro do cliente a eleva.
create or replace function public.ai_reserve_model_request(
  p_limit integer default 30,
  p_window_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  entitlement record;
  effective_limit integer:=least(greatest(coalesce(p_limit,30),1),30);
  effective_window integer:=least(greatest(coalesce(p_window_seconds,60),60),3600);
  now_at timestamptz:=clock_timestamp();
  local_day date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  day_start timestamptz;
  day_end timestamptz;
  daily_limit integer;
  daily_used integer;
  minute_used integer;
  oldest_at timestamptz;
  retry_after integer:=0;
  reserved_usage_id uuid;
begin
  select * into entitlement from public.get_my_entitlement();
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;
  daily_limit:=case
    when not coalesce(entitlement.limits_enabled,false) then 300
    when entitlement.plan='premium' then 200
    when entitlement.plan='smart' then 60
    else 0
  end;
  day_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  day_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';

  perform pg_advisory_xact_lock(hashtext(caller::text),61001);
  -- Retém 90 dias de contagens agregáveis, ainda sem qualquer conteúdo sensível.
  delete from public.ai_request_usage
  where user_id=caller and created_at<day_start-interval '90 days';
  select count(*) into daily_used from public.ai_request_usage
  where user_id=caller and created_at>=day_start and created_at<day_end;
  if daily_used>=daily_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','daily','retry_after',retry_after,'usage_id',null,
      'limit',effective_limit,'used',0,'remaining',0,'window_seconds',effective_window,
      'daily_limit',daily_limit,'daily_used',daily_used,'daily_remaining',0,
      'daily_window_start',day_start,'daily_window_end',day_end,
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),min(created_at) into minute_used,oldest_at
  from public.ai_request_usage
  where user_id=caller and created_at>now_at-make_interval(secs=>effective_window);
  if minute_used>=effective_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      oldest_at+make_interval(secs=>effective_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','minute','retry_after',retry_after,'usage_id',null,
      'limit',effective_limit,'used',minute_used,'remaining',0,
      'window_seconds',effective_window,
      'daily_limit',daily_limit,'daily_used',daily_used,
      'daily_remaining',greatest(daily_limit-daily_used,0),
      'daily_window_start',day_start,'daily_window_end',day_end,
      'timezone','America/Sao_Paulo'
    );
  end if;

  insert into public.ai_request_usage(user_id,created_at)
  values(caller,now_at)
  returning usage_id into reserved_usage_id;
  minute_used:=minute_used+1;
  daily_used:=daily_used+1;
  return jsonb_build_object(
    'allowed',true,'reason',null,'retry_after',0,'usage_id',reserved_usage_id,
    'limit',effective_limit,'used',minute_used,
    'remaining',greatest(effective_limit-minute_used,0),
    'window_seconds',effective_window,
    'daily_limit',daily_limit,'daily_used',daily_used,
    'daily_remaining',greatest(daily_limit-daily_used,0),
    'daily_window_start',day_start,'daily_window_end',day_end,
    'timezone','America/Sao_Paulo'
  );
end;
$$;

-- Somente a Edge com service_role pode preencher metadados de custo. O JWT é
-- conferido além do grant para impedir uso acidental por um cliente comum.
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
  if p_status not in ('completed','failed') then perform private.ai_fail('AI_INVALID_USAGE_STATUS'); end if;

  select * into usage_row from public.ai_request_usage u
  where u.usage_id=p_usage_id for update;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
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
    request_status=p_status,finalized_at=clock_timestamp()
  where usage_id=p_usage_id;
  return jsonb_build_object(
    'ok',true,'usage_id',p_usage_id,'status',p_status,'replayed',false
  );
end;
$$;

revoke all on function public.ai_reserve_model_request(integer,integer)
  from public,anon;
grant execute on function public.ai_reserve_model_request(integer,integer)
  to authenticated,service_role;

revoke all on function public.ai_finalize_model_request(uuid,text,text,bigint,bigint,text)
  from public,anon,authenticated;
grant execute on function public.ai_finalize_model_request(uuid,text,text,bigint,bigint,text)
  to service_role;

commit;
