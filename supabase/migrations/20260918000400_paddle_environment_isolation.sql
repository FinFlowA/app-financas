-- Mantém os identificadores Paddle de sandbox e produção separados.
-- Registros existentes pertencem ao sandbox e são preservados.

alter table public.paddle_customers
  add column if not exists environment text not null default 'sandbox'
  check (environment in ('sandbox', 'production'));

alter table public.paddle_customers
  drop constraint if exists paddle_customers_user_id_key;

create unique index if not exists paddle_customers_user_environment_uidx
  on public.paddle_customers (user_id, environment)
  where user_id is not null;

create or replace function public.bind_paddle_customer_environment(
  p_customer_id text,
  p_email text,
  p_user_id uuid,
  p_environment text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_user_id uuid;
  normalized_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_customer_id !~ '^ctm_[a-z0-9]+$'
     or normalized_email = ''
     or p_environment not in ('sandbox', 'production') then
    raise exception using errcode = '22023', message = 'PADDLE_CUSTOMER_INVALID';
  end if;

  select pc.user_id into resolved_user_id
  from public.paddle_customers pc
  where pc.customer_id = p_customer_id and pc.environment = p_environment;

  if resolved_user_id is null and p_user_id is not null then
    select u.id into resolved_user_id
    from auth.users u
    where u.id = p_user_id and lower(u.email) = normalized_email;
  end if;
  if resolved_user_id is null then
    select u.id into resolved_user_id
    from auth.users u
    where lower(u.email) = normalized_email
    order by u.created_at
    limit 1;
  end if;

  insert into public.paddle_customers (customer_id, user_id, email, environment)
  values (p_customer_id, resolved_user_id, normalized_email, p_environment)
  on conflict (customer_id) do update
  set user_id = coalesce(public.paddle_customers.user_id, excluded.user_id),
      email = excluded.email,
      environment = excluded.environment,
      updated_at = now();
  return resolved_user_id;
end;
$$;

revoke all on function public.bind_paddle_customer_environment(text,text,uuid,text)
  from public, anon, authenticated;
grant execute on function public.bind_paddle_customer_environment(text,text,uuid,text)
  to service_role;
