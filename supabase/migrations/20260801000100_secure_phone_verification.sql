-- Protege a verificação de telefone contra tentativas concorrentes e limpa
-- mudanças abandonadas antes que possam gerar uma associação ambígua no Auth.

begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.phone_verification_reservations (
  phone text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint phone_verification_reservations_phone_format
    check (phone ~ '^\+55[1-9]{2}9[0-9]{8}$')
);

revoke all on table private.phone_verification_reservations from public, anon, authenticated;

create or replace function public.reserve_phone_verification(
  p_user_id uuid,
  p_phone text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_user_id is null or p_phone !~ '^\+55[1-9]{2}9[0-9]{8}$' then
    return false;
  end if;

  delete from private.phone_verification_reservations
  where expires_at <= now();

  delete from private.phone_verification_reservations
  where user_id = p_user_id
    and phone <> p_phone;

  insert into private.phone_verification_reservations (phone, user_id, expires_at)
  values (p_phone, p_user_id, now() + interval '20 minutes')
  on conflict (phone) do update
    set expires_at = excluded.expires_at
    where private.phone_verification_reservations.user_id = excluded.user_id;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$$;

revoke all on function public.reserve_phone_verification(uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_phone_verification(uuid, text) to service_role;

create or replace function public.finflow_cleanup_stale_phone_changes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  delete from private.phone_verification_reservations
  where expires_at <= now();

  update auth.users
  set phone_change = '',
      phone_change_token = '',
      phone_change_sent_at = null
  where coalesce(phone_change, '') <> ''
    and phone_change_sent_at is not null
    and phone_change_sent_at < now() - interval '20 minutes';

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke all on function public.finflow_cleanup_stale_phone_changes() from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.unschedule(jobid)
from cron.job
where jobname = 'finflow-cleanup-stale-phone-changes';

select cron.schedule(
  'finflow-cleanup-stale-phone-changes',
  '*/10 * * * *',
  'select public.finflow_cleanup_stale_phone_changes();'
);

select public.finflow_cleanup_stale_phone_changes();

commit;
