-- Conclusao e reabertura atomicas/idempotentes de receitas e despesas.
--
-- O recibo e parte do estado operacional: ele preserva o valor originalmente
-- agendado, inclusive quando a conclusao teve juros, desconto ou saldo parcial.
-- IMPORTANTE: esta migracao depende dos helpers privados criados em
-- 20260802000100_secure_finance_ai.sql. A sequencia nova deve ser aplicada
-- integralmente e em ordem; nao publique/aplique este arquivo isoladamente.

begin;

create schema if not exists private;

create table if not exists private.transaction_completion_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  transaction_id bigint not null,
  expected_value numeric(14,2) not null,
  adjustment_type text not null check (adjustment_type in ('none', 'interest', 'discount')),
  adjustment_value numeric(14,2) not null check (adjustment_value >= 0),
  total_due numeric(14,2) not null,
  realized_value numeric(14,2) not null,
  remaining_value numeric(14,2) not null default 0 check (remaining_value >= 0),
  remaining_transaction_id bigint,
  remaining_description text,
  transaction_user_id uuid,
  transaction_type text,
  account_id bigint,
  category_id bigint,
  due_date date,
  original_description text,
  completed_description text,
  realization_date date not null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  unique (user_id, idempotency_key)
);

-- Mantem a migracao reaplicavel em ambientes que receberam a primeira versao.
alter table private.transaction_completion_receipts
  add column if not exists remaining_value numeric(14,2) not null default 0,
  add column if not exists remaining_transaction_id bigint,
  add column if not exists remaining_description text,
  add column if not exists transaction_user_id uuid,
  add column if not exists transaction_type text,
  add column if not exists account_id bigint,
  add column if not exists category_id bigint,
  add column if not exists due_date date,
  add column if not exists original_description text,
  add column if not exists completed_description text,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by uuid references auth.users(id) on delete set null;

create index if not exists transaction_completion_receipts_user_created_idx
  on private.transaction_completion_receipts (user_id, created_at desc);
create index if not exists transaction_completion_receipts_created_idx
  on private.transaction_completion_receipts (created_at);
create unique index if not exists transaction_completion_receipts_active_transaction_idx
  on private.transaction_completion_receipts (transaction_id)
  where reopened_at is null;

create table if not exists private.transaction_reopen_receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  transaction_id bigint not null,
  completion_receipt_id uuid references private.transaction_completion_receipts(id) on delete set null,
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, idempotency_key)
);

create index if not exists transaction_reopen_receipts_user_created_idx
  on private.transaction_reopen_receipts (user_id, created_at desc);
create index if not exists transaction_reopen_receipts_created_idx
  on private.transaction_reopen_receipts (created_at);

alter table private.transaction_completion_receipts enable row level security;
alter table private.transaction_reopen_receipts enable row level security;
revoke all on table private.transaction_completion_receipts from public, anon, authenticated;
revoke all on table private.transaction_reopen_receipts from public, anon, authenticated;
grant all on table private.transaction_completion_receipts to service_role;
grant all on table private.transaction_reopen_receipts to service_role;

-- O dono da conta tambem precisa enxergar e operar lancamentos criados pelo
-- parceiro dentro da conta compartilhada. O user_id da linha continua imutavel
-- pelo trigger instalado na migracao de RLS central.
drop policy if exists "transacoes_accessible_select" on public.transacoes;
create policy "transacoes_accessible_select"
  on public.transacoes for select to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.contas c
      where c.id = conta_id
        and (
          c.user_id = (select auth.uid())
          or (
            c.compartilhado is true
            and public.is_parceiro(c.user_id, (select auth.uid()))
          )
        )
    )
  );

drop policy if exists "transacoes_accessible_update" on public.transacoes;
create policy "transacoes_accessible_update"
  on public.transacoes for update to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.contas c
      where c.id = conta_id
        and (
          c.user_id = (select auth.uid())
          or (
            c.compartilhado is true
            and public.is_parceiro(c.user_id, (select auth.uid()))
          )
        )
    )
  )
  with check (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.contas c
      where c.id = conta_id
        and (
          c.user_id = (select auth.uid())
          or (
            c.compartilhado is true
            and public.is_parceiro(c.user_id, (select auth.uid()))
          )
        )
    )
  );

