-- FinFlow: edições offline idempotentes com concorrência otimista.
-- Exclusões, arquivamentos, conclusões, reaberturas e pagamentos permanecem fora.

begin;

alter table public.contas
  add column if not exists version bigint default 1,
  add column if not exists updated_at timestamptz default clock_timestamp();
alter table public.categorias
  add column if not exists version bigint default 1,
  add column if not exists updated_at timestamptz default clock_timestamp();
alter table public.caixinhas
  add column if not exists version bigint default 1,
  add column if not exists updated_at timestamptz default clock_timestamp();
alter table public.cartoes
  add column if not exists version bigint default 1,
  add column if not exists updated_at timestamptz default clock_timestamp();
alter table public.transacoes
  add column if not exists version bigint default 1,
  add column if not exists updated_at timestamptz default clock_timestamp();

update public.contas set version=1 where version is null or version<1;
update public.contas set updated_at=clock_timestamp() where updated_at is null;
update public.categorias set version=1 where version is null or version<1;
update public.categorias set updated_at=clock_timestamp() where updated_at is null;
update public.caixinhas set version=1 where version is null or version<1;
update public.caixinhas set updated_at=clock_timestamp() where updated_at is null;
update public.cartoes set version=1 where version is null or version<1;
update public.cartoes set updated_at=clock_timestamp() where updated_at is null;
update public.transacoes set version=1 where version is null or version<1;
update public.transacoes set updated_at=clock_timestamp() where updated_at is null;

alter table public.contas
  alter column version set default 1,
  alter column version set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;
alter table public.categorias
  alter column version set default 1,
  alter column version set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;
alter table public.caixinhas
  alter column version set default 1,
  alter column version set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;
alter table public.cartoes
  alter column version set default 1,
  alter column version set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;
alter table public.transacoes
  alter column version set default 1,
  alter column version set not null,
  alter column updated_at set default clock_timestamp(),
  alter column updated_at set not null;

create or replace function private.finance_touch_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op='INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

revoke all on function private.finance_touch_version() from public, anon, authenticated;

drop trigger if exists contas_touch_version on public.contas;
create trigger contas_touch_version
before insert or update on public.contas
for each row execute function private.finance_touch_version();

drop trigger if exists categorias_touch_version on public.categorias;
create trigger categorias_touch_version
before insert or update on public.categorias
for each row execute function private.finance_touch_version();

drop trigger if exists caixinhas_touch_version on public.caixinhas;
create trigger caixinhas_touch_version
before insert or update on public.caixinhas
for each row execute function private.finance_touch_version();

drop trigger if exists cartoes_touch_version on public.cartoes;
create trigger cartoes_touch_version
before insert or update on public.cartoes
for each row execute function private.finance_touch_version();

drop trigger if exists transacoes_touch_version on public.transacoes;
create trigger transacoes_touch_version
before insert or update on public.transacoes
for each row execute function private.finance_touch_version();

