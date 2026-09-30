-- FinFlow: monitoramento tecnico da IA sem prompts, respostas, descricoes,
-- valores financeiros ou identificadores do usuario.

begin;

do $$
begin
  if to_regclass('public.ai_request_usage') is null
     or to_regprocedure('public.ai_finalize_model_request(uuid,text,text,bigint,bigint,text)') is null
     or to_regprocedure('private.ai_fail(text)') is null then
    raise exception 'AI_SCHEMA_MISSING_MONITORING_CORE';
  end if;
end;
$$;

alter table public.ai_request_usage
  add column if not exists latency_ms integer,
  add column if not exists error_code text;

do $$
begin
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.ai_request_usage'::regclass
      and conname='ai_request_usage_latency_ms_check'
  ) then
    alter table public.ai_request_usage add constraint
      ai_request_usage_latency_ms_check
      check(latency_ms is null or latency_ms between 0 and 300000) not valid;
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.ai_request_usage'::regclass
      and conname='ai_request_usage_error_code_check'
  ) then
    alter table public.ai_request_usage add constraint
      ai_request_usage_error_code_check
      check(error_code is null or (
        length(error_code) between 3 and 80
        and error_code ~ '^[A-Z][A-Z0-9_]+$'
      )) not valid;
  end if;
  if not exists(
    select 1 from pg_constraint
    where conrelid='public.ai_request_usage'::regclass
      and conname='ai_request_usage_monitoring_state_check'
  ) then
    alter table public.ai_request_usage add constraint
      ai_request_usage_monitoring_state_check
      check(
        (request_status='reserved' and latency_ms is null and error_code is null)
        or (request_status='completed' and error_code is null)
        or (request_status='failed' and (
          (latency_ms is null and error_code is null)
          or (latency_ms is not null and error_code is not null)
        ))
      ) not valid;
  end if;
end;
$$;

-- Linhas historicas permanecem validas ate receberem a telemetria nova.
-- A constraint de estado passa a ser validada somente para novas escritas.
alter table public.ai_request_usage
  validate constraint ai_request_usage_latency_ms_check,
  validate constraint ai_request_usage_error_code_check;

create index if not exists ai_request_usage_monitor_status_idx
  on public.ai_request_usage(created_at desc,request_status,provider,model);
create index if not exists ai_request_usage_monitor_errors_idx
  on public.ai_request_usage(created_at desc,error_code)
  where request_status='failed';

comment on column public.ai_request_usage.latency_ms is
  'Latencia tecnica total da requisicao da IA; nao contem conteudo financeiro.';
comment on column public.ai_request_usage.error_code is
  'Codigo tecnico allowlisted; nunca armazena mensagem, prompt ou resposta.';

create or replace function public.ai_finalize_model_request_v2(
  p_usage_id uuid,
  p_provider text,
  p_model text,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_status text,
  p_latency_ms integer,
  p_error_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  base_result jsonb;
  current_latency integer;
  current_error text;
  normalized_error text:=nullif(btrim(coalesce(p_error_code,'')),'');
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  if p_latency_ms is null or p_latency_ms not between 0 and 300000 then
    perform private.ai_fail('AI_INVALID_MONITORING_LATENCY');
  end if;
  if p_status='completed' and normalized_error is not null then
    perform private.ai_fail('AI_INVALID_MONITORING_ERROR');
  end if;
  if p_status='failed' and (
    normalized_error is null
    or length(normalized_error) not between 3 and 80
    or normalized_error !~ '^[A-Z][A-Z0-9_]+$'
  ) then
    perform private.ai_fail('AI_INVALID_MONITORING_ERROR');
  end if;

  base_result:=public.ai_finalize_model_request(
    p_usage_id,p_provider,p_model,p_input_tokens,p_output_tokens,p_status
  );

  select latency_ms,error_code into current_latency,current_error
  from public.ai_request_usage where usage_id=p_usage_id for update;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
  if current_latency is not null or current_error is not null then
    if current_latency is distinct from p_latency_ms
       or current_error is distinct from normalized_error then
      perform private.ai_fail('AI_USAGE_MONITORING_CONFLICT');
    end if;
    return base_result || jsonb_build_object('monitoring_replayed',true);
  end if;

  update public.ai_request_usage
  set latency_ms=p_latency_ms,error_code=normalized_error
  where usage_id=p_usage_id;
  return base_result || jsonb_build_object('monitoring_replayed',false);
end;
$$;

revoke all on function public.ai_finalize_model_request_v2(
  uuid,text,text,bigint,bigint,text,integer,text
) from public,anon,authenticated;
grant execute on function public.ai_finalize_model_request_v2(
  uuid,text,text,bigint,bigint,text,integer,text
) to service_role;

-- Resumo agregado para observabilidade. Nao retorna user_id, usage_id nem
-- qualquer campo de conversa/contexto. Acesso exclusivo da operacao backend.
create or replace function public.ai_monitor_health(p_window_minutes integer default 60)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  safe_window integer:=least(greatest(coalesce(p_window_minutes,60),5),10080);
  cutoff timestamptz;
  total_count bigint;
  completed_count bigint;
  failed_count bigint;
  reserved_count bigint;
  average_latency numeric;
  p95_latency numeric;
  last_event timestamptz;
  last_success timestamptz;
  provider_rows jsonb;
  error_rows jsonb;
  health_status text;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  cutoff:=statement_timestamp()-make_interval(mins=>safe_window);

  select count(*),
    count(*) filter(where request_status='completed'),
    count(*) filter(where request_status='failed'),
    count(*) filter(where request_status='reserved'),
    round(avg(latency_ms)::numeric,2),
    round((percentile_cont(0.95) within group(order by latency_ms))::numeric,2),
    max(created_at),
    max(finalized_at) filter(where request_status='completed')
  into total_count,completed_count,failed_count,reserved_count,
    average_latency,p95_latency,last_event,last_success
  from public.ai_request_usage
  where created_at>=cutoff;

  select coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.requests desc),'[]'::jsonb)
  into provider_rows
  from (
    select coalesce(provider,'reserved') as provider,
      coalesce(model,'reserved') as model,
      request_status as status,
      count(*) as requests,
      round(avg(latency_ms)::numeric,2) as average_latency_ms
    from public.ai_request_usage
    where created_at>=cutoff
    group by provider,model,request_status
  ) grouped;

  select coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.occurrences desc),'[]'::jsonb)
  into error_rows
  from (
    select error_code,count(*) as occurrences,max(finalized_at) as last_seen_at
    from public.ai_request_usage
    where created_at>=cutoff and request_status='failed' and error_code is not null
    group by error_code
    order by count(*) desc
    limit 20
  ) grouped;

  health_status:=case
    when total_count=0 then 'no_data'
    when reserved_count>greatest(3,total_count/4) then 'degraded'
    when failed_count::numeric/nullif(total_count,0)>=0.25 then 'degraded'
    when failed_count>0 then 'attention'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status',health_status,
    'window_minutes',safe_window,
    'generated_at',statement_timestamp(),
    'requests',total_count,
    'completed',completed_count,
    'failed',failed_count,
    'reserved',reserved_count,
    'failure_rate',case when total_count=0 then 0
      else round((failed_count::numeric/total_count::numeric)*100,2) end,
    'average_latency_ms',average_latency,
    'p95_latency_ms',p95_latency,
    'last_event_at',last_event,
    'last_success_at',last_success,
    'providers',provider_rows,
    'errors',error_rows
  );
end;
$$;

revoke all on function public.ai_monitor_health(integer)
  from public,anon,authenticated;
grant execute on function public.ai_monitor_health(integer)
  to service_role;

commit;