drop policy if exists "transacoes_accessible_delete" on public.transacoes;
create policy "transacoes_accessible_delete"
  on public.transacoes for delete to authenticated
  using (
    (select auth.uid()) = user_id
    or exists (
      select 1
      from public.contas c
      where c.id = conta_id
        and (
          c.user_id = (select auth.uid())
          or (
            c.compartilhado is true
            and public.is_parceiro(c.user_id, (select auth.uid()))
          )
        )
    )
  );

create or replace function public.complete_transaction_with_partial(
  p_transaction_id bigint,
  p_expected_value numeric,
  p_adjustment_type text,
  p_adjustment_value numeric,
  p_realized_value numeric,
  p_realization_date date,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  existing private.transaction_completion_receipts%rowtype;
  active_receipt private.transaction_completion_receipts%rowtype;
  transaction_row public.transacoes%rowtype;
  expected_value numeric(14,2);
  adjustment_type text;
  adjustment_value numeric(14,2);
  total_due numeric(14,2);
  realized_value numeric(14,2);
  remaining_value numeric(14,2);
  remaining_id bigint;
  remaining_description text;
  completed_description text;
  parcel_match text[];
  visible_description text;
  result_value jsonb;
begin
  if caller is null then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_AUTH_REQUIRED';
  end if;
  if p_transaction_id is null
     or p_expected_value is null
     or p_realized_value is null
     or p_realization_date is null
     or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_COMPLETION_INVALID';
  end if;

  expected_value := round(p_expected_value, 2);
  adjustment_type := coalesce(p_adjustment_type, 'none');
  adjustment_value := round(coalesce(p_adjustment_value, 0), 2);
  realized_value := round(p_realized_value, 2);

  if expected_value <= 0
     or realized_value <= 0
     or p_realization_date > (clock_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_COMPLETION_INVALID';
  end if;
  if adjustment_type not in ('none', 'interest', 'discount')
     or adjustment_value < 0
     or (adjustment_type = 'none' and adjustment_value <> 0)
     or (adjustment_type = 'interest' and (adjustment_value <= 0 or adjustment_value > expected_value))
     or (adjustment_type = 'discount' and (adjustment_value <= 0 or adjustment_value >= expected_value)) then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_ADJUSTMENT_INVALID';
  end if;

  -- A mesma trava e usada na conclusao e na reabertura, independente de quem
  -- esteja operando uma conta compartilhada.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:transaction:' || p_transaction_id::text, 73117)
  );

  select t.* into transaction_row
  from public.transacoes t
  where t.id = p_transaction_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_NOT_FOUND';
  end if;
  perform private.ai_lock_account(caller, transaction_row.conta_id, false, true);
  select t.* into transaction_row
  from public.transacoes t
  where t.id = p_transaction_id and t.conta_id = transaction_row.conta_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_NOT_FOUND';
  end if;
  perform private.ai_assert_transaction(caller, p_transaction_id);

  select * into existing
  from private.transaction_completion_receipts r
  where r.user_id = caller and r.idempotency_key = p_idempotency_key;

  if found then
    total_due := case adjustment_type
      when 'interest' then expected_value + adjustment_value
      when 'discount' then expected_value - adjustment_value
      else expected_value
    end;

    if existing.transaction_id is distinct from p_transaction_id
       or existing.expected_value is distinct from expected_value
       or existing.adjustment_type is distinct from adjustment_type
       or existing.adjustment_value is distinct from adjustment_value
       or existing.total_due is distinct from total_due
       or existing.realized_value is distinct from realized_value
       or existing.realization_date is distinct from p_realization_date then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_COMPLETION_IDEMPOTENCY_CONFLICT';
    end if;
    if existing.reopened_at is not null then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_COMPLETION_ALREADY_REOPENED';
    end if;
    if transaction_row.status is distinct from 'paga'
       or round(transaction_row.valor, 2) is distinct from existing.realized_value
       or transaction_row.data_realizacao is distinct from existing.realization_date
       or transaction_row.user_id is distinct from existing.transaction_user_id
       or transaction_row.tipo is distinct from existing.transaction_type
       or transaction_row.conta_id is distinct from existing.account_id
       or transaction_row.categoria_id is distinct from existing.category_id
       or transaction_row.data_vencimento is distinct from existing.due_date
       or existing.completed_description is null
       or transaction_row.descricao is distinct from existing.completed_description
       or (
         existing.remaining_transaction_id is not null
         and not exists (
           select 1
           from public.transacoes child
           where child.id = existing.remaining_transaction_id
             and child.user_id = transaction_row.user_id
             and child.status = 'pendente'
             and round(child.valor, 2) = existing.remaining_value
             and child.data_vencimento = transaction_row.data_vencimento
             and child.data_realizacao is null
             and child.descricao is not distinct from existing.remaining_description
             and child.tipo = transaction_row.tipo
             and child.conta_id = transaction_row.conta_id
             and child.categoria_id is not distinct from transaction_row.categoria_id
         )
       )
       or (
         existing.remaining_transaction_id is null
         and existing.remaining_value <> 0
       ) then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_COMPLETION_STATE_CONFLICT';
    end if;
    return existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  select * into active_receipt
  from private.transaction_completion_receipts r
  where r.transaction_id = transaction_row.id and r.reopened_at is null
  for update;
  if found then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_ALREADY_COMPLETED';
  end if;

  if transaction_row.status is distinct from 'pendente' then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_ALREADY_COMPLETED';
  end if;
  if round(transaction_row.valor, 2) is distinct from expected_value then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_VALUE_CHANGED';
  end if;
  if transaction_row.tipo not in ('receita', 'despesa')
     or transaction_row.categoria_id is null
     or coalesce(transaction_row.descricao, '') like '[Transf.] %'
     or coalesce(transaction_row.descricao, '') ~ '\[(Destino:|Objetivo:|PagFatura:)' then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_PARTIAL_NOT_SUPPORTED';
  end if;
  if not private.ai_can_access_account(caller, transaction_row.conta_id, true) then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_ACCOUNT_ARCHIVED';
  end if;
  if p_realization_date <= transaction_row.data_vencimento
     and (adjustment_type <> 'none' or adjustment_value <> 0) then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_ADJUSTMENT_NOT_ALLOWED_BEFORE_DUE_DATE';
  end if;

  total_due := case adjustment_type
    when 'interest' then expected_value + adjustment_value
    when 'discount' then expected_value - adjustment_value
    else expected_value
  end;
  if realized_value > total_due then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_REALIZED_VALUE_TOO_HIGH';
  end if;

  remaining_value := round(total_due - realized_value, 2);
  completed_description := btrim(
    pg_catalog.regexp_replace(transaction_row.descricao, '\s*\[SaldoParcial:[0-9]+\]', '', 'g')
  );

  if remaining_value > 0 then
    visible_description := btrim(pg_catalog.regexp_replace(
      completed_description,
      '(\s*(?:\[(?:Serie:[A-Za-z0-9_-]+|Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$',
      ''
    ));
    parcel_match := pg_catalog.regexp_match(visible_description, '^(.+)\s+\(([0-9]+)/([0-9]+)\)$');
    if parcel_match is not null then
      remaining_description := parcel_match[1] || ' (saldo restante da parcela '
        || parcel_match[2] || '/' || parcel_match[3] || ')';
    else
      remaining_description := btrim(pg_catalog.regexp_replace(
        visible_description,
        '\s+\(Fixa(?: semanal| anual)?\)$',
        ''
      )) || ' (saldo restante)';
    end if;
    if pg_catalog.length(remaining_description) > 200 then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_DESCRIPTION_TOO_LONG';
    end if;

    insert into public.transacoes (
      user_id, tipo, valor, data_vencimento, data_realizacao,
      descricao, categoria_id, conta_id, status
    ) values (
      transaction_row.user_id, transaction_row.tipo, remaining_value,
      transaction_row.data_vencimento, null, remaining_description,
      transaction_row.categoria_id, transaction_row.conta_id, 'pendente'
    ) returning id into remaining_id;

    completed_description := completed_description || ' [SaldoParcial:' || remaining_id || ']';
    if pg_catalog.length(completed_description) > 200 then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_DESCRIPTION_TOO_LONG';
    end if;
  end if;

  update public.transacoes
  set status = 'paga',
      valor = realized_value,
      data_realizacao = p_realization_date,
      descricao = completed_description
  where id = transaction_row.id;

  result_value := pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'transaction_id', transaction_row.id,
    'expected_value', expected_value,
    'adjustment_type', adjustment_type,
    'adjustment_value', adjustment_value,
    'total_due', total_due,
    'realized_value', realized_value,
    'remaining_value', remaining_value,
    'remaining_transaction_id', remaining_id,
    'realization_date', p_realization_date
  );

  insert into private.transaction_completion_receipts (
    user_id, idempotency_key, transaction_id, expected_value,
    adjustment_type, adjustment_value, total_due, realized_value,
    remaining_value, remaining_transaction_id, original_description,
    remaining_description, transaction_user_id, transaction_type,
    account_id, category_id, due_date, completed_description,
    realization_date, result
  ) values (
    caller, p_idempotency_key, transaction_row.id, expected_value,
    adjustment_type, adjustment_value, total_due, realized_value,
    remaining_value, remaining_id, transaction_row.descricao,
    remaining_description, transaction_row.user_id, transaction_row.tipo,
    transaction_row.conta_id, transaction_row.categoria_id,
    transaction_row.data_vencimento, completed_description,
    p_realization_date, result_value
  );

  return result_value;
