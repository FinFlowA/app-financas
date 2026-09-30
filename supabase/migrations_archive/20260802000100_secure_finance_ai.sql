-- FinFlow: execução financeira da IA no servidor, com confirmação, auditoria,
-- idempotência, cotas por plano e histórico de conversa reservado à Edge.
--
-- Esta migração não substitui o chat atual. Ela cria o limite de confiança que
-- uma integração futura deve usar: o modelo propõe uma ação, o usuário confirma
-- um token opaco e somente então uma função transacional aplica a alteração.

begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Falhar explicitamente é mais seguro do que instalar um executor parcialmente
-- funcional em uma base cujo núcleo financeiro não corresponde ao FinFlow.
do $$
declare
  required_table text;
  missing_columns text[];
begin
  foreach required_table in array array[
    'contas', 'categorias', 'caixinhas', 'transacoes', 'cartoes', 'fatura_itens',
    'ai_request_usage'
  ] loop
    if to_regclass(format('public.%I', required_table)) is null then
      raise exception 'AI_SCHEMA_MISSING_%', upper(required_table);
    end if;
  end loop;

  select array_agg(spec.table_name || '.' || spec.column_name order by 1)
    into missing_columns
  from (values
    ('contas','id'), ('contas','user_id'), ('contas','nome'),
    ('contas','saldo_inicial'), ('contas','cor'), ('contas','arquivado'),
    ('contas','compartilhado'),
    ('categorias','id'), ('categorias','user_id'), ('categorias','nome'),
    ('categorias','tipo'), ('categorias','cor'), ('categorias','icone'),
    ('categorias','ativa'),
    ('caixinhas','id'), ('caixinhas','user_id'), ('caixinhas','nome'),
    ('caixinhas','meta_valor'), ('caixinhas','saldo_atual'),
    ('caixinhas','cor'), ('caixinhas','icone'), ('caixinhas','data_prazo'),
    ('caixinhas','arquivado'), ('caixinhas','compartilhado'),
    ('transacoes','id'), ('transacoes','user_id'), ('transacoes','tipo'),
    ('transacoes','valor'), ('transacoes','descricao'),
    ('transacoes','data_vencimento'), ('transacoes','data_realizacao'),
    ('transacoes','conta_id'), ('transacoes','categoria_id'),
    ('transacoes','status'),
    ('cartoes','id'), ('cartoes','user_id'), ('cartoes','nome'),
    ('cartoes','cor'), ('cartoes','limite'), ('cartoes','dia_vencimento'),
    ('cartoes','dia_fechamento'), ('cartoes','ativo'),
    ('fatura_itens','id'), ('fatura_itens','cartao_id'),
    ('fatura_itens','user_id'), ('fatura_itens','descricao'),
    ('fatura_itens','valor'), ('fatura_itens','data_compra'),
    ('fatura_itens','mes_fatura'), ('fatura_itens','parcela_atual'),
    ('fatura_itens','total_parcelas'), ('fatura_itens','grupo_parcela_id'),
    ('fatura_itens','categoria_id'), ('fatura_itens','pago'),
    ('ai_request_usage','user_id'), ('ai_request_usage','created_at')
  ) as spec(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = spec.table_name
      and c.column_name = spec.column_name
  );

  if missing_columns is not null then
    raise exception 'AI_SCHEMA_MISSING_COLUMNS:%', array_to_string(missing_columns, ',');
  end if;

  if to_regprocedure('public.get_my_entitlement()') is null then
    raise exception 'AI_SCHEMA_MISSING_GET_MY_ENTITLEMENT';
  end if;

  if to_regprocedure('public.is_parceiro(uuid,uuid)') is null then
    raise exception 'AI_SCHEMA_MISSING_IS_PARCEIRO';
  end if;

  if to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'AI_SCHEMA_PGCRYPTO_NOT_IN_EXTENSIONS';
  end if;
end;
$$;

create table public.ai_pending_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null check (action_type = any (array[
    'create_account', 'update_account', 'archive_account', 'delete_account',
    'reactivate_account',
    'create_category', 'update_category', 'archive_category', 'delete_category',
    'reactivate_category',
    'create_goal', 'update_goal', 'archive_goal', 'delete_goal',
    'reactivate_goal', 'move_goal',
    'create_transaction', 'update_transaction', 'delete_transaction',
    'complete_transaction', 'reopen_transaction', 'transfer_between_accounts',
    'create_card', 'update_card', 'archive_card', 'delete_card',
    'reactivate_card', 'create_card_purchase', 'update_card_purchase',
    'delete_card_purchase',
    'pay_invoice', 'reverse_invoice_payment'
  ])),
  payload jsonb not null check (
    jsonb_typeof(payload) = 'object'
    and octet_length(payload::text) <= 16384
  ),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  -- Hash opaco do estado financeiro visto na prévia. Ele nunca é devolvido
  -- ao aplicativo; serve apenas para impedir que uma confirmação antiga
  -- sobrescreva uma alteração feita em outro dispositivo ou pelo parceiro.
  state_fingerprint text check (
    state_fingerprint is null or state_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  preview jsonb not null check (
    jsonb_typeof(preview) = 'object' and octet_length(preview::text) <= 8192
  ),
  idempotency_key text not null check (
    length(idempotency_key) between 16 and 200
    and idempotency_key ~ '^[A-Za-z0-9:_-]+$'
  ),
  confirmation_token uuid not null default gen_random_uuid(),
  status text not null default 'pending' check (
    status in ('pending', 'executing', 'succeeded', 'failed', 'cancelled', 'expired')
  ),
  expires_at timestamptz not null,
  result jsonb,
  last_error_code text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  executed_at timestamptz,
  cancelled_at timestamptz,
  unique (user_id, idempotency_key),
  check (expires_at > created_at and expires_at <= created_at + interval '30 minutes'),
  check (result is null or octet_length(result::text) <= 32768),
  check (last_error_code is null or last_error_code ~ '^AI_[A-Z0-9_]+$')
);

create index ai_pending_actions_user_status_created_idx
  on public.ai_pending_actions(user_id, status, created_at desc);
create index ai_pending_actions_pending_expiry_idx
  on public.ai_pending_actions(expires_at)
  where status = 'pending';

create table public.ai_action_audit (
  id bigint generated always as identity primary key,
  action_id uuid references public.ai_pending_actions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null,
  event_type text not null check (event_type in (
    'created', 'executing', 'succeeded', 'failed', 'cancelled', 'expired',
    'quota_rejected', 'replayed', 'no_op'
  )),
  payload_snapshot jsonb,
  result jsonb,
  error_code text,
  idempotency_key text,
  created_at timestamptz not null default clock_timestamp(),
  check (payload_snapshot is null or octet_length(payload_snapshot::text) <= 16384),
  check (result is null or octet_length(result::text) <= 32768),
  check (error_code is null or error_code ~ '^AI_[A-Z0-9_]+$')
);

create index ai_action_audit_user_created_idx
  on public.ai_action_audit(user_id, created_at desc);
create index ai_action_audit_action_created_idx
  on public.ai_action_audit(action_id, created_at);
create index ai_action_audit_quota_idx
  on public.ai_action_audit(user_id, created_at)
  where event_type = 'succeeded';
create unique index ai_action_audit_analytic_idempotency_uidx
  on public.ai_action_audit(user_id,idempotency_key)
  where action_id is null and event_type='succeeded' and idempotency_key is not null;

-- Histórico somente para service_role. O conteúdo já deve chegar redigido pela
-- Edge; as restrições abaixo bloqueiam segredos conhecidos e limitam volume.
create table public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (
    jsonb_typeof(state) = 'object' and octet_length(state::text) <= 32768
  ),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index ai_conversations_user_updated_idx
  on public.ai_conversations(user_id, updated_at desc);

create table public.ai_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (
    length(btrim(content)) between 1 and 2000
    and content !~* '(sb_secret_|service_role[^[:space:]]{0,8}[=:]|gsk_[A-Za-z0-9_-]{20,}|authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{20,})'
  ),
  intent text check (intent is null or length(intent) between 1 and 80),
  provider text check (provider is null or length(provider) between 1 and 80),
  model text check (model is null or length(model) between 1 and 120),
  created_at timestamptz not null default clock_timestamp()
);

create index ai_messages_conversation_created_idx
  on public.ai_messages(conversation_id, created_at, id);
create index ai_messages_user_created_idx
  on public.ai_messages(user_id, created_at desc);

-- Ledger privado: permite estornar exatamente o pagamento produzido pela IA,
-- sem reabrir itens pagos por outro lançamento posterior.
create table private.ai_invoice_payment_ledger (
  payment_transaction_id bigint primary key,
  action_id uuid references public.ai_pending_actions(id) on delete set null,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id bigint references public.cartoes(id) on delete set null,
  invoice_month text not null check (invoice_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  mode text not null check (mode in ('total', 'partial', 'carry_forward')),
  paid_item_ids bigint[] not null default '{}',
  linked_item_id bigint,
  created_at timestamptz not null default clock_timestamp(),
  reversed_at timestamptz
);

create index ai_invoice_payment_ledger_card_month_idx
  on private.ai_invoice_payment_ledger(card_id, invoice_month, created_at desc);

-- Impede que qualquer caminho do aplicativo apague um cartão cujo pagamento
-- ainda possa ser estornado. Depois do estorno, SET NULL preserva o ledger sem
-- prender para sempre um cartão vazio. A exclusão do próprio usuário continua
-- permitida: nesse cascade a linha de auth.users já não está visível.
create or replace function private.ai_protect_card_with_active_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists(select 1 from auth.users u where u.id=old.user_id)
     and exists(
       select 1 from private.ai_invoice_payment_ledger l
       where l.card_id=old.id and l.reversed_at is null
     ) then
    raise exception using errcode='P0001', message='AI_CARD_HAS_ACTIVE_INVOICE_PAYMENT';
  end if;
  return old;
end;
$$;

create trigger ai_cartoes_protect_active_invoice_ledger
before delete on public.cartoes
for each row execute function private.ai_protect_card_with_active_payment();

revoke all on function private.ai_protect_card_with_active_payment()
  from public, anon, authenticated;

alter table public.ai_pending_actions enable row level security;
alter table public.ai_action_audit enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table private.ai_invoice_payment_ledger enable row level security;

create policy ai_pending_actions_owner_select
  on public.ai_pending_actions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy ai_action_audit_owner_select
  on public.ai_action_audit for select to authenticated
  using ((select auth.uid()) = user_id);

-- Não há grants de tabela para authenticated: as policies acima são somente uma
-- segunda barreira caso permissões sejam ampliadas no futuro.
revoke all on public.ai_pending_actions from public, anon, authenticated;
revoke all on public.ai_action_audit from public, anon, authenticated;
revoke all on public.ai_conversations from public, anon, authenticated;
revoke all on public.ai_messages from public, anon, authenticated;
revoke all on private.ai_invoice_payment_ledger from public, anon, authenticated;
revoke all on sequence public.ai_action_audit_id_seq from public, anon, authenticated;
revoke all on sequence public.ai_messages_id_seq from public, anon, authenticated;

grant all on public.ai_pending_actions to service_role;
grant all on public.ai_action_audit to service_role;
grant all on public.ai_conversations to service_role;
grant all on public.ai_messages to service_role;
grant all on private.ai_invoice_payment_ledger to service_role;
grant usage on schema private to service_role;
grant usage, select on sequence public.ai_action_audit_id_seq to service_role;
grant usage, select on sequence public.ai_messages_id_seq to service_role;

create or replace function private.ai_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

create trigger ai_pending_actions_touch_updated_at
before update on public.ai_pending_actions
for each row execute function private.ai_touch_updated_at();

create trigger ai_conversations_touch_updated_at
before update on public.ai_conversations
for each row execute function private.ai_touch_updated_at();

create or replace function private.ai_validate_message_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.ai_conversations c
    where c.id = new.conversation_id and c.user_id = new.user_id
  ) then
    raise exception using errcode = '23514', message = 'AI_MESSAGE_OWNER_MISMATCH';
  end if;
  return new;
end;
$$;

create trigger ai_messages_validate_owner
before insert or update on public.ai_messages
for each row execute function private.ai_validate_message_owner();

revoke all on function private.ai_touch_updated_at() from public, anon, authenticated;
revoke all on function private.ai_validate_message_owner() from public, anon, authenticated;