create or replace function private.offline_prepare_optimistic_update(
  caller uuid,
  action_name text,
  raw_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_key text;
  allowed_fields text[];
  resource_id bigint;
  expected_version bigint;
  field_name text;
  field_value jsonb;
  action_payload jsonb;
  prepared jsonb;
  normalized_changes jsonb := '{}'::jsonb;
  change_count integer;
begin
  if caller is null or caller is distinct from (select auth.uid()) then
    raise exception using errcode='P0001', message='OFFLINE_AUTH_MISMATCH';
  end if;
  if raw_payload is null or pg_catalog.jsonb_typeof(raw_payload)<>'object' then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_PAYLOAD';
  end if;

  case action_name
    when 'update_account' then
      resource_key:='account_id'; allowed_fields:=array['name','initial_balance','color'];
    when 'update_category' then
      resource_key:='category_id'; allowed_fields:=array['name','color','icon'];
    when 'update_goal' then
      resource_key:='goal_id'; allowed_fields:=array['name','target_amount','color','icon','target_date'];
    when 'update_card' then
      resource_key:='card_id'; allowed_fields:=array['name','value','color','due_day','closing_day'];
    when 'update_transaction' then
      resource_key:='transaction_id'; allowed_fields:=array['description','value','scheduled_date','account_id','category_id'];
    else
      raise exception using errcode='P0001', message='OFFLINE_UNSUPPORTED_ACTION';
  end case;

  perform private.ai_assert_allowed_keys(raw_payload,array[resource_key,'expected_version','changes']);
  perform private.ai_require_keys(raw_payload,array[resource_key,'expected_version','changes']);
  if pg_catalog.jsonb_typeof(raw_payload->'changes')<>'object' then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_UPDATE_CHANGES';
  end if;
  select count(*) into change_count
  from pg_catalog.jsonb_object_keys(raw_payload->'changes');
  if change_count<1 or change_count>pg_catalog.array_length(allowed_fields,1) then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_UPDATE_CHANGES';
  end if;

  resource_id:=private.ai_id(raw_payload,resource_key);
  expected_version:=private.ai_id(raw_payload,'expected_version');

  for field_name,field_value in
    select e.key,e.value from pg_catalog.jsonb_each(raw_payload->'changes') e order by e.key
  loop
    if not (field_name=any(allowed_fields)) then
      raise exception using errcode='P0001', message='OFFLINE_UNSUPPORTED_UPDATE_FIELD';
    end if;
    if field_value='null'::jsonb then
      if action_name='update_goal' and field_name='target_date' then
        field_value:=pg_catalog.to_jsonb('clear'::text);
      else
        raise exception using errcode='P0001', message='OFFLINE_INVALID_UPDATE_CHANGES';
      end if;
    end if;

    action_payload:=pg_catalog.jsonb_build_object(
      resource_key,resource_id,'field',field_name,'new_value',field_value
    );
    if action_name='update_transaction' then
      action_payload:=action_payload||pg_catalog.jsonb_build_object('series_scope','one');
    end if;
    prepared:=private.ai_prepare_action(caller,action_name,action_payload);
    normalized_changes:=pg_catalog.jsonb_set(
      normalized_changes,array[field_name],prepared->'payload'->'new_value',true
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    resource_key,resource_id,
    'expected_version',expected_version,
    'changes',normalized_changes
  );
end;
$$;

revoke all on function private.offline_prepare_optimistic_update(uuid,text,jsonb)
  from public, anon, authenticated;

create or replace function private.offline_execute_optimistic_update(
  caller uuid,
  action_name text,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_key text;
  resource_id bigint;
  expected_version bigint:=(payload->>'expected_version')::bigint;
  current_version bigint;
  final_version bigint;
  field_name text;
  field_value jsonb;
  action_payload jsonb;
  execution_result jsonb;
  execution_results jsonb:='[]'::jsonb;
begin
  case action_name
    when 'update_account' then
      resource_key:='account_id'; resource_id:=(payload->>'account_id')::bigint;
      select a.version into current_version from public.contas a
      where a.id=resource_id and a.user_id=caller for update;
      if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    when 'update_category' then
      resource_key:='category_id'; resource_id:=(payload->>'category_id')::bigint;
      select c.version into current_version from public.categorias c
      where c.id=resource_id and c.user_id=caller for update;
      if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    when 'update_goal' then
      resource_key:='goal_id'; resource_id:=(payload->>'goal_id')::bigint;
      select g.version into current_version from public.caixinhas g
      where g.id=resource_id and g.user_id=caller for update;
      if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    when 'update_card' then
      resource_key:='card_id'; resource_id:=(payload->>'card_id')::bigint;
      select c.version into current_version from public.cartoes c
      where c.id=resource_id and c.user_id=caller for update;
      if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    when 'update_transaction' then
      resource_key:='transaction_id'; resource_id:=(payload->>'transaction_id')::bigint;
      select t.version into current_version from public.transacoes t
      where t.id=resource_id and t.user_id=caller for update;
      if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
    else
      raise exception using errcode='P0001', message='OFFLINE_UNSUPPORTED_ACTION';
  end case;

  if current_version is distinct from expected_version then
    raise exception using errcode='P0001', message='OFFLINE_VERSION_CONFLICT';
  end if;

  for field_name,field_value in
    select e.key,e.value from pg_catalog.jsonb_each(payload->'changes') e order by e.key
  loop
    action_payload:=pg_catalog.jsonb_build_object(
      resource_key,resource_id,'field',field_name,'new_value',field_value
    );
    if action_name='update_transaction' then
      action_payload:=action_payload||pg_catalog.jsonb_build_object('series_scope','one');
    end if;
    execution_result:=private.ai_execute_financial_action(caller,action_name,action_payload,null);
    execution_results:=execution_results||pg_catalog.jsonb_build_array(execution_result);
  end loop;

  case action_name
    when 'update_account' then select version into final_version from public.contas where id=resource_id;
    when 'update_category' then select version into final_version from public.categorias where id=resource_id;
    when 'update_goal' then select version into final_version from public.caixinhas where id=resource_id;
    when 'update_card' then select version into final_version from public.cartoes where id=resource_id;
    when 'update_transaction' then select version into final_version from public.transacoes where id=resource_id;
  end case;

  return pg_catalog.jsonb_build_object(
    'resource_id',resource_id,
    'expected_version',expected_version,
    'version',final_version,
    'updated',true,
    'results',execution_results
  );
end;
$$;

revoke all on function private.offline_execute_optimistic_update(uuid,text,jsonb)
  from public, anon, authenticated;

create or replace function public.execute_offline_optimistic_update(
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
  caller uuid:=auth.uid();
  request_hash text;
  existing private.offline_action_receipts%rowtype;
  prepared jsonb;
  execution_result jsonb;
  recent_count integer;
begin
  if caller is null then
    raise exception using errcode='P0001', message='OFFLINE_AUTH_REQUIRED';
  end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode='P0001', message='OFFLINE_AUTH_MISMATCH';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_client_created_at is null
     or p_client_created_at<pg_catalog.clock_timestamp()-interval '30 days'
     or p_client_created_at>pg_catalog.clock_timestamp()+interval '5 minutes' then
    raise exception using errcode='P0001', message='OFFLINE_OPERATION_EXPIRED';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload)<>'object'
     or pg_catalog.octet_length(p_payload::text)>8192 then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_PAYLOAD';
  end if;
  if p_action_type is null or not (p_action_type=any(array[
    'update_account','update_category','update_goal','update_card','update_transaction'
  ]::text[])) then
    raise exception using errcode='P0001', message='OFFLINE_UNSUPPORTED_ACTION';
  end if;

  request_hash:=pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_array(p_action_type,p_payload)::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text,81277)
  );

  select * into existing from private.offline_action_receipts r
  where r.user_id=caller and r.idempotency_key=p_idempotency_key;
  if found then
    if existing.action_type<>p_action_type or existing.payload_hash<>request_hash then
      raise exception using errcode='P0001', message='OFFLINE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok',true,'replayed',true,'receipt_id',existing.id,'result',existing.result
    );
  end if;

  select count(*) into recent_count from private.offline_action_receipts r
  where r.user_id=caller and r.created_at>=pg_catalog.clock_timestamp()-interval '1 hour';
  if recent_count>=120 then
    return pg_catalog.jsonb_build_object(
      'ok',false,'error_code','OFFLINE_RATE_LIMITED','retry_after_seconds',3600
    );
  end if;

  prepared:=private.offline_prepare_optimistic_update(caller,p_action_type,p_payload);
  execution_result:=private.offline_execute_optimistic_update(caller,p_action_type,prepared);

  insert into private.offline_action_receipts(
    user_id,idempotency_key,action_type,payload_hash,result,client_created_at
  ) values (
    caller,p_idempotency_key,p_action_type,request_hash,execution_result,p_client_created_at
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'ok',true,'replayed',false,'receipt_id',existing.id,'result',execution_result
  );
end;
$$;

revoke all on function public.execute_offline_optimistic_update(text,jsonb,uuid,uuid,timestamptz)
  from public, anon;
grant execute on function public.execute_offline_optimistic_update(text,jsonb,uuid,uuid,timestamptz)
  to authenticated;

comment on function public.execute_offline_optimistic_update(text,jsonb,uuid,uuid,timestamptz) is
  'Aplica edições offline allowlisted com expected_version, lock de linha, conflito otimista e recibo idempotente.';

commit;
