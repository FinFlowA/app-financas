-- Remove a ambiguidade entre a variável PL/pgSQL e a coluna homônima do ledger.
begin;

create or replace function public.finance_pay_invoice(
  p_card_id bigint,
  p_invoice_month text,
  p_account_id bigint,
  p_payment_amount numeric,
  p_remainder_mode text,
  p_interest_value numeric,
  p_interest_percent numeric,
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  existing private.ai_invoice_payment_ledger%rowtype;
  prepared jsonb;
  payload jsonb;
  normalized jsonb;
  result jsonb;
  v_payment_transaction_id bigint;
  linked_item_id bigint;
  remaining_amount numeric:=0;
  interest_amount numeric:=0;
  changed integer;
begin
  if p_request_id is null then perform private.ai_fail('AI_INVALID_REQUEST_ID'); end if;
  perform pg_advisory_xact_lock(hashtext(caller::text),hashtext(p_request_id::text));

  select * into existing
  from private.ai_invoice_payment_ledger l
  where l.user_id=caller and l.request_id=p_request_id
  for update;
  if found then
    return coalesce(existing.operation_result,'{}'::jsonb)||jsonb_build_object(
      'payment_transaction_id',existing.payment_transaction_id,
      'card_id',coalesce(existing.card_id,(existing.operation_result->>'card_id')::bigint),
      'invoice_month',existing.invoice_month,
      'source',existing.source,
      'reversed',existing.reversed_at is not null,
      'replayed',true
    );
  end if;

  -- O normalizador-base aceita juros somente em carry. Para keep_open os juros
  -- são aplicados logo depois pelo próprio RPC, ainda na mesma transação.
  payload:=jsonb_strip_nulls(jsonb_build_object(
    'card_id',p_card_id,
    'invoice_month',p_invoice_month,
    'account_id',p_account_id,
    'payment_amount',p_payment_amount,
    'remainder_mode',p_remainder_mode,
    'interest_value',case when p_remainder_mode='carry' then p_interest_value else null end,
    'interest_percent',case when p_remainder_mode='carry' then p_interest_percent else null end
  ));
  prepared:=private.ai_prepare_action(caller,'pay_invoice',payload);
  normalized:=prepared->'payload';
  result:=private.finance_execute_invoice_action(caller,'pay_invoice',normalized,null);

  if p_remainder_mode='keep_open'
     and (p_interest_value is not null or p_interest_percent is not null) then
    remaining_amount:=(result->>'remaining')::numeric;
    if p_interest_value is not null then
      interest_amount:=round(p_interest_value,2);
    else
      interest_amount:=round(remaining_amount*p_interest_percent/100,2);
    end if;
    if interest_amount<0 then perform private.ai_fail('AI_INVALID_INTEREST'); end if;
    linked_item_id:=(result->>'linked_item_id')::bigint;
    if linked_item_id is null then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;
    update public.fatura_itens i
      set valor=round(i.valor+interest_amount,2)
      where i.id=linked_item_id and i.user_id=caller and not i.pago;
    get diagnostics changed=row_count;
    if changed<>1 then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;
    result:=result||jsonb_build_object(
      'remaining',round(remaining_amount+interest_amount,2),
      'interest',interest_amount
    );
  end if;

  v_payment_transaction_id:=(result->>'payment_transaction_id')::bigint;
  update private.ai_invoice_payment_ledger l
  set source='manual',request_id=p_request_id,operation_result=result
  where l.payment_transaction_id=v_payment_transaction_id and l.user_id=caller;
  get diagnostics changed=row_count;
  if changed<>1 then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;

  return result||jsonb_build_object('source','manual','replayed',false);
end;
$$;

revoke all on function public.finance_pay_invoice(bigint,text,bigint,numeric,text,numeric,numeric,uuid)
  from public,anon;
grant execute on function public.finance_pay_invoice(bigint,text,bigint,numeric,text,numeric,numeric,uuid)
  to authenticated,service_role;

commit;
