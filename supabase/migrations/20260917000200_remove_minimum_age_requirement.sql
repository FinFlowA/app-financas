-- A data de nascimento continua obrigatória e validada, mas o FinFlow não
-- impõe mais idade mínima para usar os recursos financeiros.

begin;

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

  return birth_date between date '1900-01-01' and today_brazil
    and accepted_at <= clock_timestamp() + interval '5 minutes';
end;
$$;

revoke all on function private.finflow_profile_is_eligible(uuid)
  from public, anon, authenticated;
grant execute on function private.finflow_profile_is_eligible(uuid)
  to service_role;

commit;
