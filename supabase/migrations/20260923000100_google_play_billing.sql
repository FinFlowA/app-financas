-- Google Play Billing: recibos verificados no servidor e eventos RTDN idempotentes.
-- Purchase tokens sao confidenciais e nunca ficam acessiveis ao cliente.

update public.billing_products set amount_brl = 19.90, updated_at = now() where code = 'smart_monthly';
update public.billing_products set amount_brl = 199.00, updated_at = now() where code = 'smart_annual';
update public.billing_products set amount_brl = 39.90, updated_at = now() where code = 'premium_monthly';
update public.billing_products set amount_brl = 399.00, updated_at = now() where code = 'premium_annual';

create table if not exists public.google_play_purchases (
  purchase_token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  package_name text not null,
  product_id text not null,
  base_plan_id text not null,
  latest_order_id text,
  subscription_state text not null,
  acknowledgement_state text,
  expiry_at timestamptz,
  auto_renewing boolean not null default false,
  linked_purchase_token text,
  provider_payload jsonb not null default '{}'::jsonb,
  verified_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists google_play_purchases_user_idx
  on public.google_play_purchases(user_id, expiry_at desc);

create table if not exists public.google_play_rtdn_events (
  message_id text primary key,
  notification_type integer,
  purchase_token text,
  event_time timestamptz,
  status text not null default 'received'
    check (status in ('received', 'processed', 'unbound', 'ignored', 'failed')),
  error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

alter table public.google_play_purchases enable row level security;
alter table public.google_play_rtdn_events enable row level security;
revoke all on public.google_play_purchases from public, anon, authenticated;
revoke all on public.google_play_rtdn_events from public, anon, authenticated;
grant select, insert, update on public.google_play_purchases to service_role;
grant select, insert, update on public.google_play_rtdn_events to service_role;

create or replace function public.upsert_google_play_subscription(
  p_user_id uuid,
  p_purchase_token text,
  p_package_name text,
  p_product_id text,
  p_base_plan_id text,
  p_plan text,
  p_billing_cycle text,
  p_status text,
  p_order_id text,
  p_started_at timestamptz,
  p_expiry_at timestamptz,
  p_auto_renewing boolean,
  p_acknowledgement_state text,
  p_linked_purchase_token text,
  p_payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  subscription_row_id uuid;
  product_code_value text := p_plan || '_' || p_billing_cycle;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_plan not in ('smart', 'premium')
     or p_billing_cycle not in ('monthly', 'annual')
     or p_status not in ('pending', 'active', 'past_due', 'grace_period', 'paused', 'cancelled', 'expired') then
    raise exception using errcode = '22023', message = 'GOOGLE_PLAY_SUBSCRIPTION_INVALID';
  end if;
  if not exists (select 1 from public.billing_products bp where bp.code = product_code_value) then
    raise exception using errcode = '23503', message = 'GOOGLE_PLAY_PRODUCT_NOT_CONFIGURED';
  end if;

  insert into public.google_play_purchases (
    purchase_token, user_id, package_name, product_id, base_plan_id,
    latest_order_id, subscription_state, acknowledgement_state, expiry_at,
    auto_renewing, linked_purchase_token, provider_payload, verified_at
  ) values (
    p_purchase_token, p_user_id, p_package_name, p_product_id, p_base_plan_id,
    p_order_id, p_status, p_acknowledgement_state, p_expiry_at,
    coalesce(p_auto_renewing, false), p_linked_purchase_token,
    coalesce(p_payload, '{}'::jsonb), now()
  )
  on conflict (purchase_token) do update set
    user_id = excluded.user_id,
    package_name = excluded.package_name,
    product_id = excluded.product_id,
    base_plan_id = excluded.base_plan_id,
    latest_order_id = excluded.latest_order_id,
    subscription_state = excluded.subscription_state,
    acknowledgement_state = excluded.acknowledgement_state,
    expiry_at = excluded.expiry_at,
    auto_renewing = excluded.auto_renewing,
    linked_purchase_token = excluded.linked_purchase_token,
    provider_payload = excluded.provider_payload,
    verified_at = now(),
    updated_at = now();

  insert into public.subscriptions (
    user_id, product_code, plan, billing_cycle, provider,
    provider_subscription_id, provider_customer_id, status,
    started_at, current_period_end, access_until, cancel_at_period_end,
    cancelled_at, last_provider_sync_at, provider_payload
  ) values (
    p_user_id, product_code_value, p_plan, p_billing_cycle, 'google_play',
    p_purchase_token, null, p_status,
    p_started_at, p_expiry_at, p_expiry_at,
    not coalesce(p_auto_renewing, false),
    case when p_status = 'cancelled' then now() else null end,
    now(), coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provider, provider_subscription_id)
    where provider_subscription_id is not null
  do update set
    user_id = excluded.user_id,
    product_code = excluded.product_code,
    plan = excluded.plan,
    billing_cycle = excluded.billing_cycle,
    status = excluded.status,
    started_at = coalesce(excluded.started_at, public.subscriptions.started_at),
    current_period_end = excluded.current_period_end,
    access_until = excluded.access_until,
    cancel_at_period_end = excluded.cancel_at_period_end,
    cancelled_at = excluded.cancelled_at,
    last_provider_sync_at = now(),
    provider_payload = excluded.provider_payload,
    updated_at = now()
  returning id into subscription_row_id;

  return subscription_row_id;
end;
$$;

revoke all on function public.upsert_google_play_subscription(uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.upsert_google_play_subscription(uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text,jsonb)
  to service_role;