create or replace function private.ai_fail(code text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if code !~ '^AI_[A-Z0-9_]+$' then
    code := 'AI_INTERNAL_ERROR';
  end if;
  raise exception using errcode = 'P0001', message = code;
end;
$$;

create or replace function private.ai_assert_authenticated()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then perform private.ai_fail('AI_AUTH_REQUIRED'); end if;
  return caller;
end;
$$;

create or replace function private.ai_require_keys(payload jsonb, required_keys text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare key_name text;
begin
  foreach key_name in array required_keys loop
    if not payload ? key_name or payload -> key_name = 'null'::jsonb then
      perform private.ai_fail('AI_MISSING_' || upper(key_name));
    end if;
  end loop;
end;
$$;

create or replace function private.ai_assert_allowed_keys(payload jsonb, allowed_keys text[])
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare key_name text;
begin
  if jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 16384 then
    perform private.ai_fail('AI_INVALID_PAYLOAD');
  end if;
  for key_name in select jsonb_object_keys(payload) loop
    if not (key_name = any(allowed_keys)) then
      perform private.ai_fail('AI_UNKNOWN_FIELD');
    end if;
  end loop;
end;
$$;

create or replace function private.ai_text(
  payload jsonb,
  key_name text,
  max_length integer,
  allow_empty boolean default false
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare value text;
begin
  if jsonb_typeof(payload -> key_name) <> 'string' then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  value := btrim(payload ->> key_name);
  if (not allow_empty and value = '') or length(value) > max_length then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value;
end;
$$;

create or replace function private.ai_number(payload jsonb, key_name text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare value numeric;
begin
  if jsonb_typeof(payload -> key_name) not in ('number','string')
     or (payload ->> key_name) !~ '^-?(0|[1-9][0-9]*)(\.[0-9]{1,4})?$' then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  begin value := (payload ->> key_name)::numeric;
  exception when others then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end;
  if value = 'NaN'::numeric or value = 'Infinity'::numeric or value = '-Infinity'::numeric then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value;
end;
$$;

create or replace function private.ai_id(payload jsonb, key_name text)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare value numeric;
begin
  value := private.ai_number(payload, key_name);
  if value <= 0 or trunc(value) <> value or value > 9223372036854775807::numeric then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value::bigint;
end;
$$;

create or replace function private.ai_integer(payload jsonb, key_name text, min_value integer, max_value integer)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare value numeric;
begin
  value := private.ai_number(payload, key_name);
  if trunc(value) <> value or value < min_value or value > max_value then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value::integer;
end;
$$;

create or replace function private.ai_date(payload jsonb, key_name text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare raw text; parsed date;
begin
  raw := private.ai_text(payload, key_name, 10);
  if raw !~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$' then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  begin parsed := raw::date;
  exception when others then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end;
  if to_char(parsed, 'YYYY-MM-DD') <> raw then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end if;
  return parsed;
end;
$$;

create or replace function private.ai_choice(payload jsonb, key_name text, choices text[])
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare value text;
begin
  value := private.ai_text(payload, key_name, 40);
  if not (value = any(choices)) then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end if;
  return value;
end;
$$;

create or replace function private.ai_color(payload jsonb, key_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare value text := private.ai_text(payload, key_name, 7);
begin
  if value !~ '^#[0-9A-Fa-f]{6}$' then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end if;
  return upper(value);
end;
$$;

create or replace function private.ai_description(payload jsonb, key_name text, max_length integer default 120)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare value text := private.ai_text(payload, key_name, max_length);
begin
  if value ~* '\[(Transf\.|Destino:|Objetivo:|Serie:|PagFatura:)' then
    perform private.ai_fail('AI_RESERVED_DESCRIPTION_MARKER');
  end if;
  return value;
end;
$$;

revoke all on function private.ai_fail(text) from public, anon, authenticated;
revoke all on function private.ai_assert_authenticated() from public, anon, authenticated;
revoke all on function private.ai_require_keys(jsonb,text[]) from public, anon, authenticated;
revoke all on function private.ai_assert_allowed_keys(jsonb,text[]) from public, anon, authenticated;
revoke all on function private.ai_text(jsonb,text,integer,boolean) from public, anon, authenticated;
revoke all on function private.ai_number(jsonb,text) from public, anon, authenticated;
revoke all on function private.ai_id(jsonb,text) from public, anon, authenticated;
revoke all on function private.ai_integer(jsonb,text,integer,integer) from public, anon, authenticated;
revoke all on function private.ai_date(jsonb,text) from public, anon, authenticated;
revoke all on function private.ai_choice(jsonb,text,text[]) from public, anon, authenticated;
revoke all on function private.ai_color(jsonb,text) from public, anon, authenticated;
revoke all on function private.ai_description(jsonb,text,integer) from public, anon, authenticated;

create or replace function private.ai_can_access_account(
  caller uuid,
  account_id bigint,
  require_active boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.contas c
    where c.id = account_id
      and (not require_active or not coalesce(c.arquivado, false))
      and (
        c.user_id = caller
        or (
          coalesce(c.compartilhado, false)
          and public.is_parceiro(c.user_id, caller)
        )
      )
  );
$$;

create or replace function private.ai_can_access_goal(
  caller uuid,
  goal_id bigint,
  require_active boolean default true
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.caixinhas g
    where g.id = goal_id
      and (not require_active or not coalesce(g.arquivado, false))
      and (
        g.user_id = caller
        or (
          coalesce(g.compartilhado, false)
          and public.is_parceiro(g.user_id, caller)
        )
      )
  );
$$;

create or replace function private.ai_assert_account(
  caller uuid,
  account_id bigint,
  owner_only boolean default false,
  require_active boolean default true
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if owner_only then
    if not exists (
      select 1 from public.contas c
      where c.id = account_id and c.user_id = caller
        and (not require_active or not coalesce(c.arquivado, false))
    ) then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
  elsif not private.ai_can_access_account(caller, account_id, require_active) then
    perform private.ai_fail('AI_ACCOUNT_NOT_FOUND');
  end if;
end;
$$;

create or replace function private.ai_assert_category(
  caller uuid,
  category_id bigint,
  transaction_type text default null,
  require_active boolean default true
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.categorias c
    where c.id = category_id and c.user_id = caller
      and (not require_active or coalesce(c.ativa::text, 'true') not in ('0','false','f'))
      and (
        transaction_type is null
        or c.tipo = transaction_type
        or c.tipo = 'ambos'
      )
  ) then perform private.ai_fail('AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE'); end if;
end;
$$;

create or replace function private.ai_assert_goal(
  caller uuid,
  goal_id bigint,
  owner_only boolean default false,
  require_active boolean default true
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if owner_only then
    if not exists (
      select 1 from public.caixinhas g
      where g.id = goal_id and g.user_id = caller
        and (not require_active or not coalesce(g.arquivado, false))
    ) then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  elsif not private.ai_can_access_goal(caller, goal_id, require_active) then
    perform private.ai_fail('AI_GOAL_NOT_FOUND');
  end if;
end;
$$;

create or replace function private.ai_assert_card(
  caller uuid,
  card_id bigint,
  require_active boolean default true
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.cartoes c
    where c.id = card_id and c.user_id = caller
      and (not require_active or coalesce(c.ativo, true))
  ) then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
end;
$$;

create or replace function private.ai_assert_transaction(caller uuid, transaction_id bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.transacoes t
    where t.id = transaction_id
      and (
        t.user_id = caller
        or exists (
          select 1 from public.contas c
          where c.id = t.conta_id
            and coalesce(c.compartilhado, false)
            and public.is_parceiro(c.user_id, caller)
        )
      )
  ) then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
end;
$$;

create or replace function private.ai_assert_card_item(caller uuid, item_id bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.fatura_itens i
    where i.id = item_id and i.user_id = caller
      and exists (
        select 1 from public.cartoes c
        where c.id = i.cartao_id and c.user_id = caller
      )
  ) then perform private.ai_fail('AI_CARD_PURCHASE_NOT_FOUND'); end if;
end;
$$;

create or replace function private.ai_add_occurrence(
  base_date date,
  occurrence_index integer,
  frequency text
)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  target_month date;
  month_offset integer;
begin
  if occurrence_index < 0 then perform private.ai_fail('AI_INVALID_OCCURRENCE'); end if;
  if frequency = 'weekly' then return base_date + (occurrence_index * 7); end if;
  if frequency not in ('monthly','annual') then perform private.ai_fail('AI_INVALID_FREQUENCY'); end if;
  month_offset := occurrence_index * case when frequency = 'annual' then 12 else 1 end;
  target_month := (date_trunc('month', base_date)::date + make_interval(months => month_offset))::date;
  return make_date(
    extract(year from target_month)::integer,
    extract(month from target_month)::integer,
    least(extract(day from base_date)::integer,
      extract(day from (target_month + interval '1 month - 1 day'))::integer)
  );
end;
$$;

create or replace function private.ai_add_month(invoice_month text, offset_months integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare parsed date;
begin
  if invoice_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    perform private.ai_fail('AI_INVALID_MONTH');
  end if;
  parsed := (invoice_month || '-01')::date;
  return to_char(parsed + make_interval(months => offset_months), 'YYYY-MM');
end;
$$;

create or replace function private.ai_invoice_month(purchase_date date, closing_day integer)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if closing_day not between 1 and 31 then perform private.ai_fail('AI_INVALID_CLOSING_DAY'); end if;
  return to_char(
    date_trunc('month', purchase_date)::date
      + case when extract(day from purchase_date)::integer > closing_day
        then interval '1 month' else interval '0 month' end,
    'YYYY-MM'
  );
end;
$$;

create or replace function private.ai_invoice_is_closed(invoice_month text, closing_day integer)
returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  month_start date;
  close_date date;
  local_now timestamp := clock_timestamp() at time zone 'America/Sao_Paulo';
begin
  if invoice_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or closing_day not between 1 and 31 then
    perform private.ai_fail('AI_INVALID_INVOICE');
  end if;
  month_start := (invoice_month || '-01')::date;
  close_date := make_date(
    extract(year from month_start)::integer,
    extract(month from month_start)::integer,
    least(closing_day, extract(day from (month_start + interval '1 month - 1 day'))::integer)
  );
  return local_now > (close_date::timestamp + interval '23 hours 59 minutes 59 seconds');
end;
$$;

create or replace function private.ai_series_marker()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '');
$$;

-- Séries criadas por versões antigas não possuem [Serie:<id>]. Esta
-- assinatura preserva conta/tipo/valor no chamador e, na descrição, mantém
-- base, tipo de recorrência e metadados de destino/objetivo separados. Ela não
-- tenta adivinhar uma série quando há qualquer marcador moderno.
create or replace function private.ai_legacy_series_descriptor(description text)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  metadata text;
  visible text;
  matched text[];
  cadence text;
begin
  if description is null or description ~ '\[Serie:[A-Za-z0-9_-]+\]' then
    return null;
  end if;

  metadata:=coalesce(substring(description from
    '(\s*(?:\[(?:Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$'), '');
  visible:=btrim(regexp_replace(description,
    '(\s*(?:\[(?:Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$','','g'));

  matched:=regexp_match(visible,'\(([0-9]+)/([0-9]+)\)$');
  if matched is not null then
    if matched[1]::integer<1 or matched[2]::integer<2
       or matched[1]::integer>matched[2]::integer then
      return null;
    end if;
    return jsonb_build_object(
      'kind','parcelada',
      'base',btrim(regexp_replace(visible,'\s*\([0-9]+/[0-9]+\)$','')),
      'metadata',metadata,
      'item_index',matched[1]::integer,
      'item_total',matched[2]::integer
    );
  end if;

  matched:=regexp_match(visible,'\(Fixa(?: (semanal|anual))?\)$');
  if matched is null then return null; end if;
  cadence:=case coalesce(matched[1],'mensal')
    when 'semanal' then 'semanal'
    when 'anual' then 'anual'
    else 'mensal'
  end;
  return jsonb_build_object(
    'kind','recorrente',
    'base',btrim(regexp_replace(visible,'\s*\(Fixa(?: semanal| anual)?\)$','')),
    'metadata',metadata,
    'cadence',cadence
  );
end;
$$;

-- Resolve somente parcelamentos legados numerados quando os itens pendentes
-- formam um grupo inequívoco. Recorrências antigas sem [Serie:<id>] nunca são
-- agrupadas: duas agendas iguais e adjacentes são matematicamente
-- indistinguíveis, portanto qualquer operação nelas deve ser individual.
create or replace function private.ai_legacy_series_ids(
  caller uuid,
  target_transaction_id bigint
)
returns bigint[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_row public.transacoes%rowtype;
  candidate_row public.transacoes%rowtype;
  target_descriptor jsonb;
  candidate_descriptor jsonb;
  result_ids bigint[]:='{}';
  seen_keys text[]:='{}';
  target_kind text;
  target_cadence text;
  target_base text;
  target_metadata text;
  target_total integer;
  item_index integer;
  anchor_month date;
  candidate_anchor_month date;
  expected_month date;
  expected_date date;
  last_day integer;
  maximum_day integer:=0;
  offset_value integer;
  minimum_offset integer:=2147483647;
  maximum_offset integer:=-2147483648;
  expected_items integer;
  duplicate_key text;
  candidate_id bigint;
begin
  select * into target_row
  from public.transacoes t
  where t.id=target_transaction_id
    and (
      t.user_id=caller
      or exists(
        select 1 from public.contas c
        where c.id=t.conta_id and coalesce(c.compartilhado,false)
          and public.is_parceiro(c.user_id,caller)
      )
    )
  for update;
  if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
  if target_row.status='paga' then
    perform private.ai_fail('AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL');
  end if;

  target_descriptor:=private.ai_legacy_series_descriptor(target_row.descricao);
  if target_descriptor is null then perform private.ai_fail('AI_TRANSACTION_NOT_IN_SERIES'); end if;
  target_kind:=target_descriptor->>'kind';
  target_cadence:=target_descriptor->>'cadence';
  target_base:=target_descriptor->>'base';
  target_metadata:=target_descriptor->>'metadata';
  target_total:=coalesce((target_descriptor->>'item_total')::integer,0);
  if target_kind='recorrente' then
    perform private.ai_fail('AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL');
  end if;
  if target_kind='parcelada' then
    item_index:=(target_descriptor->>'item_index')::integer;
    anchor_month:=(date_trunc('month',target_row.data_vencimento)::date
      - make_interval(months=>item_index-1))::date;
  end if;

  for candidate_row in
    select t.*
    from public.transacoes t
    where t.status<>'paga'
      and t.user_id=target_row.user_id
      and t.conta_id=target_row.conta_id
      and t.tipo=target_row.tipo
      and t.categoria_id is not distinct from target_row.categoria_id
      and round(t.valor,2)=round(target_row.valor,2)
      and t.descricao !~ '\[Serie:[A-Za-z0-9_-]+\]'
      and (
        t.user_id=caller
        or exists(
          select 1 from public.contas c
          where c.id=t.conta_id and coalesce(c.compartilhado,false)
            and public.is_parceiro(c.user_id,caller)
        )
      )
    order by t.data_vencimento,t.id
    for update
  loop
    candidate_descriptor:=private.ai_legacy_series_descriptor(candidate_row.descricao);
    if candidate_descriptor is null
       or candidate_descriptor->>'kind'<>target_kind
       or candidate_descriptor->>'base'<>target_base
       or candidate_descriptor->>'metadata'<>target_metadata then
      continue;
    end if;

    if target_kind='parcelada' then
      if (candidate_descriptor->>'item_total')::integer<>target_total then continue; end if;
      item_index:=(candidate_descriptor->>'item_index')::integer;
      candidate_anchor_month:=(date_trunc('month',candidate_row.data_vencimento)::date
        - make_interval(months=>item_index-1))::date;
      if candidate_anchor_month<>anchor_month then continue; end if;
      duplicate_key:='parcel:'||item_index::text;
      offset_value:=item_index-1;
    else
      if candidate_descriptor->>'cadence'<>target_cadence then continue; end if;
      if target_cadence='semanal' then
        offset_value:=(candidate_row.data_vencimento-target_row.data_vencimento)/7;
        if (candidate_row.data_vencimento-target_row.data_vencimento)%7<>0 then continue; end if;
        duplicate_key:='week:'||candidate_row.data_vencimento::text;
      elsif target_cadence='anual' then
        offset_value:=extract(year from candidate_row.data_vencimento)::integer
          - extract(year from target_row.data_vencimento)::integer;
        if extract(month from candidate_row.data_vencimento)::integer
           <>extract(month from target_row.data_vencimento)::integer then continue; end if;
        duplicate_key:='year:'||extract(year from candidate_row.data_vencimento)::integer::text;
      else
        offset_value:=(extract(year from candidate_row.data_vencimento)::integer
          - extract(year from target_row.data_vencimento)::integer)*12
          + extract(month from candidate_row.data_vencimento)::integer
          - extract(month from target_row.data_vencimento)::integer;
        duplicate_key:='month:'||to_char(candidate_row.data_vencimento,'YYYY-MM');
      end if;
    end if;

    maximum_day:=greatest(maximum_day,extract(day from candidate_row.data_vencimento)::integer);
    if array_position(seen_keys,duplicate_key) is not null then
      perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
    end if;
    seen_keys:=array_append(seen_keys,duplicate_key);
    result_ids:=array_append(result_ids,candidate_row.id);
    minimum_offset:=least(minimum_offset,offset_value);
    maximum_offset:=greatest(maximum_offset,offset_value);
  end loop;

  if cardinality(result_ids)=0 or not (target_transaction_id=any(result_ids)) then
    perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
  end if;
  if target_kind='parcelada' and cardinality(result_ids)>target_total then
    perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
  elsif target_kind='recorrente' and (
    (target_cadence='semanal' and maximum_offset-minimum_offset>259)
    or (target_cadence='mensal' and maximum_offset-minimum_offset>59)
    or (target_cadence='anual' and maximum_offset-minimum_offset>4)
  ) then
    perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
  end if;

  -- Uma série recorrente antiga não possui um identificador persistido.
  -- Por isso, só aceitamos o fallback quando os itens pendentes formam uma
  -- sequência contígua e sem duplicatas na cadência declarada. Uma lacuna
  -- pode representar itens editados/excluídos ou duas séries diferentes e,
  -- nesses casos, a operação em massa falha fechada.
  if target_kind='recorrente' then
    expected_items:=maximum_offset-minimum_offset+1;
    if expected_items<>cardinality(result_ids) then
      perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
    end if;
  end if;

  -- Datas mensais, anuais e parceladas usam sempre o mesmo dia-base, limitado
  -- ao último dia do mês. O maior dia observado recupera 29/30/31 quando
  -- algum mês da série permite esse dia.
  if target_kind='parcelada' or target_cadence in ('mensal','anual') then
    foreach candidate_id in array result_ids loop
      select * into candidate_row from public.transacoes where id=candidate_id;
      candidate_descriptor:=private.ai_legacy_series_descriptor(candidate_row.descricao);
      if target_kind='parcelada' then
        item_index:=(candidate_descriptor->>'item_index')::integer;
        expected_month:=(anchor_month+make_interval(months=>item_index-1))::date;
      elsif target_cadence='anual' then
        offset_value:=extract(year from candidate_row.data_vencimento)::integer
          - extract(year from target_row.data_vencimento)::integer;
        expected_month:=(date_trunc('month',target_row.data_vencimento)::date
          + make_interval(months=>offset_value*12))::date;
      else
        offset_value:=(extract(year from candidate_row.data_vencimento)::integer
          - extract(year from target_row.data_vencimento)::integer)*12
          + extract(month from candidate_row.data_vencimento)::integer
          - extract(month from target_row.data_vencimento)::integer;
        expected_month:=(date_trunc('month',target_row.data_vencimento)::date
          + make_interval(months=>offset_value))::date;
      end if;
      last_day:=extract(day from (expected_month+interval '1 month - 1 day'))::integer;
      expected_date:=make_date(
        extract(year from expected_month)::integer,
        extract(month from expected_month)::integer,
        least(maximum_day,last_day)
      );
      if candidate_row.data_vencimento<>expected_date then
        perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
      end if;
    end loop;
  end if;
  return result_ids;
end;
$$;

-- Movimentações de objetivo das primeiras versões eram gravadas apenas
-- como "Guardar em: <nome>" ou "Resgate de: <nome>". A resolução pelo nome
-- só é segura quando existe exatamente um objetivo acessível com aquele nome.
-- Marcadores de transferência entre contas nunca são tratados como objetivo.
create or replace function private.ai_resolve_legacy_goal_movement(
  caller uuid,
  description text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  visible_description text;
  legacy_match text[];
  legacy_name text;
  resolved_goal_id bigint;
  resolved_goal_name text;
  matching_goals integer;
  operation_name text;
  marker_operation text;
begin
  if description is null
     or description ~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]'
     or description ~ '\[Destino:[0-9]+\]' then
    return null;
  end if;

  visible_description:=btrim(regexp_replace(description,
    '(\s*(?:\[(?:Serie:[A-Za-z0-9_-]+)\]\s*)+)$','','g'));
  visible_description:=btrim(regexp_replace(visible_description,'^\[Transf\.\]\s*','','i'));
  visible_description:=btrim(regexp_replace(visible_description,
    '\s*(\([0-9]+/[0-9]+\)|\(Fixa(?: semanal| anual)?\))$','','i'));
  legacy_match:=regexp_match(visible_description,
    '^(Guardar em|Resgate de):\s*(.+)$','i');
  if legacy_match is null or btrim(coalesce(legacy_match[2],''))='' then
    return null;
  end if;

  legacy_name:=btrim(legacy_match[2]);
  marker_operation:=case when lower(legacy_match[1])='guardar em'
    then 'guardar' else 'resgatar' end;
  operation_name:=case marker_operation when 'guardar' then 'save' else 'withdraw' end;

  select count(*),min(g.id),min(g.nome)
  into matching_goals,resolved_goal_id,resolved_goal_name
  from public.caixinhas g
  where lower(btrim(g.nome))=lower(legacy_name)
    and (
      g.user_id=caller
      or (coalesce(g.compartilhado,false) and public.is_parceiro(g.user_id,caller))
    );
  if matching_goals=0 then perform private.ai_fail('AI_LEGACY_GOAL_NOT_FOUND'); end if;
  if matching_goals<>1 then perform private.ai_fail('AI_LEGACY_GOAL_AMBIGUOUS'); end if;

  return jsonb_build_object(
    'goal_id',resolved_goal_id,
    'goal_name',resolved_goal_name,
    'operation',operation_name,
    'marker_operation',marker_operation
  );
end;
$$;

revoke all on function private.ai_can_access_account(uuid,bigint,boolean) from public, anon, authenticated;
revoke all on function private.ai_can_access_goal(uuid,bigint,boolean) from public, anon, authenticated;
revoke all on function private.ai_assert_account(uuid,bigint,boolean,boolean) from public, anon, authenticated;
revoke all on function private.ai_assert_category(uuid,bigint,text,boolean) from public, anon, authenticated;
revoke all on function private.ai_assert_goal(uuid,bigint,boolean,boolean) from public, anon, authenticated;
revoke all on function private.ai_assert_card(uuid,bigint,boolean) from public, anon, authenticated;
revoke all on function private.ai_assert_transaction(uuid,bigint) from public, anon, authenticated;
revoke all on function private.ai_assert_card_item(uuid,bigint) from public, anon, authenticated;
revoke all on function private.ai_add_occurrence(date,integer,text) from public, anon, authenticated;
revoke all on function private.ai_add_month(text,integer) from public, anon, authenticated;
revoke all on function private.ai_invoice_month(date,integer) from public, anon, authenticated;
revoke all on function private.ai_invoice_is_closed(text,integer) from public, anon, authenticated;
revoke all on function private.ai_series_marker() from public, anon, authenticated;
revoke all on function private.ai_legacy_series_descriptor(text) from public, anon, authenticated;
revoke all on function private.ai_legacy_series_ids(uuid,bigint) from public, anon, authenticated;
revoke all on function private.ai_resolve_legacy_goal_movement(uuid,text) from public, anon, authenticated;

create or replace function private.ai_prepare_action_obsolete(
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
  allowed text[];
  required text[];
  normalized jsonb := raw_payload;
  key_name text;
  id_value bigint;
  numeric_value numeric;
  text_value text;
  primary_name text;
  secondary_name text;
  transaction_type text;
  status_value text;
  series_kind text;
  operation_value text;
  destination_kind text;
  frequency_value text;
  occurrences_value integer;
  invoice_total numeric;
  title text;
  summary text;
  consequences jsonb := '[]'::jsonb;
begin
  if caller is null or caller is distinct from (select auth.uid()) then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;

  case action_name
    when 'create_account' then
      allowed := array['name','initial_balance','color']; required := allowed;
    when 'edit_account' then
      allowed := array['account_id','name','initial_balance','color']; required := array['account_id'];
    when 'archive_account', 'delete_account', 'reactivate_account' then
      allowed := array['account_id']; required := allowed;
    when 'create_category' then
      allowed := array['name','type','color','icon']; required := allowed;
    when 'edit_category' then
      allowed := array['category_id','name','type','color','icon']; required := array['category_id'];
    when 'archive_category', 'delete_category', 'reactivate_category' then
      allowed := array['category_id']; required := allowed;
    when 'create_caixinha' then
      allowed := array['name','target_amount','initial_balance','color','icon','target_date'];
      required := array['name','target_amount','initial_balance','color','icon'];
    when 'edit_caixinha' then
      allowed := array['caixinha_id','name','target_amount','color','icon','target_date'];
      required := array['caixinha_id'];
    when 'archive_caixinha', 'delete_caixinha', 'reactivate_caixinha' then
      allowed := array['caixinha_id']; required := allowed;
    when 'move_caixinha' then
      allowed := array['caixinha_id','account_id','operation','value','description','status','scheduled_date','realization_date'];
      required := array['caixinha_id','account_id','operation','value','description','status','scheduled_date'];
    when 'create_transaction' then
      allowed := array['type','value','description','status','scheduled_date','realization_date','account_id','category_id'];
      required := array['type','value','description','status','scheduled_date','account_id','category_id'];
    when 'create_transaction_series' then
      allowed := array['type','value','value_mode','description','first_status','scheduled_date','realization_date','account_id','category_id','series_kind','frequency','occurrences'];
      required := array['type','value','value_mode','description','first_status','scheduled_date','account_id','category_id','series_kind','frequency','occurrences'];
    when 'edit_transaction' then
      allowed := array['transaction_id','expected_value','description','value','scheduled_date','account_id','category_id'];
      required := array['transaction_id','expected_value'];
    when 'edit_transaction_series_open' then
      allowed := array['transaction_id','description','value','scheduled_date','account_id','category_id','scope'];
      required := array['transaction_id','scope'];
    when 'delete_transaction' then
      allowed := array['transaction_id','expected_value']; required := allowed;
    when 'delete_transaction_series_open' then
      allowed := array['transaction_id','scope']; required := allowed;
    when 'complete_transaction' then
      allowed := array['transaction_id','expected_value','realization_date','final_value'];
      required := array['transaction_id','expected_value','realization_date'];
    when 'reopen_transaction' then
      allowed := array['transaction_id','expected_value']; required := allowed;
    when 'transfer_between_accounts' then
      allowed := array['source_account_id','destination_account_id','value','description','status','scheduled_date','realization_date'];
      required := array['source_account_id','destination_account_id','value','description','status','scheduled_date'];
    when 'create_recurring_transfer' then
      allowed := array['destination_kind','source_account_id','destination_account_id','caixinha_id','operation','value','description','scheduled_date','frequency','occurrences'];
      required := array['destination_kind','source_account_id','value','description','scheduled_date','frequency','occurrences'];
    when 'create_card' then
      allowed := array['name','color','limit','due_day','closing_day']; required := allowed;
    when 'edit_card' then
      allowed := array['card_id','name','color','limit','due_day','closing_day']; required := array['card_id'];
    when 'archive_card', 'delete_card', 'reactivate_card' then
      allowed := array['card_id']; required := allowed;
    when 'create_card_purchase' then
      allowed := array['card_id','description','value','value_mode','category_id','purchase_date','series_kind','occurrences'];
      required := allowed;
    when 'edit_card_purchase' then
      allowed := array['item_id','expected_value','description','value','category_id','purchase_date'];
      required := array['item_id','expected_value'];
    when 'delete_card_purchase' then
      allowed := array['item_id','expected_value']; required := allowed;
    when 'delete_card_purchase_series' then
      allowed := array['item_id']; required := allowed;
    when 'pay_invoice' then
      allowed := array['card_id','month','account_id','payment_amount','payment_date','mode','interest_amount'];
      required := array['card_id','month','account_id','payment_amount','payment_date','mode'];
    when 'reverse_invoice_payment' then
      allowed := array['transaction_id','expected_value']; required := allowed;
    else
      perform private.ai_fail('AI_UNSUPPORTED_ACTION');
  end case;

  perform private.ai_assert_allowed_keys(raw_payload, allowed);
  perform private.ai_require_keys(raw_payload, required);

  if action_name in ('edit_account','edit_category','edit_caixinha','edit_card')
     and (select count(*) from pg_catalog.jsonb_object_keys(raw_payload)) = 1 then
    perform private.ai_fail('AI_NO_CHANGES');
  end if;
  if action_name in ('edit_transaction','edit_card_purchase')
     and (select count(*) from pg_catalog.jsonb_object_keys(raw_payload)) = 2 then
    perform private.ai_fail('AI_NO_CHANGES');
  end if;
  if action_name = 'edit_transaction_series_open'
     and (select count(*) from pg_catalog.jsonb_object_keys(raw_payload)) = 2 then
    perform private.ai_fail('AI_NO_CHANGES');
  end if;

  foreach key_name in array array[
    'account_id','source_account_id','destination_account_id','category_id',
    'caixinha_id','transaction_id','card_id','item_id'
  ] loop
    if raw_payload ? key_name then
      normalized := jsonb_set(normalized, array[key_name], to_jsonb(private.ai_id(raw_payload, key_name)), true);
    end if;
  end loop;

  foreach key_name in array array[
    'initial_balance','target_amount','value','expected_value','final_value',
    'limit','payment_amount','interest_amount'
  ] loop
    if raw_payload ? key_name then
      numeric_value := round(private.ai_number(raw_payload, key_name), 2);
      if numeric_value < 0 or (
        key_name not in ('initial_balance','interest_amount') and numeric_value <= 0
      ) then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end if;
      if abs(numeric_value) > 999999999999.99 then
        perform private.ai_fail('AI_INVALID_' || upper(key_name));
      end if;
      normalized := jsonb_set(normalized, array[key_name], to_jsonb(numeric_value), true);
    end if;
  end loop;

  foreach key_name in array array['scheduled_date','realization_date','target_date','purchase_date','payment_date'] loop
    if raw_payload ? key_name then
      normalized := jsonb_set(normalized, array[key_name], to_jsonb(to_char(private.ai_date(raw_payload, key_name), 'YYYY-MM-DD')), true);
    end if;
  end loop;

  if raw_payload ? 'name' then normalized := jsonb_set(normalized, '{name}', to_jsonb(private.ai_text(raw_payload,'name',100)), true); end if;
  if raw_payload ? 'icon' then normalized := jsonb_set(normalized, '{icon}', to_jsonb(private.ai_text(raw_payload,'icon',50)), true); end if;
  if raw_payload ? 'color' then normalized := jsonb_set(normalized, '{color}', to_jsonb(private.ai_color(raw_payload,'color')), true); end if;
  if raw_payload ? 'description' then normalized := jsonb_set(normalized, '{description}', to_jsonb(private.ai_description(raw_payload,'description',120)), true); end if;

  if raw_payload ? 'type' then
    text_value := private.ai_choice(raw_payload,'type',array['income','expense','both','receita','despesa','ambos']);
    text_value := case text_value when 'receita' then 'income' when 'despesa' then 'expense' when 'ambos' then 'both' else text_value end;
    normalized := jsonb_set(normalized, '{type}', to_jsonb(text_value), true);
  end if;
  if raw_payload ? 'status' then
    status_value := private.ai_choice(raw_payload,'status',array['pending','paid','pendente','paga']);
    status_value := case status_value when 'pendente' then 'pending' when 'paga' then 'paid' else status_value end;
    normalized := jsonb_set(normalized, '{status}', to_jsonb(status_value), true);
  end if;
  if raw_payload ? 'first_status' then
    status_value := private.ai_choice(raw_payload,'first_status',array['pending','paid','pendente','paga']);
    status_value := case status_value when 'pendente' then 'pending' when 'paga' then 'paid' else status_value end;
    normalized := jsonb_set(normalized, '{first_status}', to_jsonb(status_value), true);
  end if;
  if raw_payload ? 'operation' then
    operation_value := private.ai_choice(raw_payload,'operation',array['save','withdraw','guardar','resgatar']);
    operation_value := case operation_value when 'guardar' then 'save' when 'resgatar' then 'withdraw' else operation_value end;
    normalized := jsonb_set(normalized, '{operation}', to_jsonb(operation_value), true);
  end if;
  if raw_payload ? 'frequency' then
    frequency_value := private.ai_choice(raw_payload,'frequency',array['weekly','monthly','annual','semanal','mensal','anual']);
    frequency_value := case frequency_value when 'semanal' then 'weekly' when 'mensal' then 'monthly' when 'anual' then 'annual' else frequency_value end;
    normalized := jsonb_set(normalized, '{frequency}', to_jsonb(frequency_value), true);
  end if;
  if raw_payload ? 'occurrences' then
    occurrences_value := private.ai_integer(raw_payload,'occurrences',1,120);
    normalized := jsonb_set(normalized, '{occurrences}', to_jsonb(occurrences_value), true);
  end if;
  if raw_payload ? 'value_mode' then
    normalized := jsonb_set(normalized, '{value_mode}', to_jsonb(private.ai_choice(raw_payload,'value_mode',array['total','each'])), true);
  end if;
  if raw_payload ? 'series_kind' then
    series_kind := private.ai_choice(raw_payload,'series_kind',array['single','installment','recurring']);
    normalized := jsonb_set(normalized, '{series_kind}', to_jsonb(series_kind), true);
  end if;
  if raw_payload ? 'destination_kind' then
    destination_kind := private.ai_choice(raw_payload,'destination_kind',array['account','caixinha']);
    normalized := jsonb_set(normalized, '{destination_kind}', to_jsonb(destination_kind), true);
  end if;
  if raw_payload ? 'scope' then
    normalized := jsonb_set(normalized, '{scope}', to_jsonb(private.ai_choice(raw_payload,'scope',array['all_open','from_current'])), true);
  end if;
  if raw_payload ? 'mode' then
    normalized := jsonb_set(normalized, '{mode}', to_jsonb(private.ai_choice(raw_payload,'mode',array['total','partial','carry_forward'])), true);
  end if;
  if raw_payload ? 'month' then
    text_value := private.ai_text(raw_payload,'month',7);
    if text_value !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then perform private.ai_fail('AI_INVALID_MONTH'); end if;
    normalized := jsonb_set(normalized, '{month}', to_jsonb(text_value), true);
  end if;
  if raw_payload ? 'due_day' then normalized := jsonb_set(normalized,'{due_day}',to_jsonb(private.ai_integer(raw_payload,'due_day',1,31)),true); end if;
  if raw_payload ? 'closing_day' then normalized := jsonb_set(normalized,'{closing_day}',to_jsonb(private.ai_integer(raw_payload,'closing_day',1,31)),true); end if;

  -- Regras cruzadas e resolução de referências. Esses testes se repetem sob
  -- lock no executor porque o estado pode mudar enquanto o usuário confirma.
  if action_name in ('create_transaction','create_transaction_series') then
    transaction_type := normalized ->> 'type';
    if transaction_type not in ('income','expense') then perform private.ai_fail('AI_INVALID_TYPE'); end if;
    perform private.ai_assert_account(caller,(normalized->>'account_id')::bigint,false,true);
    perform private.ai_assert_category(caller,(normalized->>'category_id')::bigint,
      case transaction_type when 'income' then 'receita' else 'despesa' end,true);
    select nome into primary_name from public.contas where id=(normalized->>'account_id')::bigint;
    select nome into secondary_name from public.categorias where id=(normalized->>'category_id')::bigint;
    if coalesce(normalized->>'status',normalized->>'first_status') = 'paid' and not normalized ? 'realization_date' then
      perform private.ai_fail('AI_REALIZATION_DATE_REQUIRED');
    end if;
  elsif action_name = 'move_caixinha' then
    perform private.ai_assert_account(caller,(normalized->>'account_id')::bigint,false,true);
    perform private.ai_assert_goal(caller,(normalized->>'caixinha_id')::bigint,false,true);
    if normalized->>'status' = 'paid' and not normalized ? 'realization_date' then perform private.ai_fail('AI_REALIZATION_DATE_REQUIRED'); end if;
    select nome into primary_name from public.caixinhas where id=(normalized->>'caixinha_id')::bigint;
    select nome into secondary_name from public.contas where id=(normalized->>'account_id')::bigint;
  elsif action_name = 'transfer_between_accounts' then
    perform private.ai_assert_account(caller,(normalized->>'source_account_id')::bigint,false,true);
    perform private.ai_assert_account(caller,(normalized->>'destination_account_id')::bigint,false,true);
    if normalized->>'source_account_id' = normalized->>'destination_account_id' then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
    if normalized->>'status' = 'paid' and not normalized ? 'realization_date' then perform private.ai_fail('AI_REALIZATION_DATE_REQUIRED'); end if;
    select nome into primary_name from public.contas where id=(normalized->>'source_account_id')::bigint;
    select nome into secondary_name from public.contas where id=(normalized->>'destination_account_id')::bigint;
  elsif action_name = 'create_recurring_transfer' then
    perform private.ai_assert_account(caller,(normalized->>'source_account_id')::bigint,false,true);
    destination_kind := normalized->>'destination_kind';
    if destination_kind = 'account' then
      if not normalized ? 'destination_account_id' or normalized ? 'caixinha_id' or normalized ? 'operation' then perform private.ai_fail('AI_INVALID_TRANSFER_DESTINATION'); end if;
      perform private.ai_assert_account(caller,(normalized->>'destination_account_id')::bigint,false,true);
      if normalized->>'source_account_id'=normalized->>'destination_account_id' then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
      select nome into secondary_name from public.contas where id=(normalized->>'destination_account_id')::bigint;
    elsif destination_kind = 'caixinha' then
      if not normalized ? 'caixinha_id' or not normalized ? 'operation' or normalized ? 'destination_account_id' then perform private.ai_fail('AI_INVALID_TRANSFER_DESTINATION'); end if;
      perform private.ai_assert_goal(caller,(normalized->>'caixinha_id')::bigint,false,true);
      select nome into secondary_name from public.caixinhas where id=(normalized->>'caixinha_id')::bigint;
    end if;
    select nome into primary_name from public.contas where id=(normalized->>'source_account_id')::bigint;
  elsif action_name like '%transaction%' or action_name = 'reverse_invoice_payment' then
    if normalized ? 'transaction_id' then
      perform private.ai_assert_transaction(caller,(normalized->>'transaction_id')::bigint);
      select descricao into primary_name from public.transacoes where id=(normalized->>'transaction_id')::bigint;
    end if;
    if normalized ? 'account_id' then perform private.ai_assert_account(caller,(normalized->>'account_id')::bigint,false,true); end if;
  end if;

  if action_name in ('edit_account','archive_account','delete_account','reactivate_account') then
    perform private.ai_assert_account(caller,(normalized->>'account_id')::bigint,true,action_name<>'reactivate_account');
    select nome into primary_name from public.contas where id=(normalized->>'account_id')::bigint;
  elsif action_name in ('edit_category','archive_category','delete_category','reactivate_category') then
    perform private.ai_assert_category(caller,(normalized->>'category_id')::bigint,null,action_name<>'reactivate_category');
    select nome into primary_name from public.categorias where id=(normalized->>'category_id')::bigint;
  elsif action_name in ('edit_caixinha','archive_caixinha','delete_caixinha','reactivate_caixinha') then
    perform private.ai_assert_goal(caller,(normalized->>'caixinha_id')::bigint,true,action_name<>'reactivate_caixinha');
    select nome into primary_name from public.caixinhas where id=(normalized->>'caixinha_id')::bigint;
  elsif action_name in ('edit_card','archive_card','delete_card','reactivate_card') then
    perform private.ai_assert_card(caller,(normalized->>'card_id')::bigint,action_name<>'reactivate_card');
    select nome into primary_name from public.cartoes where id=(normalized->>'card_id')::bigint;
  elsif action_name in ('create_card_purchase','pay_invoice') then
    perform private.ai_assert_card(caller,(normalized->>'card_id')::bigint,true);
    select nome into primary_name from public.cartoes where id=(normalized->>'card_id')::bigint;
    if normalized ? 'category_id' then perform private.ai_assert_category(caller,(normalized->>'category_id')::bigint,'despesa',true); end if;
    if normalized ? 'account_id' then
      perform private.ai_assert_account(caller,(normalized->>'account_id')::bigint,false,true);
      select nome into secondary_name from public.contas where id=(normalized->>'account_id')::bigint;
    end if;
  elsif action_name in ('edit_card_purchase','delete_card_purchase','delete_card_purchase_series') then
    perform private.ai_assert_card_item(caller,(normalized->>'item_id')::bigint);
    select descricao into primary_name from public.fatura_itens where id=(normalized->>'item_id')::bigint;
    if normalized ? 'category_id' then perform private.ai_assert_category(caller,(normalized->>'category_id')::bigint,'despesa',true); end if;
  end if;

  if action_name = 'create_transaction_series' then
    series_kind := normalized->>'series_kind'; frequency_value := normalized->>'frequency';
    occurrences_value := (normalized->>'occurrences')::integer;
    if series_kind not in ('installment','recurring') then perform private.ai_fail('AI_INVALID_SERIES_KIND'); end if;
    if series_kind='installment' and (frequency_value<>'monthly' or occurrences_value not between 2 and 120) then perform private.ai_fail('AI_INVALID_INSTALLMENTS'); end if;
    if series_kind='recurring' and occurrences_value not between 2 and 120 then perform private.ai_fail('AI_INVALID_OCCURRENCES'); end if;
  elsif action_name = 'create_recurring_transfer' then
    if (normalized->>'occurrences')::integer not between 2 and 120 then perform private.ai_fail('AI_INVALID_OCCURRENCES'); end if;
  elsif action_name = 'create_card_purchase' then
    series_kind := normalized->>'series_kind'; occurrences_value := (normalized->>'occurrences')::integer;
    if (series_kind='single' and occurrences_value<>1)
       or (series_kind='installment' and occurrences_value not between 2 and 48)
       or (series_kind='recurring' and occurrences_value not between 2 and 60) then
      perform private.ai_fail('AI_INVALID_OCCURRENCES');
    end if;
    if series_kind='single' and normalized->>'value_mode'<>'total' then perform private.ai_fail('AI_INVALID_VALUE_MODE'); end if;
  end if;

  if action_name = 'pay_invoice' then
    select coalesce(sum(i.valor),0) into invoice_total
    from public.fatura_itens i
    where i.cartao_id=(normalized->>'card_id')::bigint
      and i.user_id=caller and i.mes_fatura=normalized->>'month' and not i.pago;
    if invoice_total <= 0 then perform private.ai_fail('AI_INVOICE_ALREADY_SETTLED'); end if;
    if (normalized->>'payment_amount')::numeric > invoice_total then perform private.ai_fail('AI_PAYMENT_ABOVE_INVOICE'); end if;
    if normalized->>'mode'='total' and (normalized->>'payment_amount')::numeric<>invoice_total then perform private.ai_fail('AI_TOTAL_PAYMENT_MISMATCH'); end if;
    if normalized->>'mode'<>'total' and (normalized->>'payment_amount')::numeric>=invoice_total then perform private.ai_fail('AI_PARTIAL_PAYMENT_MISMATCH'); end if;
    if normalized->>'mode'='carry_forward' and not normalized ? 'interest_amount' then normalized := normalized || jsonb_build_object('interest_amount',0); end if;
    if normalized->>'mode'<>'carry_forward' and normalized ? 'interest_amount' then perform private.ai_fail('AI_INTEREST_NOT_APPLICABLE'); end if;
  end if;

  -- Preview canônico: nunca usa resumo redigido pelo modelo.
  title := case
    when action_name like 'create_%' then 'Confirmar criação'
    when action_name like 'edit_%' then 'Confirmar alteração'
    when action_name like 'delete_%' then 'Confirmar exclusão'
    when action_name like 'archive_%' then 'Confirmar arquivamento'
    when action_name like 'reactivate_%' then 'Confirmar reativação'
    when action_name='pay_invoice' then 'Confirmar pagamento da fatura'
    when action_name='reverse_invoice_payment' then 'Confirmar estorno da fatura'
    when action_name='complete_transaction' then 'Confirmar realização'
    when action_name='reopen_transaction' then 'Voltar para pendente'
    else 'Confirmar movimentação financeira'
  end;
  summary := case
    when action_name='create_account' then format('Criar a conta %s com saldo inicial de R$ %s.',normalized->>'name',normalized->>'initial_balance')
    when action_name='create_category' then format('Criar a categoria %s.',normalized->>'name')
    when action_name='create_caixinha' then format('Criar o objetivo %s com R$ %s.',normalized->>'name',normalized->>'initial_balance')
    when action_name='create_card' then format('Criar o cartão %s com limite de R$ %s.',normalized->>'name',normalized->>'limit')
    when action_name='create_transaction' then format('Lançar %s de R$ %s na conta %s.',case normalized->>'type' when 'income' then 'receita' else 'despesa' end,normalized->>'value',primary_name)
    when action_name='create_transaction_series' then format('Criar %s lançamentos de R$ %s na conta %s.',normalized->>'occurrences',normalized->>'value',primary_name)
    when action_name='transfer_between_accounts' then format('Transferir R$ %s de %s para %s.',normalized->>'value',primary_name,secondary_name)
    when action_name='create_recurring_transfer' then format('Agendar %s transferências de R$ %s de %s para %s.',normalized->>'occurrences',normalized->>'value',primary_name,secondary_name)
    when action_name='move_caixinha' then format('%s R$ %s no objetivo %s pela conta %s.',case normalized->>'operation' when 'save' then 'Guardar' else 'Resgatar' end,normalized->>'value',primary_name,secondary_name)
    when action_name='create_card_purchase' then format('Adicionar %s cobrança(s) de R$ %s ao cartão %s.',normalized->>'occurrences',normalized->>'value',primary_name)
    when action_name='pay_invoice' then format('Pagar R$ %s da fatura %s do cartão %s usando %s.',normalized->>'payment_amount',normalized->>'month',primary_name,secondary_name)
    else format('%s: %s.',replace(action_name,'_',' '),coalesce(primary_name,'dados informados'))
  end;
  if action_name like 'delete_%' or action_name='reverse_invoice_payment' then
    consequences := consequences || jsonb_build_array('A operação pode remover dados financeiros e será auditada.');
  end if;
  if action_name like '%series%' or action_name in ('create_transaction_series','create_recurring_transfer') then
    consequences := consequences || jsonb_build_array('A ação afeta múltiplos lançamentos da mesma série.');
  end if;
  if action_name in ('complete_transaction','reopen_transaction','move_caixinha','pay_invoice','reverse_invoice_payment') then
    consequences := consequences || jsonb_build_array('Saldos e indicadores financeiros serão recalculados pelo estado confirmado.');
  end if;
  if normalized->>'mode'='carry_forward' then
    consequences := consequences || jsonb_build_array('O saldo restante e os juros informados irão para a próxima fatura.');
  end if;
  if consequences='[]'::jsonb then consequences := jsonb_build_array('A alteração será aplicada imediatamente após a confirmação.'); end if;

  return jsonb_build_object(
    'payload', normalized,
    'preview', jsonb_build_object('title',title,'summary',summary,'consequences',consequences)
  );
end;
$$;

revoke all on function private.ai_prepare_action_obsolete(uuid,text,jsonb) from public, anon, authenticated;

-- Executor canônico de recursos (contrato field/new_value da Edge).
create or replace function private.ai_execute_resource_action(
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
  resource_id bigint;
  field_name text := payload->>'field';
  row_count integer;
  current_type text;
  current_balance numeric;
  resource_name text;
  has_references boolean;
begin
  if action_name='create_account' then
    insert into public.contas(user_id,nome,saldo_inicial,cor,arquivado)
    values(caller,payload->>'name',(payload->>'initial_balance')::numeric,payload->>'color',false)
    returning id into resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'created',true);
  elsif action_name='update_account' then
    resource_id:=(payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    update public.contas set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      saldo_inicial=case when field_name='initial_balance' then (payload->>'new_value')::numeric else saldo_inicial end,
      cor=case when field_name='color' then payload->>'new_value' else cor end
    where id=resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'updated',true,'field',field_name);
  elsif action_name='archive_account' then
    resource_id:=(payload->>'account_id')::bigint;
    update public.contas set arquivado=true where id=resource_id and user_id=caller and not coalesce(arquivado,false);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_ACCOUNT_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','account','id',resource_id,'archived',true);
  elsif action_name='delete_account' then
    resource_id:=(payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    select exists(
      select 1
      from public.transacoes
      where conta_id=resource_id
         or position('[Destino:'||resource_id::text||']' in descricao)>0
    ) into has_references;
    if has_references then
      update public.contas set arquivado=true where id=resource_id;
      return jsonb_build_object('resource','account','id',resource_id,'deleted',false,'archived',true,'reason','has_transactions');
    end if;
    delete from public.contas where id=resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'deleted',true,'archived',false);
  elsif action_name='reactivate_account' then
    resource_id:=(payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller and coalesce(arquivado,false) for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'account');
    update public.contas set arquivado=false where id=resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'reactivated',true);
  elsif action_name='create_category' then
    insert into public.categorias(user_id,nome,tipo,cor,icone,ativa)
    values(caller,payload->>'name',payload->>'type',payload->>'color',payload->>'icon',1)
    returning id into resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'created',true);
  elsif action_name='update_category' then
    resource_id:=(payload->>'category_id')::bigint;
    perform 1 from public.categorias where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    update public.categorias set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      cor=case when field_name='color' then payload->>'new_value' else cor end,
      icone=case when field_name='icon' then payload->>'new_value' else icone end
    where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'updated',true,'field',field_name);
  elsif action_name='archive_category' then
    resource_id:=(payload->>'category_id')::bigint;
    update public.categorias set ativa=0 where id=resource_id and user_id=caller
      and coalesce(ativa::text,'true') not in ('0','false','f');
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_CATEGORY_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','category','id',resource_id,'archived',true);
  elsif action_name='delete_category' then
    resource_id:=(payload->>'category_id')::bigint;
    perform 1 from public.categorias where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    select exists(select 1 from public.transacoes where categoria_id=resource_id)
      or exists(select 1 from public.fatura_itens where categoria_id=resource_id) into has_references;
    if has_references then
      update public.categorias set ativa=0 where id=resource_id;
      return jsonb_build_object('resource','category','id',resource_id,'deleted',false,'archived',true,'reason','has_entries');
    end if;
    delete from public.categorias where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'deleted',true,'archived',false);
  elsif action_name='reactivate_category' then
    resource_id:=(payload->>'category_id')::bigint;
    select tipo into current_type from public.categorias where id=resource_id and user_id=caller
      and coalesce(ativa::text,'true') in ('0','false','f') for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'category',current_type);
    update public.categorias set ativa=1 where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'reactivated',true);
  elsif action_name='create_goal' then
    if (payload->>'target_amount')::numeric<1
       or (payload->>'initial_balance')::numeric>(payload->>'target_amount')::numeric then
      perform private.ai_fail('AI_INVALID_GOAL_VALUES');
    end if;
    insert into public.caixinhas(user_id,nome,meta_valor,saldo_atual,cor,icone,data_prazo,arquivado)
    values(caller,payload->>'name',(payload->>'target_amount')::numeric,
      (payload->>'initial_balance')::numeric,payload->>'color',payload->>'icon',
      case when payload?'target_date' then (payload->>'target_date')::date else null end,false)
    returning id into resource_id;
    return jsonb_build_object('resource','goal','id',resource_id,'created',true);
  elsif action_name='update_goal' then
    resource_id:=(payload->>'goal_id')::bigint;
    select saldo_atual into current_balance from public.caixinhas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    if field_name='target_amount' and (payload->>'new_value')::numeric<greatest(1,current_balance) then
      perform private.ai_fail('AI_TARGET_BELOW_CURRENT_BALANCE');
    end if;
    update public.caixinhas set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      meta_valor=case when field_name='target_amount' then (payload->>'new_value')::numeric else meta_valor end,
      cor=case when field_name='color' then payload->>'new_value' else cor end,
      icone=case when field_name='icon' then payload->>'new_value' else icone end,
      data_prazo=case when field_name='target_date' then
        case when payload->>'new_value'='clear' then null else (payload->>'new_value')::date end
        else data_prazo end
    where id=resource_id;
    return jsonb_build_object('resource','goal','id',resource_id,'updated',true,'field',field_name);
  elsif action_name='archive_goal' then
    resource_id:=(payload->>'goal_id')::bigint;
    update public.caixinhas set arquivado=true where id=resource_id and user_id=caller and not coalesce(arquivado,false);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_GOAL_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','goal','id',resource_id,'archived',true);
  elsif action_name='delete_goal' then
    resource_id:=(payload->>'goal_id')::bigint;
    select saldo_atual,nome into current_balance,resource_name
    from public.caixinhas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    select exists(
      select 1
      from public.transacoes t
      where t.status<>'paga'
        and (
          t.user_id=caller
          or private.ai_can_access_account(caller,t.conta_id,false)
        )
        and (
          t.descricao like '%[Objetivo:'||resource_id::text||':%'
          or position('Guardar em: '||resource_name in t.descricao)>0
          or position('Resgate de: '||resource_name in t.descricao)>0
        )
    ) into has_references;
    if coalesce(current_balance,0)<>0 or has_references then
      update public.caixinhas set arquivado=true where id=resource_id;
      return jsonb_build_object('resource','goal','id',resource_id,'deleted',false,'archived',true,
        'reason',case when current_balance<>0 then 'has_balance' else 'has_entries_or_schedules' end);
    end if;
    delete from public.caixinhas where id=resource_id;
    return jsonb_build_object('resource','goal','id',resource_id,'deleted',true,'archived',false);
  elsif action_name='reactivate_goal' then
    resource_id:=(payload->>'goal_id')::bigint;
    perform 1 from public.caixinhas where id=resource_id and user_id=caller and coalesce(arquivado,false) for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'goal');
    update public.caixinhas set arquivado=false where id=resource_id;
    return jsonb_build_object('resource','goal','id',resource_id,'reactivated',true);
  elsif action_name='create_card' then
    insert into public.cartoes(user_id,nome,cor,limite,dia_vencimento,dia_fechamento,ativo)
    values(caller,payload->>'name',payload->>'color',(payload->>'value')::numeric,
      (payload->>'due_day')::integer,(payload->>'closing_day')::integer,true)
    returning id into resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'created',true);
  elsif action_name='update_card' then
    resource_id:=(payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    if field_name='value' and (payload->>'new_value')::numeric<private.ai_card_used_limit(caller,resource_id) then
      perform private.ai_fail('AI_LIMIT_BELOW_USED');
    end if;
    update public.cartoes set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      limite=case when field_name='value' then (payload->>'new_value')::numeric else limite end,
      cor=case when field_name='color' then payload->>'new_value' else cor end,
      dia_vencimento=case when field_name='due_day' then (payload->>'new_value')::integer else dia_vencimento end,
      dia_fechamento=case when field_name='closing_day' then (payload->>'new_value')::integer else dia_fechamento end
    where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'updated',true,'field',field_name);
  elsif action_name='archive_card' then
    resource_id:=(payload->>'card_id')::bigint;
    update public.cartoes set ativo=false where id=resource_id and user_id=caller and coalesce(ativo,true);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_CARD_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','card','id',resource_id,'archived',true);
  elsif action_name='delete_card' then
    resource_id:=(payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    select
      exists(select 1 from public.fatura_itens where cartao_id=resource_id)
      or exists(
        select 1 from private.ai_invoice_payment_ledger l
        where l.card_id=resource_id and l.reversed_at is null
      )
      or exists(
        select 1 from public.transacoes t
        where t.user_id=caller
          and t.descricao like '%[PagFatura:'||resource_id::text||':%'
      )
    into has_references;
    if has_references then
      update public.cartoes set ativo=false where id=resource_id;
      return jsonb_build_object('resource','card','id',resource_id,'deleted',false,'archived',true,
        'reason','has_purchases_or_payments');
    end if;
    delete from public.cartoes where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'deleted',true,'archived',false);
  elsif action_name='reactivate_card' then
    resource_id:=(payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller and not coalesce(ativo,true) for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'card');
    update public.cartoes set ativo=true where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'reactivated',true);
  end if;
  perform private.ai_fail('AI_UNSUPPORTED_RESOURCE_ACTION');
  return null;
end;
$$;

revoke all on function private.ai_execute_resource_action(uuid,text,jsonb) from public, anon, authenticated;

-- Travas canônicas de referência. A autorização e o estado ativo são
-- verificados novamente depois que a linha e a eventual parceria estão
-- bloqueadas, evitando validar uma referência e usá-la após ela mudar.
create or replace function private.ai_lock_partnership_access(caller uuid, owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare partnership_id bigint;
begin
  if caller is null or caller is distinct from (select auth.uid()) then perform private.ai_fail('AI_AUTH_REQUIRED'); end if;
  if owner_id=caller then return; end if;
  select p.id into partnership_id
  from public.parcerias p
  where p.status='aceito'
    and ((p.solicitante_id=owner_id and p.convidado_id=caller)
      or (p.solicitante_id=caller and p.convidado_id=owner_id));
  if not found then perform private.ai_fail('AI_PARTNERSHIP_NOT_FOUND'); end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:partnership:'||partnership_id::text,73119)
  );
  perform 1 from public.parcerias p
  where p.id=partnership_id and p.status='aceito'
    and ((p.solicitante_id=owner_id and p.convidado_id=caller)
      or (p.solicitante_id=caller and p.convidado_id=owner_id))
  for share;
  if not found then perform private.ai_fail('AI_PARTNERSHIP_NOT_FOUND'); end if;
end;
$$;

create or replace function private.ai_lock_account(
  caller uuid, account_id bigint, owner_only boolean default false, require_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare account_row public.contas%rowtype; observed_owner uuid;
begin
  select c.user_id into observed_owner from public.contas c where c.id=account_id;
  if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
  if observed_owner<>caller then perform private.ai_lock_partnership_access(caller,observed_owner); end if;
  select c.* into account_row from public.contas c where c.id=account_id for update;
  if not found
     or account_row.user_id is distinct from observed_owner
     or (require_active and coalesce(account_row.arquivado,false))
     or (owner_only and account_row.user_id<>caller) then
    perform private.ai_fail('AI_ACCOUNT_NOT_FOUND');
  end if;
  if account_row.user_id<>caller then
    if owner_only or not coalesce(account_row.compartilhado,false) then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    perform private.ai_lock_partnership_access(caller,account_row.user_id);
    if not coalesce(account_row.compartilhado,false)
       or not public.is_parceiro(account_row.user_id,caller) then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
  end if;
end;
$$;

create or replace function private.ai_lock_goal(
  caller uuid, goal_id bigint, owner_only boolean default false, require_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare goal_row public.caixinhas%rowtype; observed_owner uuid;
begin
  select g.user_id into observed_owner from public.caixinhas g where g.id=goal_id;
  if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  if observed_owner<>caller then perform private.ai_lock_partnership_access(caller,observed_owner); end if;
  select g.* into goal_row from public.caixinhas g where g.id=goal_id for update;
  if not found
     or goal_row.user_id is distinct from observed_owner
     or (require_active and coalesce(goal_row.arquivado,false))
     or (owner_only and goal_row.user_id<>caller) then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  if goal_row.user_id<>caller then
    if owner_only or not coalesce(goal_row.compartilhado,false) then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    perform private.ai_lock_partnership_access(caller,goal_row.user_id);
    if not coalesce(goal_row.compartilhado,false)
       or not public.is_parceiro(goal_row.user_id,caller) then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  end if;
end;
$$;

create or replace function private.ai_lock_category(
  caller uuid, category_id bigint, transaction_type text default null, require_active boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare category_row public.categorias%rowtype;
begin
  select c.* into category_row from public.categorias c where c.id=category_id for update;
  if not found or category_row.user_id<>caller
     or (require_active and coalesce(category_row.ativa::text,'true') in ('0','false','f'))
     or (transaction_type is not null and category_row.tipo not in (transaction_type,'ambos')) then
    perform private.ai_fail('AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE');
  end if;
end;
$$;

create or replace function private.ai_lock_card(caller uuid, card_id bigint, require_active boolean default true)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare card_row public.cartoes%rowtype;
begin
  select c.* into card_row from public.cartoes c where c.id=card_id for update;
  if not found or card_row.user_id<>caller or (require_active and not coalesce(card_row.ativo,true)) then
    perform private.ai_fail('AI_CARD_NOT_FOUND');
  end if;
end;
$$;

revoke all on function private.ai_lock_partnership_access(uuid,uuid) from public, anon, authenticated;
revoke all on function private.ai_lock_account(uuid,bigint,boolean,boolean) from public, anon, authenticated;
revoke all on function private.ai_lock_goal(uuid,bigint,boolean,boolean) from public, anon, authenticated;
revoke all on function private.ai_lock_category(uuid,bigint,text,boolean) from public, anon, authenticated;
revoke all on function private.ai_lock_card(uuid,bigint,boolean) from public, anon, authenticated;

create or replace function private.ai_execute_transaction_action(
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
  transaction_row record;
  reference_row record;
  series_row record;
  transaction_id bigint;
  inserted_ids jsonb := '[]'::jsonb;
  series_id text;
  series_match text[];
  legacy_series_ids bigint[] := '{}';
  legacy_goal jsonb;
  goal_match text[];
  destination_match text[];
  occurrence_count integer;
  occurrence_index integer;
  occurrence_date date;
  base_date date;
  realization_date date;
  frequency_value text;
  status_value text;
  db_status text;
  db_type text;
  amount numeric;
  final_amount numeric;
  amount_cents bigint;
  per_cents bigint;
  remainder_cents integer;
  description_value text;
  final_description text;
  suffix text;
  goal_name text;
  field_name text;
  scope_value text;
  new_account_id bigint;
  new_category_id bigint;
  new_date date;
  rows_changed integer := 0;
begin
  if action_name='move_goal' then
    perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
    perform private.ai_lock_goal(caller,(payload->>'goal_id')::bigint,false,true);
    select nome into goal_name from public.caixinhas where id=(payload->>'goal_id')::bigint;
    amount:=(payload->>'value')::numeric;
    occurrence_count:=(payload->>'recurrence_count')::integer;
    if occurrence_count>1 then
      series_id:=private.ai_series_marker(); frequency_value:=payload->>'frequency';
      base_date:=(payload->>'scheduled_date')::date;
      for occurrence_index in 0..occurrence_count-1 loop
        occurrence_date:=case frequency_value
          when 'semanal' then private.ai_add_occurrence(base_date,occurrence_index,'weekly')
          when 'anual' then private.ai_add_occurrence(base_date,occurrence_index,'annual')
          else private.ai_add_occurrence(base_date,occurrence_index,'monthly') end;
        suffix:=case frequency_value when 'semanal' then ' (Fixa semanal)'
          when 'anual' then ' (Fixa anual)' else ' (Fixa)' end;
        final_description:=format('[Transf.] %s%s %s%s [Serie:%s] [Objetivo:%s:%s]',
          case when coalesce(payload->>'description','')='' then '' else payload->>'description'||' · ' end,
          case payload->>'operation' when 'guardar' then 'Guardar em:' else 'Resgate de:' end,
          goal_name,suffix,series_id,payload->>'goal_id',payload->>'operation');
        if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
        insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
        values(caller,case payload->>'operation' when 'guardar' then 'despesa' else 'receita' end,
          amount,final_description,occurrence_date,null,(payload->>'account_id')::bigint,null,'pendente')
        returning id into transaction_id;
        inserted_ids:=inserted_ids||jsonb_build_array(transaction_id);
      end loop;
      return jsonb_build_object('transaction_ids',inserted_ids,'series_id',series_id,
        'goal_id',(payload->>'goal_id')::bigint,'operation',payload->>'operation',
        'occurrences',occurrence_count,'frequency',frequency_value,'status','pendente');
    end if;
    final_description:=format('[Transf.] %s%s %s [Objetivo:%s:%s]',
      case when coalesce(payload->>'description','')='' then '' else payload->>'description'||' · ' end,
      case payload->>'operation' when 'guardar' then 'Guardar em:' else 'Resgate de:' end,
      goal_name,payload->>'goal_id',payload->>'operation');
    if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
    perform private.ai_adjust_goal_balance(caller,(payload->>'goal_id')::bigint,
      case payload->>'operation' when 'guardar' then 'save' else 'withdraw' end,amount,1);
    insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
    values(caller,case payload->>'operation' when 'guardar' then 'despesa' else 'receita' end,
      amount,final_description,(payload->>'realization_date')::date,(payload->>'realization_date')::date,
      (payload->>'account_id')::bigint,null,'paga') returning id into transaction_id;
    return jsonb_build_object('transaction_id',transaction_id,'goal_id',(payload->>'goal_id')::bigint,
      'operation',payload->>'operation','value',amount,'status','paga');
  end if;

  if action_name in ('create_transaction','transfer_between_accounts') then
    frequency_value:=payload->>'frequency';
    occurrence_count:=(payload->>'recurrence_count')::integer;
    base_date:=(payload->>'scheduled_date')::date;
    status_value:=payload->>'status';
    amount:=(payload->>'value')::numeric;
    description_value:=payload->>'description';
    if action_name='create_transaction' then
      perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
      db_type:=payload->>'type';
      perform private.ai_lock_category(caller,(payload->>'category_id')::bigint,db_type,true);
    else
      db_type:='despesa';
      if payload->>'account_id'=payload->>'destination_account_id' then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
      if (payload->>'account_id')::bigint < (payload->>'destination_account_id')::bigint then
        perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
        perform private.ai_lock_account(caller,(payload->>'destination_account_id')::bigint,false,true);
      else
        perform private.ai_lock_account(caller,(payload->>'destination_account_id')::bigint,false,true);
        perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
      end if;
    end if;
    if occurrence_count>1 then series_id:=private.ai_series_marker(); end if;
    if frequency_value='parcelada' then
      amount_cents:=round(amount*100)::bigint;
      per_cents:=amount_cents/occurrence_count;
      remainder_cents:=(amount_cents%occurrence_count)::integer;
      if per_cents<=0 then perform private.ai_fail('AI_INSTALLMENT_TOO_SMALL'); end if;
    end if;
    for occurrence_index in 0..occurrence_count-1 loop
      occurrence_date:=case frequency_value
        when 'unica' then base_date
        when 'parcelada' then private.ai_add_occurrence(base_date,occurrence_index,'monthly')
        when 'semanal' then private.ai_add_occurrence(base_date,occurrence_index,'weekly')
        when 'mensal' then private.ai_add_occurrence(base_date,occurrence_index,'monthly')
        else private.ai_add_occurrence(base_date,occurrence_index,'annual') end;
      final_amount:=case when frequency_value='parcelada'
        then (per_cents+case when occurrence_index<remainder_cents then 1 else 0 end)::numeric/100
        else amount end;
      suffix:=case frequency_value
        when 'parcelada' then format(' (%s/%s)',occurrence_index+1,occurrence_count)
        when 'semanal' then ' (Fixa semanal)'
        when 'mensal' then ' (Fixa)'
        when 'anual' then ' (Fixa anual)'
        else '' end;
      final_description:=description_value||suffix
        ||case when series_id is not null then ' [Serie:'||series_id||']' else '' end;
      if action_name='transfer_between_accounts' then
        final_description:='[Transf.] '||final_description||' [Destino:'||payload->>'destination_account_id'||']';
      end if;
      if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
      db_status:=case when occurrence_index=0 and status_value='paga' then 'paga' else 'pendente' end;
      realization_date:=case when db_status='paga' then (payload->>'realization_date')::date else null end;
      insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
      values(caller,db_type,final_amount,final_description,occurrence_date,realization_date,
        (payload->>'account_id')::bigint,
        case when action_name='create_transaction' then (payload->>'category_id')::bigint else null end,db_status)
      returning id into transaction_id;
      inserted_ids:=inserted_ids||jsonb_build_array(transaction_id);
    end loop;
    return jsonb_build_object('transaction_ids',inserted_ids,'series_id',series_id,
      'occurrences',occurrence_count,'frequency',frequency_value);
  end if;

  if action_name in ('update_transaction','delete_transaction','complete_transaction','reopen_transaction') then
    transaction_id:=(payload->>'transaction_id')::bigint;
    select * into transaction_row from public.transacoes where id=transaction_id;
    if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
    perform private.ai_lock_account(caller,transaction_row.conta_id,false,false);
    select t.* into transaction_row from public.transacoes t
    where t.id=transaction_id and t.conta_id=transaction_row.conta_id for update;
    if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
    perform private.ai_assert_transaction(caller,transaction_id);
    if transaction_row.descricao like '%[PagFatura:%' then perform private.ai_fail('AI_USE_INVOICE_REVERSAL'); end if;
    if transaction_row.descricao not like '[Transf.] %' then
      if transaction_row.categoria_id is null then
        legacy_goal:=private.ai_resolve_legacy_goal_movement(caller,transaction_row.descricao);
        if legacy_goal is null then perform private.ai_fail('AI_CATEGORY_REQUIRED'); end if;
        if (legacy_goal->>'operation'='save' and transaction_row.tipo<>'despesa')
           or (legacy_goal->>'operation'='withdraw' and transaction_row.tipo<>'receita') then
          perform private.ai_fail('AI_LEGACY_GOAL_TYPE_MISMATCH');
        end if;
      elsif not exists(
        select 1 from public.categorias c where c.id=transaction_row.categoria_id
          and (c.tipo=transaction_row.tipo or c.tipo='ambos')
      ) then perform private.ai_fail('AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE'); end if;
    end if;
    series_match:=regexp_match(transaction_row.descricao,'\[Serie:([A-Za-z0-9_-]+)\]');
  end if;

  if action_name='update_transaction' then
    field_name:=payload->>'field'; scope_value:=payload->>'series_scope';
    if transaction_row.user_id<>caller and field_name in ('account_id','category_id') then
      perform private.ai_fail('AI_SHARED_TRANSACTION_OWNERSHIP_IMMUTABLE');
    end if;
    if transaction_row.status='paga' and scope_value<>'one' then perform private.ai_fail('AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL'); end if;
    if scope_value='open_series' and series_match is null then
      legacy_series_ids:=private.ai_legacy_series_ids(caller,transaction_id);
    end if;
    if scope_value='open_series' and transaction_row.status='paga' then perform private.ai_fail('AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL'); end if;
    if scope_value='one' then
      amount:=transaction_row.valor;
      final_description:=transaction_row.descricao;
      new_account_id:=transaction_row.conta_id;
      new_category_id:=transaction_row.categoria_id;
      new_date:=transaction_row.data_vencimento;
      if field_name='value' then amount:=(payload->>'new_value')::numeric; end if;
      if field_name='description' then
        if legacy_goal is not null then
          final_description:=format('[Transf.] %s · %s: %s [Objetivo:%s:%s]',
            payload->>'new_value',
            case legacy_goal->>'marker_operation' when 'guardar' then 'Guardar em' else 'Resgate de' end,
            legacy_goal->>'goal_name',legacy_goal->>'goal_id',legacy_goal->>'marker_operation');
          if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
        else
          final_description:=private.ai_replace_transaction_base(transaction_row.descricao,payload->>'new_value');
        end if;
      end if;
      if field_name='account_id' then
        new_account_id:=(payload->>'new_value')::bigint;
        perform private.ai_lock_account(caller,new_account_id,false,true);
      end if;
      if field_name='category_id' then
        if transaction_row.categoria_id is null then perform private.ai_fail('AI_INTERNAL_TRANSFER_HAS_NO_CATEGORY'); end if;
        new_category_id:=(payload->>'new_value')::bigint;
        perform private.ai_lock_category(caller,new_category_id,transaction_row.tipo,true);
      end if;
      if field_name='scheduled_date' then new_date:=(payload->>'new_value')::date; end if;
      destination_match:=regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]\s*$');
      if destination_match is not null then
        perform private.ai_lock_account(caller,destination_match[1]::bigint,false,true);
        if new_account_id=destination_match[1]::bigint then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
      end if;
      if transaction_row.status='paga' and amount<>transaction_row.valor
         and transaction_row.categoria_id is null then
        perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,transaction_row.valor,-1);
        perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,amount,1);
      end if;
      update public.transacoes set valor=amount,descricao=final_description,conta_id=new_account_id,
        categoria_id=new_category_id,data_vencimento=new_date where id=transaction_id;
      return jsonb_build_object('transaction_id',transaction_id,'updated',true,'scope','one','field',field_name);
    end if;

    -- Série: somente itens ainda pendentes; os concluídos permanecem imutáveis.
    for series_row in
      select * from public.transacoes t
      where (
          (series_match is not null and position('[Serie:'||series_match[1]||']' in t.descricao)>0)
          or (series_match is null and t.id=any(legacy_series_ids))
        )
        and t.status<>'paga'
        and (
          t.user_id=caller
          or exists(select 1 from public.contas c where c.id=t.conta_id
            and coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller))
        )
      order by t.data_vencimento,t.id for update
    loop
      perform private.ai_lock_account(caller,series_row.conta_id,false,false);
      perform private.ai_assert_transaction(caller,series_row.id);
      if series_row.user_id<>caller and field_name in ('account_id','category_id') then
        perform private.ai_fail('AI_SHARED_TRANSACTION_OWNERSHIP_IMMUTABLE');
      end if;
      amount:=series_row.valor; final_description:=series_row.descricao;
      new_account_id:=series_row.conta_id; new_category_id:=series_row.categoria_id;
      new_date:=series_row.data_vencimento;
      if field_name='value' then amount:=(payload->>'new_value')::numeric; end if;
      if field_name='description' then
        legacy_goal:=case when series_row.categoria_id is null
          then private.ai_resolve_legacy_goal_movement(caller,series_row.descricao)
          else null end;
        if legacy_goal is not null then
          final_description:=format('[Transf.] %s · %s: %s [Objetivo:%s:%s]',
            payload->>'new_value',
            case legacy_goal->>'marker_operation' when 'guardar' then 'Guardar em' else 'Resgate de' end,
            legacy_goal->>'goal_name',legacy_goal->>'goal_id',legacy_goal->>'marker_operation');
          if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
        else
          final_description:=private.ai_replace_transaction_base(series_row.descricao,payload->>'new_value');
        end if;
      end if;
      if field_name='account_id' then
        new_account_id:=(payload->>'new_value')::bigint;
        perform private.ai_lock_account(caller,new_account_id,false,true);
      end if;
      if field_name='category_id' then
        if series_row.categoria_id is null then perform private.ai_fail('AI_INTERNAL_TRANSFER_HAS_NO_CATEGORY'); end if;
        new_category_id:=(payload->>'new_value')::bigint;
        perform private.ai_lock_category(caller,new_category_id,series_row.tipo,true);
      end if;
      if field_name='scheduled_date' then
        if transaction_row.descricao like '%(Fixa semanal)%' then
          new_date:=(payload->>'new_value')::date+(series_row.data_vencimento-transaction_row.data_vencimento);
        else
          new_date:=make_date(extract(year from series_row.data_vencimento)::integer,
            extract(month from series_row.data_vencimento)::integer,
            least(extract(day from (payload->>'new_value')::date)::integer,
              extract(day from (date_trunc('month',series_row.data_vencimento)+interval '1 month - 1 day'))::integer));
        end if;
      end if;
      destination_match:=regexp_match(series_row.descricao,'\[Destino:([0-9]+)\]\s*$');
      if destination_match is not null then
        perform private.ai_lock_account(caller,destination_match[1]::bigint,false,true);
        if new_account_id=destination_match[1]::bigint then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
      end if;
      update public.transacoes set valor=amount,descricao=final_description,conta_id=new_account_id,
        categoria_id=new_category_id,data_vencimento=new_date where id=series_row.id;
      rows_changed:=rows_changed+1;
    end loop;
    if rows_changed=0 then perform private.ai_fail('AI_NO_OPEN_SERIES_ITEMS'); end if;
    return jsonb_build_object('transaction_id',transaction_id,'updated',true,'scope','open_series','updated_count',rows_changed,'field',field_name);
  end if;

  if action_name='delete_transaction' then
    scope_value:=payload->>'series_scope';
    if transaction_row.status='paga' and scope_value<>'one' then perform private.ai_fail('AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL'); end if;
    if scope_value='one' then
      if transaction_row.status='paga' and transaction_row.categoria_id is null then
        perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,transaction_row.valor,-1);
      end if;
      delete from public.transacoes where id=transaction_id;
      return jsonb_build_object('transaction_id',transaction_id,'deleted',true,'scope','one');
    end if;
    if series_match is null then
      legacy_series_ids:=private.ai_legacy_series_ids(caller,transaction_id);
    end if;
    for series_row in
      select t.* from public.transacoes t where t.status<>'paga'
        and (
          (series_match is not null and position('[Serie:'||series_match[1]||']' in t.descricao)>0)
          or (series_match is null and t.id=any(legacy_series_ids))
        )
        and (
          t.user_id=caller
          or exists(select 1 from public.contas c where c.id=t.conta_id
            and coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller))
        )
        and (scope_value='open_series' or t.data_vencimento>=transaction_row.data_vencimento)
      order by t.id for update
    loop
      perform private.ai_lock_account(caller,series_row.conta_id,false,false);
      perform private.ai_assert_transaction(caller,series_row.id);
      delete from public.transacoes where id=series_row.id and status<>'paga';
      if found then rows_changed:=rows_changed+1; end if;
    end loop;
    if rows_changed=0 then perform private.ai_fail('AI_NO_OPEN_SERIES_ITEMS'); end if;
    return jsonb_build_object('transaction_id',transaction_id,'deleted',true,'scope',scope_value,'deleted_count',rows_changed);
  end if;

  if action_name='complete_transaction' then
    if transaction_row.status='paga' then perform private.ai_fail('AI_TRANSACTION_ALREADY_COMPLETED'); end if;
    if round(transaction_row.valor,2)<>(payload->>'expected_value')::numeric then perform private.ai_fail('AI_TRANSACTION_VALUE_CHANGED'); end if;
    final_amount:=transaction_row.valor;
    if payload?'interest_value' then final_amount:=final_amount+(payload->>'interest_value')::numeric; end if;
    if payload?'interest_percent' then final_amount:=round(final_amount*(1+(payload->>'interest_percent')::numeric/100),2); end if;
    if final_amount<=0 then perform private.ai_fail('AI_INVALID_FINAL_VALUE'); end if;
    if not private.ai_can_access_account(caller,transaction_row.conta_id,true) then perform private.ai_fail('AI_ACCOUNT_ARCHIVED'); end if;
    destination_match:=regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]\s*$');
    if destination_match is not null then perform private.ai_lock_account(caller,destination_match[1]::bigint,false,true); end if;
    if transaction_row.categoria_id is null then
      perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,final_amount,1);
    end if;
    update public.transacoes set status='paga',valor=round(final_amount,2),
      data_realizacao=(payload->>'realization_date')::date where id=transaction_id;
    return jsonb_build_object('transaction_id',transaction_id,'completed',true,
      'value',round(final_amount,2),'realization_date',payload->>'realization_date');
  end if;

  if action_name='reopen_transaction' then
    if transaction_row.status<>'paga' then perform private.ai_fail('AI_TRANSACTION_NOT_COMPLETED'); end if;
    destination_match:=regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]\s*$');
    if destination_match is not null then perform private.ai_lock_account(caller,destination_match[1]::bigint,false,true); end if;
    if transaction_row.categoria_id is null then
      perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,transaction_row.valor,-1);
    end if;
    update public.transacoes set status='pendente',data_realizacao=null where id=transaction_id;
    return jsonb_build_object('transaction_id',transaction_id,'reopened',true,'status','pendente');
  end if;

  perform private.ai_fail('AI_UNSUPPORTED_TRANSACTION_ACTION');
  return null;
