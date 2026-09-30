-- Permite estornar qualquer baixa isoladamente. As demais continuam ativas e
-- somente o principal daquela baixa volta ao lançamento pendente.
begin;

create or replace function public.reverse_selected_transaction_payment(
  p_transaction_id bigint,
  p_payment_id uuid,
  p_idempotency_key uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  root_row public.transacoes%rowtype;
  payment_row public.transacoes%rowtype;
  target private.transaction_completion_receipts%rowtype;
  final_receipt private.transaction_completion_receipts%rowtype;
  existing private.transaction_reopen_receipts%rowtype;
  replacement_payment_id bigint;
  restored_value numeric(20,2);
  paid_total numeric(20,2);
  remaining_value numeric(20,2);
  result_value jsonb;
begin
  if caller is null then raise exception using errcode='P0001',message='TRANSACTION_AUTH_REQUIRED'; end if;
  if p_transaction_id is null or p_payment_id is null or p_idempotency_key is null then
    raise exception using errcode='P0001',message='TRANSACTION_REOPEN_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finflow:transaction:'||p_transaction_id::text,73117));
  select t.* into root_row from public.transacoes t where t.id=p_transaction_id;
  if not found or root_row.transacao_pai_id is not null then raise exception using errcode='P0001',message='TRANSACTION_NOT_FOUND'; end if;
  perform private.ai_lock_account(caller,root_row.conta_id,false,false);
  select t.* into root_row from public.transacoes t where t.id=p_transaction_id and t.conta_id=root_row.conta_id for update;
  perform private.ai_assert_transaction(caller,p_transaction_id);

  select * into existing from private.transaction_reopen_receipts r
  where r.user_id=caller and r.idempotency_key=p_idempotency_key;
  if found then
    if existing.transaction_id is distinct from p_transaction_id or existing.completion_receipt_id is distinct from p_payment_id then
      raise exception using errcode='P0001',message='TRANSACTION_REOPEN_IDEMPOTENCY_CONFLICT';
    end if;
    return existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;

  select r.* into target from private.transaction_completion_receipts r
  where r.id=p_payment_id and r.root_transaction_id=p_transaction_id and r.reopened_at is null for update;
  if not found then raise exception using errcode='P0001',message='TRANSACTION_NOT_COMPLETED'; end if;

  -- O pagamento final usa a própria linha raiz. O fluxo já existente trata
  -- esse caso, inclusive lançamentos legados e validações de concorrência.
  if target.payment_transaction_id=root_row.id then
    return public.reverse_transaction_payment(p_transaction_id,p_payment_id,p_idempotency_key);
  end if;

  select t.* into payment_row from public.transacoes t
  where t.id=target.payment_transaction_id and t.transacao_pai_id=root_row.id and t.status='paga' for update;
  if not found then raise exception using errcode='P0001',message='TRANSACTION_REOPEN_STATE_CONFLICT'; end if;

  restored_value:=round(target.expected_value-target.remaining_value,2);
  if restored_value<=0 then raise exception using errcode='P0001',message='TRANSACTION_REOPEN_RESTORED_VALUE_INVALID'; end if;

  if root_row.status='paga' then
    -- A baixa mais recente ocupava a linha raiz. Convertemos somente essa baixa
    -- em filha técnica antes de devolver o valor selecionado ao saldo aberto.
    select r.* into final_receipt from private.transaction_completion_receipts r
    where r.root_transaction_id=root_row.id and r.payment_transaction_id=root_row.id and r.reopened_at is null
    order by r.payment_sequence desc,r.created_at desc,r.id desc limit 1 for update;
    if not found then raise exception using errcode='P0001',message='TRANSACTION_REOPEN_STATE_CONFLICT'; end if;

    perform private.finflow_authorize_payment_child_write(caller,root_row.id);
    insert into public.transacoes(user_id,tipo,valor,data_vencimento,data_realizacao,descricao,categoria_id,conta_id,status,transacao_pai_id)
    values(root_row.user_id,root_row.tipo,root_row.valor,root_row.data_vencimento,root_row.data_realizacao,root_row.descricao,root_row.categoria_id,root_row.conta_id,'paga',root_row.id)
    returning id into replacement_payment_id;
    perform pg_catalog.set_config('finflow.payment_child_root_id','',true);

    update private.transaction_completion_receipts set payment_transaction_id=replacement_payment_id where id=final_receipt.id;
    update public.transacoes set valor=restored_value,status='pendente',data_realizacao=null where id=root_row.id;
  elsif root_row.status='pendente' then
    remaining_value:=round(root_row.valor+restored_value,2);
    if remaining_value<=0 or remaining_value>999999999999.99 then raise exception using errcode='P0001',message='TRANSACTION_REOPEN_RESTORED_VALUE_INVALID'; end if;
    update public.transacoes set valor=remaining_value,data_realizacao=null where id=root_row.id;
  else
    raise exception using errcode='P0001',message='TRANSACTION_REOPEN_STATE_CONFLICT';
  end if;

  perform private.finflow_authorize_payment_child_write(caller,root_row.id);
  delete from public.transacoes where id=payment_row.id and transacao_pai_id=root_row.id;
  perform pg_catalog.set_config('finflow.payment_child_root_id','',true);
  update private.transaction_completion_receipts set reopened_at=clock_timestamp(),reopened_by=caller where id=target.id and reopened_at is null;

  select coalesce(round(sum(r.realized_value),2),0) into paid_total
  from private.transaction_completion_receipts r where r.root_transaction_id=root_row.id and r.reopened_at is null;
  select round(t.valor,2) into remaining_value from public.transacoes t where t.id=root_row.id;
  result_value:=pg_catalog.jsonb_build_object('ok',true,'replayed',false,'transaction_id',root_row.id,'payment_id',target.id,
    'reopened_payment_transaction_id',target.payment_transaction_id,'restored_value',restored_value,'paid_total',paid_total,
    'remaining_value',remaining_value,'status','pendente','is_fully_paid',false);
  insert into private.transaction_reopen_receipts(user_id,idempotency_key,transaction_id,completion_receipt_id,result)
  values(caller,p_idempotency_key,root_row.id,target.id,result_value);
  return result_value;
end;
$$;

revoke all on function public.reverse_selected_transaction_payment(bigint,uuid,uuid) from public,anon;
grant execute on function public.reverse_selected_transaction_payment(bigint,uuid,uuid) to authenticated;

commit;
