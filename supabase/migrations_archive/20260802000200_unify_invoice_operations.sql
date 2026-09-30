-- FinFlow: unifica pagamentos de fatura manuais e da IA no mesmo executor
-- transacional. Clientes antigos deixam de poder montar pagamentos em etapas.

begin;

do $$
begin
  if to_regclass('private.ai_invoice_payment_ledger') is null
     or to_regprocedure('private.ai_prepare_action(uuid,text,jsonb)') is null
     or to_regprocedure('private.ai_execute_card_action(uuid,text,jsonb,uuid)') is null
     or to_regprocedure('private.ai_assert_authenticated()') is null then
    raise exception 'AI_SCHEMA_MISSING_SECURE_INVOICE_CORE';
  end if;
end;
$$;

alter table private.ai_invoice_payment_ledger
  add column source text not null default 'ai',
  add column request_id uuid,
  add column reversal_request_id uuid,
  add column operation_result jsonb,
  add column reversal_result jsonb,
  add constraint ai_invoice_payment_ledger_source_check
    check (source in ('ai','manual','legacy')),
  add constraint ai_invoice_payment_ledger_operation_result_size_check
    check (operation_result is null or octet_length(operation_result::text)<=32768),
  add constraint ai_invoice_payment_ledger_reversal_result_size_check
    check (reversal_result is null or octet_length(reversal_result::text)<=32768);

create unique index ai_invoice_payment_ledger_user_request_uidx
  on private.ai_invoice_payment_ledger(user_id,request_id)
  where request_id is not null;

create unique index ai_invoice_payment_ledger_user_reversal_request_uidx
  on private.ai_invoice_payment_ledger(user_id,reversal_request_id)
  where reversal_request_id is not null;

alter table private.ai_invoice_payment_ledger enable row level security;
revoke all on private.ai_invoice_payment_ledger from public,anon,authenticated;
grant all on private.ai_invoice_payment_ledger to service_role;