end;
$$;

revoke all on function private.ai_execute_transaction_action(uuid,text,jsonb) from public, anon, authenticated;

create or replace function private.ai_execute_card_action(
  caller uuid,
  action_name text,
  payload jsonb,
  pending_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  card_row record;
  item_row record;
  transaction_row record;
  ledger_row record;
  purchase_id bigint;
  first_purchase_id bigint;
  payment_tx_id bigint;
  linked_item_id bigint;
  group_id bigint;
  occurrence_count integer;
  occurrence_index integer;
  frequency_value text;
  purchase_date date;
  occurrence_date date;
  first_invoice text;
  invoice_month text;
  current_month text := to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM');
  today date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  amount numeric;
  item_amount numeric;
  total_amount numeric;
  payment_amount numeric;
  remaining_amount numeric;
  interest_amount numeric := 0;
  amount_cents bigint;
  per_cents bigint;
  remainder_cents integer;
  used_limit numeric;
  limit_charge numeric;
  description_value text;
  final_description text;
  field_name text;
  scope_value text;
  remainder_mode text;
  paid_ids bigint[] := '{}';
  target_ids bigint[] := '{}';
  deleted_count integer;
  marker text[];
begin
  if action_name='create_card_purchase' then
    perform private.ai_lock_card(caller,(payload->>'card_id')::bigint,true);
    select * into card_row from public.cartoes
    where id=(payload->>'card_id')::bigint and user_id=caller and coalesce(ativo,true) for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    perform private.ai_lock_category(caller,(payload->>'category_id')::bigint,'despesa',true);
    frequency_value:=payload->>'frequency'; occurrence_count:=(payload->>'recurrence_count')::integer;
    purchase_date:=(payload->>'purchase_date')::date; amount:=(payload->>'value')::numeric;
    first_invoice:=private.ai_invoice_month(purchase_date,card_row.dia_fechamento);
    if private.ai_invoice_is_closed(first_invoice,card_row.dia_fechamento) then perform private.ai_fail('AI_INVOICE_CLOSED'); end if;
    if frequency_value='parcelada' then
      amount_cents:=round(amount*100)::bigint; per_cents:=amount_cents/occurrence_count;
      remainder_cents:=(amount_cents%occurrence_count)::integer;
      if per_cents<=0 then perform private.ai_fail('AI_INSTALLMENT_TOO_SMALL'); end if;
      limit_charge:=amount;
    elsif frequency_value='mensal' then
      limit_charge:=case when first_invoice=current_month then amount else 0 end;
    else limit_charge:=amount;
    end if;
    used_limit:=private.ai_card_used_limit(caller,card_row.id);
    if used_limit+limit_charge>card_row.limite then perform private.ai_fail('AI_CARD_LIMIT_EXCEEDED'); end if;

    for occurrence_index in 0..occurrence_count-1 loop
      invoice_month:=private.ai_add_month(first_invoice,occurrence_index);
      occurrence_date:=case when frequency_value='mensal'
        then private.ai_add_occurrence(purchase_date,occurrence_index,'monthly') else purchase_date end;
      item_amount:=case when frequency_value='parcelada'
        then (per_cents+case when occurrence_index<remainder_cents then 1 else 0 end)::numeric/100
        else amount end;
      final_description:=(payload->>'description')||case frequency_value
        when 'parcelada' then format(' (%s/%s)',occurrence_index+1,occurrence_count)
        when 'mensal' then ' (Fixa)' else '' end;
      insert into public.fatura_itens(
        cartao_id,user_id,descricao,valor,data_compra,mes_fatura,
        parcela_atual,total_parcelas,grupo_parcela_id,categoria_id,pago
      ) values(
        card_row.id,caller,final_description,item_amount,occurrence_date,invoice_month,
        occurrence_index+1,case when frequency_value='parcelada' then occurrence_count else 1 end,
        case when occurrence_index=0 then null else first_purchase_id end,
        (payload->>'category_id')::bigint,false
      ) returning id into purchase_id;
      if occurrence_index=0 then
        first_purchase_id:=purchase_id;
        update public.fatura_itens set grupo_parcela_id=first_purchase_id where id=first_purchase_id;
      end if;
      target_ids:=array_append(target_ids,purchase_id);
    end loop;
    return jsonb_build_object('purchase_ids',to_jsonb(target_ids),'group_id',first_purchase_id,
      'frequency',frequency_value,'occurrences',occurrence_count,'first_invoice',first_invoice);
  end if;

  if action_name in ('update_card_purchase','delete_card_purchase') then
    purchase_id:=(payload->>'purchase_id')::bigint;
    perform private.ai_assert_card_item(caller,purchase_id);
    select * into item_row from public.fatura_itens where id=purchase_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CARD_PURCHASE_NOT_FOUND'); end if;
    perform private.ai_lock_card(caller,item_row.cartao_id,true);
    select * into card_row from public.cartoes
    where id=item_row.cartao_id and user_id=caller and coalesce(ativo,true) for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    if item_row.descricao='Pagamento parcial da fatura'
       or item_row.descricao~'^Saldo da fatura anterior \(.+\)$' then
      perform private.ai_fail('AI_INVOICE_SYNTHETIC_ITEM_IMMUTABLE');
    end if;
    if item_row.pago then perform private.ai_fail('AI_CARD_PURCHASE_ALREADY_PAID'); end if;
    if exists(
      select 1
      from private.ai_invoice_payment_ledger l
      where l.user_id=caller and l.linked_item_id=purchase_id and l.reversed_at is null
    ) then
      perform private.ai_fail('AI_INVOICE_PAYMENT_ITEM_REQUIRES_REVERSAL');
    end if;
  end if;

  if action_name='update_card_purchase' then
    field_name:=payload->>'field'; scope_value:=coalesce(payload->>'series_scope','one');
    if field_name='category_id' then
      perform private.ai_lock_category(caller,(payload->>'new_value')::bigint,'despesa',true);
    end if;
    if scope_value='one' then
      if private.ai_invoice_is_closed(item_row.mes_fatura,card_row.dia_fechamento) then perform private.ai_fail('AI_INVOICE_CLOSED'); end if;
      if field_name='description' then
        description_value:=payload->>'new_value';
        if item_row.total_parcelas>1 then
          description_value:=description_value||format(' (%s/%s)',item_row.parcela_atual,item_row.total_parcelas);
        elsif item_row.descricao like '%(Fixa)' then description_value:=description_value||' (Fixa)'; end if;
        update public.fatura_itens set descricao=description_value where id=purchase_id;
      else
        update public.fatura_itens set categoria_id=(payload->>'new_value')::bigint where id=purchase_id;
      end if;
      return jsonb_build_object('purchase_id',purchase_id,'updated',true,'field',field_name,'scope','one','updated_count',1);
    end if;
    group_id:=coalesce(item_row.grupo_parcela_id,item_row.id);
    deleted_count:=0;
    for item_row in
      select i.* from public.fatura_itens i
      where i.user_id=caller and coalesce(i.grupo_parcela_id,i.id)=group_id and not i.pago
      order by i.mes_fatura,i.id for update
    loop
      if not private.ai_invoice_is_closed(item_row.mes_fatura,card_row.dia_fechamento) then
        if field_name='description' then
          description_value:=payload->>'new_value';
          if item_row.total_parcelas>1 then
            description_value:=description_value||format(' (%s/%s)',item_row.parcela_atual,item_row.total_parcelas);
          elsif item_row.descricao like '%(Fixa)' then description_value:=description_value||' (Fixa)'; end if;
          update public.fatura_itens set descricao=description_value where id=item_row.id;
        else
          update public.fatura_itens set categoria_id=(payload->>'new_value')::bigint where id=item_row.id;
        end if;
        deleted_count:=deleted_count+1;
      end if;
    end loop;
    if deleted_count=0 then perform private.ai_fail('AI_NO_OPEN_CARD_PURCHASES'); end if;
    return jsonb_build_object('purchase_id',purchase_id,'updated',true,'field',field_name,
      'scope','open_series','updated_count',deleted_count);
  end if;

  if action_name='delete_card_purchase' then
    scope_value:=payload->>'series_scope'; group_id:=coalesce(item_row.grupo_parcela_id,item_row.id);
    if scope_value='one' then
      if private.ai_invoice_is_closed(item_row.mes_fatura,card_row.dia_fechamento) then perform private.ai_fail('AI_INVOICE_CLOSED'); end if;
      delete from public.fatura_itens where id=purchase_id and user_id=caller and not pago;
      return jsonb_build_object('purchase_id',purchase_id,'deleted',true,'scope','one','deleted_count',1);
    end if;
    -- Somente cobranças ainda abertas: parcelas já pagas ou pertencentes a
    -- faturas fechadas permanecem intactas.
    for item_row in
      select i.* from public.fatura_itens i
      where i.user_id=caller and coalesce(i.grupo_parcela_id,i.id)=group_id and not i.pago
      order by i.mes_fatura,i.id for update
    loop
      if not private.ai_invoice_is_closed(item_row.mes_fatura,card_row.dia_fechamento) then
        target_ids:=array_append(target_ids,item_row.id);
      end if;
    end loop;
    if cardinality(target_ids)=0 then perform private.ai_fail('AI_NO_OPEN_CARD_PURCHASES'); end if;
    delete from public.fatura_itens where user_id=caller and id=any(target_ids);
    get diagnostics deleted_count=row_count;
    return jsonb_build_object('purchase_id',purchase_id,'deleted',true,'scope','open_series','deleted_count',deleted_count);
  end if;

  if action_name='pay_invoice' then
    perform private.ai_lock_card(caller,(payload->>'card_id')::bigint,true);
    perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
    select * into card_row from public.cartoes where id=(payload->>'card_id')::bigint and user_id=caller for update;
    if not found or not coalesce(card_row.ativo,true) then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    invoice_month:=payload->>'invoice_month';
    perform pg_advisory_xact_lock(hashtext('invoice:'||caller::text||':'||card_row.id::text),hashtext(invoice_month));
    perform 1 from public.fatura_itens i
      where i.user_id=caller and i.cartao_id=card_row.id and i.mes_fatura=invoice_month and not i.pago
      order by i.id for update;
    select coalesce(sum(i.valor),0),coalesce(array_agg(i.id order by i.id),'{}')
      into total_amount,paid_ids
    from public.fatura_itens i
    where i.user_id=caller and i.cartao_id=card_row.id and i.mes_fatura=invoice_month and not i.pago;
    if total_amount<=0 then perform private.ai_fail('AI_INVOICE_ALREADY_SETTLED'); end if;
    payment_amount:=(payload->>'payment_amount')::numeric;
    remainder_mode:=payload->>'remainder_mode';
    if payment_amount>total_amount then perform private.ai_fail('AI_PAYMENT_ABOVE_INVOICE'); end if;
    if remainder_mode='full' and payment_amount<>total_amount then perform private.ai_fail('AI_TOTAL_PAYMENT_MISMATCH'); end if;
    if remainder_mode<>'full' and payment_amount>=total_amount then perform private.ai_fail('AI_PARTIAL_PAYMENT_MISMATCH'); end if;
    remaining_amount:=round(total_amount-payment_amount,2);
    if remainder_mode='carry' then
      if payload?'interest_value' then interest_amount:=(payload->>'interest_value')::numeric;
      elsif payload?'interest_percent' then interest_amount:=round(remaining_amount*(payload->>'interest_percent')::numeric/100,2);
      end if;
    end if;
    if remainder_mode in ('full','carry') then
      update public.fatura_itens set pago=true where user_id=caller and id=any(paid_ids);
    end if;
    if remainder_mode='keep_open' then
      insert into public.fatura_itens(cartao_id,user_id,descricao,valor,data_compra,mes_fatura,
        parcela_atual,total_parcelas,grupo_parcela_id,categoria_id,pago)
      values(card_row.id,caller,'Pagamento parcial da fatura',-payment_amount,today,invoice_month,
        1,1,null,null,false) returning id into linked_item_id;
    elsif remainder_mode='carry' then
      insert into public.fatura_itens(cartao_id,user_id,descricao,valor,data_compra,mes_fatura,
        parcela_atual,total_parcelas,grupo_parcela_id,categoria_id,pago)
      values(card_row.id,caller,'Saldo da fatura anterior ('||invoice_month||')',remaining_amount+interest_amount,
        today,private.ai_add_month(invoice_month,1),1,1,null,null,false) returning id into linked_item_id;
    end if;
    final_description:=format('Fatura %s - %s [PagFatura:%s:%s:%s%s]',card_row.nome,invoice_month,
      card_row.id,invoice_month,
      case remainder_mode when 'full' then 'total' when 'keep_open' then 'parcial' else 'saldo_transferido' end,
      case when linked_item_id is null then '' else ':'||linked_item_id::text end);
    insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
    values(caller,'despesa',payment_amount,final_description,today,today,
      (payload->>'account_id')::bigint,null,'paga') returning id into payment_tx_id;
    insert into private.ai_invoice_payment_ledger(payment_transaction_id,action_id,user_id,card_id,
      invoice_month,mode,paid_item_ids,linked_item_id)
    values(payment_tx_id,pending_action_id,caller,card_row.id,invoice_month,
      case remainder_mode when 'full' then 'total' when 'keep_open' then 'partial' else 'carry_forward' end,
      case when remainder_mode='keep_open' then '{}'::bigint[] else paid_ids end,linked_item_id);
    return jsonb_build_object('payment_transaction_id',payment_tx_id,'card_id',card_row.id,
      'invoice_month',invoice_month,'mode',remainder_mode,'paid',payment_amount,
      'remaining',remaining_amount,'interest',interest_amount,'linked_item_id',linked_item_id);
  end if;

  if action_name='reverse_invoice_payment' then
    payment_tx_id:=(payload->>'transaction_id')::bigint;
    select * into transaction_row from public.transacoes
    where id=payment_tx_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_PAYMENT_TRANSACTION_NOT_FOUND'); end if;
    select * into ledger_row from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=payment_tx_id and l.user_id=caller for update;
    if found then
      if ledger_row.reversed_at is not null then perform private.ai_fail('AI_INVOICE_PAYMENT_ALREADY_REVERSED'); end if;
      if ledger_row.mode<>'partial' and exists(
        select 1
        from public.transacoes t
        where t.user_id=caller and t.id<>payment_tx_id
          and t.descricao like '%[PagFatura:'||ledger_row.card_id::text||':'||ledger_row.invoice_month||':%'
          and not exists(
            select 1 from private.ai_invoice_payment_ledger tracked
            where tracked.payment_transaction_id=t.id and tracked.user_id=caller
          )
      ) then perform private.ai_fail('AI_INVOICE_HAS_UNTRACKED_PAYMENT'); end if;
      if ledger_row.linked_item_id is not null and exists(
        select 1 from public.fatura_itens linked
        where linked.id=ledger_row.linked_item_id and linked.user_id=caller and linked.pago
      ) then perform private.ai_fail('AI_INVOICE_HAS_LATER_PAYMENT'); end if;
      if exists(
        select 1 from private.ai_invoice_payment_ledger later
        where later.user_id=caller and later.card_id=ledger_row.card_id
          and later.reversed_at is null
          and later.created_at>ledger_row.created_at
          and (
            later.paid_item_ids&&ledger_row.paid_item_ids
            or ledger_row.linked_item_id=any(later.paid_item_ids)
          )
      ) then perform private.ai_fail('AI_INVOICE_HAS_LATER_PAYMENT'); end if;
      if cardinality(ledger_row.paid_item_ids)>0 then
        update public.fatura_itens set pago=false
        where user_id=caller and id=any(ledger_row.paid_item_ids);
      end if;
      if ledger_row.linked_item_id is not null then
        delete from public.fatura_itens where id=ledger_row.linked_item_id and user_id=caller;
      end if;
      update private.ai_invoice_payment_ledger l set reversed_at=clock_timestamp()
      where l.payment_transaction_id=payment_tx_id;
      delete from public.transacoes where id=payment_tx_id;
      return jsonb_build_object('payment_transaction_id',payment_tx_id,'reversed',true,
        'card_id',ledger_row.card_id,'invoice_month',ledger_row.invoice_month);
    end if;

    -- Sem ledger não há snapshot confiável: o estorno legado falha fechado para
    -- não reabrir itens quitados por pagamentos anteriores ou posteriores.
    marker:=regexp_match(transaction_row.descricao,
      '\[PagFatura:([0-9]+):([0-9]{4}-[0-9]{2}):(total|parcial|saldo_transferido)(?::([0-9]+))?\]\s*$');
    if marker is null then perform private.ai_fail('AI_NOT_AN_INVOICE_PAYMENT'); end if;
    perform private.ai_assert_card(caller,marker[1]::bigint,false);
    perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
  end if;

  perform private.ai_fail('AI_UNSUPPORTED_CARD_ACTION');
  return null;
end;
$$;

revoke all on function private.ai_execute_card_action(uuid,text,jsonb,uuid) from public, anon, authenticated;




create or replace function private.ai_action_quota(caller uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitlement record;
  local_day date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  window_start timestamptz;
  window_end timestamptz;
  action_limit integer;
  used_count integer;
begin
  if caller is null or caller is distinct from (select auth.uid()) then perform private.ai_fail('AI_AUTH_REQUIRED'); end if;
  select * into entitlement from public.get_my_entitlement();
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;
  window_start := local_day::timestamp at time zone 'America/Sao_Paulo';
  window_end := (local_day + 1)::timestamp at time zone 'America/Sao_Paulo';
  action_limit := case
    when not coalesce(entitlement.limits_enabled,false) then -1
    when entitlement.plan='premium' then 50
    when entitlement.plan='smart' then 15
    else 0
  end;
  select count(*) into used_count
  from public.ai_action_audit a
  where a.user_id=caller and a.event_type='succeeded'
    and a.created_at>=window_start and a.created_at<window_end;
  return jsonb_build_object(
    'plan',coalesce(entitlement.plan,'free'),
    'limits_enabled',coalesce(entitlement.limits_enabled,false),
    'limit',action_limit,
    'used',used_count,
    'remaining',case when action_limit<0 then -1 else greatest(action_limit-used_count,0) end,
    'window_start',window_start,
    'window_end',window_end,
    'timezone','America/Sao_Paulo'
  );
end;
$$;

create or replace function private.ai_assert_reactivation_limit(caller uuid, resource_kind text, resource_type text default null)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  entitlement record;
  allowed_count integer;
  used_count integer;
begin
  select * into entitlement from public.get_my_entitlement();
  if not coalesce(entitlement.limits_enabled,false) or entitlement.plan='premium' then return; end if;
  if resource_kind='account' then
    allowed_count := case entitlement.plan when 'smart' then 5 else 2 end;
    select count(*) into used_count from public.contas where user_id=caller and not coalesce(arquivado,false);
  elsif resource_kind='card' then
    allowed_count := case entitlement.plan when 'smart' then 3 else 1 end;
    select count(*) into used_count from public.cartoes where user_id=caller and coalesce(ativo,true);
  elsif resource_kind='goal' then
    allowed_count := case entitlement.plan when 'smart' then 5 else 1 end;
    select count(*) into used_count from public.caixinhas where user_id=caller and not coalesce(arquivado,false);
  elsif resource_kind='category' then
    allowed_count := case entitlement.plan when 'smart' then 14 else 7 end;
    select count(*) into used_count from public.categorias
    where user_id=caller and tipo=resource_type
      and coalesce(ativa::text,'true') not in ('0','false','f');
  else
    perform private.ai_fail('AI_INVALID_RESOURCE_KIND');
  end if;
  if used_count>=allowed_count then perform private.ai_fail('AI_PLAN_RESOURCE_LIMIT'); end if;
end;
$$;

create or replace function private.ai_adjust_goal_balance(
  caller uuid,
  goal_id bigint,
  operation_name text,
  amount numeric,
  direction integer
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare current_balance numeric; new_balance numeric;
begin
  if operation_name not in ('save','withdraw') or amount<=0 or direction not in (-1,1) then
    perform private.ai_fail('AI_INVALID_GOAL_ADJUSTMENT');
  end if;
  perform private.ai_lock_goal(caller,goal_id,false,true);
  select g.saldo_atual into current_balance
  from public.caixinhas g
  where g.id=goal_id
    and not coalesce(g.arquivado,false)
    and (
      g.user_id=caller
      or (coalesce(g.compartilhado,false) and public.is_parceiro(g.user_id,caller))
    )
  for update;
  if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  new_balance := coalesce(current_balance,0)
    + case operation_name when 'save' then amount else -amount end * direction;
  if new_balance < 0 then perform private.ai_fail('AI_INSUFFICIENT_GOAL_BALANCE'); end if;
  update public.caixinhas set saldo_atual=round(new_balance,2) where id=goal_id;
  return round(new_balance,2);
end;
$$;

create or replace function private.ai_adjust_goal_from_description(
  caller uuid,
  description text,
  amount numeric,
  direction integer
)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
declare
  marker text[];
  legacy_goal jsonb;
begin
  marker := regexp_match(description,'\[Objetivo:([0-9]+):(guardar|resgatar)\]\s*$');
  if marker is null then
    legacy_goal:=private.ai_resolve_legacy_goal_movement(caller,description);
    if legacy_goal is null then return null; end if;
    return private.ai_adjust_goal_balance(
      caller,(legacy_goal->>'goal_id')::bigint,legacy_goal->>'operation',amount,direction
    );
  end if;
  return private.ai_adjust_goal_balance(
    caller, marker[1]::bigint,
    case marker[2] when 'guardar' then 'save' else 'withdraw' end,
    amount, direction
  );
end;
$$;

create or replace function private.ai_card_used_limit(caller uuid, card_id bigint)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(sum(i.valor),0),0)
  from public.fatura_itens i
  where i.user_id=caller and i.cartao_id=card_id and not i.pago
    and i.mes_fatura>=to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM')
    and (
      i.descricao !~ '\(Fixa\)$'
      or i.mes_fatura=to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM')
    );
$$;

create or replace function private.ai_replace_transaction_base(original_description text, new_base text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  metadata text := coalesce(substring(original_description from '(\s*(?:\[(?:Serie:[A-Za-z0-9_-]+|Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$'), '');
  visible text;
  recurrence text;
  goal_label text;
  result_description text;
  prefix text := case when original_description like '[Transf.] %' then '[Transf.] ' else '' end;
begin
  visible := btrim(regexp_replace(original_description,'(\s*(?:\[(?:Serie:[A-Za-z0-9_-]+|Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$',''));
  visible := regexp_replace(visible,'^\[Transf\.\]\s*','');
  recurrence := coalesce(substring(visible from '(\s+\([0-9]+/[0-9]+\)|\s+\(Fixa(?: semanal| anual)?\))$'),'');
  if original_description ~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]\s*$' then
    visible:=btrim(regexp_replace(visible,'(\s+\([0-9]+/[0-9]+\)|\s+\(Fixa(?: semanal| anual)?\))$',''));
    goal_label:=case when position(' · Guardar em:' in visible)>0 or position(' · Resgate de:' in visible)>0
      then substring(visible from position(' · ' in visible)+3)
      else visible end;
    result_description:=btrim('[Transf.] '||new_base||' · '||goal_label||recurrence||metadata);
    if length(result_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
    return result_description;
  end if;
  result_description:=btrim(prefix||new_base||recurrence||metadata);
  if length(result_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
  return result_description;
end;
$$;

revoke all on function private.ai_action_quota(uuid) from public, anon, authenticated;
revoke all on function private.ai_assert_reactivation_limit(uuid,text,text) from public, anon, authenticated;
revoke all on function private.ai_adjust_goal_balance(uuid,bigint,text,numeric,integer) from public, anon, authenticated;
revoke all on function private.ai_adjust_goal_from_description(uuid,text,numeric,integer) from public, anon, authenticated;
revoke all on function private.ai_card_used_limit(uuid,bigint) from public, anon, authenticated;
revoke all on function private.ai_replace_transaction_base(text,text) from public, anon, authenticated;

create or replace function private.ai_execute_resource_action_obsolete(
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
  resource_id bigint;
  row_count integer;
  db_type text;
  current_type text;
  current_balance numeric;
  has_references boolean;
begin
  if action_name='create_account' then
    insert into public.contas(user_id,nome,saldo_inicial,cor,arquivado)
    values(caller,payload->>'name',(payload->>'initial_balance')::numeric,payload->>'color',false)
    returning id into resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'created',true);

  elsif action_name='edit_account' then
    resource_id := (payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    update public.contas set
      nome=case when payload?'name' then payload->>'name' else nome end,
      saldo_inicial=case when payload?'initial_balance' then (payload->>'initial_balance')::numeric else saldo_inicial end,
      cor=case when payload?'color' then payload->>'color' else cor end
    where id=resource_id and user_id=caller;
    return jsonb_build_object('resource','account','id',resource_id,'updated',true);

  elsif action_name='archive_account' then
    resource_id := (payload->>'account_id')::bigint;
    update public.contas set arquivado=true
    where id=resource_id and user_id=caller and not coalesce(arquivado,false);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_ACCOUNT_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','account','id',resource_id,'archived',true);

  elsif action_name='delete_account' then
    resource_id := (payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    select exists(select 1 from public.transacoes where conta_id=resource_id) into has_references;
    if has_references then
      update public.contas set arquivado=true where id=resource_id;
      return jsonb_build_object('resource','account','id',resource_id,'deleted',false,'archived',true,'reason','has_transactions');
    end if;
    delete from public.contas where id=resource_id and user_id=caller;
    return jsonb_build_object('resource','account','id',resource_id,'deleted',true,'archived',false);

  elsif action_name='reactivate_account' then
    resource_id := (payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller and coalesce(arquivado,false) for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'account');
    update public.contas set arquivado=false where id=resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'reactivated',true);

  elsif action_name='create_category' then
    db_type := case payload->>'type' when 'income' then 'receita' when 'expense' then 'despesa' else 'ambos' end;
    insert into public.categorias(user_id,nome,tipo,cor,icone,ativa)
    values(caller,payload->>'name',db_type,payload->>'color',payload->>'icon',1)
    returning id into resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'created',true);

  elsif action_name='edit_category' then
    resource_id := (payload->>'category_id')::bigint;
    select tipo into current_type from public.categorias where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    if payload?'type' then
      db_type := case payload->>'type' when 'income' then 'receita' when 'expense' then 'despesa' else 'ambos' end;
      if db_type<>'ambos' and exists(
        select 1 from public.transacoes t
        where t.categoria_id=resource_id and t.tipo<>db_type
      ) then perform private.ai_fail('AI_CATEGORY_TYPE_IN_USE'); end if;
      if db_type<>'despesa' and exists(
        select 1 from public.fatura_itens i where i.categoria_id=resource_id
      ) then perform private.ai_fail('AI_CATEGORY_TYPE_IN_USE'); end if;
    else db_type := current_type;
    end if;
    update public.categorias set
      nome=case when payload?'name' then payload->>'name' else nome end,
      tipo=db_type,
      cor=case when payload?'color' then payload->>'color' else cor end,
      icone=case when payload?'icon' then payload->>'icon' else icone end
    where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'updated',true);

  elsif action_name='archive_category' then
    resource_id := (payload->>'category_id')::bigint;
    update public.categorias set ativa=0
    where id=resource_id and user_id=caller and coalesce(ativa::text,'true') not in ('0','false','f');
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_CATEGORY_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','category','id',resource_id,'archived',true);

  elsif action_name='delete_category' then
    resource_id := (payload->>'category_id')::bigint;
    perform 1 from public.categorias where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    select exists(select 1 from public.transacoes where categoria_id=resource_id)
      or exists(select 1 from public.fatura_itens where categoria_id=resource_id)
      into has_references;
    if has_references then
      update public.categorias set ativa=0 where id=resource_id;
      return jsonb_build_object('resource','category','id',resource_id,'deleted',false,'archived',true,'reason','has_entries');
    end if;
    delete from public.categorias where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'deleted',true,'archived',false);

  elsif action_name='reactivate_category' then
    resource_id := (payload->>'category_id')::bigint;
    select tipo into current_type from public.categorias
    where id=resource_id and user_id=caller and coalesce(ativa::text,'true') in ('0','false','f') for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'category',current_type);
    update public.categorias set ativa=1 where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'reactivated',true);

  elsif action_name='create_caixinha' then
    if (payload->>'target_amount')::numeric<=0 or (payload->>'initial_balance')::numeric<0 then
      perform private.ai_fail('AI_INVALID_GOAL_VALUES');
    end if;
    insert into public.caixinhas(
      user_id,nome,meta_valor,saldo_atual,cor,icone,data_prazo,arquivado
    ) values(
      caller,payload->>'name',(payload->>'target_amount')::numeric,
      (payload->>'initial_balance')::numeric,payload->>'color',payload->>'icon',
      case when payload?'target_date' then (payload->>'target_date')::date else null end,false
    ) returning id into resource_id;
    return jsonb_build_object('resource','caixinha','id',resource_id,'created',true);

  elsif action_name='edit_caixinha' then
    resource_id := (payload->>'caixinha_id')::bigint;
    perform 1 from public.caixinhas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    update public.caixinhas set
      nome=case when payload?'name' then payload->>'name' else nome end,
      meta_valor=case when payload?'target_amount' then (payload->>'target_amount')::numeric else meta_valor end,
      cor=case when payload?'color' then payload->>'color' else cor end,
      icone=case when payload?'icon' then payload->>'icon' else icone end,
      data_prazo=case when payload?'target_date' then (payload->>'target_date')::date else data_prazo end
    where id=resource_id;
    return jsonb_build_object('resource','caixinha','id',resource_id,'updated',true);

  elsif action_name='archive_caixinha' then
    resource_id := (payload->>'caixinha_id')::bigint;
    update public.caixinhas set arquivado=true
    where id=resource_id and user_id=caller and not coalesce(arquivado,false);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_GOAL_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','caixinha','id',resource_id,'archived',true);

  elsif action_name='delete_caixinha' then
    resource_id := (payload->>'caixinha_id')::bigint;
    select saldo_atual into current_balance from public.caixinhas
    where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    select exists(
      select 1 from public.transacoes
      where descricao like '%[Objetivo:' || resource_id::text || ':%'
    ) into has_references;
    if coalesce(current_balance,0)<>0 or has_references then
      update public.caixinhas set arquivado=true where id=resource_id;
      return jsonb_build_object('resource','caixinha','id',resource_id,'deleted',false,'archived',true,'reason',case when current_balance<>0 then 'has_balance' else 'has_entries' end);
    end if;
    delete from public.caixinhas where id=resource_id;
    return jsonb_build_object('resource','caixinha','id',resource_id,'deleted',true,'archived',false);

  elsif action_name='reactivate_caixinha' then
    resource_id := (payload->>'caixinha_id')::bigint;
    perform 1 from public.caixinhas where id=resource_id and user_id=caller and coalesce(arquivado,false) for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'goal');
    update public.caixinhas set arquivado=false where id=resource_id;
    return jsonb_build_object('resource','caixinha','id',resource_id,'reactivated',true);

  elsif action_name='create_card' then
    insert into public.cartoes(user_id,nome,cor,limite,dia_vencimento,dia_fechamento,ativo)
    values(caller,payload->>'name',payload->>'color',(payload->>'limit')::numeric,
      (payload->>'due_day')::integer,(payload->>'closing_day')::integer,true)
    returning id into resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'created',true);

  elsif action_name='edit_card' then
    resource_id := (payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    if payload?'limit' and (payload->>'limit')::numeric < private.ai_card_used_limit(caller,resource_id) then
      perform private.ai_fail('AI_LIMIT_BELOW_USED');
    end if;
    update public.cartoes set
      nome=case when payload?'name' then payload->>'name' else nome end,
      cor=case when payload?'color' then payload->>'color' else cor end,
      limite=case when payload?'limit' then (payload->>'limit')::numeric else limite end,
      dia_vencimento=case when payload?'due_day' then (payload->>'due_day')::integer else dia_vencimento end,
      dia_fechamento=case when payload?'closing_day' then (payload->>'closing_day')::integer else dia_fechamento end
    where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'updated',true);

  elsif action_name='archive_card' then
    resource_id := (payload->>'card_id')::bigint;
    update public.cartoes set ativo=false
    where id=resource_id and user_id=caller and coalesce(ativo,true);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_CARD_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','card','id',resource_id,'archived',true);

  elsif action_name='delete_card' then
    resource_id := (payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    select exists(select 1 from public.fatura_itens where cartao_id=resource_id) into has_references;
    if has_references then
      update public.cartoes set ativo=false where id=resource_id;
      return jsonb_build_object('resource','card','id',resource_id,'deleted',false,'archived',true,'reason','has_purchases');
    end if;
    delete from public.cartoes where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'deleted',true,'archived',false);

  elsif action_name='reactivate_card' then
    resource_id := (payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller and not coalesce(ativo,true) for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'card');
    update public.cartoes set ativo=true where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'reactivated',true);
  end if;
  perform private.ai_fail('AI_UNSUPPORTED_RESOURCE_ACTION');
  return null;
