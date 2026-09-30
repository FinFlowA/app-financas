-- Um vínculo é uma conta ou um objetivo do usuário marcado como compartilhado.
-- Gratuito: 1; Pro (smart): 3; Plus (premium): ilimitado.

create or replace function private.finflow_enforce_shared_link_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits_on boolean;
  plan_name text;
  allowed_count integer;
  used_count integer;
begin
  if not coalesce(new.compartilhado, false)
     or coalesce(new.arquivado, false)
     or (tg_op = 'UPDATE' and coalesce(old.compartilhado, false)) then
    return new;
  end if;

  select limits_enabled into limits_on
  from public.billing_settings
  where id = true;
  if not coalesce(limits_on, false) then return new; end if;

  plan_name := private.finflow_plan_for_user(new.user_id);
  if plan_name = 'premium' then return new; end if;
  allowed_count := case plan_name when 'smart' then 3 else 1 end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:shared-links:' || new.user_id::text, 73119)
  );

  select
    (select pg_catalog.count(*) from public.contas c
      where c.user_id = new.user_id
        and coalesce(c.compartilhado, false)
        and not coalesce(c.arquivado, false))
    +
    (select pg_catalog.count(*) from public.caixinhas g
      where g.user_id = new.user_id
        and coalesce(g.compartilhado, false)
        and not coalesce(g.arquivado, false))
  into used_count;

  if used_count >= allowed_count then
    raise exception using errcode = 'P0001', message = 'FINFLOW_SHARED_LINK_LIMIT';
  end if;
  return new;
end;
$$;

revoke all on function private.finflow_enforce_shared_link_limit()
  from public, anon, authenticated;

drop trigger if exists finflow_enforce_shared_link_limit on public.contas;
create trigger finflow_enforce_shared_link_limit
before insert or update of compartilhado, arquivado on public.contas
for each row execute function private.finflow_enforce_shared_link_limit();

drop trigger if exists finflow_enforce_shared_link_limit on public.caixinhas;
create trigger finflow_enforce_shared_link_limit
before insert or update of compartilhado, arquivado on public.caixinhas
for each row execute function private.finflow_enforce_shared_link_limit();
