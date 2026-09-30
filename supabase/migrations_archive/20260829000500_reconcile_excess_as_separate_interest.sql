begin;

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
  interest_result jsonb;
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
  interest_value := round(p_entry_amount-transaction_row.valor,2);
  if interest_value<=0 then raise exception using errcode='22023',message='RECONCILIATION_EXCESS_CONFIRMATION_REQUIRED'; end if;

  completion_result := public.complete_transaction_with_partial(transaction_row.id,transaction_row.valor,
    'none',0,transaction_row.valor,p_entry_date,p_idempotency_key);
  if completion_result is null or completion_result->>'ok'<>'true' then
    raise exception using errcode='P0001',message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
  end if;
  interest_result := public.execute_manual_financial_action('create_transaction',jsonb_build_object(
      'type',p_entry_type,'value',interest_value,
      'description',left('Juros de '||trim(transaction_row.descricao),100),
      'status','paga','scheduled_date',p_entry_date::text,'realization_date',p_entry_date::text,
      'account_id',p_account_id,'category_id',transaction_row.categoria_id,'frequency','unica'
    ),extensions.gen_random_uuid(),caller,p_client_created_at);
  if interest_result is null or interest_result->>'ok'<>'true' then
    raise exception using errcode='P0001',message='RECONCILIATION_CREATION_NOT_CONFIRMED';
  end if;
  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,entry_type,
    entry_amount,reconciliation_mode,transaction_id,idempotency_key)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    'existing',transaction_row.id,p_idempotency_key) returning * into existing;
  return jsonb_build_object('ok',true,'receipt_id',existing.id,'transaction_id',transaction_row.id,
    'interest_value',interest_value,'completion',completion_result,'interest',interest_result);
end;
$$;

revoke all on function public.reconcile_bank_statement_excess_interest(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz) from public,anon;
grant execute on function public.reconcile_bank_statement_excess_interest(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz) to authenticated;

commit;