end;
$$;

revoke all on function private.ai_execute_resource_action_obsolete(uuid,text,jsonb) from public, anon, authenticated;

-- Definição canônica alinhada a supabase/functions/finance-ai/contracts.ts.
-- Sobrescreve a definição de fundação acima para manter a migração legível e,
-- ao mesmo tempo, aceitar somente as chaves que a Edge pode emitir.
create or replace function private.ai_prepare_action(
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
  allowed text[];
  required text[];
  normalized jsonb := raw_payload;
  key_name text;
  field_name text;
  text_value text;
  numeric_value numeric;
  primary_name text;
  secondary_name text;
  frequency_value text;
  recurrence_count integer;
  installments integer;
  invoice_total numeric;
  completion_total numeric;
  legacy_descriptor jsonb;
  title text;
  summary text;
  consequences jsonb := '[]'::jsonb;
begin
  if caller is null or caller is distinct from (select auth.uid()) then perform private.ai_fail('AI_AUTH_REQUIRED'); end if;

  case action_name
    when 'create_account' then
      allowed:=array['name','initial_balance','color']; required:=array['name'];
    when 'update_account' then allowed:=array['account_id','field','new_value']; required:=allowed;
    when 'archive_account','delete_account','reactivate_account' then allowed:=array['account_id']; required:=allowed;
    when 'create_category' then
      allowed:=array['name','type','color','icon']; required:=array['name','type'];
    when 'update_category' then allowed:=array['category_id','field','new_value']; required:=allowed;
    when 'archive_category','delete_category','reactivate_category' then allowed:=array['category_id']; required:=allowed;
    when 'create_goal' then
      allowed:=array['name','target_amount','initial_balance','color','icon','target_date'];
      required:=array['name','target_amount'];
    when 'update_goal' then allowed:=array['goal_id','field','new_value']; required:=allowed;
    when 'archive_goal','delete_goal','reactivate_goal' then allowed:=array['goal_id']; required:=allowed;
    when 'move_goal' then
      allowed:=array['operation','goal_id','account_id','value','description','realization_date',
        'scheduled_date','frequency','recurrence_count'];
      required:=array['operation','goal_id','account_id','value','description'];
    when 'create_transaction' then
      allowed:=array['type','value','description','status','scheduled_date','realization_date','account_id','category_id','frequency','installments','installment_value','recurrence_count'];
      required:=array['type','value','description','status','scheduled_date','account_id','category_id','frequency'];
    when 'transfer_between_accounts' then
      allowed:=array['account_id','destination_account_id','value','description','status','scheduled_date','realization_date','frequency','installments','installment_value','recurrence_count'];
      required:=array['account_id','destination_account_id','value','description','status','scheduled_date','frequency'];
    when 'update_transaction' then
      allowed:=array['transaction_id','series_scope','field','new_value']; required:=allowed;
    when 'delete_transaction' then
      allowed:=array['transaction_id','series_scope']; required:=allowed;
    when 'complete_transaction' then
      allowed:=array['transaction_id','realization_date','expected_value','realized_value','interest_value','interest_percent'];
      required:=array['transaction_id','realization_date','expected_value','realized_value'];
    when 'reopen_transaction' then allowed:=array['transaction_id']; required:=allowed;
    when 'create_card' then
      allowed:=array['name','value','color','due_day','closing_day'];
      required:=array['name','value','due_day','closing_day'];
    when 'update_card' then allowed:=array['card_id','field','new_value']; required:=allowed;
    when 'archive_card','delete_card','reactivate_card' then allowed:=array['card_id']; required:=allowed;
    when 'create_card_purchase' then
      allowed:=array['card_id','category_id','description','value','purchase_date','frequency','installments','installment_value','recurrence_count'];
      required:=array['card_id','category_id','description','value','purchase_date','frequency'];
    when 'update_card_purchase' then
      allowed:=array['purchase_id','field','new_value','series_scope'];
      required:=array['purchase_id','field','new_value'];
    when 'delete_card_purchase' then allowed:=array['purchase_id','series_scope']; required:=allowed;
    when 'pay_invoice' then
      allowed:=array['card_id','invoice_month','account_id','payment_amount','remainder_mode','interest_value','interest_percent'];
      required:=array['card_id','invoice_month','account_id','payment_amount','remainder_mode'];
    when 'reverse_invoice_payment' then allowed:=array['transaction_id']; required:=allowed;
    else perform private.ai_fail('AI_UNSUPPORTED_ACTION');
  end case;
  perform private.ai_assert_allowed_keys(raw_payload,allowed);
  perform private.ai_require_keys(raw_payload,required);

  -- Defaults visuais/zerados são responsabilidade do servidor, não do modelo.
  if action_name='create_account' then
    if not normalized?'initial_balance' then normalized:=normalized||jsonb_build_object('initial_balance',0); end if;
    if not normalized?'color' then normalized:=normalized||jsonb_build_object('color','#2A9D8F'); end if;
  elsif action_name='create_category' then
    if not normalized?'color' then normalized:=normalized||jsonb_build_object('color','#6B7280'); end if;
    if not normalized?'icon' then normalized:=normalized||jsonb_build_object('icon','more-horiz'); end if;
  elsif action_name='create_goal' then
    if not normalized?'initial_balance' then normalized:=normalized||jsonb_build_object('initial_balance',0); end if;
    if not normalized?'color' then normalized:=normalized||jsonb_build_object('color','#2A9D8F'); end if;
    if not normalized?'icon' then normalized:=normalized||jsonb_build_object('icon','flag'); end if;
  elsif action_name='create_card' and not normalized?'color' then
    normalized:=normalized||jsonb_build_object('color','#457B9D');
  end if;

  foreach key_name in array array['account_id','destination_account_id','category_id','goal_id','card_id','transaction_id','purchase_id'] loop
    if raw_payload?key_name then
      normalized:=jsonb_set(normalized,array[key_name],to_jsonb(private.ai_id(raw_payload,key_name)),true);
    end if;
  end loop;
  foreach key_name in array array['initial_balance','target_amount','value','expected_value','realized_value','payment_amount','installment_value'] loop
    if raw_payload?key_name then
      numeric_value:=round(private.ai_number(raw_payload,key_name),2);
      if numeric_value<0 or (key_name not in ('initial_balance') and numeric_value<=0) then perform private.ai_fail('AI_INVALID_'||upper(key_name)); end if;
      if abs(numeric_value)>999999999999.99 then perform private.ai_fail('AI_INVALID_'||upper(key_name)); end if;
      normalized:=jsonb_set(normalized,array[key_name],to_jsonb(numeric_value),true);
    end if;
  end loop;
  foreach key_name in array array['scheduled_date','realization_date','target_date','purchase_date'] loop
    if raw_payload?key_name then normalized:=jsonb_set(normalized,array[key_name],to_jsonb(to_char(private.ai_date(raw_payload,key_name),'YYYY-MM-DD')),true); end if;
  end loop;
  if raw_payload?'name' then normalized:=jsonb_set(normalized,'{name}',to_jsonb(private.ai_text(raw_payload,'name',100)),true); end if;
  if raw_payload?'description' then normalized:=jsonb_set(normalized,'{description}',to_jsonb(private.ai_description(raw_payload,'description',100)),true); end if;
  if raw_payload?'color' then normalized:=jsonb_set(normalized,'{color}',to_jsonb(private.ai_color(raw_payload,'color')),true); end if;
  if raw_payload?'icon' then normalized:=jsonb_set(normalized,'{icon}',to_jsonb(private.ai_text(raw_payload,'icon',50)),true); end if;

  if raw_payload?'type' then
    text_value:=private.ai_choice(raw_payload,'type',array['receita','despesa']);
    normalized:=jsonb_set(normalized,'{type}',to_jsonb(text_value),true);
  end if;
  if raw_payload?'status' then
    text_value:=private.ai_choice(raw_payload,'status',array['pendente','paga']);
    normalized:=jsonb_set(normalized,'{status}',to_jsonb(text_value),true);
    if text_value='paga' and not raw_payload?'realization_date' then perform private.ai_fail('AI_REALIZATION_DATE_REQUIRED'); end if;
    if text_value='pendente' and raw_payload?'realization_date' then perform private.ai_fail('AI_REALIZATION_DATE_NOT_ALLOWED'); end if;
  end if;
  if raw_payload?'operation' then
    normalized:=jsonb_set(normalized,'{operation}',to_jsonb(private.ai_choice(raw_payload,'operation',array['guardar','resgatar'])),true);
  end if;
  if raw_payload?'frequency' then
    frequency_value:=private.ai_choice(raw_payload,'frequency',
      case when action_name='create_card_purchase' then array['unica','parcelada','mensal']
      when action_name='move_goal' then array['unica','semanal','mensal','anual']
      else array['unica','parcelada','semanal','mensal','anual'] end);
    normalized:=jsonb_set(normalized,'{frequency}',to_jsonb(frequency_value),true);
    if frequency_value='parcelada' then
      if not raw_payload?'installments' then perform private.ai_fail('AI_MISSING_INSTALLMENTS'); end if;
      -- Teto defensivo: 120 parcelas financeiras e 48 no cartão. O aplicativo
      -- atual não impõe teto às primeiras, mas o servidor não aceita escrita em
      -- massa sem limite.
      installments:=private.ai_integer(raw_payload,'installments',2,case when action_name='create_card_purchase' then 48 else 120 end);
      normalized:=jsonb_set(normalized,'{installments}',to_jsonb(installments),true);
      normalized:=normalized||jsonb_build_object('recurrence_count',installments);
    elsif frequency_value='unica' then
      if raw_payload?'installments'
         or (raw_payload?'recurrence_count' and private.ai_integer(raw_payload,'recurrence_count',1,1)<>1) then
        perform private.ai_fail('AI_SERIES_FIELDS_NOT_ALLOWED');
      end if;
      normalized:=normalized||jsonb_build_object('recurrence_count',1);
    else
      recurrence_count:=case when raw_payload?'recurrence_count'
        then private.ai_integer(raw_payload,'recurrence_count',2,
          case when action_name='create_card_purchase' then 60
            when frequency_value='semanal' then 260
            when frequency_value='mensal' then 60
            when frequency_value='anual' then 5
            else 120 end)
        -- Horizontes equivalentes ao app: 5 anos em qualquer frequência.
        else case frequency_value when 'weekly' then 260 when 'semanal' then 260
               when 'annual' then 5 when 'anual' then 5 else 60 end end;
      normalized:=jsonb_set(normalized,'{recurrence_count}',to_jsonb(recurrence_count),true);
      if raw_payload?'installments' then perform private.ai_fail('AI_INSTALLMENTS_NOT_ALLOWED'); end if;
    end if;
    if raw_payload?'installment_value' then
      if frequency_value<>'parcelada' then perform private.ai_fail('AI_INSTALLMENT_VALUE_NOT_ALLOWED'); end if;
      if abs((normalized->>'installment_value')::numeric*installments-(normalized->>'value')::numeric)>0.02 then
        perform private.ai_fail('AI_INSTALLMENT_TOTAL_MISMATCH');
      end if;
    end if;
  end if;
  if raw_payload?'recurrence_count' and not raw_payload?'frequency' then perform private.ai_fail('AI_RECURRENCE_WITHOUT_FREQUENCY'); end if;
  if action_name='move_goal' and not normalized?'frequency' then
    normalized:=normalized||jsonb_build_object('frequency','unica','recurrence_count',1);
  end if;
  if action_name='move_goal' then
    if (normalized->>'recurrence_count')::integer=1 and not normalized?'realization_date' then
      perform private.ai_fail('AI_REALIZATION_DATE_REQUIRED');
    elsif (normalized->>'recurrence_count')::integer>1 and (
      not normalized?'scheduled_date' or normalized?'realization_date'
    ) then perform private.ai_fail('AI_INVALID_GOAL_SERIES_DATES'); end if;
  end if;

  if raw_payload?'series_scope' then
    text_value:=private.ai_choice(raw_payload,'series_scope',
      case when action_name='delete_transaction' then array['one','current_and_future','open_series']
           when action_name='delete_card_purchase' then array['one','open_series']
           else array['one','open_series'] end);
    normalized:=jsonb_set(normalized,'{series_scope}',to_jsonb(text_value),true);
  end if;
  if action_name='update_card_purchase' and not normalized?'series_scope' then
    normalized:=normalized||jsonb_build_object('series_scope','one');
  end if;
  if raw_payload?'field' then
    field_name:=private.ai_text(raw_payload,'field',40);
    if (action_name='update_account' and field_name not in ('name','initial_balance','color'))
      or (action_name='update_category' and field_name not in ('name','color','icon'))
      or (action_name='update_goal' and field_name not in ('name','target_amount','color','icon','target_date'))
      or (action_name='update_transaction' and field_name not in ('description','value','scheduled_date','account_id','category_id'))
      or (action_name='update_card' and field_name not in ('name','value','color','due_day','closing_day'))
      or (action_name='update_card_purchase' and field_name not in ('description','category_id')) then
      perform private.ai_fail('AI_INVALID_FIELD');
    end if;
    normalized:=jsonb_set(normalized,'{field}',to_jsonb(field_name),true);
    if field_name in ('initial_balance','target_amount','value') then
      numeric_value:=round(private.ai_number(raw_payload,'new_value'),2);
      if numeric_value<0 or (field_name<>'initial_balance' and numeric_value<=0) then perform private.ai_fail('AI_INVALID_NEW_VALUE'); end if;
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(numeric_value),true);
    elsif field_name in ('account_id','category_id') then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_id(raw_payload,'new_value')),true);
    elsif field_name in ('due_day','closing_day') then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_integer(raw_payload,'new_value',1,31)),true);
    elsif field_name in ('scheduled_date','target_date') then
      if field_name='target_date' and lower(private.ai_text(raw_payload,'new_value',20)) in ('clear','null') then
        normalized:=jsonb_set(normalized,'{new_value}',to_jsonb('clear'::text),true);
      else
        normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(to_char(private.ai_date(raw_payload,'new_value'),'YYYY-MM-DD')),true);
      end if;
    elsif field_name='color' then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_color(raw_payload,'new_value')),true);
    elsif field_name='description' then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_description(raw_payload,'new_value',100)),true);
    elsif field_name='name' then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_text(raw_payload,'new_value',100)),true);
    else
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_text(raw_payload,'new_value',50)),true);
    end if;
  end if;

  if raw_payload?'interest_value' then
    numeric_value:=round(private.ai_number(raw_payload,'interest_value'),2);
    if action_name='pay_invoice' and numeric_value<0 then perform private.ai_fail('AI_INVALID_INTEREST'); end if;
    normalized:=jsonb_set(normalized,'{interest_value}',to_jsonb(numeric_value),true);
  end if;
  if raw_payload?'interest_percent' then
    numeric_value:=round(private.ai_number(raw_payload,'interest_percent'),4);
    if numeric_value<0 or numeric_value>1000 then perform private.ai_fail('AI_INVALID_INTEREST_PERCENT'); end if;
    normalized:=jsonb_set(normalized,'{interest_percent}',to_jsonb(numeric_value),true);
  end if;
  if raw_payload?'interest_value' and raw_payload?'interest_percent' then perform private.ai_fail('AI_MULTIPLE_INTEREST_MODES'); end if;
  if action_name='complete_transaction' then
    completion_total:=(normalized->>'expected_value')::numeric;
    if normalized?'interest_value' then
      if (normalized->>'interest_value')::numeric>completion_total
         or (normalized->>'interest_value')::numeric<=-completion_total then
        perform private.ai_fail('AI_INVALID_TRANSACTION_ADJUSTMENT');
      end if;
      completion_total:=round(completion_total+(normalized->>'interest_value')::numeric,2);
    elsif normalized?'interest_percent' then
      if (normalized->>'interest_percent')::numeric>100 then
        perform private.ai_fail('AI_INVALID_TRANSACTION_ADJUSTMENT');
      end if;
      completion_total:=round(completion_total*(1+(normalized->>'interest_percent')::numeric/100),2);
    end if;
    if completion_total<=0 or (normalized->>'realized_value')::numeric>completion_total then
      perform private.ai_fail('AI_INVALID_REALIZED_VALUE');
    end if;
  end if;
  if raw_payload?'invoice_month' then
    text_value:=private.ai_text(raw_payload,'invoice_month',7);
    if text_value!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then perform private.ai_fail('AI_INVALID_INVOICE_MONTH'); end if;
    normalized:=jsonb_set(normalized,'{invoice_month}',to_jsonb(text_value),true);
  end if;
  if raw_payload?'remainder_mode' then
    text_value:=private.ai_choice(raw_payload,'remainder_mode',array['full','keep_open','carry']);
    normalized:=jsonb_set(normalized,'{remainder_mode}',to_jsonb(text_value),true);
    if text_value<>'carry' and (raw_payload?'interest_value' or raw_payload?'interest_percent') then perform private.ai_fail('AI_INTEREST_NOT_APPLICABLE'); end if;
  end if;
  if raw_payload?'due_day' then normalized:=jsonb_set(normalized,'{due_day}',to_jsonb(private.ai_integer(raw_payload,'due_day',1,31)),true); end if;
  if raw_payload?'closing_day' then normalized:=jsonb_set(normalized,'{closing_day}',to_jsonb(private.ai_integer(raw_payload,'closing_day',1,31)),true); end if;

  if normalized?'realization_date'
     and (normalized->>'realization_date')::date > (clock_timestamp() at time zone 'America/Sao_Paulo')::date then
    perform private.ai_fail('AI_FUTURE_REALIZATION_DATE');
  end if;
  if action_name='create_goal' and (
    (normalized->>'target_amount')::numeric < 1
    or (normalized->>'initial_balance')::numeric > (normalized->>'target_amount')::numeric
  ) then perform private.ai_fail('AI_INVALID_GOAL_VALUES'); end if;

  -- Resolução de IDs e compatibilidade de domínio.
  if normalized?'account_id' then
    perform private.ai_assert_account(caller,(normalized->>'account_id')::bigint,
      action_name in ('update_account','archive_account','delete_account','reactivate_account'),
      action_name<>'reactivate_account');
    select nome into primary_name from public.contas where id=(normalized->>'account_id')::bigint;
  end if;
  if normalized?'destination_account_id' then
    perform private.ai_assert_account(caller,(normalized->>'destination_account_id')::bigint,false,true);
    if normalized->>'account_id'=normalized->>'destination_account_id' then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
    select nome into secondary_name from public.contas where id=(normalized->>'destination_account_id')::bigint;
  end if;
  if normalized?'goal_id' then
    perform private.ai_assert_goal(caller,(normalized->>'goal_id')::bigint,
      action_name in ('update_goal','archive_goal','delete_goal','reactivate_goal'),action_name<>'reactivate_goal');
    select nome into secondary_name from public.caixinhas where id=(normalized->>'goal_id')::bigint;
  end if;
  if normalized?'category_id' then
    perform private.ai_assert_category(caller,(normalized->>'category_id')::bigint,
      case when action_name='create_transaction' then normalized->>'type'
           when action_name in ('create_card_purchase','update_card_purchase') then 'despesa' else null end,
      action_name<>'reactivate_category');
    select nome into secondary_name from public.categorias where id=(normalized->>'category_id')::bigint;
  end if;
  if normalized?'transaction_id' then
    perform private.ai_assert_transaction(caller,(normalized->>'transaction_id')::bigint);
    select descricao into primary_name from public.transacoes where id=(normalized->>'transaction_id')::bigint;
  end if;
  if action_name in ('update_transaction','delete_transaction')
     and normalized->>'series_scope'<>'one'
     and primary_name !~ '\[Serie:[A-Za-z0-9_-]+\]' then
    legacy_descriptor:=private.ai_legacy_series_descriptor(primary_name);
    if legacy_descriptor->>'kind'='recorrente' then
      perform private.ai_fail('AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL');
    end if;
  end if;
  if normalized?'card_id' then
    perform private.ai_assert_card(caller,(normalized->>'card_id')::bigint,action_name<>'reactivate_card');
    select nome into primary_name from public.cartoes where id=(normalized->>'card_id')::bigint;
  end if;
  if normalized?'purchase_id' then
    perform private.ai_assert_card_item(caller,(normalized->>'purchase_id')::bigint);
    select descricao into primary_name from public.fatura_itens where id=(normalized->>'purchase_id')::bigint;
  end if;
  if action_name='update_transaction' and field_name='account_id' then perform private.ai_assert_account(caller,(normalized->>'new_value')::bigint,false,true); end if;
  if action_name='update_transaction' and field_name='category_id' then
    select tipo into text_value from public.transacoes where id=(normalized->>'transaction_id')::bigint;
    perform private.ai_assert_category(caller,(normalized->>'new_value')::bigint,text_value,true);
  end if;
  if action_name='update_card_purchase' and field_name='category_id' then perform private.ai_assert_category(caller,(normalized->>'new_value')::bigint,'despesa',true); end if;

  if action_name='pay_invoice' then
    select nome into secondary_name from public.contas where id=(normalized->>'account_id')::bigint;
    select coalesce(sum(valor),0) into invoice_total from public.fatura_itens
    where cartao_id=(normalized->>'card_id')::bigint and user_id=caller
      and mes_fatura=normalized->>'invoice_month' and not pago;
    if invoice_total<=0 then perform private.ai_fail('AI_INVOICE_ALREADY_SETTLED'); end if;
    if (normalized->>'payment_amount')::numeric>invoice_total then perform private.ai_fail('AI_PAYMENT_ABOVE_INVOICE'); end if;
    if normalized->>'remainder_mode'='full' and (normalized->>'payment_amount')::numeric<>invoice_total then perform private.ai_fail('AI_TOTAL_PAYMENT_MISMATCH'); end if;
    if normalized->>'remainder_mode'<>'full' and (normalized->>'payment_amount')::numeric>=invoice_total then perform private.ai_fail('AI_PARTIAL_PAYMENT_MISMATCH'); end if;
    if normalized->>'remainder_mode'='carry' and not (normalized?'interest_value' or normalized?'interest_percent') then normalized:=normalized||jsonb_build_object('interest_value',0); end if;
  end if;

  title:=case
    when action_name like 'create_%' then 'Confirmar criação'
    when action_name like 'update_%' then 'Confirmar alteração'
    when action_name like 'delete_%' then 'Confirmar exclusão'
    when action_name like 'archive_%' then 'Confirmar arquivamento'
    when action_name like 'reactivate_%' then 'Confirmar reativação'
    when action_name='pay_invoice' then 'Confirmar pagamento da fatura'
    when action_name='reverse_invoice_payment' then 'Confirmar estorno da fatura'
    when action_name='complete_transaction' then 'Confirmar realização'
    when action_name='reopen_transaction' then 'Voltar para pendente'
    else 'Confirmar movimentação financeira' end;
  summary:=case
    when action_name='create_account' then format('Criar a conta %s com saldo inicial de R$ %s.',normalized->>'name',normalized->>'initial_balance')
    when action_name='create_category' then format('Criar a categoria %s.',normalized->>'name')
    when action_name='create_goal' then format('Criar o objetivo %s com R$ %s.',normalized->>'name',normalized->>'initial_balance')
    when action_name='create_card' then format('Criar o cartão %s com limite de R$ %s.',normalized->>'name',normalized->>'value')
    when action_name='create_transaction' then format('Lançar %s de R$ %s em %s%s.',normalized->>'type',normalized->>'value',primary_name,case when (normalized->>'recurrence_count')::integer>1 then format(' (%s ocorrências)',normalized->>'recurrence_count') else '' end)
    when action_name='transfer_between_accounts' then format('Transferir R$ %s de %s para %s%s.',normalized->>'value',primary_name,secondary_name,case when (normalized->>'recurrence_count')::integer>1 then format(' (%s ocorrências)',normalized->>'recurrence_count') else '' end)
    when action_name='move_goal' then format('%s R$ %s no objetivo %s usando %s%s.',initcap(normalized->>'operation'),normalized->>'value',secondary_name,primary_name,
      case when (normalized->>'recurrence_count')::integer>1 then format(' em %s ocorrências a partir de %s',normalized->>'recurrence_count',normalized->>'scheduled_date')
      else format(' em %s',normalized->>'realization_date') end)
    when action_name='create_card_purchase' then format('Adicionar %s cobrança(s) de R$ %s ao cartão %s.',normalized->>'recurrence_count',normalized->>'value',primary_name)
    when action_name='pay_invoice' then format('Pagar R$ %s da fatura %s do cartão %s usando %s.',normalized->>'payment_amount',normalized->>'invoice_month',primary_name,secondary_name)
    when action_name in ('update_account','update_category','update_goal','update_card') then
      format('Alterar %s de %s para %s.',normalized->>'field',coalesce(primary_name,secondary_name),
        case when normalized->>'new_value'='clear' then 'sem data' else normalized->>'new_value' end)
    when action_name='update_transaction' then
      format('Alterar %s para %s em %s (%s).',normalized->>'field',normalized->>'new_value',primary_name,
        case normalized->>'series_scope' when 'open_series' then 'todos os itens pendentes da série' else 'somente este lançamento' end)
    when action_name='delete_transaction' then
      format('Excluir %s (%s).',primary_name,case normalized->>'series_scope'
        when 'open_series' then 'todos os itens pendentes da série'
        when 'current_and_future' then 'este e os próximos itens pendentes'
        else 'somente este lançamento' end)
    when action_name='complete_transaction' then
      format('Concluir %s, previsto em R$ %s, com R$ %s efetivamente realizado na data %s%s.',primary_name,normalized->>'expected_value',normalized->>'realized_value',normalized->>'realization_date',
        case when normalized?'interest_value' then format(' com ajuste de R$ %s',normalized->>'interest_value')
          when normalized?'interest_percent' then format(' com ajuste de %s%%',normalized->>'interest_percent') else '' end)
    when action_name='reopen_transaction' then format('Reabrir %s como pendente e remover sua data de realização.',primary_name)
    when action_name='update_card_purchase' then
      format('Alterar %s para %s em %s (%s).',normalized->>'field',normalized->>'new_value',primary_name,
        case normalized->>'series_scope' when 'open_series' then 'todas as cobranças abertas da série' else 'somente esta cobrança' end)
    when action_name='delete_card_purchase' then
      format('Excluir %s (%s).',primary_name,case normalized->>'series_scope'
        when 'open_series' then 'todas as cobranças abertas da série' else 'somente esta cobrança' end)
    when action_name='reverse_invoice_payment' then format('Estornar o pagamento %s e restaurar somente os itens ligados a ele.',primary_name)
    when action_name like 'delete_%' then format('Excluir %s conforme as regras de preservação de histórico.',coalesce(primary_name,secondary_name))
    when action_name like 'archive_%' then format('Arquivar %s sem apagar seu histórico.',coalesce(primary_name,secondary_name))
    when action_name like 'reactivate_%' then format('Reativar %s respeitando o limite do plano.',coalesce(primary_name,secondary_name))
    else format('%s: %s.',replace(action_name,'_',' '),coalesce(primary_name,secondary_name,'dados informados')) end;
  if action_name like 'delete_%' or action_name='reverse_invoice_payment' then consequences:=consequences||jsonb_build_array('A operação pode remover dados financeiros e será auditada.'); end if;
  if coalesce((normalized->>'recurrence_count')::integer,1)>1 or normalized->>'series_scope'<>'one' then consequences:=consequences||jsonb_build_array('A ação afeta múltiplos lançamentos da mesma série.'); end if;
  if action_name in ('complete_transaction','reopen_transaction','move_goal','pay_invoice','reverse_invoice_payment') then consequences:=consequences||jsonb_build_array('Saldos e indicadores serão atualizados conforme a data realizada.'); end if;
  if action_name='delete_account' then consequences:=consequences||jsonb_build_array('A conta só será excluída se não tiver lançamentos; caso contrário, será arquivada.'); end if;
  if action_name='delete_category' then consequences:=consequences||jsonb_build_array('Se houver lançamentos ou compras vinculados, a categoria será arquivada e os vínculos serão preservados.'); end if;
  if action_name='delete_goal' then consequences:=consequences||jsonb_build_array('O objetivo só será excluído com saldo zero e sem agendamentos pendentes; caso contrário, será arquivado. Movimentos concluídos permanecem descritos no histórico.'); end if;
  if action_name='delete_card' then consequences:=consequences||jsonb_build_array('O cartão só será excluído sem compras; caso contrário, será arquivado.'); end if;
  if normalized->>'remainder_mode'='carry' then consequences:=consequences||jsonb_build_array('O saldo restante e os juros irão para a próxima fatura.'); end if;
  if consequences='[]'::jsonb then consequences:=jsonb_build_array('A alteração será aplicada imediatamente após a confirmação.'); end if;
  return jsonb_build_object('payload',normalized,'preview',jsonb_build_object('title',title,'summary',summary,'consequences',consequences));
