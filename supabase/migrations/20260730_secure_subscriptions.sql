-- FinFlow: base segura e independente de provedor para assinaturas.
-- O aplicativo só pode ler o próprio direito. Toda escrita é feita por Edge Functions
-- autenticadas com service_role após confirmação do provedor.

create table if not exists public.billing_settings (
  id boolean primary key default true check (id),
  billing_enabled boolean not null default false,
  limits_enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.billing_settings (id, billing_enabled, limits_enabled)
values (true, false, false)
on conflict (id) do nothing;

-- Remove bloqueios deixados pela regra antiga enquanto os limites estiverem
-- globalmente desativados. O bloco tolera instalações que ainda não possuam
-- alguma destas tabelas/colunas.
do $$
declare
  target_table text;
begin
  foreach target_table in array array['contas', 'cartoes', 'caixinhas', 'categorias']
  loop
    if to_regclass(format('public.%I', target_table)) is not null
       and exists (
         select 1
         from information_schema.columns
         where table_schema = 'public'
           and information_schema.columns.table_name = target_table
           and column_name = 'bloqueado_plano'
       ) then
      execute format(
        'update public.%I set bloqueado_plano = false where bloqueado_plano is true',
        target_table
      );
    end if;
  end loop;
end;
$$;

create table if not exists public.billing_products (
  code text primary key,
  plan text not null check (plan in ('smart', 'premium')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  amount_brl numeric(10,2) not null check (amount_brl > 0),
  active boolean not null default true,
  mercado_pago_plan_id text,
  google_play_product_id text,
  apple_product_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan, billing_cycle)
);

insert into public.billing_products (code, plan, billing_cycle, amount_brl)
values
  ('smart_monthly', 'smart', 'monthly', 9.90),
  ('smart_annual', 'smart', 'annual', 79.90),
  ('premium_monthly', 'premium', 'monthly', 19.90),
  ('premium_annual', 'premium', 'annual', 149.90)
on conflict (code) do update
set plan = excluded.plan,
    billing_cycle = excluded.billing_cycle,
    amount_brl = excluded.amount_brl,
    updated_at = now();

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_code text not null references public.billing_products(code),
  plan text not null check (plan in ('free', 'smart', 'premium')),
  billing_cycle text not null check (billing_cycle in ('monthly', 'annual')),
  provider text not null check (provider in ('mercado_pago', 'google_play', 'apple')),
  provider_subscription_id text,
  provider_customer_id text,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'past_due', 'grace_period', 'paused', 'cancelled', 'expired', 'refunded')),
  started_at timestamptz,
  current_period_end timestamptz,
  access_until timestamptz,
  cancel_at_period_end boolean not null default false,
  cancelled_at timestamptz,
  last_provider_sync_at timestamptz,
  provider_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists subscriptions_provider_id_unique
  on public.subscriptions(provider, provider_subscription_id)
  where provider_subscription_id is not null;
create index if not exists subscriptions_user_status_idx
  on public.subscriptions(user_id, status, access_until desc);

create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  event_type text not null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  payload jsonb not null,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create table if not exists public.ai_request_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists ai_request_usage_user_created_idx
  on public.ai_request_usage(user_id, created_at desc);

alter table public.billing_settings enable row level security;
alter table public.billing_products enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.ai_request_usage enable row level security;

revoke all on public.billing_settings from anon, authenticated;
revoke all on public.subscription_events from anon, authenticated;
revoke all on public.ai_request_usage from anon, authenticated;
revoke insert, update, delete on public.billing_products from anon, authenticated;
revoke insert, update, delete on public.subscriptions from anon, authenticated;
grant select on public.billing_products to authenticated;
grant select on public.subscriptions to authenticated;

drop policy if exists "billing_products_authenticated_read" on public.billing_products;
create policy "billing_products_authenticated_read"
  on public.billing_products for select to authenticated using (active);

drop policy if exists "subscriptions_owner_read" on public.subscriptions;
create policy "subscriptions_owner_read"
  on public.subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function public.get_my_entitlement()
