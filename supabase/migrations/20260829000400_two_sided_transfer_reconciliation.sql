begin;

create or replace function public.list_pending_bank_transfer_counterparts()
returns table(
  transaction_id bigint, account_id bigint, entry_type text,
  description text, due_date date, amount numeric
)
language sql
stable
security definer
set search_path = ''
as $$
  with reconciled as (
    select r.transaction_id, min(r.account_id) as reconciled_account, count(*) as side_count
    from private.bank_reconciliation_receipts r
    where r.user_id=auth.uid() and r.transaction_id is not null
    group by r.transaction_id
  ), transfers as (
    select t.*, nullif((regexp_match(t.descricao,'\[Destino:([0-9]+)\]'))[1],'')::bigint as destination_id
    from public.transacoes t join reconciled r on r.transaction_id=t.id and r.side_count=1
    where t.status='paga' and t.transacao_pai_id is null and coalesce(t.descricao,'') like '[Transf.]%'
  )
  select t.id,
    case when r.reconciled_account=t.conta_id then t.destination_id else t.conta_id end,
    case when r.reconciled_account=t.conta_id then 'receita' else 'despesa' end,
    t.descricao,t.data_vencimento,t.valor
  from transfers t join reconciled r on r.transaction_id=t.id
  where t.destination_id is not null
    and r.reconciled_account in (t.conta_id,t.destination_id)
    and exists(select 1 from public.contas c
      where c.id=case when r.reconciled_account=t.conta_id then t.destination_id else t.conta_id end
      and not coalesce(c.arquivado,false)
      and (c.user_id=auth.uid() or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,auth.uid()))));
$$;

revoke all on function public.list_pending_bank_transfer_counterparts() from public,anon;
grant execute on function public.list_pending_bank_transfer_counterparts() to authenticated;

create or replace function public.reconcile_bank_transfer_entry(
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
  destination_id bigint;
  prior_account bigint;
  action_result jsonb;
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_account_id is null or p_entry_fingerprint !~ '^[0-9a-f]{64}$' or p_entry_date is null
    or p_entry_type not in ('receita','despesa') or p_entry_amount<=0 or p_transaction_id is null
    or p_idempotency_key is null or p_client_created_at is null then
    raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finflow:bank-transfer:'||p_transaction_id::text,82903));
  select * into existing from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;
  if not exists(select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
    and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))) then
    raise exception using errcode='42501',message='RECONCILIATION_ACCOUNT_DENIED';
  end if;
  select * into transaction_row from public.transacoes t where t.id=p_transaction_id
    and t.transacao_pai_id is null and coalesce(t.descricao,'') like '[Transf.]%' for update;
  if not found then raise exception using errcode='22023',message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  destination_id := nullif((regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]'))[1],'')::bigint;
  if not ((p_entry_type='despesa' and transaction_row.conta_id=p_account_id)
       or (p_entry_type='receita' and destination_id=p_account_id))
     or round(p_entry_amount,2)<>round(transaction_row.valor,2) then
    raise exception using errcode='22023',message='RECONCILIATION_TRANSFER_REQUIRES_EXACT_VALUE';
  end if;
  select r.account_id into prior_account from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.transaction_id=transaction_row.id limit 1;
  if transaction_row.status='pendente' and prior_account is null then
    action_result := public.execute_manual_financial_action('complete_transaction',
      jsonb_build_object('transaction_id',transaction_row.id,'realization_date',p_entry_date::text,
        'expected_value',transaction_row.valor,'realized_value',transaction_row.valor),
      p_idempotency_key,caller,p_client_created_at);
  elsif transaction_row.status='paga' and prior_account is not null and prior_account<>p_account_id then
    action_result := jsonb_build_object('ok',true,'counterpart_only',true);
  else
    raise exception using errcode='22023',message='RECONCILIATION_TRANSFER_SIDE_UNAVAILABLE';
  end if;
  if action_result is null or action_result->>'ok'<>'true' then
    raise exception using errcode='P0001',message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
  end if;
  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,entry_type,
    entry_amount,reconciliation_mode,transaction_id,idempotency_key)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    'existing',transaction_row.id,p_idempotency_key) returning * into existing;
  return jsonb_build_object('ok',true,'receipt_id',existing.id,'transaction_id',transaction_row.id,'result',action_result);
end;
$$;

revoke all on function public.reconcile_bank_transfer_entry(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.reconcile_bank_transfer_entry(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz) to authenticated;

commit;
