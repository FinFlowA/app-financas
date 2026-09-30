-- Reabrir um lancamento tambem libera a parte correspondente do extrato.
-- Em conciliacoes compostas, os demais vinculos continuam preservados.

begin;

create or replace function private.release_bank_reconciliation_for_transaction(p_transaction_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare affected_receipts bigint[];
begin
  if p_transaction_id is null then return; end if;
  delete from private.bank_reconciliation_receipts r where r.transaction_id=p_transaction_id;
  with removed as (
    delete from private.bank_reconciliation_transactions rt where rt.transaction_id=p_transaction_id returning rt.receipt_id
  ) select array_agg(distinct receipt_id) into affected_receipts from removed;
  if affected_receipts is not null then
    delete from private.bank_reconciliation_receipts r where r.id=any(affected_receipts)
      and not exists (select 1 from private.bank_reconciliation_transactions rt where rt.receipt_id=r.id);
  end if;
end; $$;
revoke all on function private.release_bank_reconciliation_for_transaction(bigint) from public,anon,authenticated;

create or replace function private.release_bank_reconciliation_after_reopen()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op='UPDATE' and old.status='paga' and new.status='pendente' then
    perform private.release_bank_reconciliation_for_transaction(new.id);
  elsif tg_op='DELETE' and old.transacao_pai_id is not null then
    perform private.release_bank_reconciliation_for_transaction(old.transacao_pai_id);
  end if;
  return coalesce(new,old);
end; $$;
drop trigger if exists release_bank_reconciliation_after_reopen on public.transacoes;
create trigger release_bank_reconciliation_after_reopen after update of status or delete on public.transacoes
for each row execute function private.release_bank_reconciliation_after_reopen();

create or replace function public.list_bank_reconciliation_progress()
returns table(receipt_id bigint,account_id bigint,entry_fingerprint text,entry_amount numeric,reconciled_amount numeric)
language sql stable security definer set search_path = '' as $$
  select r.id,r.account_id,r.entry_fingerprint,r.entry_amount,
    case when exists (select 1 from private.bank_reconciliation_transactions x where x.receipt_id=r.id)
      then coalesce((select round(sum(x.amount),2) from private.bank_reconciliation_transactions x where x.receipt_id=r.id),0)
      else r.entry_amount end
  from private.bank_reconciliation_receipts r where r.user_id=auth.uid() order by r.id;
$$;
revoke all on function public.list_bank_reconciliation_progress() from public,anon;
grant execute on function public.list_bank_reconciliation_progress() to authenticated;

create or replace function public.reconcile_reopened_bank_statement_entry(
  p_receipt_id bigint,p_entry_fingerprint text,p_entry_date date,p_entry_type text,p_entry_amount numeric,
  p_transaction_id bigint,p_idempotency_key uuid,p_expected_user_id uuid,p_client_created_at timestamptz
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  caller uuid:=auth.uid(); receipt private.bank_reconciliation_receipts%rowtype;
  transaction_row public.transacoes%rowtype; reconciled_total numeric(20,2); available_amount numeric(20,2); action_result jsonb;
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_idempotency_key is null or p_client_created_at is null
    or p_client_created_at<clock_timestamp()-interval '30 days' or p_client_created_at>clock_timestamp()+interval '5 minutes'
  then raise exception using errcode='22023',message='RECONCILIATION_INVALID_REQUEST'; end if;
  select * into receipt from private.bank_reconciliation_receipts r
  where r.id=p_receipt_id and r.user_id=caller and r.entry_fingerprint=p_entry_fingerprint
    and r.entry_date=p_entry_date and r.entry_type=p_entry_type for update;
  if not found then raise exception using errcode='22023',message='RECONCILIATION_PARTIAL_RECEIPT_UNAVAILABLE'; end if;
  select coalesce(round(sum(rt.amount),2),0) into reconciled_total
  from private.bank_reconciliation_transactions rt where rt.receipt_id=receipt.id;
  available_amount:=round(receipt.entry_amount-reconciled_total,2);
  if available_amount<=0 or round(p_entry_amount,2) is distinct from available_amount then
    raise exception using errcode='22023',message='RECONCILIATION_PARTIAL_AMOUNT_CHANGED'; end if;
  select * into transaction_row from public.transacoes t
  where t.id=p_transaction_id and t.transacao_pai_id is null and t.status='pendente'
    and t.conta_id=receipt.account_id and t.tipo=receipt.entry_type and t.categoria_id is not null
    and coalesce(t.descricao,'') !~ '\[(Destino:|Objetivo:|PagFatura:)' for update;
  if not found or round(transaction_row.valor,2) is distinct from available_amount then
    raise exception using errcode='22023',message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  if exists (select 1 from private.bank_reconciliation_receipts r
    left join private.bank_reconciliation_transactions rt on rt.receipt_id=r.id
    where r.user_id=caller and (r.transaction_id=p_transaction_id or rt.transaction_id=p_transaction_id))
  then raise exception using errcode='22023',message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  action_result:=public.complete_transaction_with_partial(transaction_row.id,transaction_row.valor,'none',0,available_amount,p_entry_date,p_idempotency_key);
  if action_result is null or action_result->>'ok'<>'true' then
    raise exception using errcode='P0001',message='RECONCILIATION_COMPLETION_NOT_CONFIRMED'; end if;
  insert into private.bank_reconciliation_transactions(receipt_id,transaction_id,amount)
  values(receipt.id,transaction_row.id,available_amount);
  return jsonb_build_object('ok',true,'receipt_id',receipt.id,'transaction_id',transaction_row.id,
    'reconciled_amount',receipt.entry_amount,'remaining_amount',0);
end; $$;
revoke all on function public.reconcile_reopened_bank_statement_entry(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.reconcile_reopened_bank_statement_entry(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz) to authenticated;

commit;
