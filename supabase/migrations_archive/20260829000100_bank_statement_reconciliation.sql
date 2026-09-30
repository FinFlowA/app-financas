-- Conciliação bancária do site FinFlow.
-- O arquivo e sua descrição bruta nunca chegam ao banco. Persistimos apenas
-- um hash da linha confirmada e os vínculos mínimos necessários para impedir
-- que a mesma movimentação seja oferecida novamente.

begin;

create table if not exists private.bank_reconciliation_receipts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id bigint not null references public.contas(id) on delete cascade,
  entry_fingerprint text not null check (entry_fingerprint ~ '^[0-9a-f]{64}$'),
  entry_date date not null,
  entry_type text not null check (entry_type in ('receita','despesa')),
  entry_amount numeric(14,2) not null check (entry_amount > 0 and entry_amount <= 999999999999.99),
  reconciliation_mode text not null check (reconciliation_mode in ('existing','new')),
  transaction_id bigint references public.transacoes(id) on delete set null,
  idempotency_key uuid not null,
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, account_id, entry_fingerprint),
  unique (user_id, idempotency_key)
);

revoke all on table private.bank_reconciliation_receipts from public, anon, authenticated;

create or replace function public.list_bank_reconciliation_fingerprints()
returns table(account_id bigint, entry_fingerprint text)
language sql
stable
security definer
set search_path = ''
as $$
  select r.account_id, r.entry_fingerprint
  from private.bank_reconciliation_receipts r
  where r.user_id = auth.uid()
  order by r.id;
$$;

revoke all on function public.list_bank_reconciliation_fingerprints() from public, anon;
grant execute on function public.list_bank_reconciliation_fingerprints() to authenticated;

create or replace function public.reconcile_bank_statement_entry(
  p_account_id bigint,
  p_entry_fingerprint text,
  p_entry_date date,
  p_entry_type text,
  p_entry_amount numeric,
  p_mode text,
  p_transaction_id bigint,
  p_category_id bigint,
  p_description text,
  p_idempotency_key uuid,
  p_expected_user_id uuid,
  p_client_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  account_row public.contas%rowtype;
  transaction_row public.transacoes%rowtype;
  existing private.bank_reconciliation_receipts%rowtype;
  action_result jsonb;
begin
  if caller is null then raise exception using errcode='42501', message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode='42501', message='RECONCILIATION_AUTH_MISMATCH';
  end if;
  if p_idempotency_key is null or p_client_created_at is null
     or p_client_created_at < clock_timestamp() - interval '30 days'
     or p_client_created_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_REQUEST';
  end if;
  if p_entry_fingerprint is null or p_entry_fingerprint !~ '^[0-9a-f]{64}$'
     or p_entry_date is null or p_entry_date > (clock_timestamp() at time zone 'America/Sao_Paulo')::date
     or p_entry_type not in ('receita','despesa')
     or p_entry_amount is null or p_entry_amount <= 0 or p_entry_amount > 999999999999.99
     or p_mode not in ('existing','new') then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_ENTRY';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_account_id::text || ':' || p_entry_fingerprint, 82901));
  select * into existing from private.bank_reconciliation_receipts r
  where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then
    return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id);
  end if;

  select * into account_row from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false) and (
    c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller))
  ) for update;
  if not found then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;

  if p_mode='existing' then
    if p_transaction_id is null then raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_REQUIRED'; end if;
    select * into transaction_row from public.transacoes t
    where t.id=p_transaction_id and t.transacao_pai_id is null and t.status='pendente'
      and t.conta_id=p_account_id and t.tipo=p_entry_type
      and t.categoria_id is not null
      and t.descricao !~ '\[(Destino:|Objetivo:|PagFatura:)'
      and not (t.descricao like '%[Transferencia]%' or t.descricao like '%[Transferência]%')
    for update;
    if not found then raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
    if p_entry_amount > transaction_row.valor then
      raise exception using errcode='22023', message='RECONCILIATION_AMOUNT_EXCEEDS_REMAINDER';
    end if;
    action_result := public.complete_transaction_with_partial(
      transaction_row.id,
      transaction_row.valor,
      'none',
      0,
      p_entry_amount,
      p_entry_date,
      p_idempotency_key
    );
    if action_result is null or action_result->>'ok' <> 'true' then
      raise exception using errcode='P0001', message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
    end if;
  else
    if p_category_id is null or not exists (
      select 1 from public.categorias c where c.id=p_category_id and c.user_id=caller
        and coalesce(c.ativa::integer,0)<>0 and c.tipo in (p_entry_type,'ambos')
    ) then raise exception using errcode='22023', message='RECONCILIATION_CATEGORY_INVALID'; end if;
    if p_description is null or length(trim(p_description))=0 or length(trim(p_description))>100 then
      raise exception using errcode='22023', message='RECONCILIATION_DESCRIPTION_INVALID';
    end if;
    action_result := public.execute_manual_financial_action(
      'create_transaction',
      jsonb_build_object(
        'type',p_entry_type,'value',round(p_entry_amount,2),'description',trim(p_description),
        'status','paga','scheduled_date',p_entry_date::text,'realization_date',p_entry_date::text,
        'account_id',p_account_id,'category_id',p_category_id,'frequency','unica'
      ),
      p_idempotency_key,
      caller,
      p_client_created_at
    );
    if action_result is null or action_result->>'ok' <> 'true' then
      raise exception using errcode='P0001', message='RECONCILIATION_CREATION_NOT_CONFIRMED';
    end if;
  end if;

  insert into private.bank_reconciliation_receipts(
    user_id,account_id,entry_fingerprint,entry_date,entry_type,entry_amount,
    reconciliation_mode,transaction_id,idempotency_key
  ) values (
    caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    p_mode,case when p_mode='existing' then p_transaction_id else null end,p_idempotency_key
  ) returning * into existing;

  return jsonb_build_object(
    'ok',true,'replayed',false,'receipt_id',existing.id,
    'transaction_id',existing.transaction_id,'result',action_result
  );
end;
$$;

revoke all on function public.reconcile_bank_statement_entry(bigint,text,date,text,numeric,text,bigint,bigint,text,uuid,uuid,timestamptz)
  from public, anon;
grant execute on function public.reconcile_bank_statement_entry(bigint,text,date,text,numeric,text,bigint,bigint,text,uuid,uuid,timestamptz)
  to authenticated;

comment on function public.reconcile_bank_statement_entry(bigint,text,date,text,numeric,text,bigint,bigint,text,uuid,uuid,timestamptz) is
  'Concilia atomicamente uma linha de extrato sem persistir o arquivo ou a descrição bancária bruta.';

commit;