end;
$$;

revoke all on function private.ai_prepare_action(uuid,text,jsonb) from public, anon, authenticated;

-- Captura o estado efetivamente editado por uma proposta. Na confirmação,
-- p_lock=true bloqueia as mesmas linhas antes de recalcular o hash; os locks
-- permanecem até o fim da transação e fecham a janela entre comparação e
-- execução. Criações puras não sobrescrevem estado e, portanto, são isentas.
create or replace function private.ai_action_state_fingerprint(
  caller uuid,
  action_name text,
  payload jsonb,
  p_lock boolean
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  resource_id bigint;
  scope_value text;
  group_id bigint;
  resource_card_id bigint;
  marker text[];
  target_ids bigint[] := '{}';
  row_state jsonb;
  related_state jsonb;
  state_snapshot jsonb;
  transaction_row record;
  item_row record;
  reference_row record;
  card_row record;
  ledger_row record;
  ledger_found boolean := false;
  item_found boolean := false;
begin
  if caller is null or caller is distinct from (select auth.uid()) then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;

  if action_name=any(array[
    'create_account','create_category','create_goal','create_transaction',
    'transfer_between_accounts','create_card','create_card_purchase'
  ]) then
    return null;
  end if;

  if action_name=any(array['update_account','archive_account','delete_account','reactivate_account']) then
    resource_id:=(payload->>'account_id')::bigint;
    if p_lock then
      perform 1 from public.contas c where c.id=resource_id and c.user_id=caller for update;
    end if;
    select to_jsonb(c) into row_state from public.contas c
    where c.id=resource_id and c.user_id=caller;
    state_snapshot:=jsonb_build_object('kind','account','row',coalesce(row_state,'null'::jsonb));

  elsif action_name=any(array['update_category','archive_category','delete_category','reactivate_category']) then
    resource_id:=(payload->>'category_id')::bigint;
    if p_lock then
      perform 1 from public.categorias c where c.id=resource_id and c.user_id=caller for update;
    end if;
    select to_jsonb(c) into row_state from public.categorias c
    where c.id=resource_id and c.user_id=caller;
    state_snapshot:=jsonb_build_object('kind','category','row',coalesce(row_state,'null'::jsonb));

  elsif action_name=any(array['update_goal','archive_goal','delete_goal','reactivate_goal']) then
    resource_id:=(payload->>'goal_id')::bigint;
    if p_lock then
      perform 1 from public.caixinhas g where g.id=resource_id and g.user_id=caller for update;
    end if;
    select to_jsonb(g) into row_state from public.caixinhas g
    where g.id=resource_id and g.user_id=caller;
    state_snapshot:=jsonb_build_object('kind','goal','row',coalesce(row_state,'null'::jsonb));

  elsif action_name=any(array['update_card','archive_card','delete_card','reactivate_card']) then
    resource_id:=(payload->>'card_id')::bigint;
    if p_lock then
      perform 1 from public.cartoes c where c.id=resource_id and c.user_id=caller for update;
    end if;
    select to_jsonb(c) into row_state from public.cartoes c
    where c.id=resource_id and c.user_id=caller;
    state_snapshot:=jsonb_build_object('kind','card','row',coalesce(row_state,'null'::jsonb));

  elsif action_name='move_goal' then
    -- Mesma ordem do executor: parceria, conta e então objetivo. Os helpers
    -- revalidam autorização/ativo depois dos locks também na criação da prévia.
    perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
    perform private.ai_lock_goal(caller,(payload->>'goal_id')::bigint,false,true);
    select to_jsonb(c) into row_state from public.contas c
    where c.id=(payload->>'account_id')::bigint
      and private.ai_can_access_account(caller,c.id,false);
    select to_jsonb(g) into related_state from public.caixinhas g
    where g.id=(payload->>'goal_id')::bigint
      and private.ai_can_access_goal(caller,g.id,false);
    state_snapshot:=jsonb_build_object(
      'kind','goal_movement','account',coalesce(row_state,'null'::jsonb),
      'goal',coalesce(related_state,'null'::jsonb)
    );

  elsif action_name=any(array[
    'update_transaction','delete_transaction','complete_transaction','reopen_transaction'
  ]) then
    resource_id:=(payload->>'transaction_id')::bigint;
    -- Lê primeiro apenas para resolver o conjunto. O lock vem depois, sempre
    -- em ordem de id, evitando deadlock quando duas confirmações partem de
    -- itens diferentes da mesma série.
    select t.* into transaction_row from public.transacoes t where t.id=resource_id;

    if not found then
      state_snapshot:=jsonb_build_object('kind','transaction','rows','[]'::jsonb);
    else
      perform private.ai_lock_account(caller,transaction_row.conta_id,false,
        action_name='complete_transaction');
      perform private.ai_assert_transaction(caller,resource_id);
      target_ids:=array[resource_id];
      scope_value:=coalesce(payload->>'series_scope','one');
      if action_name in ('update_transaction','delete_transaction') and scope_value<>'one' then
        marker:=regexp_match(transaction_row.descricao,'\[Serie:([A-Za-z0-9_-]+)\]');
        if marker is not null then
          select coalesce(array_agg(t.id order by t.id),'{}') into target_ids
          from public.transacoes t
          where position('[Serie:'||marker[1]||']' in t.descricao)>0
            and t.status<>'paga'
            and (
              t.user_id=caller
              or exists(
                select 1 from public.contas c
                where c.id=t.conta_id and coalesce(c.compartilhado,false)
                  and public.is_parceiro(c.user_id,caller)
              )
            )
            and (scope_value<>'current_and_future'
              or t.data_vencimento>=transaction_row.data_vencimento);
        else
          target_ids:=coalesce(private.ai_legacy_series_ids(caller,resource_id),'{}');
          if scope_value='current_and_future' then
            select coalesce(array_agg(t.id order by t.id),'{}') into target_ids
            from public.transacoes t
            where t.id=any(target_ids) and t.status<>'paga'
              and t.data_vencimento>=transaction_row.data_vencimento;
          end if;
        end if;
      end if;
      for reference_row in
        select distinct t.conta_id from public.transacoes t
        where t.id=any(target_ids) order by t.conta_id
      loop
        perform private.ai_lock_account(caller,reference_row.conta_id,false,
          action_name='complete_transaction');
      end loop;
      if p_lock and cardinality(target_ids)>0 then
        perform 1 from public.transacoes t
        where t.id=any(target_ids)
        order by t.id for update;
      end if;
      select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)
      into row_state
      from public.transacoes t where t.id=any(target_ids);
      state_snapshot:=jsonb_build_object('kind','transaction','rows',row_state);
    end if;

  elsif action_name=any(array['update_card_purchase','delete_card_purchase']) then
    resource_id:=(payload->>'purchase_id')::bigint;
    select i.* into item_row from public.fatura_itens i
    where i.id=resource_id and i.user_id=caller;
    item_found:=found;
    if item_found then
      resource_card_id:=item_row.cartao_id;
      perform private.ai_lock_card(caller,resource_card_id,true);
      -- Cartão antes dos itens: a mesma ordem usada por pagamento de fatura e
      -- exclusão/edição do cartão.
      if p_lock then
        select c.* into card_row from public.cartoes c
        where c.id=resource_card_id and c.user_id=caller for update;
        select i.* into item_row from public.fatura_itens i
        where i.id=resource_id and i.user_id=caller for update;
        item_found:=found and item_row.cartao_id=resource_card_id;
      else
        select c.* into card_row from public.cartoes c
        where c.id=resource_card_id and c.user_id=caller;
      end if;
    end if;
    if not item_found then
      state_snapshot:=jsonb_build_object('kind','card_purchase','card','null'::jsonb,'rows','[]'::jsonb);
    else
      target_ids:=array[resource_id];
      scope_value:=coalesce(payload->>'series_scope','one');
      if scope_value='open_series' then
        group_id:=coalesce(item_row.grupo_parcela_id,item_row.id);
        select coalesce(array_agg(i.id order by i.id),'{}') into target_ids
        from public.fatura_itens i
        where i.user_id=caller and coalesce(i.grupo_parcela_id,i.id)=group_id
          and not i.pago;
      end if;
      if p_lock and cardinality(target_ids)>0 then
        perform 1 from public.fatura_itens i
        where i.id=any(target_ids) order by i.id for update;
      end if;
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'row',to_jsonb(i),
          'invoice_closed',private.ai_invoice_is_closed(i.mes_fatura,card_row.dia_fechamento)
        ) order by i.id
      ),'[]'::jsonb) into row_state
      from public.fatura_itens i where i.id=any(target_ids);
      state_snapshot:=jsonb_build_object(
        'kind','card_purchase','card',to_jsonb(card_row),'rows',row_state
      );
    end if;

  elsif action_name='pay_invoice' then
    resource_id:=(payload->>'card_id')::bigint;
    perform private.ai_lock_card(caller,resource_id,true);
    perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
    select c.* into card_row from public.cartoes c
    where c.id=resource_id and c.user_id=caller and coalesce(c.ativo,true);
    select to_jsonb(c) into related_state from public.contas c
    where c.id=(payload->>'account_id')::bigint;
    select coalesce(array_agg(i.id order by i.id),'{}') into target_ids
    from public.fatura_itens i
    where i.card_id=resource_id and i.user_id=caller
      and i.mes_fatura=payload->>'invoice_month';
    if p_lock and cardinality(target_ids)>0 then
      perform 1 from public.fatura_itens i
      where i.id=any(target_ids) order by i.id for update;
    end if;
    select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb)
    into row_state from public.fatura_itens i where i.id=any(target_ids);
    state_snapshot:=jsonb_build_object(
      'kind','invoice','card',case when card_row is null then 'null'::jsonb else to_jsonb(card_row) end,
      'account',coalesce(related_state,'null'::jsonb),'items',row_state
    );

  elsif action_name='reverse_invoice_payment' then
    resource_id:=(payload->>'transaction_id')::bigint;
    if p_lock then
      select t.* into transaction_row from public.transacoes t
      where t.id=resource_id and t.user_id=caller for update;
      select l.* into ledger_row from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=resource_id and l.user_id=caller for update;
      ledger_found:=found;
    else
      select t.* into transaction_row from public.transacoes t
      where t.id=resource_id and t.user_id=caller;
      select l.* into ledger_row from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=resource_id and l.user_id=caller;
      ledger_found:=found;
    end if;
    if ledger_found then
      target_ids:=coalesce(ledger_row.paid_item_ids,'{}');
      if ledger_row.linked_item_id is not null then
        target_ids:=array_append(target_ids,ledger_row.linked_item_id);
      end if;
      if p_lock and cardinality(target_ids)>0 then
        perform 1 from public.fatura_itens i
        where i.id=any(target_ids) order by i.id for update;
      end if;
      select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb)
      into related_state from public.fatura_itens i where i.id=any(target_ids);
    else
      related_state:='[]'::jsonb;
    end if;
    state_snapshot:=jsonb_build_object(
      'kind','invoice_payment',
      'transaction',case when transaction_row is null then 'null'::jsonb else to_jsonb(transaction_row) end,
      'ledger',case when ledger_row is null then 'null'::jsonb else to_jsonb(ledger_row) end,
      'items',related_state
    );

  else
    perform private.ai_fail('AI_STATE_GUARD_UNSUPPORTED');
  end if;

  return encode(extensions.digest(
    convert_to(jsonb_build_array('finflow-ai-state-v1',action_name,state_snapshot)::text,'UTF8'),
    'sha256'
  ),'hex');
