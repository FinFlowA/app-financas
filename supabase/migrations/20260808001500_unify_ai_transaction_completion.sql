-- FinFlow: a IA confirma e reabre lançamentos pelas mesmas RPCs atômicas da UI.
-- A proposta pendente é a chave idempotente, portanto retry não duplica baixa
-- nem o lançamento criado para um eventual saldo restante.
-- IMPORTANTE: depende de 20260802000100 (nucleo/locks da IA) e de 20260808001100
-- (RPCs canonicas). A sequencia nova deve ser aplicada integralmente e em ordem;
-- nao publique/aplique esta migracao isoladamente.
begin;

create or replace function private.ai_execute_transaction_action_v2(
  caller uuid,
  action_name text,
  payload jsonb,
  pending_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transaction_row public.transacoes%rowtype;
  prepared jsonb;
  normalized jsonb;
  expected_value numeric(14,2);
  realized_value numeric(14,2);
  adjustment_type text := 'none';
  adjustment_value numeric(14,2) := 0;
  raw_adjustment numeric;
  result_value jsonb;
  canonical_error text;
  common_transaction boolean;
begin
  if action_name not in ('complete_transaction','reopen_transaction') then
    return private.ai_execute_transaction_action(caller,action_name,payload);
  end if;
  if caller is null or caller is distinct from (select auth.uid()) or pending_action_id is null then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:transaction:'||(payload->>'transaction_id'),73117)
  );

  -- Resolve primeiro sem confiar nessa leitura, trava parceria/conta e só
  -- então bloqueia e revalida o lançamento que será efetivamente alterado.
  select t.* into transaction_row
  from public.transacoes t
  where t.id=(payload->>'transaction_id')::bigint;
  if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
  perform private.ai_lock_account(
    caller,transaction_row.conta_id,false,action_name='complete_transaction'
  );
  select t.* into transaction_row
  from public.transacoes t
  where t.id=(payload->>'transaction_id')::bigint
    and t.conta_id=transaction_row.conta_id
  for update;
  if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;

  prepared:=private.ai_prepare_action(caller,action_name,payload);
  normalized:=prepared->'payload';
  perform private.ai_assert_transaction(caller,(normalized->>'transaction_id')::bigint);

  if coalesce(transaction_row.descricao,'') like '%[PagFatura:%' then
    perform private.ai_fail('AI_USE_INVOICE_REVERSAL');
  end if;

  common_transaction:=transaction_row.tipo in ('receita','despesa')
    and transaction_row.categoria_id is not null
    and coalesce(transaction_row.descricao,'') not like '[Transf.] %'
    and coalesce(transaction_row.descricao,'') !~ '\[(Destino:|Objetivo:|PagFatura:)';

  if common_transaction then
    -- A categoria histórica pode estar arquivada, mas precisa continuar
    -- existindo, pertencer ao titular do lançamento e ser compatível.
    perform 1 from public.categorias c
    where c.id=transaction_row.categoria_id
      and c.user_id=transaction_row.user_id
      and c.tipo in (transaction_row.tipo,'ambos')
    for share;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE'); end if;

    begin
      if action_name='reopen_transaction' then
        result_value:=public.reopen_transaction_completion(
          (normalized->>'transaction_id')::bigint,
          pending_action_id
        );
        return result_value||jsonb_build_object('reopened',true);
      end if;

      expected_value:=round((normalized->>'expected_value')::numeric,2);
      realized_value:=round((normalized->>'realized_value')::numeric,2);
      if normalized?'interest_value' then
        raw_adjustment:=round((normalized->>'interest_value')::numeric,2);
        if raw_adjustment>0 then
          adjustment_type:='interest'; adjustment_value:=raw_adjustment;
        elsif raw_adjustment<0 then
          adjustment_type:='discount'; adjustment_value:=abs(raw_adjustment);
        end if;
      elsif normalized?'interest_percent' then
        raw_adjustment:=round((normalized->>'interest_percent')::numeric,4);
        if raw_adjustment>0 then
          adjustment_type:='interest';
          adjustment_value:=round(expected_value*raw_adjustment/100,2);
        end if;
      end if;

      result_value:=public.complete_transaction_with_partial(
        (normalized->>'transaction_id')::bigint,
        expected_value,
        adjustment_type,
        adjustment_value,
        realized_value,
        (normalized->>'realization_date')::date,
        pending_action_id
      );
      return result_value||jsonb_build_object('completed',true);
    exception when others then
      get stacked diagnostics canonical_error=message_text;
      perform private.ai_fail(case canonical_error
        when 'TRANSACTION_AUTH_REQUIRED' then 'AI_AUTH_REQUIRED'
        when 'TRANSACTION_NOT_FOUND' then 'AI_TRANSACTION_NOT_FOUND'
        when 'TRANSACTION_ALREADY_COMPLETED' then 'AI_TRANSACTION_ALREADY_COMPLETED'
        when 'TRANSACTION_VALUE_CHANGED' then 'AI_TRANSACTION_VALUE_CHANGED'
        when 'TRANSACTION_ACCOUNT_ARCHIVED' then 'AI_ACCOUNT_ARCHIVED'
        when 'TRANSACTION_REALIZED_VALUE_TOO_HIGH' then 'AI_INVALID_REALIZED_VALUE'
        when 'TRANSACTION_ADJUSTMENT_INVALID' then 'AI_INVALID_TRANSACTION_ADJUSTMENT'
        when 'TRANSACTION_ADJUSTMENT_NOT_ALLOWED_BEFORE_DUE_DATE' then 'AI_TRANSACTION_ADJUSTMENT_NOT_ALLOWED'
        when 'TRANSACTION_COMPLETION_IDEMPOTENCY_CONFLICT' then 'AI_IDEMPOTENCY_CONFLICT'
        when 'TRANSACTION_COMPLETION_STATE_CONFLICT' then 'AI_ACTION_STATE_CHANGED'
        when 'TRANSACTION_COMPLETION_ALREADY_REOPENED' then 'AI_TRANSACTION_NOT_COMPLETED'
        when 'TRANSACTION_NOT_COMPLETED' then 'AI_TRANSACTION_NOT_COMPLETED'
        when 'TRANSACTION_REOPEN_IDEMPOTENCY_CONFLICT' then 'AI_IDEMPOTENCY_CONFLICT'
        when 'TRANSACTION_REOPEN_STATE_CONFLICT' then 'AI_ACTION_STATE_CHANGED'
        when 'TRANSACTION_REOPEN_REMAINDER_CHANGED' then 'AI_ACTION_STATE_CHANGED'
        when 'TRANSACTION_REOPEN_LEGACY_PARTIAL_UNSAFE' then 'AI_TRANSACTION_REOPEN_UNSAFE'
        else 'AI_TRANSACTION_COMPLETION_FAILED'
      end);
    end;
  end if;

  -- Transferências e objetivos continuam no executor especializado. Eles não
  -- representam receita/despesa parcial: a realização precisa ser integral e
  -- não aceita juros ou desconto.
  if action_name='complete_transaction' then
    expected_value:=round((normalized->>'expected_value')::numeric,2);
    realized_value:=round((normalized->>'realized_value')::numeric,2);
    if realized_value<>expected_value
       or normalized?'interest_value' or normalized?'interest_percent' then
      perform private.ai_fail('AI_INTERNAL_TRANSACTION_REQUIRES_FULL_VALUE');
    end if;
  end if;
  return private.ai_execute_transaction_action(caller,action_name,normalized);
