-- Liga cada conciliacao a baixa individual correspondente, sem expor dados do extrato.
begin;

alter table private.bank_reconciliation_receipts add column if not exists payment_id uuid references private.transaction_completion_receipts(id) on delete set null;
alter table private.bank_reconciliation_transactions add column if not exists payment_id uuid references private.transaction_completion_receipts(id) on delete set null;

create or replace function private.assign_bank_reconciliation_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare root_id bigint; matched uuid;
begin
  if new.payment_id is not null or new.transaction_id is null then return new; end if;
  select coalesce(t.transacao_pai_id,t.id) into root_id from public.transacoes t where t.id=new.transaction_id;
  select p.id into matched from private.transaction_completion_receipts p
  where p.root_transaction_id=root_id and p.reopened_at is null and p.realization_date=new.entry_date
    and round(p.realized_value,2)=round(new.entry_amount,2)
    and not exists(select 1 from private.bank_reconciliation_receipts x where x.payment_id=p.id)
    and not exists(select 1 from private.bank_reconciliation_transactions x where x.payment_id=p.id)
  order by p.payment_sequence,p.created_at,p.id limit 1;
  new.payment_id:=matched; return new;
end; $$;
drop trigger if exists assign_bank_reconciliation_payment on private.bank_reconciliation_receipts;
create trigger assign_bank_reconciliation_payment before insert or update of transaction_id,entry_date,entry_amount on private.bank_reconciliation_receipts for each row execute function private.assign_bank_reconciliation_payment();

create or replace function private.assign_bank_reconciliation_transaction_payment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare root_id bigint; entry_date_value date; matched uuid;
begin
  if new.payment_id is not null then return new; end if;
  select r.entry_date into entry_date_value from private.bank_reconciliation_receipts r where r.id=new.receipt_id;
  select coalesce(t.transacao_pai_id,t.id) into root_id from public.transacoes t where t.id=new.transaction_id;
  select p.id into matched from private.transaction_completion_receipts p
  where p.root_transaction_id=root_id and p.reopened_at is null and p.realization_date=entry_date_value
    and round(p.realized_value,2)=round(new.amount,2)
    and not exists(select 1 from private.bank_reconciliation_receipts x where x.payment_id=p.id)
    and not exists(select 1 from private.bank_reconciliation_transactions x where x.payment_id=p.id)
  order by p.payment_sequence,p.created_at,p.id limit 1;
  new.payment_id:=matched; return new;
end; $$;
drop trigger if exists assign_bank_reconciliation_transaction_payment on private.bank_reconciliation_transactions;
create trigger assign_bank_reconciliation_transaction_payment before insert or update of transaction_id,amount on private.bank_reconciliation_transactions for each row execute function private.assign_bank_reconciliation_transaction_payment();

-- Backfill deterministico para conciliacoes existentes com data e valor iguais.
with payments as (
  select p.id,p.root_transaction_id,p.realization_date,round(p.realized_value,2) amount,
    row_number() over(partition by p.root_transaction_id,p.realization_date,round(p.realized_value,2) order by p.payment_sequence,p.created_at,p.id) occurrence
  from private.transaction_completion_receipts p where p.reopened_at is null
), receipts as (
  select br.id,coalesce(t.transacao_pai_id,t.id) root_transaction_id,br.entry_date,round(br.entry_amount,2) amount,
    row_number() over(partition by coalesce(t.transacao_pai_id,t.id),br.entry_date,round(br.entry_amount,2) order by br.created_at,br.id) occurrence
  from private.bank_reconciliation_receipts br join public.transacoes t on t.id=br.transaction_id where br.payment_id is null
)
update private.bank_reconciliation_receipts br set payment_id=p.id from receipts r join payments p
on p.root_transaction_id=r.root_transaction_id and p.realization_date=r.entry_date and p.amount=r.amount and p.occurrence=r.occurrence where br.id=r.id;