returns table (
  plan text,
  subscription_status text,
  billing_cycle text,
  provider text,
  access_until timestamptz,
  billing_enabled boolean,
  limits_enabled boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with settings as (
    select bs.billing_enabled, bs.limits_enabled
    from public.billing_settings bs
    where bs.id = true
  ),
  current_subscription as (
    select s.plan, s.status, s.billing_cycle, s.provider, s.access_until
    from public.subscriptions s
    where s.user_id = (select auth.uid())
      and (
        s.status in ('active', 'grace_period')
        or (s.status = 'cancelled' and s.access_until > now())
      )
    order by
      case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc,
      s.access_until desc nulls last
    limit 1
  )
  select
    coalesce(cs.plan, 'free')::text,
    coalesce(cs.status, 'none')::text,
    cs.billing_cycle,
    cs.provider,
    cs.access_until,
    coalesce(st.billing_enabled, false),
    coalesce(st.limits_enabled, false)
  from settings st
  left join current_subscription cs on true;
$$;

revoke all on function public.get_my_entitlement() from public, anon;
grant execute on function public.get_my_entitlement() to authenticated;

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
begin
  select limits_enabled into limits_on
  from public.billing_settings where id = true;
  if not coalesce(limits_on, false) then return new; end if;
  if new.user_id is distinct from (select auth.uid()) then
    raise exception using errcode = '42501', message = 'invalid resource owner';
  end if;

  select coalesce((
    select s.plan from public.subscriptions s
    where s.user_id = new.user_id
      and (s.status in ('active','grace_period') or (s.status = 'cancelled' and s.access_until > now()))
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc
    limit 1
  ), 'free') into current_plan;
  if current_plan = 'premium' then return new; end if;

  if tg_table_name = 'contas' then
    allowed_count := case current_plan when 'smart' then 5 else 2 end;
    select count(*) into used_count from public.contas where user_id = new.user_id and not coalesce(arquivado, false);
  elsif tg_table_name = 'cartoes' then
    allowed_count := case current_plan when 'smart' then 3 else 1 end;
    select count(*) into used_count from public.cartoes where user_id = new.user_id and coalesce(ativo, true);
  elsif tg_table_name = 'caixinhas' then
    allowed_count := case current_plan when 'smart' then 5 else 1 end;
    select count(*) into used_count from public.caixinhas where user_id = new.user_id and not coalesce(arquivado, false);
  elsif tg_table_name = 'categorias' then
    allowed_count := case current_plan when 'smart' then 14 else 7 end;
    select count(*) into used_count from public.categorias
      where user_id = new.user_id
        and tipo = new.tipo
        and coalesce(ativa::text, 'true') not in ('0', 'false', 'f');
  elsif tg_table_name = 'transacoes' then
    allowed_count := case current_plan when 'smart' then 300 else 40 end;
    select count(*) into used_count from public.transacoes
      where user_id = new.user_id
        and date_trunc('month', data_vencimento::date) = date_trunc('month', new.data_vencimento::date);
  else
    return new;
  end if;

  if used_count >= allowed_count then
    raise exception using errcode = 'P0001', message = 'plan limit reached';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_finflow_plan_limit() from public, anon, authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array['contas','cartoes','caixinhas','categorias','transacoes']
  loop
    if to_regclass('public.' || table_name) is not null then
      execute format('drop trigger if exists enforce_plan_limit_before_insert on public.%I', table_name);
      execute format(
        'create trigger enforce_plan_limit_before_insert before insert on public.%I for each row execute function public.enforce_finflow_plan_limit()',
        table_name
      );
    end if;
  end loop;
end;
$$;

comment on table public.billing_settings is
  'Chaves operacionais. limits_enabled=false libera limites durante desenvolvimento sem conceder plano pago.';
comment on table public.subscriptions is
  'Fonte oficial de direitos. Nunca permita escrita direta pelo aplicativo.';

-- Endurece a função legada de exclusão caso ela já exista.
do $$
begin
  if to_regprocedure('public.delete_user()') is not null then
    execute 'alter function public.delete_user() set search_path = ''''';
    execute 'revoke all on function public.delete_user() from public, anon';
    execute 'grant execute on function public.delete_user() to authenticated';
  end if;
end;
$$;