end;
$$;

revoke all on function private.ai_execute_transaction_action_v2(uuid,text,jsonb,uuid)
  from public, anon, authenticated;

create or replace function private.ai_execute_financial_action(
  caller uuid,
  action_name text,
  payload jsonb,
  pending_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare prepared jsonb; normalized jsonb;
begin
  prepared:=private.ai_prepare_action(caller,action_name,payload);
  normalized:=prepared->'payload';
  if action_name=any(array[
    'create_account','update_account','archive_account','delete_account','reactivate_account',
    'create_category','update_category','archive_category','delete_category','reactivate_category',
    'create_goal','update_goal','archive_goal','delete_goal','reactivate_goal',
    'create_card','update_card','archive_card','delete_card','reactivate_card'
  ]) then
    return private.ai_execute_resource_action(caller,action_name,normalized);
  elsif action_name=any(array[
    'move_goal','create_transaction','update_transaction','delete_transaction',
    'complete_transaction','reopen_transaction','transfer_between_accounts'
  ]) then
    return private.ai_execute_transaction_action_v2(
      caller,action_name,normalized,pending_action_id
    );
  elsif action_name=any(array[
    'create_card_purchase','update_card_purchase','delete_card_purchase',
    'pay_invoice','reverse_invoice_payment'
  ]) then
    return private.ai_execute_card_action(caller,action_name,normalized,pending_action_id);
  end if;
  perform private.ai_fail('AI_UNSUPPORTED_ACTION');
  return null;
end;
$$;

revoke all on function private.ai_execute_financial_action(uuid,text,jsonb,uuid)
  from public, anon, authenticated;

commit;