end;
$$;

revoke all on function private.ai_action_state_fingerprint(uuid,text,jsonb,boolean)
  from public, anon, authenticated;

create or replace function private.ai_execute_financial_action(
  caller uuid,
  action_name text,
  payload jsonb,
  pending_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prepared jsonb;
  normalized jsonb;
begin
  -- O consumidor já comparou o fingerprint sob locks das linhas-alvo. Ainda
  -- assim, revalidamos formato, referências e regras derivadas imediatamente
  -- antes do DML: completar exige expected_value, faturas exigem ledger e
  -- limites/referências podem produzir um erro de domínio em vez de forçar uma
  -- proposta que deixou de ser aplicável.
  prepared:=private.ai_prepare_action(caller,action_name,payload);
  normalized:=prepared->'payload';
  if action_name=any(array[
    'create_account','update_account','archive_account','delete_account','reactivate_account',
    'create_category','update_category','archive_category','delete_category','reactivate_category',
    'create_goal','update_goal','archive_goal','delete_goal','reactivate_goal',
    'create_card','update_card','archive_card','delete_card','reactivate_card'
  ]) then
    return private.ai_execute_resource_action(caller,action_name,normalized);
  elsif action_name=any(array[
    'move_goal','create_transaction','update_transaction','delete_transaction',
    'complete_transaction','reopen_transaction','transfer_between_accounts'
  ]) then
    return private.ai_execute_transaction_action(caller,action_name,normalized);
  elsif action_name=any(array[
    'create_card_purchase','update_card_purchase','delete_card_purchase',
    'pay_invoice','reverse_invoice_payment'
  ]) then
    return private.ai_execute_card_action(caller,action_name,normalized,pending_action_id);
  end if;
  perform private.ai_fail('AI_UNSUPPORTED_ACTION');
  return null;
end;
$$;

create or replace function private.ai_expire_actions(caller uuid, only_action uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare expired_count integer;
begin
  with expired as (
    update public.ai_pending_actions a
    set status='expired',last_error_code='AI_ACTION_EXPIRED'
    where a.user_id=caller and a.status='pending' and a.expires_at<=clock_timestamp()
      and (only_action is null or a.id=only_action)
    returning a.*
  )
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
  )
  select id,user_id,action_type,'expired',payload,'AI_ACTION_EXPIRED',idempotency_key from expired;
  get diagnostics expired_count=row_count;
  return expired_count;
end;
$$;

revoke all on function private.ai_execute_financial_action(uuid,text,jsonb,uuid) from public, anon, authenticated;
revoke all on function private.ai_expire_actions(uuid,uuid) from public, anon, authenticated;

create or replace function public.ai_get_action_quota()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare caller uuid:=private.ai_assert_authenticated();
begin
  return private.ai_action_quota(caller);
end;
$$;

create or replace function public.ai_reserve_model_request(
  p_limit integer default 30,
  p_window_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  effective_limit integer:=least(greatest(coalesce(p_limit,30),1),120);
  effective_window integer:=least(greatest(coalesce(p_window_seconds,60),60),3600);
  now_at timestamptz:=clock_timestamp();
  used_count integer;
  oldest_at timestamptz;
  retry_after integer:=0;
begin
  perform pg_advisory_xact_lock(hashtext(caller::text),61001);
  -- O maior intervalo aceito é uma hora; um dia preserva margem de auditoria
  -- operacional sem deixar esta tabela crescer indefinidamente por usuário.
  delete from public.ai_request_usage
  where user_id=caller and created_at<now_at-interval '1 day';
  select count(*),min(created_at) into used_count,oldest_at
  from public.ai_request_usage
  where user_id=caller and created_at>now_at-make_interval(secs=>effective_window);
  if used_count>=effective_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      oldest_at+make_interval(secs=>effective_window)-now_at
    )))::integer);
    return jsonb_build_object('allowed',false,'limit',effective_limit,'used',used_count,
      'remaining',0,'window_seconds',effective_window,'retry_after',retry_after);
  end if;
  insert into public.ai_request_usage(user_id,created_at) values(caller,now_at);
  used_count:=used_count+1;
  return jsonb_build_object('allowed',true,'limit',effective_limit,'used',used_count,
    'remaining',greatest(effective_limit-used_count,0),'window_seconds',effective_window,'retry_after',0);
