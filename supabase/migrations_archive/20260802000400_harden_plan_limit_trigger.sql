-- FinFlow: serializa a aplicação dos limites de recursos do plano e fecha o
-- bypass por reativações/realocações concorrentes.

begin;

do $$
begin
  if to_regprocedure('public.enforce_finflow_plan_limit()') is null
     or to_regprocedure('private.ai_action_quota(uuid)') is null
     or to_regprocedure('public.ai_create_pending_action(text,jsonb,text,integer)') is null
     or to_regprocedure('public.ai_consume_pending_action(uuid,uuid)') is null
     or to_regclass('public.ai_request_usage') is null
     or to_regclass('public.contas') is null
     or to_regclass('public.cartoes') is null
     or to_regclass('public.caixinhas') is null
     or to_regclass('public.categorias') is null
     or to_regclass('public.transacoes') is null then
    raise exception 'AI_SCHEMA_MISSING_PLAN_LIMIT_CORE';
  end if;
end;
$$;

create or replace function public.enforce_finflow_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits_on boolean;
  current_plan text;
  allowed_count integer;
  used_count integer;
  should_enforce boolean:=false;
  old_active boolean;
  new_active boolean;
  actor_id uuid;
  jwt_role text;
  privileged_execution boolean:=false;
begin
  actor_id:=(select auth.uid());
  jwt_role:=coalesce((select auth.jwt()->>'role'),'');
  -- `session_user` não é alterado por SECURITY DEFINER. Conexões diretas de
  -- manutenção só são privilegiadas quando a sessão do banco é explicitamente
  -- administrativa; `anon`/`authenticator` nunca entram nesse caminho. Em uma
  -- requisição normal, somente a role JWT assinada `service_role` é privilegiada.
  privileged_execution:=jwt_role='service_role' or (
    actor_id is null and session_user in ('postgres','supabase_admin')
  );

  -- A titularidade não é um campo editável pelo aplicativo. Essa validação
  -- ocorre antes do atalho de limites desligados para não depender apenas de
  -- RLS e não abrir um bypass anônimo.
  if tg_op='UPDATE'
     and new.user_id is distinct from old.user_id
     and not privileged_execution then
    raise exception using errcode='42501',message='invalid resource owner';
  end if;
  if not privileged_execution
     and (actor_id is null or new.user_id is distinct from actor_id) then
    raise exception using errcode='42501',message='invalid resource owner';
  end if;

  select limits_enabled into limits_on
  from public.billing_settings where id=true;
  if not coalesce(limits_on,false) then return new; end if;

  -- INSERT sempre passa pela regra existente. Em UPDATE, somente uma transição
  -- que consome uma nova vaga do plano deve ser contada; edições comuns não
  -- podem falhar apenas porque o usuário já atingiu o teto.
  if tg_op='INSERT' then
    should_enforce:=true;
  elsif tg_op='UPDATE' then
    if tg_table_name='contas' then
      should_enforce:=coalesce(old.arquivado,false)
        and not coalesce(new.arquivado,false);
    elsif tg_table_name='cartoes' then
      should_enforce:=not coalesce(old.ativo,true)
        and coalesce(new.ativo,true);
    elsif tg_table_name='caixinhas' then
      should_enforce:=coalesce(old.arquivado,false)
        and not coalesce(new.arquivado,false);
    elsif tg_table_name='categorias' then
      old_active:=coalesce(old.ativa::text,'true') not in ('0','false','f');
      new_active:=coalesce(new.ativa::text,'true') not in ('0','false','f');
      should_enforce:=new_active and (
        not old_active or new.tipo is distinct from old.tipo
      );
    elsif tg_table_name='transacoes' then
      should_enforce:=date_trunc('month',old.data_vencimento::date)
        is distinct from date_trunc('month',new.data_vencimento::date);
    end if;
  end if;
  if not should_enforce then return new; end if;

  select coalesce((
    select s.plan from public.subscriptions s
    where s.user_id=new.user_id
      and (
        s.status in ('active','grace_period')
        or (s.status='cancelled' and s.access_until>now())
      )
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc
    limit 1
  ),'free') into current_plan;
  if current_plan='premium' then return new; end if;

  -- 61004 é o namespace exclusivo dos limites de recursos. Todas as tabelas
  -- usam uma chave distinta de modelo (61001), ação (61002) e proposta (61003),
  -- usam a mesma chave por usuário, serializando DML manual e o executor da IA
  -- antes da leitura count(*) e impedindo duas vagas simultâneas.
  perform pg_advisory_xact_lock(hashtext(new.user_id::text),61004);

  if tg_table_name='contas' then
    allowed_count:=case current_plan when 'smart' then 5 else 2 end;
    select count(*) into used_count
    from public.contas
    where user_id=new.user_id and not coalesce(arquivado,false);
  elsif tg_table_name='cartoes' then
    allowed_count:=case current_plan when 'smart' then 3 else 1 end;
    select count(*) into used_count
    from public.cartoes
    where user_id=new.user_id and coalesce(ativo,true);
  elsif tg_table_name='caixinhas' then
    allowed_count:=case current_plan when 'smart' then 5 else 1 end;
    select count(*) into used_count
    from public.caixinhas
    where user_id=new.user_id and not coalesce(arquivado,false);
  elsif tg_table_name='categorias' then
    allowed_count:=case current_plan when 'smart' then 14 else 7 end;
    select count(*) into used_count
    from public.categorias
    where user_id=new.user_id and tipo=new.tipo
      and coalesce(ativa::text,'true') not in ('0','false','f');
  elsif tg_table_name='transacoes' then
    allowed_count:=case current_plan when 'smart' then 300 else 40 end;
    if tg_op='UPDATE' then
      select count(*) into used_count
      from public.transacoes
      where user_id=new.user_id and id<>old.id
        and date_trunc('month',data_vencimento::date)
          =date_trunc('month',new.data_vencimento::date);
    else
      select count(*) into used_count
      from public.transacoes
      where user_id=new.user_id
        and date_trunc('month',data_vencimento::date)
          =date_trunc('month',new.data_vencimento::date);
    end if;
  else
    return new;
  end if;

  if used_count>=allowed_count then
    raise exception using errcode='P0001',message='plan limit reached';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_finflow_plan_limit()
  from public,anon,authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'contas','cartoes','caixinhas','categorias','transacoes'
  ] loop
    execute format(
      'drop trigger if exists enforce_plan_limit_before_insert on public.%I',
      table_name
    );
    execute format(
      'drop trigger if exists enforce_plan_limit_before_write on public.%I',
      table_name
    );
    execute format(
      'create trigger enforce_plan_limit_before_write before insert or update on public.%I for each row execute function public.enforce_finflow_plan_limit()',
      table_name
    );
  end loop;
