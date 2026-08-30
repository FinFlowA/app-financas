begin;

alter table private.bank_reconciliation_receipts
  add column if not exists scheduled_amount numeric(14,2),
  add column if not exists interest_amount numeric(14,2);

alter table private.bank_reconciliation_receipts
  drop constraint if exists bank_reconciliation_receipts_interest_amount_check;
alter table private.bank_reconciliation_receipts
  add constraint bank_reconciliation_receipts_interest_amount_check
  check (interest_amount is null or interest_amount > 0);

create or replace function public.reconcile_bank_statement_excess_interest(
  p_account_id bigint, p_entry_fingerprint text, p_entry_date date,
  p_entry_type text, p_entry_amount numeric, p_transaction_id bigint,
  p_idempotency_key uuid, p_expected_user_id uuid, p_client_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  transaction_row public.transacoes%rowtype;
  existing private.bank_reconciliation_receipts%rowtype;
  completion_result jsonb;
  scheduled_value numeric(14,2);
  interest_value numeric(14,2);
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_account_id is null or p_entry_fingerprint !~ '^[0-9a-f]{64}$' or p_entry_date is null
    or p_entry_type not in ('receita','despesa') or p_entry_amount<=0 or p_transaction_id is null
    or p_idempotency_key is null or p_client_created_at is null then
    raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finflow:bank-interest:'||p_transaction_id::text,82905));
  select * into existing from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;
  select * into transaction_row from public.transacoes t where t.id=p_transaction_id
    and t.transacao_pai_id is null and t.status='pendente' and t.conta_id=p_account_id
    and t.tipo=p_entry_type and t.categoria_id is not null
    and coalesce(t.descricao,'') not like '[Transf.]%'
    and coalesce(t.descricao,'') !~ '\[(Destino:|Objetivo:|PagFatura:)' for update;
  if not found then raise exception using errcode='22023',message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  scheduled_value := round(transaction_row.valor,2);
  interest_value := round(p_entry_amount-scheduled_value,2);
  if interest_value<=0 then raise exception using errcode='22023',message='RECONCILIATION_EXCESS_CONFIRMATION_REQUIRED'; end if;

  -- O total realizado permanece no próprio agendamento. Os componentes são
  -- preservados no recibo privado da conciliação para exibição e auditoria.
  update public.transacoes set valor=round(p_entry_amount,2) where id=transaction_row.id;
  completion_result := public.complete_transaction_with_partial(transaction_row.id,round(p_entry_amount,2),
    'none',0,round(p_entry_amount,2),p_entry_date,p_idempotency_key);
  if completion_result is null or completion_result->>'ok'<>'true' then
    raise exception using errcode='P0001',message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
  end if;
  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,entry_type,
    entry_amount,reconciliation_mode,transaction_id,idempotency_key,scheduled_amount,interest_amount)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    'existing',transaction_row.id,p_idempotency_key,scheduled_value,interest_value) returning * into existing;
  return jsonb_build_object('ok',true,'receipt_id',existing.id,'transaction_id',transaction_row.id,
    'scheduled_amount',scheduled_value,'interest_amount',interest_value,'completion',completion_result);
end;
$$;

create or replace function public.get_bank_reconciliation_adjustment(p_transaction_id bigint)
returns table(scheduled_amount numeric, interest_amount numeric, entry_amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select r.scheduled_amount,r.interest_amount,r.entry_amount
  from private.bank_reconciliation_receipts r
  join public.transacoes t on t.id=r.transaction_id
  where r.transaction_id=p_transaction_id and r.user_id=auth.uid()
    and (t.user_id=auth.uid() or public.is_parceiro(t.user_id,auth.uid()))
    and r.interest_amount is not null
  order by r.id desc limit 1;
$$;

revoke all on function public.get_bank_reconciliation_adjustment(bigint) from public,anon;
grant execute on function public.get_bank_reconciliation_adjustment(bigint) to authenticated;

commit;
