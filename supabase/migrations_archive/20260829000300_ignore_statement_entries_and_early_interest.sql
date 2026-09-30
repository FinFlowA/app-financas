begin;

alter table private.bank_reconciliation_receipts
  drop constraint if exists bank_reconciliation_receipts_reconciliation_mode_check;
alter table private.bank_reconciliation_receipts
  add constraint bank_reconciliation_receipts_reconciliation_mode_check
  check (reconciliation_mode in ('existing','new','ignored'));

create or replace function public.ignore_bank_statement_entry(
  p_account_id bigint, p_entry_fingerprint text, p_entry_date date,
  p_entry_type text, p_entry_amount numeric, p_idempotency_key uuid,
  p_expected_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  receipt private.bank_reconciliation_receipts%rowtype;
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_account_id is null or p_entry_fingerprint !~ '^[0-9a-f]{64}$' or p_entry_date is null
    or p_entry_type not in ('receita','despesa') or p_entry_amount<=0 or p_idempotency_key is null then
    raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY';
  end if;
  if not exists(select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
    and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))) then
    raise exception using errcode='42501',message='RECONCILIATION_ACCOUNT_DENIED';
  end if;
  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,
    entry_type,entry_amount,reconciliation_mode,transaction_id,idempotency_key)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    'ignored',null,p_idempotency_key)
  on conflict(user_id,account_id,entry_fingerprint) do nothing;
  select * into receipt from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  return jsonb_build_object('ok',true,'receipt_id',receipt.id,'ignored',receipt.reconciliation_mode='ignored');
end;
$$;

revoke all on function public.ignore_bank_statement_entry(bigint,text,date,text,numeric,uuid,uuid) from public,anon;
grant execute on function public.ignore_bank_statement_entry(bigint,text,date,text,numeric,uuid,uuid) to authenticated;

-- A diferença confirmada pelo usuário pode representar juros ou tarifa mesmo
-- quando debitada antes da data originalmente agendada.
do $$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.complete_transaction_with_partial(bigint,numeric,text,numeric,numeric,date,uuid)'::regprocedure
  ) into definition;
  if pg_catalog.strpos(definition,'if p_realization_date <= root_row.data_vencimento')=0 then
    raise exception 'COMPLETE_TRANSACTION_INTEREST_GUARD_NOT_FOUND';
  end if;
  definition := pg_catalog.replace(definition,
    'if p_realization_date <= root_row.data_vencimento',
    'if false and p_realization_date <= root_row.data_vencimento');
  execute definition;
end;
$$;

commit;