with used as (
  select payment_id from private.bank_reconciliation_receipts where payment_id is not null union all
  select payment_id from private.bank_reconciliation_transactions where payment_id is not null
), payments as (
  select p.id,p.root_transaction_id,p.realization_date,round(p.realized_value,2) amount,
    row_number() over(partition by p.root_transaction_id,p.realization_date,round(p.realized_value,2) order by p.payment_sequence,p.created_at,p.id) occurrence
  from private.transaction_completion_receipts p where p.reopened_at is null and not exists(select 1 from used u where u.payment_id=p.id)
), links as (
  select rt.receipt_id,rt.transaction_id,coalesce(t.transacao_pai_id,t.id) root_transaction_id,br.entry_date,round(rt.amount,2) amount,
    row_number() over(partition by coalesce(t.transacao_pai_id,t.id),br.entry_date,round(rt.amount,2) order by br.created_at,rt.receipt_id,rt.transaction_id) occurrence
  from private.bank_reconciliation_transactions rt join private.bank_reconciliation_receipts br on br.id=rt.receipt_id
  join public.transacoes t on t.id=rt.transaction_id where rt.payment_id is null
)
update private.bank_reconciliation_transactions rt set payment_id=p.id from links l join payments p
on p.root_transaction_id=l.root_transaction_id and p.realization_date=l.entry_date and p.amount=l.amount and p.occurrence=l.occurrence
where rt.receipt_id=l.receipt_id and rt.transaction_id=l.transaction_id;

create or replace function private.release_bank_reconciliation_for_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare affected bigint[];
begin
  delete from private.bank_reconciliation_receipts r where r.payment_id=p_payment_id;
  with removed as (delete from private.bank_reconciliation_transactions r where r.payment_id=p_payment_id returning r.receipt_id)
  select array_agg(distinct receipt_id) into affected from removed;
  if affected is not null then delete from private.bank_reconciliation_receipts r where r.id=any(affected)
    and not exists(select 1 from private.bank_reconciliation_transactions x where x.receipt_id=r.id); end if;
end; $$;

create or replace function private.release_bank_reconciliation_after_reopen()
returns trigger language plpgsql security definer set search_path = '' as $$
declare payment uuid; root_id bigint;
begin
  root_id:=case when tg_op='DELETE' then old.transacao_pai_id else new.id end;
  if tg_op='UPDATE' and old.status='paga' and new.status='pendente' then
    select r.id into payment from private.transaction_completion_receipts r where r.root_transaction_id=new.id and r.payment_transaction_id=old.id and r.reopened_at is null order by r.payment_sequence desc limit 1;
  elsif tg_op='DELETE' and old.transacao_pai_id is not null then
    select r.id into payment from private.transaction_completion_receipts r where r.root_transaction_id=old.transacao_pai_id and r.payment_transaction_id=old.id and r.reopened_at is null order by r.payment_sequence desc limit 1;
  else return coalesce(new,old); end if;
  if payment is not null then perform private.release_bank_reconciliation_for_payment(payment);
  elsif not exists(select 1 from private.transaction_completion_receipts r where r.root_transaction_id=root_id) then perform private.release_bank_reconciliation_for_transaction(root_id); end if;
  return coalesce(new,old);
end; $$;

create or replace function public.get_transaction_payment_history(p_transaction_id bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare caller uuid:=auth.uid(); root_id bigint; summary_value jsonb; payments_value jsonb;
begin
  if caller is null then raise exception using errcode='42501',message='TRANSACTION_AUTH_REQUIRED'; end if;
  select coalesce(t.transacao_pai_id,t.id) into root_id from public.transacoes t where t.id=p_transaction_id;
  if not found then raise exception using errcode='P0001',message='TRANSACTION_NOT_FOUND'; end if;
  perform private.ai_assert_transaction(caller,root_id);
  select to_jsonb(s) into summary_value from public.list_transaction_payment_summaries(array[root_id]) s;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'payment_sequence',p.payment_sequence,'transaction_id',p.payment_transaction_id,'value',p.realized_value,'realization_date',p.realization_date,'adjustment_type',p.adjustment_type,'adjustment_value',p.adjustment_value,'active',p.reopened_at is null,'reopened_at',p.reopened_at,'created_at',p.created_at,'reconciled',p.reopened_at is null and (exists(select 1 from private.bank_reconciliation_receipts br where br.user_id=caller and br.payment_id=p.id) or exists(select 1 from private.bank_reconciliation_transactions rt join private.bank_reconciliation_receipts br on br.id=rt.receipt_id where br.user_id=caller and rt.payment_id=p.id))) order by p.payment_sequence,p.created_at,p.id),'[]'::jsonb)
  into payments_value from private.transaction_completion_receipts p where p.root_transaction_id=root_id;
  return jsonb_build_object('ok',true,'summary',summary_value,'payments',payments_value);
end; $$;
revoke all on function public.get_transaction_payment_history(bigint) from public,anon;
grant execute on function public.get_transaction_payment_history(bigint) to authenticated;
comment on function public.get_transaction_payment_history(bigint) is 'Retorna o historico de baixas e o estado individual de conciliacao sem expor dados do extrato.';
commit;
