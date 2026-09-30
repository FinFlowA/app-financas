-- Permite que uma saída do extrato quite uma fatura sem criar uma despesa
-- duplicada. Pagamento e recibo de conciliação são gravados na mesma transação.
begin;

create or replace function public.reconcile_bank_invoice_entry(
  p_account_id bigint,
  p_entry_fingerprint text,
  p_entry_date date,
  p_entry_amount numeric,
  p_card_id bigint,
  p_invoice_month text,
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
  invoice_total numeric;
  payment_result jsonb;
  payment_transaction_id bigint;
  payment_mode text;
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
     or p_entry_amount is null or p_entry_amount <= 0 or p_entry_amount > 999999999999.99
     or p_invoice_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_ENTRY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text||':'||p_account_id::text||':'||p_entry_fingerprint,82901)
  );
  select * into existing from private.bank_reconciliation_receipts r
   where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;

  if not exists (
    select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
      and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))
  ) then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;
  if not exists (
    select 1 from public.cartoes c where c.id=p_card_id and c.user_id=caller and coalesce(c.ativo,true)
  ) then raise exception using errcode='22023', message='RECONCILIATION_INVOICE_UNAVAILABLE'; end if;

  perform 1 from public.fatura_itens i
   where i.user_id=caller and i.cartao_id=p_card_id and i.mes_fatura=p_invoice_month and not i.pago
   order by i.id for update;
  select round(coalesce(sum(i.valor),0),2) into invoice_total
    from public.fatura_itens i
   where i.user_id=caller and i.cartao_id=p_card_id and i.mes_fatura=p_invoice_month and not i.pago;
  if invoice_total <= 0 or round(p_entry_amount,2) > invoice_total then
    raise exception using errcode='22023', message='RECONCILIATION_INVOICE_AMOUNT_MISMATCH';
  end if;

  payment_mode := case when round(p_entry_amount,2)=invoice_total then 'full' else 'keep_open' end;
  payment_result := public.finance_pay_invoice(
    p_card_id,p_invoice_month,p_account_id,round(p_entry_amount,2),payment_mode,null,null,p_idempotency_key
  );
  payment_transaction_id := (payment_result->>'payment_transaction_id')::bigint;
  if payment_transaction_id is null then
    raise exception using errcode='P0001', message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
  end if;

  -- A data financeira deve ser a data efetiva do banco, não o dia da importação.
  update public.transacoes set data_vencimento=p_entry_date,data_realizacao=p_entry_date
   where id=payment_transaction_id and user_id=caller;

  insert into private.bank_reconciliation_receipts(
    user_id,account_id,entry_fingerprint,entry_date,entry_type,entry_amount,
    reconciliation_mode,transaction_id,idempotency_key
  ) values (
    caller,p_account_id,p_entry_fingerprint,p_entry_date,'despesa',round(p_entry_amount,2),
    'existing',payment_transaction_id,p_idempotency_key
  ) returning * into existing;

  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',existing.id,
    'transaction_id',payment_transaction_id,'result',payment_result);
end;
$$;

revoke all on function public.reconcile_bank_invoice_entry(bigint,text,date,numeric,bigint,text,uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.reconcile_bank_invoice_entry(bigint,text,date,numeric,bigint,text,uuid,uuid,timestamptz)
  to authenticated;

commit;
