-- Reabertura de lancamentos concluidos que nao possuem recibo de baixa.
--
-- Lancamentos que ficaram 'paga' sem passar por uma baixa parcial (criados ja
-- concluidos com "Concluido na data", ou concluidos em versoes anteriores do
-- app) nao tem linha em private.transaction_completion_receipts. Antes, reabrir
-- esses itens falhava com TRANSACTION_NOT_COMPLETED tanto no app quanto no site.
--
-- Agora, quando nao existe recibo ativo, fazemos a reabertura simples: o item
-- volta para 'pendente' e perde a data de realizacao. O saldo da conta e
-- derivado do status, entao nenhum ledger precisa ser revertido. So vale para
-- receita e despesa comum ja concluida, sem filhos tecnicos e sem marcadores de
-- transferencia, objetivo ou pagamento de fatura -- esses seguem seus fluxos
-- proprios. O caminho com recibo permanece inalterado.
--
-- Juros e desconto em qualquer data ja foram liberados na migracao
-- 20260829000300; nada precisa mudar aqui para isso.

begin;

create or replace function public.reverse_transaction_payment(
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
  completion private.transaction_completion_receipts%rowtype;
  existing private.transaction_reopen_receipts%rowtype;
  paid_total numeric(20,2);
  remaining_value numeric(20,2);
  result_value jsonb;
begin
  if caller is null then
    raise exception using errcode='P0001', message='TRANSACTION_AUTH_REQUIRED';
  end if;
  if p_transaction_id is null or p_idempotency_key is null then
    raise exception using errcode='P0001', message='TRANSACTION_REOPEN_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:transaction:'||p_transaction_id::text,73117)
  );

  select t.* into root_row from public.transacoes t where t.id=p_transaction_id;
  if not found then
    raise exception using errcode='P0001', message='TRANSACTION_NOT_FOUND';
  end if;
  if root_row.transacao_pai_id is not null then
    raise exception using errcode='P0001', message='TRANSACTION_PAYMENT_CHILD_NOT_ACTIONABLE';
  end if;
  perform private.ai_lock_account(caller,root_row.conta_id,false,false);
  select t.* into root_row from public.transacoes t
  where t.id=p_transaction_id and t.conta_id=root_row.conta_id for update;
  if not found then
    raise exception using errcode='P0001', message='TRANSACTION_NOT_FOUND';
  end if;
  perform private.ai_assert_transaction(caller,p_transaction_id);

  select * into existing from private.transaction_reopen_receipts r
  where r.user_id=caller and r.idempotency_key=p_idempotency_key;
  if found then
    if existing.transaction_id is distinct from p_transaction_id
       or (p_payment_id is not null
         and existing.completion_receipt_id is distinct from p_payment_id) then
      raise exception using errcode='P0001', message='TRANSACTION_REOPEN_IDEMPOTENCY_CONFLICT';
    end if;
    return existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;

  select r.* into completion
  from private.transaction_completion_receipts r
  where r.root_transaction_id=p_transaction_id and r.reopened_at is null
  order by r.payment_sequence desc,r.created_at desc,r.id desc
  limit 1 for update;
  if not found then
    -- Sem recibo ativo: reabertura simples de um lancamento concluido antigo.
    if p_payment_id is not null then
      raise exception using errcode='P0001', message='TRANSACTION_NOT_COMPLETED';
    end if;
    if root_row.status is distinct from 'paga'
       or root_row.tipo not in ('receita','despesa')
       or root_row.categoria_id is null
       or coalesce(root_row.descricao,'') like '[Transf.] %'
       or coalesce(root_row.descricao,'') ~ '\[(Destino:|Objetivo:|PagFatura:)' then
      raise exception using errcode='P0001', message='TRANSACTION_NOT_COMPLETED';
    end if;
    if exists (
      select 1 from public.transacoes p where p.transacao_pai_id=root_row.id
    ) then
      raise exception using errcode='P0001', message='TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;

    update public.transacoes
    set status='pendente',data_realizacao=null
    where id=root_row.id;

    result_value:=pg_catalog.jsonb_build_object(
      'ok',true,'replayed',false,
      'transaction_id',root_row.id,
      'payment_id',null,
      'reopened_payment_transaction_id',root_row.id,
      'restored_value',round(root_row.valor,2),
      'paid_total',0,
      'remaining_value',round(root_row.valor,2),
      'status','pendente',
      'is_fully_paid',false
    );

    insert into private.transaction_reopen_receipts(
      user_id,idempotency_key,transaction_id,completion_receipt_id,result
    ) values (
      caller,p_idempotency_key,root_row.id,null,result_value
    );

    return result_value;
  end if;
  if p_payment_id is not null and completion.id<>p_payment_id then
    raise exception using errcode='P0001', message='TRANSACTION_PAYMENT_NOT_LATEST';
  end if;

  if completion.payment_transaction_id=root_row.id then
    if root_row.status is distinct from 'paga'
       or round(root_row.valor,2) is distinct from completion.realized_value
       or root_row.data_realizacao is distinct from completion.realization_date then
      raise exception using errcode='P0001', message='TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;
    update public.transacoes
    set valor=completion.expected_value,status='pendente',data_realizacao=null
    where id=root_row.id;
  else
    select p.* into payment_row from public.transacoes p
    where p.id=completion.payment_transaction_id
      and p.transacao_pai_id=root_row.id for update;
    if not found or payment_row.status is distinct from 'paga'
       or round(payment_row.valor,2) is distinct from completion.realized_value
       or payment_row.data_realizacao is distinct from completion.realization_date
       or root_row.status is distinct from 'pendente'
       or root_row.data_realizacao is not null then
      raise exception using errcode='P0001', message='TRANSACTION_REOPEN_STATE_CONFLICT';
    end if;
    delete from public.transacoes where id=payment_row.id;
    remaining_value:=round(
      root_row.valor+completion.expected_value-completion.remaining_value,
      2
    );
    if remaining_value<=0 or abs(remaining_value)>999999999999.99 then
      raise exception using errcode='P0001', message='TRANSACTION_REOPEN_RESTORED_VALUE_INVALID';
    end if;
    update public.transacoes
    set valor=remaining_value,status='pendente',data_realizacao=null
    where id=root_row.id;
  end if;

  update private.transaction_completion_receipts
  set reopened_at=clock_timestamp(),reopened_by=caller
  where id=completion.id and reopened_at is null;
  if not found then
    raise exception using errcode='P0001', message='TRANSACTION_REOPEN_STATE_CONFLICT';
  end if;

  select coalesce(sum(r.realized_value),0)
  into paid_total
  from private.transaction_completion_receipts r
  where r.root_transaction_id=p_transaction_id and r.reopened_at is null;
  if completion.payment_transaction_id=root_row.id then
    remaining_value:=completion.expected_value;
  end if;

  result_value:=pg_catalog.jsonb_build_object(
    'ok',true,'replayed',false,
    'transaction_id',root_row.id,
    'payment_id',completion.id,
    'reopened_payment_transaction_id',completion.payment_transaction_id,
    'restored_value',remaining_value,
    'paid_total',round(paid_total,2),
    'remaining_value',remaining_value,
    'status','pendente',
    'is_fully_paid',false
  );

  insert into private.transaction_reopen_receipts(
    user_id,idempotency_key,transaction_id,completion_receipt_id,result
  ) values (
    caller,p_idempotency_key,root_row.id,completion.id,result_value
  );

  return result_value;
end;
$$;

revoke all on function public.reverse_transaction_payment(bigint,uuid,uuid)
  from public,anon;
grant execute on function public.reverse_transaction_payment(bigint,uuid,uuid)
  to authenticated;

commit;