end;
$$;

revoke all on function public.complete_transaction_with_partial(bigint,numeric,text,numeric,numeric,date,uuid)
  from public, anon;
grant execute on function public.complete_transaction_with_partial(bigint,numeric,text,numeric,numeric,date,uuid)
  to authenticated;

comment on function public.complete_transaction_with_partial(bigint,numeric,text,numeric,numeric,date,uuid) is
  'Conclui receita/despesa e cria eventual saldo pendente de forma atomica e idempotente.';

create or replace function public.reopen_transaction_completion(
  p_transaction_id bigint,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  existing private.transaction_reopen_receipts%rowtype;
  completion private.transaction_completion_receipts%rowtype;
  transaction_row public.transacoes%rowtype;
  restored_value numeric(14,2);
  restored_description text;
  result_value jsonb;
begin
  if caller is null then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_AUTH_REQUIRED';
  end if;
  if p_transaction_id is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:transaction:' || p_transaction_id::text, 73117)
  );

  select t.* into transaction_row
  from public.transacoes t
  where t.id = p_transaction_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_NOT_FOUND';
  end if;
  perform private.ai_lock_account(caller, transaction_row.conta_id, false, false);
  select t.* into transaction_row
  from public.transacoes t
  where t.id = p_transaction_id and t.conta_id = transaction_row.conta_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_NOT_FOUND';
  end if;
  perform private.ai_assert_transaction(caller, p_transaction_id);

  select * into existing
  from private.transaction_reopen_receipts r
  where r.user_id = caller and r.idempotency_key = p_idempotency_key;
  if found then
    if existing.transaction_id is distinct from p_transaction_id then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_IDEMPOTENCY_CONFLICT';
    end if;
    if transaction_row.status is distinct from 'pendente'
       or transaction_row.data_realizacao is not null
       or round(transaction_row.valor, 2) is distinct from
          round((existing.result ->> 'restored_value')::numeric, 2)
       or transaction_row.descricao is distinct from (existing.result ->> 'restored_description') then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;
    return existing.result || pg_catalog.jsonb_build_object('replayed', true);
  end if;

  if transaction_row.tipo not in ('receita', 'despesa')
     or coalesce(transaction_row.descricao, '') like '[Transf.] %'
     or coalesce(transaction_row.descricao, '') ~ '\[(Destino:|Objetivo:|PagFatura:)' then
    raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_NOT_SUPPORTED';
  end if;

  select * into completion
  from private.transaction_completion_receipts r
  where r.transaction_id = transaction_row.id and r.reopened_at is null
  for update;

  if found then
    if transaction_row.status is distinct from 'paga'
       or round(transaction_row.valor, 2) is distinct from completion.realized_value
       or transaction_row.data_realizacao is distinct from completion.realization_date
       or transaction_row.user_id is distinct from completion.transaction_user_id
       or transaction_row.tipo is distinct from completion.transaction_type
       or transaction_row.conta_id is distinct from completion.account_id
       or transaction_row.categoria_id is distinct from completion.category_id
       or transaction_row.data_vencimento is distinct from completion.due_date
       or completion.original_description is null
       or completion.completed_description is null
       or transaction_row.descricao is distinct from completion.completed_description then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;

    if completion.remaining_transaction_id is not null then
      if not exists (
        select 1
        from public.transacoes child
        where child.id = completion.remaining_transaction_id
          and child.user_id = transaction_row.user_id
          and child.status = 'pendente'
          and round(child.valor, 2) = completion.remaining_value
          and child.data_vencimento = transaction_row.data_vencimento
          and child.data_realizacao is null
          and child.descricao is not distinct from completion.remaining_description
          and child.tipo = transaction_row.tipo
          and child.conta_id = transaction_row.conta_id
          and child.categoria_id is not distinct from transaction_row.categoria_id
        for update
      ) then
        raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_REMAINDER_CHANGED';
      end if;

      delete from public.transacoes
      where id = completion.remaining_transaction_id;
      if not found then
        raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_REMAINDER_CHANGED';
      end if;
    elsif completion.remaining_value <> 0 then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;

    restored_value := completion.expected_value;
    restored_description := completion.original_description;

    update public.transacoes
    set status = 'pendente',
        data_realizacao = null,
        valor = restored_value,
        descricao = restored_description
    where id = transaction_row.id;
    if not found then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;

    update private.transaction_completion_receipts
    set reopened_at = clock_timestamp(), reopened_by = caller
    where id = completion.id and reopened_at is null;
    if not found then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;
  else
    -- Registros anteriores a esta RPC podem ser reabertos apenas quando nao ha
    -- marcador de saldo parcial: sem recibo nao existe forma segura de inferir
    -- o valor original antes de juros/desconto e da divisao.
    if transaction_row.status is distinct from 'paga' then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_NOT_COMPLETED';
    end if;
    if coalesce(transaction_row.descricao, '') ~ '\[SaldoParcial:[0-9]+\]' then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_LEGACY_PARTIAL_UNSAFE';
    end if;

    restored_value := round(transaction_row.valor, 2);
    restored_description := transaction_row.descricao;
    update public.transacoes
    set status = 'pendente', data_realizacao = null
    where id = transaction_row.id;
    if not found then
      raise exception using errcode = 'P0001', message = 'TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;
  end if;

  result_value := pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'transaction_id', transaction_row.id,
    'restored_value', restored_value,
    'restored_description', restored_description,
    'removed_remaining_transaction_id', completion.remaining_transaction_id,
    'status', 'pendente'
  );

  insert into private.transaction_reopen_receipts (
    user_id, idempotency_key, transaction_id, completion_receipt_id, result
  ) values (
    caller, p_idempotency_key, transaction_row.id, completion.id, result_value
  );

  return result_value;
