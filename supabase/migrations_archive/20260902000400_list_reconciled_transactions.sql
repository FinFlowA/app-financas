-- Lista mínima para ocultar candidatos já vinculados e identificar lançamentos
-- conciliados no Histórico. Nenhum dado do extrato é exposto.

begin;

create or replace function public.list_bank_reconciled_transaction_ids()
returns table(transaction_id bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct linked.transaction_id
  from (
    select r.transaction_id
    from private.bank_reconciliation_receipts r
    where r.user_id=auth.uid() and r.transaction_id is not null
    union all
    select rt.transaction_id
    from private.bank_reconciliation_transactions rt
    join private.bank_reconciliation_receipts r on r.id=rt.receipt_id
    where r.user_id=auth.uid()
  ) linked
  where linked.transaction_id is not null
  order by linked.transaction_id;
$$;

revoke all on function public.list_bank_reconciled_transaction_ids() from public,anon;
grant execute on function public.list_bank_reconciled_transaction_ids() to authenticated;

commit;
