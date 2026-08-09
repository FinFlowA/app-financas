-- Impede que um cliente modificado ignore idade minima e aceite legal antes de
-- escrever no nucleo financeiro. Os dados continuam autodeclarados; verificacao
-- documental de idade exigiria um provedor de identidade/KYC separado.

begin;

create schema if not exists private;

create or replace function private.finflow_profile_is_eligible(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  metadata jsonb;
  birth_date date;
  accepted_at timestamptz;
  today_brazil date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  if p_user_id is null then return false; end if;

  select u.raw_user_meta_data into metadata
  from auth.users u
  where u.id = p_user_id;
  if not found or metadata is null then return false; end if;

  if coalesce(metadata ->> 'termos_versao', '') <> '2026-08-08-offline-seguranca-ia'
     or coalesce(metadata ->> 'data_nascimento', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(metadata ->> 'termos_aceitos_em', '') = '' then
    return false;
  end if;

  begin
    birth_date := (metadata ->> 'data_nascimento')::date;
    accepted_at := (metadata ->> 'termos_aceitos_em')::timestamptz;
  exception when others then
    return false;
  end;

  return birth_date <= (today_brazil - interval '18 years')::date
    and birth_date >= date '1900-01-01'
    and accepted_at <= clock_timestamp() + interval '5 minutes';
end;
$$;

revoke all on function private.finflow_profile_is_eligible(uuid)
  from public, anon, authenticated;
grant execute on function private.finflow_profile_is_eligible(uuid)
  to service_role;

create or replace function private.enforce_finflow_financial_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  jwt_role text := coalesce((select auth.jwt() ->> 'role'), '');
begin
  -- Migracoes sem JWT e backends com service_role sao fronteiras
  -- administrativas. Um request anonimo ainda traz role=anon e e recusado.
  if jwt_role = 'service_role' or (caller is null and jwt_role = '') then return null; end if;

  if caller is null or not private.finflow_profile_is_eligible(caller) then
    raise exception using errcode = 'P0001', message = 'FINFLOW_PROFILE_REQUIRED';
  end if;
  return null;
end;
$$;

revoke all on function private.enforce_finflow_financial_profile()
  from public, anon, authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'contas', 'categorias', 'caixinhas', 'cartoes', 'transacoes',
    'fatura_itens', 'compras_cartao'
  ] loop
    if to_regclass('public.' || table_name) is null then continue; end if;
    execute format(
      'drop trigger if exists enforce_finflow_financial_profile on public.%I',
      table_name
    );
    execute format(
      'create trigger enforce_finflow_financial_profile '
      || 'before insert or update or delete on public.%I '
      || 'for each statement execute function private.enforce_finflow_financial_profile()',
      table_name
    );
  end loop;
end;
$$;

commit;