end;
$$;

revoke all on function public.reopen_transaction_completion(bigint,uuid)
  from public, anon;
grant execute on function public.reopen_transaction_completion(bigint,uuid)
  to authenticated;

comment on function public.reopen_transaction_completion(bigint,uuid) is
  'Reabre receita/despesa de forma atomica, remove o saldo parcial intacto e restaura o valor agendado original.';

-- Recibos de reabertura e recibos terminais podem expirar globalmente. Recibos
-- de conclusoes ainda ativas permanecem, pois sao necessarios para uma futura
-- reabertura restaurar o valor originalmente agendado sem perda financeira.
create or replace function private.cleanup_transaction_completion_receipts()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_reopens integer := 0;
  deleted_completions integer := 0;
begin
  delete from private.transaction_reopen_receipts r
  where r.created_at < clock_timestamp() - interval '90 days';
  get diagnostics deleted_reopens = row_count;

  delete from private.transaction_completion_receipts r
  where r.created_at < clock_timestamp() - interval '90 days'
    and (
      r.reopened_at is not null
      or not exists (
        select 1 from public.transacoes t where t.id = r.transaction_id
      )
    );
  get diagnostics deleted_completions = row_count;

  return deleted_reopens + deleted_completions;
end;
$$;

revoke all on function private.cleanup_transaction_completion_receipts()
  from public, anon, authenticated;
grant execute on function private.cleanup_transaction_completion_receipts()
  to service_role;

select private.cleanup_transaction_completion_receipts();

do $$
begin
  if to_regclass('cron.job') is not null
     and not exists (
       select 1 from cron.job
       where jobname = 'finflow-transaction-receipt-retention'
     ) then
    perform cron.schedule(
      'finflow-transaction-receipt-retention',
      '17 3 * * *',
      'select private.cleanup_transaction_completion_receipts();'
    );
  end if;
exception
  when insufficient_privilege or undefined_function or undefined_table then
    raise notice 'FINFLOW_RECEIPT_RETENTION_CRON_NOT_AVAILABLE';
end;
$$;

commit;
