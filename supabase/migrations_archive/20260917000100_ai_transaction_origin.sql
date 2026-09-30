create table if not exists public.ai_transaction_origins (
  transaction_id bigint primary key references public.transacoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null default 'ai' check (source = 'ai'),
  created_at timestamptz not null default now()
);

create index if not exists ai_transaction_origins_user_idx
  on public.ai_transaction_origins(user_id, transaction_id);

alter table public.ai_transaction_origins enable row level security;

drop policy if exists ai_transaction_origins_owner_select on public.ai_transaction_origins;
create policy ai_transaction_origins_owner_select
  on public.ai_transaction_origins for select to authenticated
  using (user_id = auth.uid());

revoke all on public.ai_transaction_origins from public, anon, authenticated;
grant select on public.ai_transaction_origins to authenticated;
grant all on public.ai_transaction_origins to service_role;