end;
$$;

create or replace function public.ai_consume_analytical_action(
  p_intent text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  entitlement record;
  quota jsonb;
  existing_id bigint;
  existing_intent text;
begin
  if p_intent not in ('category_analysis','budget_analysis','financial_projection') then
    perform private.ai_fail('AI_INVALID_ANALYTICAL_INTENT');
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 200
     or p_idempotency_key!~'^[A-Za-z0-9:_-]+$' then perform private.ai_fail('AI_INVALID_IDEMPOTENCY_KEY'); end if;
  perform pg_advisory_xact_lock(hashtext(caller::text),61002);
  select id,action_type into existing_id,existing_intent from public.ai_action_audit
  where user_id=caller and action_id is null and event_type='succeeded'
    and idempotency_key=p_idempotency_key;
  if found then
    if existing_intent<>p_intent then perform private.ai_fail('AI_IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('ok',true,'intent',p_intent,'consumed',false,'replayed',true,
      'audit_id',existing_id,'quota',private.ai_action_quota(caller));
  end if;
  select * into entitlement from public.get_my_entitlement();
  if coalesce(entitlement.limits_enabled,false) and entitlement.plan<>'premium' then
    return jsonb_build_object('ok',false,'error_code','AI_ANALYTICS_PLAN_REQUIRED');
  end if;
  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    return jsonb_build_object('ok',false,'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota);
  end if;
  insert into public.ai_action_audit(
    user_id,action_type,event_type,payload_snapshot,result,idempotency_key
  ) values(
    caller,p_intent,'succeeded',jsonb_build_object('intent',p_intent),
    jsonb_build_object('analytical_action',true),p_idempotency_key
  ) returning id into existing_id;
  return jsonb_build_object('ok',true,'intent',p_intent,'consumed',true,'replayed',false,
    'audit_id',existing_id,'quota',private.ai_action_quota(caller));
end;
$$;

create or replace function public.ai_create_pending_action(
  p_action_type text,
  p_payload jsonb,
  p_idempotency_key text,
  p_ttl_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  existing public.ai_pending_actions%rowtype;
  created public.ai_pending_actions%rowtype;
  prepared jsonb;
  normalized jsonb;
  server_preview jsonb;
  request_hash text;
  state_fingerprint text;
  verified_state_fingerprint text;
  quota jsonb;
  pending_count integer;
  recent_created_count integer;
  now_at timestamptz:=clock_timestamp();
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>16384 then
    perform private.ai_fail('AI_INVALID_PAYLOAD');
  end if;
  if p_action_type is null or length(p_action_type)>80 then perform private.ai_fail('AI_UNSUPPORTED_ACTION'); end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 200
     or p_idempotency_key!~'^[A-Za-z0-9:_-]+$' then perform private.ai_fail('AI_INVALID_IDEMPOTENCY_KEY'); end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 1800 then perform private.ai_fail('AI_INVALID_TTL'); end if;
  request_hash:=encode(extensions.digest(
    convert_to(jsonb_build_array(p_action_type,p_payload)::text,'UTF8'),
    'sha256'
  ),'hex');

  -- Serializa replay, limite de 10 pendências e 60 propostas/hora. Sem este
  -- lock, chamadas paralelas com chaves distintas ultrapassariam os tetos.
  perform pg_advisory_xact_lock(hashtext(caller::text),61003);
  select * into existing from public.ai_pending_actions
  where user_id=caller and idempotency_key=p_idempotency_key;
  if found then
    if existing.action_type<>p_action_type or existing.payload_hash<>request_hash then
      perform private.ai_fail('AI_IDEMPOTENCY_CONFLICT');
    end if;
    perform private.ai_expire_actions(caller,existing.id);
    select * into existing from public.ai_pending_actions where id=existing.id;
    insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,
      result,idempotency_key)
    values(existing.id,caller,existing.action_type,'replayed',existing.payload,
      jsonb_build_object('status',existing.status),existing.idempotency_key);
    return jsonb_build_object('ok',true,'id',existing.id,'action_type',existing.action_type,
      'payload',existing.payload,'preview',existing.preview,'status',existing.status,
      'expires_at',existing.expires_at,'confirmation_token',existing.confirmation_token,
      'created_at',existing.created_at,'replayed',true);
  end if;

  perform private.ai_expire_actions(caller,null);
  select count(*) into pending_count from public.ai_pending_actions
  where user_id=caller and status='pending';
  if pending_count>=10 then
    return jsonb_build_object('ok',false,'error_code','AI_TOO_MANY_PENDING_ACTIONS','pending_limit',10);
  end if;
  select count(*) into recent_created_count from public.ai_action_audit
  where user_id=caller and event_type='created' and created_at>=clock_timestamp()-interval '1 hour';
  if recent_created_count>=60 then
    return jsonb_build_object('ok',false,'error_code','AI_PROPOSAL_RATE_LIMITED','retry_after',3600);
  end if;

  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    insert into public.ai_action_audit(user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key)
    values(caller,p_action_type,'quota_rejected',p_payload,'AI_DAILY_QUOTA_EXCEEDED',p_idempotency_key);
    return jsonb_build_object('ok',false,'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota);
  end if;

  prepared:=private.ai_prepare_action(caller,p_action_type,p_payload);
  normalized:=prepared->'payload'; server_preview:=prepared->'preview';
  state_fingerprint:=private.ai_action_state_fingerprint(
    caller,p_action_type,normalized,false
  );
  if state_fingerprint is not null then
    -- Gera novamente a prévia entre duas leituras do estado. Assim, uma
    -- alteração concorrente durante a própria criação da proposta não produz
    -- texto antigo associado ao hash novo.
    prepared:=private.ai_prepare_action(caller,p_action_type,normalized);
    normalized:=prepared->'payload'; server_preview:=prepared->'preview';
    verified_state_fingerprint:=private.ai_action_state_fingerprint(
      caller,p_action_type,normalized,false
    );
    if verified_state_fingerprint is distinct from state_fingerprint then
      return jsonb_build_object('ok',false,'error_code','AI_ACTION_STATE_CHANGED');
    end if;
    state_fingerprint:=verified_state_fingerprint;
  end if;
  insert into public.ai_pending_actions(
    user_id,action_type,payload,payload_hash,state_fingerprint,preview,idempotency_key,
    confirmation_token,status,expires_at,created_at,updated_at
  ) values(
    caller,p_action_type,normalized,request_hash,state_fingerprint,server_preview,p_idempotency_key,
    gen_random_uuid(),'pending',now_at+make_interval(secs=>p_ttl_seconds),now_at,now_at
  ) on conflict(user_id,idempotency_key) do nothing
  returning * into created;
  if not found then
    select * into existing from public.ai_pending_actions
    where user_id=caller and idempotency_key=p_idempotency_key;
    if existing.action_type<>p_action_type or existing.payload_hash<>request_hash then
      perform private.ai_fail('AI_IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object('ok',true,'id',existing.id,'action_type',existing.action_type,
      'payload',existing.payload,'preview',existing.preview,'status',existing.status,
      'expires_at',existing.expires_at,'confirmation_token',existing.confirmation_token,
      'created_at',existing.created_at,'replayed',true);
  end if;
  insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key)
  values(created.id,caller,created.action_type,'created',created.payload,created.idempotency_key);
  return jsonb_build_object('ok',true,'id',created.id,'action_type',created.action_type,
    'payload',created.payload,'preview',created.preview,'status',created.status,
    'expires_at',created.expires_at,'confirmation_token',created.confirmation_token,
    'created_at',created.created_at,'replayed',false);
end;
$$;

create or replace function public.ai_get_pending_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid:=private.ai_assert_authenticated(); action_row public.ai_pending_actions%rowtype;
begin
  perform private.ai_expire_actions(caller,p_action_id);
  select * into action_row from public.ai_pending_actions where id=p_action_id and user_id=caller;
  if not found then return jsonb_build_object('ok',false,'error_code','AI_ACTION_NOT_FOUND'); end if;
  return jsonb_build_object('ok',true,'id',action_row.id,'action_type',action_row.action_type,
    'payload',action_row.payload,'preview',action_row.preview,'status',action_row.status,
    'expires_at',action_row.expires_at,'created_at',action_row.created_at,
    'executed_at',action_row.executed_at,'cancelled_at',action_row.cancelled_at,
    'result',action_row.result,'error_code',action_row.last_error_code);
end;
$$;

create or replace function public.ai_list_pending_actions(
  p_limit integer default 20,
  p_include_terminal boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid:=private.ai_assert_authenticated(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then perform private.ai_fail('AI_INVALID_LIMIT'); end if;
  perform private.ai_expire_actions(caller,null);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'action_type',x.action_type,'payload',x.payload,'preview',x.preview,
    'status',x.status,'expires_at',x.expires_at,'created_at',x.created_at,
    'executed_at',x.executed_at,'cancelled_at',x.cancelled_at,
    'result',x.result,'error_code',x.last_error_code
  ) order by x.created_at desc),'[]'::jsonb) into result
  from (
    select * from public.ai_pending_actions a
    where a.user_id=caller and (p_include_terminal or a.status='pending')
    order by a.created_at desc limit p_limit
  ) x;
  return result;
end;
$$;

create or replace function public.ai_cancel_pending_action(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare caller uuid:=private.ai_assert_authenticated(); action_row public.ai_pending_actions%rowtype;
begin
  perform private.ai_expire_actions(caller,p_action_id);
  select * into action_row from public.ai_pending_actions
    where id=p_action_id and user_id=caller for update;
  if not found then return jsonb_build_object('ok',false,'error_code','AI_ACTION_NOT_FOUND'); end if;
  if action_row.status='cancelled' then
    return jsonb_build_object('ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','cancelled','cancelled_at',action_row.cancelled_at,'replayed',true);
  end if;
  if action_row.status<>'pending' then
    return jsonb_build_object('ok',false,'action_id',action_row.id,'status',action_row.status,
      'error_code',case action_row.status when 'expired' then 'AI_ACTION_EXPIRED' else 'AI_ACTION_NOT_CANCELLABLE' end);
  end if;
  update public.ai_pending_actions set status='cancelled',cancelled_at=clock_timestamp(),
    last_error_code=null where id=action_row.id returning * into action_row;
  insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key)
  values(action_row.id,caller,action_row.action_type,'cancelled',action_row.payload,action_row.idempotency_key);
  return jsonb_build_object('ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
    'status','cancelled','cancelled_at',action_row.cancelled_at,'replayed',false);
end;
$$;

create or replace function public.ai_consume_pending_action(
  p_action_id uuid,
  p_confirmation_token uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  action_row public.ai_pending_actions%rowtype;
  execution_result jsonb;
  quota jsonb;
  error_message text;
  safe_error text;
  current_state_fingerprint text;
begin
  perform private.ai_expire_actions(caller,p_action_id);
  select * into action_row from public.ai_pending_actions
  where id=p_action_id and user_id=caller for update;
  if not found or action_row.confirmation_token is distinct from p_confirmation_token then
    return jsonb_build_object('ok',false,'error_code','AI_ACTION_NOT_FOUND');
  end if;
  if action_row.status='succeeded' then
    insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,result,idempotency_key)
    values(action_row.id,caller,action_row.action_type,'replayed',action_row.payload,action_row.result,action_row.idempotency_key);
    return jsonb_build_object('ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','succeeded','result',action_row.result,'replayed',true);
  end if;
  if action_row.status<>'pending' then
    return jsonb_build_object('ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
      'status',action_row.status,'error_code',coalesce(action_row.last_error_code,
        case action_row.status when 'expired' then 'AI_ACTION_EXPIRED'
          when 'cancelled' then 'AI_ACTION_CANCELLED' else 'AI_ACTION_NOT_EXECUTABLE' end),
      'replayed',coalesce(action_row.last_error_code='AI_ACTION_STATE_CHANGED',false));
  end if;

  -- Serializa confirmação e contagem diária do mesmo usuário.
  perform pg_advisory_xact_lock(hashtext(caller::text),61002);
  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key)
    values(action_row.id,caller,action_row.action_type,'quota_rejected',action_row.payload,
      'AI_DAILY_QUOTA_EXCEEDED',action_row.idempotency_key);
    return jsonb_build_object('ok',false,'action_id',action_row.id,'status','pending',
      'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota,'replayed',false);
  end if;

  -- Recalcula sob lock antes de mudar o status para executing. Se qualquer
  -- linha-alvo mudou desde a prévia, a proposta fica terminal e precisa ser
  -- recriada; ela não consome cota e nenhuma escrita financeira é aplicada.
  if action_row.state_fingerprint is not null then
    begin
      current_state_fingerprint:=private.ai_action_state_fingerprint(
        caller,action_row.action_type,action_row.payload,true
      );
    exception when others then
      -- Uma exclusão, perda de acesso ou série que se tornou ambígua também
      -- representa estado diferente. Falhar fechado é mais seguro que usar a
      -- proposta antiga ou expor detalhes internos do banco.
      current_state_fingerprint:=null;
    end;
    if current_state_fingerprint is distinct from action_row.state_fingerprint then
      update public.ai_pending_actions
      set status='failed',last_error_code='AI_ACTION_STATE_CHANGED'
      where id=action_row.id;
      insert into public.ai_action_audit(
        action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
      ) values(
        action_row.id,caller,action_row.action_type,'failed',action_row.payload,
        'AI_ACTION_STATE_CHANGED',action_row.idempotency_key
      );
      return jsonb_build_object(
        'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
        'status','failed','error_code','AI_ACTION_STATE_CHANGED','replayed',false
      );
    end if;
  end if;

  update public.ai_pending_actions set status='executing',last_error_code=null where id=action_row.id;
  insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key)
  values(action_row.id,caller,action_row.action_type,'executing',action_row.payload,action_row.idempotency_key);
  begin
    execution_result:=private.ai_execute_financial_action(caller,action_row.action_type,action_row.payload,action_row.id);
  exception when others then
    get stacked diagnostics error_message=message_text;
    safe_error:=case when error_message~'^AI_[A-Z0-9_]+$' then error_message else 'AI_ACTION_EXECUTION_FAILED' end;
    update public.ai_pending_actions set status='failed',last_error_code=safe_error where id=action_row.id;
    insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key)
    values(action_row.id,caller,action_row.action_type,'failed',action_row.payload,safe_error,action_row.idempotency_key);
    return jsonb_build_object('ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','failed','error_code',safe_error,'replayed',false);
  end;
  update public.ai_pending_actions set status='succeeded',result=execution_result,
    executed_at=clock_timestamp(),last_error_code=null where id=action_row.id;
  insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,result,idempotency_key)
  values(action_row.id,caller,action_row.action_type,'succeeded',action_row.payload,execution_result,action_row.idempotency_key);
  return jsonb_build_object('ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
    'status','succeeded','result',execution_result,'replayed',false);