-- Consulta mínima usada pelo trigger SECURITY INVOKER. Ela revela somente se um
-- item do próprio usuário está protegido; o ledger e seus detalhes seguem privados.
create or replace function public.finance_is_invoice_item_protected(p_item_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when (select auth.uid()) is null then true
    else exists(
      select 1
      from private.ai_invoice_payment_ledger l
      where l.user_id=(select auth.uid())
        and l.reversed_at is null
        and (
          l.linked_item_id=p_item_id
          or p_item_id=any(l.paid_item_ids)
        )
    )
  end;
$$;

revoke all on function public.finance_is_invoice_item_protected(bigint)
  from public,anon;
grant execute on function public.finance_is_invoice_item_protected(bigint)
  to authenticated,service_role;

-- O trigger é invoker de propósito: DML direto chega como authenticated e é
-- bloqueado; o executor canônico SECURITY DEFINER chega como o dono da função.
create or replace function private.finance_guard_invoice_transaction_dml()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_is_payment boolean:=false;
  new_is_payment boolean:=false;
begin
  if current_user not in ('authenticated','anon') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op<>'INSERT' then
    old_is_payment:=coalesce(old.descricao,'') like '%[PagFatura:%';
  end if;
  if tg_op<>'DELETE' then
    new_is_payment:=coalesce(new.descricao,'') like '%[PagFatura:%';
  end if;
  if old_is_payment or new_is_payment then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_TRANSACTION_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.finance_guard_invoice_item_dml()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  old_is_synthetic boolean:=false;
  new_is_synthetic boolean:=false;
begin
  if current_user not in ('authenticated','anon') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op<>'INSERT' then
    old_is_synthetic:=old.descricao='Pagamento parcial da fatura'
      or coalesce(old.descricao,'')~'^Saldo da fatura anterior \(.+\)$';
  end if;
  if tg_op<>'DELETE' then
    new_is_synthetic:=new.descricao='Pagamento parcial da fatura'
      or coalesce(new.descricao,'')~'^Saldo da fatura anterior \(.+\)$';
  end if;

  if old_is_synthetic or new_is_synthetic then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_SYNTHETIC_ITEM_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='INSERT' and coalesce(new.pago,false) then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_PAID_STATE_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='UPDATE' and new.pago is distinct from old.pago then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_PAID_STATE_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='DELETE' and coalesce(old.pago,false) then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_PAID_ITEM_DIRECT_DELETE_FORBIDDEN';
  end if;
  if tg_op in ('UPDATE','DELETE')
     and public.finance_is_invoice_item_protected(old.id) then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_LEDGER_ITEM_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create trigger finance_guard_invoice_transaction_dml
before insert or update or delete on public.transacoes
for each row execute function private.finance_guard_invoice_transaction_dml();

create trigger finance_guard_invoice_item_dml
before insert or update or delete on public.fatura_itens
for each row execute function private.finance_guard_invoice_item_dml();

revoke all on function private.finance_guard_invoice_transaction_dml()
  from public,anon,authenticated;
revoke all on function private.finance_guard_invoice_item_dml()
  from public,anon,authenticated;

-- Concilia somente três formatos legados cuja reversão pode ser reconstruída
-- exatamente. Qualquer divergência falha fechado e não altera dado algum.
create or replace function private.finance_try_backfill_legacy_invoice_payment(
  caller uuid,
  payment_transaction_id bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  tx record;
  marker text[];
  linked record;
  ledger_mode text;
  candidate_ids bigint[]:='{}';
  candidate_count integer:=0;
  other_payments integer:=0;
  invoice_total numeric:=0;
  remaining_amount numeric:=0;
  all_paid boolean:=false;
  has_synthetic boolean:=false;
begin
  select * into tx
  from public.transacoes t
  where t.id=payment_transaction_id and t.user_id=caller
  for update;
  if not found then perform private.ai_fail('AI_PAYMENT_TRANSACTION_NOT_FOUND'); end if;

  if exists(
    select 1 from private.ai_invoice_payment_ledger l
    where l.payment_transaction_id=payment_transaction_id and l.user_id=caller
  ) then return true; end if;

  marker:=regexp_match(tx.descricao,
    '\[PagFatura:([0-9]+):([0-9]{4}-[0-9]{2}):(total|parcial|saldo_transferido)(?::([0-9]+))?\]\s*$');
  if marker is null or tx.tipo<>'despesa' or tx.status<>'paga' or tx.valor<=0 then
    perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
  end if;
  perform private.ai_assert_card(caller,marker[1]::bigint,false);

  if marker[3] in ('total','saldo_transferido') then
    select count(*) into other_payments
    from public.transacoes other_tx
    where other_tx.user_id=caller and other_tx.id<>payment_transaction_id
      and other_tx.descricao like '%[PagFatura:'||marker[1]||':'||marker[2]||':%';
    if other_payments<>0 then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;

    perform 1 from public.fatura_itens i
    where i.user_id=caller and i.cartao_id=marker[1]::bigint and i.mes_fatura=marker[2]
    order by i.id for update;
    select count(*),coalesce(sum(i.valor),0),coalesce(bool_and(i.pago),false),
      coalesce(array_agg(i.id order by i.id),'{}'::bigint[]),
      coalesce(bool_or(
        i.descricao='Pagamento parcial da fatura'
        or coalesce(i.descricao,'')~'^Saldo da fatura anterior \(.+\)$'
      ),false)
    into candidate_count,invoice_total,all_paid,candidate_ids,has_synthetic
    from public.fatura_itens i
    where i.user_id=caller and i.cartao_id=marker[1]::bigint and i.mes_fatura=marker[2];
    if candidate_count=0 or not all_paid or has_synthetic then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
  end if;

  if marker[3]='total' then
    if marker[4] is not null or round(invoice_total,2)<>round(tx.valor,2) then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
    ledger_mode:='total';

  elsif marker[3]='parcial' then
    if marker[4] is null then perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED'); end if;
    select * into linked from public.fatura_itens i
    where i.id=marker[4]::bigint and i.user_id=caller
      and i.cartao_id=marker[1]::bigint and i.mes_fatura=marker[2]
    for update;
    if not found or linked.pago
       or linked.descricao<>'Pagamento parcial da fatura'
       or round(linked.valor,2)<>-round(tx.valor,2) then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
    candidate_ids:='{}';
    ledger_mode:='partial';

  elsif marker[3]='saldo_transferido' then
    if marker[4] is null or invoice_total<=tx.valor then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
    remaining_amount:=round(invoice_total-tx.valor,2);
    select * into linked from public.fatura_itens i
    where i.id=marker[4]::bigint and i.user_id=caller
      and i.cartao_id=marker[1]::bigint
      and i.mes_fatura=private.ai_add_month(marker[2],1)
    for update;
    if not found or linked.pago
       or linked.descricao<>'Saldo da fatura anterior ('||marker[2]||')'
       or round(linked.valor,2)<remaining_amount then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
    ledger_mode:='carry_forward';
  else
    perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
  end if;

  insert into private.ai_invoice_payment_ledger(
    payment_transaction_id,action_id,user_id,card_id,invoice_month,mode,
    paid_item_ids,linked_item_id,source
  ) values(
    payment_transaction_id,null,caller,marker[1]::bigint,marker[2],ledger_mode,
    candidate_ids,case when marker[4] is null then null else marker[4]::bigint end,'legacy'
  ) on conflict(payment_transaction_id) do nothing;
  return true;
end;
$$;

revoke all on function private.finance_try_backfill_legacy_invoice_payment(uuid,bigint)
  from public,anon,authenticated;

-- Ponto canônico para pagar ou estornar faturas. Tanto a confirmação da IA
-- quanto os RPCs usados pelas telas manuais passam por este executor. No estorno
-- de um pagamento anterior ao ledger, ele tenta uma reconstrução conservadora;
-- qualquer ambiguidade falha fechado antes de alterar dados financeiros.
create or replace function private.finance_execute_invoice_action(
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
  payment_transaction_id bigint;
begin
  if action_name not in ('pay_invoice','reverse_invoice_payment') then
    perform private.ai_fail('AI_UNSUPPORTED_CARD_ACTION');
  end if;

  if action_name='reverse_invoice_payment' then
    payment_transaction_id:=(payload->>'transaction_id')::bigint;
    perform pg_advisory_xact_lock(
      hashtext(caller::text),
      hashtext('invoice-reversal:'||payment_transaction_id::text)
    );
    if not exists(
      select 1
      from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=payment_transaction_id
        and l.user_id=caller
    ) then
      perform private.finance_try_backfill_legacy_invoice_payment(
        caller,payment_transaction_id
      );
    end if;
  end if;

  return private.ai_execute_card_action(
    caller,action_name,payload,pending_action_id
  );
end;
$$;

revoke all on function private.finance_execute_invoice_action(uuid,text,jsonb,uuid)
  from public,anon,authenticated;

-- Mantém o despachante da IA alinhado ao executor canônico acima. As demais
-- ações continuam usando os executores restritos da migração-base.
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
declare
  prepared jsonb;
  normalized jsonb;
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
    return private.ai_execute_transaction_action(caller,action_name,normalized);
  elsif action_name=any(array[
    'create_card_purchase','update_card_purchase','delete_card_purchase'
  ]) then
    return private.ai_execute_card_action(
      caller,action_name,normalized,pending_action_id
    );
  elsif action_name=any(array['pay_invoice','reverse_invoice_payment']) then
    return private.finance_execute_invoice_action(
      caller,action_name,normalized,pending_action_id
    );
  end if;
  perform private.ai_fail('AI_UNSUPPORTED_ACTION');
  return null;
end;
$$;

revoke all on function private.ai_execute_financial_action(uuid,text,jsonb,uuid)
  from public,anon,authenticated;

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
  result jsonb;
  payment_transaction_id bigint;
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

  payload:=jsonb_strip_nulls(jsonb_build_object(
    'card_id',p_card_id,
    'invoice_month',p_invoice_month,
    'account_id',p_account_id,
    'payment_amount',p_payment_amount,
    'remainder_mode',p_remainder_mode,
    'interest_value',p_interest_value,
    'interest_percent',p_interest_percent
  ));
  prepared:=private.ai_prepare_action(caller,'pay_invoice',payload);
  result:=private.finance_execute_invoice_action(
    caller,'pay_invoice',prepared->'payload',null
  );
  payment_transaction_id:=(result->>'payment_transaction_id')::bigint;

  update private.ai_invoice_payment_ledger l
  set source='manual',request_id=p_request_id,operation_result=result
  where l.payment_transaction_id=payment_transaction_id and l.user_id=caller;
  get diagnostics changed=row_count;
  if changed<>1 then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;

  return result||jsonb_build_object('source','manual','replayed',false);
end;
$$;

create or replace function public.finance_reverse_invoice_payment(
  p_transaction_id bigint,
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
  result jsonb;
  changed integer;
begin
  if p_request_id is null then perform private.ai_fail('AI_INVALID_REQUEST_ID'); end if;
  perform pg_advisory_xact_lock(hashtext(caller::text),hashtext(p_request_id::text));

  select * into existing
  from private.ai_invoice_payment_ledger l
  where l.user_id=caller and l.reversal_request_id=p_request_id
  for update;
  if found then
    return coalesce(existing.reversal_result,'{}'::jsonb)||jsonb_build_object(
      'payment_transaction_id',existing.payment_transaction_id,
      'card_id',coalesce(existing.card_id,(existing.reversal_result->>'card_id')::bigint),
      'invoice_month',existing.invoice_month,
      'source',existing.source,
      'reversed',true,
      'replayed',true
    );
  end if;

  prepared:=private.ai_prepare_action(
    caller,'reverse_invoice_payment',jsonb_build_object('transaction_id',p_transaction_id)
  );
  result:=private.finance_execute_invoice_action(
    caller,'reverse_invoice_payment',prepared->'payload',null
  );

  update private.ai_invoice_payment_ledger l
  set reversal_request_id=p_request_id,reversal_result=result
  where l.payment_transaction_id=p_transaction_id and l.user_id=caller
    and l.reversed_at is not null;
  get diagnostics changed=row_count;
  if changed<>1 then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;
  select * into existing
  from private.ai_invoice_payment_ledger l
  where l.user_id=caller and l.payment_transaction_id=p_transaction_id;
  if not found then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;
  return result||jsonb_build_object('source',existing.source,'replayed',false);
end;
$$;

revoke all on function public.finance_pay_invoice(bigint,text,bigint,numeric,text,numeric,numeric,uuid)
  from public,anon;
revoke all on function public.finance_reverse_invoice_payment(bigint,uuid)
  from public,anon;
grant execute on function public.finance_pay_invoice(bigint,text,bigint,numeric,text,numeric,numeric,uuid)
  to authenticated,service_role;
grant execute on function public.finance_reverse_invoice_payment(bigint,uuid)
  to authenticated,service_role;

-- Rate limiter de custo: o cliente pode pedir um limite menor por minuto, mas
-- nunca elevar o teto de 30/min nem a franquia diária definida pelo plano.
create or replace function public.ai_reserve_model_request(
  p_limit integer default 30,
  p_window_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid:=private.ai_assert_authenticated();
  entitlement record;
  effective_limit integer:=least(greatest(coalesce(p_limit,30),1),30);
  effective_window integer:=least(greatest(coalesce(p_window_seconds,60),60),3600);
  now_at timestamptz:=clock_timestamp();
  local_day date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  day_start timestamptz;
  day_end timestamptz;
  daily_limit integer;
  daily_used integer;
  minute_used integer;
  oldest_at timestamptz;
  retry_after integer:=0;
begin
  select * into entitlement from public.get_my_entitlement();
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;
  daily_limit:=case
    when not coalesce(entitlement.limits_enabled,false) then 300
    when entitlement.plan='premium' then 200
    when entitlement.plan='smart' then 60
    else 0
  end;
  day_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  day_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';

  perform pg_advisory_xact_lock(hashtext(caller::text),61001);
  delete from public.ai_request_usage
  where user_id=caller and created_at<day_start-interval '1 day';
  select count(*) into daily_used from public.ai_request_usage
  where user_id=caller and created_at>=day_start and created_at<day_end;
  if daily_used>=daily_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','daily','retry_after',retry_after,
      'limit',effective_limit,'used',0,'remaining',0,'window_seconds',effective_window,
      'daily_limit',daily_limit,'daily_used',daily_used,'daily_remaining',0,
      'daily_window_start',day_start,'daily_window_end',day_end,
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),min(created_at) into minute_used,oldest_at
  from public.ai_request_usage
  where user_id=caller and created_at>now_at-make_interval(secs=>effective_window);
  if minute_used>=effective_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      oldest_at+make_interval(secs=>effective_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','minute','retry_after',retry_after,
      'limit',effective_limit,'used',minute_used,'remaining',0,
      'window_seconds',effective_window,
      'daily_limit',daily_limit,'daily_used',daily_used,
      'daily_remaining',greatest(daily_limit-daily_used,0),
      'daily_window_start',day_start,'daily_window_end',day_end,
      'timezone','America/Sao_Paulo'
    );
  end if;

  insert into public.ai_request_usage(user_id,created_at) values(caller,now_at);
  minute_used:=minute_used+1;
  daily_used:=daily_used+1;
  return jsonb_build_object(
    'allowed',true,'reason',null,'retry_after',0,
    'limit',effective_limit,'used',minute_used,
    'remaining',greatest(effective_limit-minute_used,0),
    'window_seconds',effective_window,
    'daily_limit',daily_limit,'daily_used',daily_used,
    'daily_remaining',greatest(daily_limit-daily_used,0),
    'daily_window_start',day_start,'daily_window_end',day_end,
    'timezone','America/Sao_Paulo'
  );
end;
$$;

revoke all on function public.ai_reserve_model_request(integer,integer)
  from public,anon;
grant execute on function public.ai_reserve_model_request(integer,integer)
  to authenticated,service_role;

commit;