end;
$$;

-- Acrescenta a franquia de chamadas do modelo à mesma resposta de cota sem
-- alterar os campos nem os limites comerciais de ações (Free 0, Smart 15,
-- Premium 50; desenvolvimento ilimitado).
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
    and u.created_at>=window_start and u.created_at<window_end;
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

-- Replay e rejeição por cota são respostas idempotentes, não novos eventos
-- de auditoria. Criações reais continuam limitadas a 60/h e deixam um único
-- registro `created`.
create or replace function public.ai_create_pending_action(
  p_action_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_ttl_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  existing public.ai_pending_actions%rowtype;
  created public.ai_pending_actions%rowtype;
  prepared jsonb;
  normalized jsonb;
  server_preview jsonb;
  request_hash text;
  state_fingerprint text;
  verified_state_fingerprint text;
  quota jsonb;
  pending_count integer;
  recent_created_count integer;
  now_at timestamptz:=clock_timestamp();
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
     or octet_length(p_payload::text)>16384 then
    perform private.ai_fail('AI_INVALID_PAYLOAD');
  end if;
  if p_action_type is null or length(p_action_type)>80 then
    perform private.ai_fail('AI_UNSUPPORTED_ACTION');
  end if;
  if p_idempotency_key is null
     or length(p_idempotency_key) not between 16 and 200
     or p_idempotency_key!~'^[A-Za-z0-9:_-]+$' then
    perform private.ai_fail('AI_INVALID_IDEMPOTENCY_KEY');
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 1800 then
    perform private.ai_fail('AI_INVALID_TTL');
  end if;
  request_hash:=encode(
    extensions.digest(
      convert_to(jsonb_build_array(p_action_type,p_payload)::text,'UTF8'),'sha256'
    ),'hex'
  );

  perform pg_advisory_xact_lock(hashtext(caller::text),61003);
  select * into existing from public.ai_pending_actions
  where user_id=caller and idempotency_key=p_idempotency_key;
  if found then
    if existing.action_type<>p_action_type or existing.payload_hash<>request_hash then
      perform private.ai_fail('AI_IDEMPOTENCY_CONFLICT');
    end if;
    perform private.ai_expire_actions(caller,existing.id);
    select * into existing from public.ai_pending_actions where id=existing.id;
    return jsonb_build_object(
      'ok',true,'id',existing.id,'action_type',existing.action_type,
      'payload',existing.payload,'preview',existing.preview,'status',existing.status,
      'expires_at',existing.expires_at,
      'confirmation_token',existing.confirmation_token,
      'created_at',existing.created_at,'replayed',true
    );
  end if;

  perform private.ai_expire_actions(caller,null);
  select count(*) into pending_count from public.ai_pending_actions
  where user_id=caller and status='pending';
  if pending_count>=10 then
    return jsonb_build_object(
      'ok',false,'error_code','AI_TOO_MANY_PENDING_ACTIONS','pending_limit',10
    );
  end if;
  select count(*) into recent_created_count from public.ai_action_audit
  where user_id=caller and event_type='created'
    and created_at>=clock_timestamp()-interval '1 hour';
  if recent_created_count>=60 then
    return jsonb_build_object(
      'ok',false,'error_code','AI_PROPOSAL_RATE_LIMITED','retry_after',3600
    );
  end if;

  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    return jsonb_build_object(
      'ok',false,'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota
    );
  end if;

  prepared:=private.ai_prepare_action(caller,p_action_type,p_payload);
  normalized:=prepared->'payload';
  server_preview:=prepared->'preview';
  state_fingerprint:=private.ai_action_state_fingerprint(
    caller,p_action_type,normalized,false
  );
  if state_fingerprint is not null then
    prepared:=private.ai_prepare_action(caller,p_action_type,normalized);
    normalized:=prepared->'payload';
    server_preview:=prepared->'preview';
    verified_state_fingerprint:=private.ai_action_state_fingerprint(
      caller,p_action_type,normalized,false
    );
    if verified_state_fingerprint is distinct from state_fingerprint then
      return jsonb_build_object(
        'ok',false,'error_code','AI_ACTION_STATE_CHANGED'
      );
    end if;
    state_fingerprint:=verified_state_fingerprint;
  end if;
  insert into public.ai_pending_actions(
    user_id,action_type,payload,payload_hash,state_fingerprint,preview,idempotency_key,
    confirmation_token,status,expires_at,created_at,updated_at
  ) values(
    caller,p_action_type,normalized,request_hash,state_fingerprint,server_preview,p_idempotency_key,
    gen_random_uuid(),'pending',now_at+make_interval(secs=>p_ttl_seconds),now_at,now_at
  ) on conflict(user_id,idempotency_key) do nothing
  returning * into created;
  if not found then
    select * into existing from public.ai_pending_actions
    where user_id=caller and idempotency_key=p_idempotency_key;
    if existing.action_type<>p_action_type or existing.payload_hash<>request_hash then
      perform private.ai_fail('AI_IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object(
      'ok',true,'id',existing.id,'action_type',existing.action_type,
      'payload',existing.payload,'preview',existing.preview,'status',existing.status,
      'expires_at',existing.expires_at,
      'confirmation_token',existing.confirmation_token,
      'created_at',existing.created_at,'replayed',true
    );
  end if;
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key
  ) values(
    created.id,caller,created.action_type,'created',created.payload,
    created.idempotency_key
  );
  return jsonb_build_object(
    'ok',true,'id',created.id,'action_type',created.action_type,
    'payload',created.payload,'preview',created.preview,'status',created.status,
    'expires_at',created.expires_at,'confirmation_token',created.confirmation_token,
    'created_at',created.created_at,'replayed',false
  );
