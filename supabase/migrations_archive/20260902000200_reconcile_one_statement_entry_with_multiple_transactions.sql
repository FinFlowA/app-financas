-- Uma única linha do extrato pode representar a soma de vários agendamentos.
-- A baixa é atômica: todos são concluídos ou nenhum deles é alterado.

begin;

create table if not exists private.bank_reconciliation_transactions (
  receipt_id bigint not null references private.bank_reconciliation_receipts(id) on delete cascade,
  transaction_id bigint not null references public.transacoes(id) on delete restrict,
  amount numeric(14,2) not null check (amount > 0),
  primary key (receipt_id, transaction_id)
);

revoke all on table private.bank_reconciliation_transactions from public, anon, authenticated;
grant all on table private.bank_reconciliation_transactions to service_role;

create or replace function public.reconcile_bank_statement_entries(
  p_account_id bigint,
  p_entry_fingerprint text,
  p_entry_date date,
  p_entry_type text,
  p_entry_amount numeric,
  p_transaction_ids bigint[],
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
  existing private.bank_reconciliation_receipts%rowtype;
  receipt private.bank_reconciliation_receipts%rowtype;
  transaction_row public.transacoes%rowtype;
  transaction_id bigint;
  normalized_ids bigint[];
  selected_total numeric(20,2);
  completion_key uuid;
  completion_hash text;
  action_result jsonb;
  completed_ids bigint[] := '{}';
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
     or p_entry_type not in ('receita','despesa') or p_entry_amount is null
     or p_entry_amount <= 0 or p_entry_amount > 999999999999.99 then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_ENTRY';
  end if;

  select array_agg(id order by id) into normalized_ids
  from (select distinct unnest(p_transaction_ids) as id) selected;
  if coalesce(cardinality(normalized_ids),0) < 2 or cardinality(normalized_ids) > 50
     or array_position(normalized_ids,null) is not null then
    raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text||':'||p_account_id::text||':'||p_entry_fingerprint,82901)
  );
  select * into existing from private.bank_reconciliation_receipts r
  where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then
    return jsonb_build_object('ok',true,'replayed',true,'receipt_id',existing.id,
      'transaction_ids',(select coalesce(jsonb_agg(t.transaction_id order by t.transaction_id),'[]'::jsonb)
        from private.bank_reconciliation_transactions t where t.receipt_id=existing.id));
  end if;

  if not exists (
    select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
      and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))
  ) then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;

  perform 1 from public.transacoes t where t.id=any(normalized_ids) order by t.id for update;
  if (select count(*) from public.transacoes t where t.id=any(normalized_ids)) <> cardinality(normalized_ids)
     or exists (
       select 1 from public.transacoes t where t.id=any(normalized_ids)
         and (t.transacao_pai_id is not null or t.status not in ('pendente','paga') or t.conta_id<>p_account_id
           or t.tipo<>p_entry_type
           or (t.categoria_id is null and coalesce(t.descricao,'') !~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]')
           or coalesce(t.descricao,'') ~ '\[(PagFatura:|Destino:)')
     ) then
    raise exception using errcode='22023', message='RECONCILIATION_MULTIPLE_NOT_SUPPORTED';
  end if;

  select round(sum(t.valor),2) into selected_total
  from public.transacoes t where t.id=any(normalized_ids);
  if selected_total is distinct from round(p_entry_amount,2) then
    raise exception using errcode='22023', message='RECONCILIATION_MULTIPLE_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1 from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.account_id=p_account_id
      and (r.transaction_id=any(normalized_ids) or exists (
        select 1 from private.bank_reconciliation_transactions rt
        where rt.receipt_id=r.id and rt.transaction_id=any(normalized_ids)
      ))
  ) then
    raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE';
  end if;

  foreach transaction_id in array normalized_ids loop
    select * into transaction_row from public.transacoes t where t.id=transaction_id;
    if transaction_row.status='pendente' then
      completion_hash := md5(p_idempotency_key::text||':'||transaction_row.id::text);
      completion_key := (substr(completion_hash,1,8)||'-'||substr(completion_hash,9,4)||'-4'||
        substr(completion_hash,14,3)||'-8'||substr(completion_hash,18,3)||'-'||substr(completion_hash,21,12))::uuid;
      if coalesce(transaction_row.descricao,'') ~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]' then
        action_result := public.execute_manual_financial_action(
          'complete_transaction',
          jsonb_build_object('transaction_id',transaction_row.id,'realization_date',p_entry_date::text,
            'expected_value',transaction_row.valor,'realized_value',transaction_row.valor),
          completion_key,caller,p_client_created_at
        );
      else
        action_result := public.complete_transaction_with_partial(
          transaction_row.id, transaction_row.valor, 'none', 0,
          transaction_row.valor, p_entry_date, completion_key
        );
      end if;
      if action_result is null or action_result->>'ok'<>'true' then
        raise exception using errcode='P0001', message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
      end if;
    end if;
    completed_ids := array_append(completed_ids,transaction_row.id);
  end loop;

  insert into private.bank_reconciliation_receipts(
    user_id,account_id,entry_fingerprint,entry_date,entry_type,entry_amount,
    reconciliation_mode,transaction_id,idempotency_key
  ) values (
    caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,
    round(p_entry_amount,2),'existing',null,p_idempotency_key
  ) returning * into receipt;

  insert into private.bank_reconciliation_transactions(receipt_id,transaction_id,amount)
  select receipt.id,t.id,round(t.valor,2) from public.transacoes t where t.id=any(normalized_ids);

  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',receipt.id,
    'transaction_ids',to_jsonb(completed_ids),'total',selected_total);
end;
$$;

revoke all on function public.reconcile_bank_statement_entries(bigint,text,date,text,numeric,bigint[],uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.reconcile_bank_statement_entries(bigint,text,date,text,numeric,bigint[],uuid,uuid,timestamptz)
  to authenticated;

commit;