end;
$$;

revoke all on function public.ai_get_action_quota() from public, anon;
revoke all on function public.ai_reserve_model_request(integer,integer) from public, anon;
revoke all on function public.ai_consume_analytical_action(text,text) from public, anon;
revoke all on function public.ai_create_pending_action(text,jsonb,text,integer) from public, anon;
revoke all on function public.ai_get_pending_action(uuid) from public, anon;
revoke all on function public.ai_list_pending_actions(integer,boolean) from public, anon;
revoke all on function public.ai_cancel_pending_action(uuid) from public, anon;
revoke all on function public.ai_consume_pending_action(uuid,uuid) from public, anon;

grant execute on function public.ai_get_action_quota() to authenticated, service_role;
grant execute on function public.ai_reserve_model_request(integer,integer) to authenticated, service_role;
grant execute on function public.ai_consume_analytical_action(text,text) to authenticated, service_role;
grant execute on function public.ai_create_pending_action(text,jsonb,text,integer) to authenticated, service_role;
grant execute on function public.ai_get_pending_action(uuid) to authenticated, service_role;
grant execute on function public.ai_list_pending_actions(integer,boolean) to authenticated, service_role;
grant execute on function public.ai_cancel_pending_action(uuid) to authenticated, service_role;
grant execute on function public.ai_consume_pending_action(uuid,uuid) to authenticated, service_role;

drop function private.ai_prepare_action_obsolete(uuid,text,jsonb);
drop function private.ai_execute_resource_action_obsolete(uuid,text,jsonb);

commit;
