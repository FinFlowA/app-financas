-- O mesmo tipo de conflito de nome corrigido em finance_pay_invoice
-- (20260908000300) também existe aqui: a variável local `payment_transaction_id`
-- tem o mesmo nome da coluna `ai_invoice_payment_ledger.payment_transaction_id`,
-- e com plpgsql.variable_conflict=error isso falha com
-- "column reference \"payment_transaction_id\" is ambiguous" (42702) toda vez
-- que a branch reverse_invoice_payment é executada. Confirmado por teste manual
-- em 2026-09-19: todo estorno de pagamento de fatura (web e mobile) falha hoje.
begin;

create or replace function private.finance_execute_invoice_action(caller uuid, action_name text, payload jsonb, pending_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  payment_tx_id bigint;
begin
  if action_name not in ('pay_invoice','reverse_invoice_payment') then
    perform private.ai_fail('AI_UNSUPPORTED_CARD_ACTION');
  end if;

  if action_name='reverse_invoice_payment' then
    payment_tx_id:=(payload->>'transaction_id')::bigint;
    perform pg_advisory_xact_lock(
      hashtext(caller::text),
      hashtext('invoice-reversal:'||payment_tx_id::text)
    );
    if not exists(
      select 1
      from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=payment_tx_id
        and l.user_id=caller
    ) then
      perform private.finance_try_backfill_legacy_invoice_payment(
        caller,payment_tx_id
      );
    end if;
  end if;

  return private.ai_execute_card_action(
    caller,action_name,payload,pending_action_id
  );
end;
$$;

commit;
