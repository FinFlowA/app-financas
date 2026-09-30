-- Paddle: espelho idempotente de clientes e assinaturas.
-- Produtos, preços e registros financeiros são infraestrutura permanente.

create table if not exists public.paddle_customers (
  customer_id text primary key check (customer_id ~ '^ctm_[a-z0-9]+$'),
  user_id uuid unique references auth.users(id) on delete set null,
  email text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists paddle_customers_email_idx
  on public.paddle_customers (lower(email));

alter table public.paddle_customers enable row level security;
revoke all on public.paddle_customers from public, anon, authenticated;
grant select, insert, update on public.paddle_customers to service_role;

alter table public.subscriptions
  add column if not exists price_id text,
  add column if not exists product_id text,
  add column if not exists scheduled_change_action text,
  add column if not exists scheduled_change_at timestamptz,
  add column if not exists last_provider_event_at timestamptz;

alter table public.subscriptions
  drop constraint if exists subscriptions_provider_check;
alter table public.subscriptions
  add constraint subscriptions_provider_check
  check (provider in ('mercado_pago', 'google_play', 'apple', 'paddle')) not valid;
alter table public.subscriptions validate constraint subscriptions_provider_check;

alter table public.subscriptions
  drop constraint if exists subscriptions_status_check;
alter table public.subscriptions
  add constraint subscriptions_status_check
  check (status in ('pending', 'active', 'trialing', 'past_due', 'grace_period', 'paused', 'cancelled', 'expired', 'refunded')) not valid;
alter table public.subscriptions validate constraint subscriptions_status_check;

create or replace function public.bind_paddle_customer(
  p_customer_id text,
  p_email text,
  p_user_id uuid default null
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
  if p_customer_id !~ '^ctm_[a-z0-9]+$' or normalized_email = '' then
    raise exception using errcode = '22023', message = 'PADDLE_CUSTOMER_INVALID';
  end if;

  select pc.user_id into resolved_user_id
  from public.paddle_customers pc
  where pc.customer_id = p_customer_id;

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

  insert into public.paddle_customers (customer_id, user_id, email)
  values (p_customer_id, resolved_user_id, normalized_email)
  on conflict (customer_id) do update
  set user_id = coalesce(public.paddle_customers.user_id, excluded.user_id),
      email = excluded.email,
      updated_at = now();
  return resolved_user_id;
end;
$$;
revoke all on function public.bind_paddle_customer(text,text,uuid)
  from public, anon, authenticated;
grant execute on function public.bind_paddle_customer(text,text,uuid) to service_role;

create or replace function public.upsert_paddle_subscription(
  p_user_id uuid,
  p_product_code text,
  p_plan text,
  p_billing_cycle text,
  p_subscription_id text,
  p_customer_id text,
  p_status text,
  p_price_id text,
  p_product_id text,
  p_started_at timestamptz,
  p_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_cancelled_at timestamptz,
  p_scheduled_action text,
  p_scheduled_at timestamptz,
  p_event_at timestamptz,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_row_id uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.paddle_customers pc
    where pc.customer_id = p_customer_id and pc.user_id = p_user_id
  ) then
    raise exception using errcode = '23503', message = 'PADDLE_CUSTOMER_NOT_BOUND';
  end if;

  insert into public.subscriptions (
    user_id, product_code, plan, billing_cycle, provider,
    provider_subscription_id, provider_customer_id, status,
    started_at, current_period_end, access_until,
    cancel_at_period_end, cancelled_at, last_provider_sync_at,
    provider_payload, price_id, product_id,
    scheduled_change_action, scheduled_change_at, last_provider_event_at
  ) values (
    p_user_id, p_product_code, p_plan, p_billing_cycle, 'paddle',
    p_subscription_id, p_customer_id, p_status,
    p_started_at, p_period_end, p_period_end,
    coalesce(p_cancel_at_period_end, false), p_cancelled_at, now(),
    coalesce(p_payload, '{}'::jsonb), p_price_id, p_product_id,
    p_scheduled_action, p_scheduled_at, p_event_at
  )
  on conflict (provider, provider_subscription_id)
    where provider_subscription_id is not null
  do update set
    user_id = excluded.user_id,
    product_code = excluded.product_code,
    plan = excluded.plan,
    billing_cycle = excluded.billing_cycle,
    provider_customer_id = excluded.provider_customer_id,
    status = excluded.status,
    started_at = coalesce(excluded.started_at, public.subscriptions.started_at),
    current_period_end = excluded.current_period_end,
    access_until = excluded.access_until,
    cancel_at_period_end = excluded.cancel_at_period_end,
    cancelled_at = excluded.cancelled_at,
    last_provider_sync_at = now(),
    provider_payload = excluded.provider_payload,
    price_id = excluded.price_id,
    product_id = excluded.product_id,
    scheduled_change_action = excluded.scheduled_change_action,
    scheduled_change_at = excluded.scheduled_change_at,
    last_provider_event_at = excluded.last_provider_event_at,
    updated_at = now()
  where public.subscriptions.last_provider_event_at is null
     or excluded.last_provider_event_at >= public.subscriptions.last_provider_event_at
  returning id into subscription_row_id;

  if subscription_row_id is null then
    select s.id into subscription_row_id from public.subscriptions s
    where s.provider = 'paddle' and s.provider_subscription_id = p_subscription_id;
  end if;
  return subscription_row_id;
end;
$$;
revoke all on function public.upsert_paddle_subscription(uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,text,timestamptz,timestamptz,jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_paddle_subscription(uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,timestamptz,text,timestamptz,timestamptz,jsonb)
  to service_role;

create or replace function public.get_my_entitlement()
returns table (
  plan text, subscription_status text, billing_cycle text, provider text,
  access_until timestamptz, billing_enabled boolean, limits_enabled boolean
)
language sql stable security definer set search_path = '' as $$
  with settings as (
    select bs.billing_enabled, bs.limits_enabled
    from public.billing_settings bs where bs.id = true
  ), current_subscription as (
    select s.plan, s.status, s.billing_cycle, s.provider, s.access_until
    from public.subscriptions s
    where s.user_id = (select auth.uid()) and (
      s.status in ('active', 'trialing', 'grace_period')
      or (s.status = 'cancelled' and s.access_until > now())
    )
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc,
      s.access_until desc nulls last limit 1
  )
  select coalesce(cs.plan, 'free')::text, coalesce(cs.status, 'none')::text,
    cs.billing_cycle, cs.provider, cs.access_until,
    coalesce(st.billing_enabled, false), coalesce(st.limits_enabled, false)
  from settings st left join current_subscription cs on true;
$$;
revoke all on function public.get_my_entitlement() from public, anon;
grant execute on function public.get_my_entitlement() to authenticated;