end;
$$;

revoke all on function public.ai_create_pending_action(text,jsonb,text,integer)
  from public,anon;
grant execute on function public.ai_create_pending_action(text,jsonb,text,integer)
  to authenticated,service_role;

-- Mantém o contrato original e traduz somente a exceção conhecida do trigger.
-- Qualquer outra mensagem interna continua reduzida a um código genérico.
create or replace function public.ai_consume_pending_action(
  p_action_id uuid,
  p_confirmation_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  action_row public.ai_pending_actions%rowtype;
  execution_result jsonb;
  quota jsonb;
  error_message text;
  error_state text;
  safe_error text;
  current_state_fingerprint text;
begin
  perform private.ai_expire_actions(caller,p_action_id);
  select * into action_row from public.ai_pending_actions
  where id=p_action_id and user_id=caller for update;
  if not found or action_row.confirmation_token is distinct from p_confirmation_token then
    return jsonb_build_object('ok',false,'error_code','AI_ACTION_NOT_FOUND');
  end if;
  if action_row.status='succeeded' then
    return jsonb_build_object(
      'ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','succeeded','result',action_row.result,'replayed',true
    );
  end if;
  if action_row.status<>'pending' then
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
      'status',action_row.status,
      'error_code',coalesce(
        action_row.last_error_code,
        case action_row.status
          when 'expired' then 'AI_ACTION_EXPIRED'
          when 'cancelled' then 'AI_ACTION_CANCELLED'
          else 'AI_ACTION_NOT_EXECUTABLE'
        end
      ),'replayed',coalesce(action_row.last_error_code='AI_ACTION_STATE_CHANGED',false)
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(caller::text),61002);
  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'status','pending',
      'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota,'replayed',false
    );
  end if;

  if action_row.state_fingerprint is not null then
    begin
      current_state_fingerprint:=private.ai_action_state_fingerprint(
        caller,action_row.action_type,action_row.payload,true
      );
    exception when others then
      current_state_fingerprint:=null;
    end;
    if current_state_fingerprint is distinct from action_row.state_fingerprint then
      update public.ai_pending_actions
      set status='failed',last_error_code='AI_ACTION_STATE_CHANGED'
      where id=action_row.id;
      insert into public.ai_action_audit(
        action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
      ) values(
        action_row.id,caller,action_row.action_type,'failed',action_row.payload,
        'AI_ACTION_STATE_CHANGED',action_row.idempotency_key
      );
      return jsonb_build_object(
        'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
        'status','failed','error_code','AI_ACTION_STATE_CHANGED','replayed',false
      );
    end if;
  end if;

  update public.ai_pending_actions
  set status='executing',last_error_code=null
  where id=action_row.id;
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key
  ) values(
    action_row.id,caller,action_row.action_type,'executing',
    action_row.payload,action_row.idempotency_key
  );
  begin
    execution_result:=private.ai_execute_financial_action(
      caller,action_row.action_type,action_row.payload,action_row.id
    );
  exception when others then
    get stacked diagnostics
      error_message=message_text,
      error_state=returned_sqlstate;
    safe_error:=case
      when error_state='P0001' and error_message='plan limit reached'
        then 'AI_PLAN_RESOURCE_LIMIT'
      when error_message~'^AI_[A-Z0-9_]+$' then error_message
      else 'AI_ACTION_EXECUTION_FAILED'
    end;
    update public.ai_pending_actions
    set status='failed',last_error_code=safe_error
    where id=action_row.id;
    insert into public.ai_action_audit(
      action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
    ) values(
      action_row.id,caller,action_row.action_type,'failed',action_row.payload,
      safe_error,action_row.idempotency_key
    );
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','failed','error_code',safe_error,'replayed',false
    );
  end;
  update public.ai_pending_actions
  set status='succeeded',result=execution_result,
    executed_at=clock_timestamp(),last_error_code=null
  where id=action_row.id;
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,result,idempotency_key
  ) values(
    action_row.id,caller,action_row.action_type,'succeeded',action_row.payload,
    execution_result,action_row.idempotency_key
  );
  return jsonb_build_object(
    'ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
    'status','succeeded','result',execution_result,'replayed',false
  );
end;
$$;

revoke all on function public.ai_consume_pending_action(uuid,uuid)
  from public,anon;
grant execute on function public.ai_consume_pending_action(uuid,uuid)
  to authenticated,service_role;

commit;
