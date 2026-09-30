-- FinFlow: pagamentos parciais pertencem ao mesmo agendamento logico.
--
-- O agendamento raiz continua sendo a unica linha exibida. Cada baixa parcial
-- cria uma transacao tecnica paga ligada ao raiz, enquanto o valor do raiz
-- passa a representar somente o saldo pendente. Na ultima baixa o proprio
-- raiz vira a ultima transacao paga. Assim os calculos legados continuam
-- corretos: pagos = filhos + ultima baixa; previsto = saldo do raiz pendente.
--
-- Depende de 20260808001100_atomic_partial_transaction_completion.sql.

begin;

alter table public.transacoes
  add column if not exists transacao_pai_id bigint;

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.transacoes'::pg_catalog.regclass
      and c.conname = 'transacoes_transacao_pai_id_fkey'
  ) then
    alter table public.transacoes
      add constraint transacoes_transacao_pai_id_fkey
      foreign key (transacao_pai_id) references public.transacoes(id)
      on delete restrict;
  end if;
  if not exists (
    select 1 from pg_catalog.pg_constraint c
    where c.conrelid = 'public.transacoes'::pg_catalog.regclass
      and c.conname = 'transacoes_payment_child_not_self'
  ) then
    alter table public.transacoes
      add constraint transacoes_payment_child_not_self
      check (transacao_pai_id is null or transacao_pai_id <> id) not valid;
  end if;
end;
$$;

create index if not exists transacoes_transacao_pai_id_idx
  on public.transacoes (transacao_pai_id, data_realizacao, id)
  where transacao_pai_id is not null;

-- Travas adquiridas antes de remover a unicidade legada. Como toda a migration
-- esta em uma transacao, permanecem ativas ate o COMMIT.
lock table public.transacoes in share row exclusive mode;
lock table private.transaction_completion_receipts in share row exclusive mode;
lock table private.transaction_reopen_receipts in share row exclusive mode;

-- A unicidade anterior permitia apenas uma baixa ativa por transacao.
drop index if exists private.transaction_completion_receipts_active_transaction_idx;

alter table private.transaction_completion_receipts
  add column if not exists root_transaction_id bigint,
  add column if not exists payment_transaction_id bigint,
  add column if not exists payment_sequence integer;

-- Snapshot imutavel do estado 011. Em uma reaplicacao, recibos ja canonicos
-- ficam fora da conversao; um estado parcialmente preenchido falha fechado.
drop table if exists pg_temp.finflow_legacy_payment_receipts;
create temporary table finflow_legacy_payment_receipts
on commit drop
as
select r.id
from private.transaction_completion_receipts r
where r.root_transaction_id is null
   or r.payment_transaction_id is null
   or r.payment_sequence is null;

-- Falha fechada antes de construir a topologia: sem o indice legado (ou em um
-- ambiente que sofreu drift), duplicidades poderiam transformar a recursao em
-- uma arvore ambigua. Os locks acima garantem que o diagnostico nao envelhece
-- antes da conversao.
do $$
declare bad_ids text;
begin
  if exists (
    select 1
    from private.transaction_completion_receipts r
    where r.root_transaction_id is not null
      and r.payment_transaction_id is not null
      and r.payment_sequence is not null
      and r.remaining_transaction_id is not null
  ) then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_LEDGER_STATE_INCOMPLETE';
  end if;

  if exists (
    select 1
    from private.transaction_completion_receipts r
    join pg_temp.finflow_legacy_payment_receipts legacy on legacy.id=r.id
    where not (
      r.root_transaction_id is null
      and r.payment_transaction_id is null
      and r.payment_sequence is null
    )
  ) then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_LEDGER_STATE_INCOMPLETE';
  end if;

  select string_agg(duplicate.transaction_id::text,',' order by duplicate.transaction_id)
  into bad_ids
  from (
    select r.transaction_id
    from private.transaction_completion_receipts r
    join pg_temp.finflow_legacy_payment_receipts legacy on legacy.id=r.id
    where r.reopened_at is null
    group by r.transaction_id
    having count(*)<>1
  ) duplicate;
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_DUPLICATE_ACTIVE_TRANSACTION:'||left(bad_ids,1000);
  end if;

  select string_agg(duplicate.remaining_transaction_id::text,',' order by duplicate.remaining_transaction_id)
  into bad_ids
  from (
    select r.remaining_transaction_id
    from private.transaction_completion_receipts r
    join pg_temp.finflow_legacy_payment_receipts legacy on legacy.id=r.id
    where r.remaining_transaction_id is not null
    group by r.remaining_transaction_id
    having count(*)<>1
  ) duplicate;
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_BRANCH_OR_DUPLICATE:'||left(bad_ids,1000);
  end if;
end;
$$;

-- Fechamento historico de todas as bifurcacoes criadas por concluir, estornar
-- e concluir novamente. A aresta e o ID imutavel do saldo criado pelo recibo;
-- por isso um filho com dois pais e sempre corrupcao, enquanto um pai com
-- varios filhos historicos e uma reexecucao legitima depois de estorno.
drop table if exists pg_temp.finflow_legacy_payment_edges;
create temporary table finflow_legacy_payment_edges
on commit drop
as
select r.id as receipt_id,
       r.transaction_id as parent_transaction_id,
       r.remaining_transaction_id as child_transaction_id
from private.transaction_completion_receipts r
join pg_temp.finflow_legacy_payment_receipts legacy on legacy.id=r.id
where r.remaining_transaction_id is not null;

drop table if exists pg_temp.finflow_legacy_payment_lineage_nodes;
create temporary table finflow_legacy_payment_lineage_nodes
on commit drop
as
with recursive roots as (
  select distinct edge.parent_transaction_id as root_transaction_id
  from pg_temp.finflow_legacy_payment_edges edge
  where not exists (
    select 1 from pg_temp.finflow_legacy_payment_edges incoming
    where incoming.child_transaction_id=edge.parent_transaction_id
  )
), lineage as (
  select root.root_transaction_id,
         root.root_transaction_id as transaction_id,
         0::integer as lineage_depth,
         array[root.root_transaction_id]::bigint[] as visited_transactions
  from roots root

  union all

  select lineage.root_transaction_id,
         edge.child_transaction_id,
         lineage.lineage_depth+1,
         lineage.visited_transactions||edge.child_transaction_id
  from lineage
  join pg_temp.finflow_legacy_payment_edges edge
    on edge.parent_transaction_id=lineage.transaction_id
  where lineage.lineage_depth<1000
    and not edge.child_transaction_id=any(lineage.visited_transactions)
)
select * from lineage;

drop table if exists pg_temp.finflow_legacy_payment_lineage_receipts;
create temporary table finflow_legacy_payment_lineage_receipts
on commit drop
as
select legacy.id as receipt_id,
       node.root_transaction_id,
       r.transaction_id as original_transaction_id
from pg_temp.finflow_legacy_payment_receipts legacy
join private.transaction_completion_receipts r on r.id=legacy.id
join pg_temp.finflow_legacy_payment_lineage_nodes node
  on node.transaction_id=r.transaction_id;

drop table if exists pg_temp.finflow_legacy_payment_chain_nodes;
create temporary table finflow_legacy_payment_chain_nodes
on commit drop
as
with recursive
active_receipts as materialized (
  select r.*
  from private.transaction_completion_receipts r
  join pg_temp.finflow_legacy_payment_receipts legacy on legacy.id=r.id
  where r.reopened_at is null
),
chain_roots as materialized (
  select r.id as receipt_id,r.transaction_id as root_transaction_id
  from active_receipts r
  where r.remaining_transaction_id is not null
    and not exists (
      select 1 from active_receipts previous
      where previous.remaining_transaction_id=r.transaction_id
    )
),
chain as (
  select
    root.root_transaction_id,
    receipt.id as receipt_id,
    receipt.transaction_id,
    receipt.remaining_transaction_id,
    1::integer as chain_depth,
    array[receipt.transaction_id]::bigint[] as visited_transactions
  from chain_roots root
  join active_receipts receipt on receipt.id=root.receipt_id

  union all

  select
    chain.root_transaction_id,
    next_receipt.id,
    next_receipt.transaction_id,
    next_receipt.remaining_transaction_id,
    chain.chain_depth+1,
    chain.visited_transactions||next_receipt.transaction_id
  from chain
  join active_receipts current_receipt on current_receipt.id=chain.receipt_id
  join active_receipts next_receipt
    on next_receipt.transaction_id=current_receipt.remaining_transaction_id
  where chain.chain_depth<1000
    and not next_receipt.transaction_id=any(chain.visited_transactions)
)
select * from chain;

drop table if exists pg_temp.finflow_legacy_payment_chain_roots;
create temporary table finflow_legacy_payment_chain_roots
on commit drop
as
select
  n.root_transaction_id,
  (array_agg(n.receipt_id order by n.chain_depth))[1] as first_receipt_id,
  (array_agg(n.receipt_id order by n.chain_depth desc))[1] as last_receipt_id,
  max(n.chain_depth)::integer as payment_count
from pg_temp.finflow_legacy_payment_chain_nodes n
group by n.root_transaction_id;

drop table if exists pg_temp.finflow_legacy_payment_chain_ids;
create temporary table finflow_legacy_payment_chain_ids
on commit drop
as
select n.root_transaction_id,n.transaction_id
from pg_temp.finflow_legacy_payment_chain_nodes n
union
select roots.root_transaction_id,last_receipt.remaining_transaction_id
from pg_temp.finflow_legacy_payment_chain_roots roots
join private.transaction_completion_receipts last_receipt
  on last_receipt.id=roots.last_receipt_id
where last_receipt.remaining_transaction_id is not null;

do $$
declare
  bad_ids text;
  chain_root record;
  chain_node record;
  first_receipt private.transaction_completion_receipts%rowtype;
  last_receipt private.transaction_completion_receipts%rowtype;
  current_receipt private.transaction_completion_receipts%rowtype;
  root_row public.transacoes%rowtype;
  terminal_row public.transacoes%rowtype;
  payment_transaction_id bigint;
  cumulative_paid numeric(20,2);
  terminal_is_paid boolean;
begin
  -- Todo recibo que participa de uma linhagem historica precisa chegar a uma
  -- unica raiz. Isso inclui nos profundos ja reabertos e linhas fisicas que o
  -- modelo 011 removeu ao desfazer o pagamento.
  select string_agg(affected.id::text,',' order by affected.id)
  into bad_ids
  from (
    select legacy.id
    from pg_temp.finflow_legacy_payment_receipts legacy
    join private.transaction_completion_receipts r on r.id=legacy.id
    where exists (
      select 1 from pg_temp.finflow_legacy_payment_edges edge
      where edge.parent_transaction_id=r.transaction_id
         or edge.child_transaction_id=r.transaction_id
    )
    except
    select mapped.receipt_id
    from pg_temp.finflow_legacy_payment_lineage_receipts mapped
  ) affected;
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_HISTORICAL_CYCLE_OR_ORPHAN:'||left(bad_ids,1000);
  end if;

  select string_agg(mapped.receipt_id::text,',' order by mapped.receipt_id)
  into bad_ids
  from pg_temp.finflow_legacy_payment_lineage_receipts mapped
  group by mapped.receipt_id
  having count(distinct mapped.root_transaction_id)<>1
  limit 1;
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_HISTORICAL_ROOT_AMBIGUOUS:'||left(bad_ids,1000);
  end if;

  select string_agg(r.transaction_id::text,',' order by r.transaction_id)
  into bad_ids
  from pg_temp.finflow_legacy_payment_lineage_receipts mapped
  join private.transaction_completion_receipts r on r.id=mapped.receipt_id
  where r.reopened_at is null
    and mapped.original_transaction_id<>mapped.root_transaction_id
    and not exists (
      select 1 from pg_temp.finflow_legacy_payment_chain_nodes active_node
      where active_node.receipt_id=r.id
        and active_node.root_transaction_id=mapped.root_transaction_id
    );
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_ACTIVE_LINEAGE_DISCONNECTED:'||left(bad_ids,1000);
  end if;

  -- Todos os recibos ativos, inclusive quitacoes integrais fora de uma cadeia,
  -- devem corresponder exatamente a uma linha paga. Caso contrario, fazer um
  -- backfill simples criaria saldo/paid_total duplicado e bloquearia correcao.
  select string_agg(r.transaction_id::text,',' order by r.transaction_id)
  into bad_ids
  from private.transaction_completion_receipts r
  join pg_temp.finflow_legacy_payment_receipts legacy on legacy.id=r.id
  left join public.transacoes t on t.id=r.transaction_id
  where r.reopened_at is null
    and (
      t.id is null
      or t.transacao_pai_id is not null
      or t.status is distinct from 'paga'
      or round(t.valor,2) is distinct from r.realized_value
      or t.data_realizacao is distinct from r.realization_date
      or t.user_id is distinct from r.transaction_user_id
      or t.tipo is distinct from r.transaction_type
      or t.conta_id is distinct from r.account_id
      or t.categoria_id is distinct from r.category_id
      or t.data_vencimento is distinct from r.due_date
      or r.completed_description is null
      or t.descricao is distinct from r.completed_description
      or r.original_description is null
      or r.expected_value<=0
      or r.realized_value<=0
      or r.total_due<=0
      or r.total_due>999999999999.99
      or r.total_due is distinct from round(case r.adjustment_type
        when 'interest' then r.expected_value+r.adjustment_value
        when 'discount' then r.expected_value-r.adjustment_value
        else r.expected_value end,2)
      or r.remaining_value<0
      or r.remaining_value is distinct from round(r.total_due-r.realized_value,2)
      or (r.remaining_transaction_id is null) is distinct from (r.remaining_value=0)
    );
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_ACTIVE_RECEIPT_STATE_CHANGED:'||left(bad_ids,1000);
  end if;

  -- Todo recibo ativo pertencente a uma cadeia parcial deve aparecer uma vez.
  select string_agg(affected.id::text,',' order by affected.id)
  into bad_ids
  from (
    select r.id
    from private.transaction_completion_receipts r
    where r.reopened_at is null
      and (
        r.remaining_transaction_id is not null
        or exists(
          select 1 from private.transaction_completion_receipts previous
          where previous.reopened_at is null
            and previous.remaining_transaction_id=r.transaction_id
        )
      )
    except
    select n.receipt_id from pg_temp.finflow_legacy_payment_chain_nodes n
  ) affected;
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_CYCLE_OR_ORPHAN_RECEIPTS:'||left(bad_ids,1000);
  end if;

  select string_agg(n.receipt_id::text,',' order by n.receipt_id)
  into bad_ids
  from pg_temp.finflow_legacy_payment_chain_nodes n
  group by n.receipt_id
  having count(*)<>1
  limit 1;
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_RECEIPT_IN_MULTIPLE_CHAINS:'||left(bad_ids,1000);
  end if;

  select string_agg(ids.transaction_id::text,',' order by ids.transaction_id)
  into bad_ids
  from pg_temp.finflow_legacy_payment_chain_ids ids
  group by ids.transaction_id
  having count(distinct ids.root_transaction_id)<>1
  limit 1;
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_TRANSACTION_IN_MULTIPLE_CHAINS:'||left(bad_ids,1000);
  end if;

  -- Cada no pago precisa continuar exatamente no estado registrado pelo
  -- recibo 011; qualquer edicao externa torna a conversao ambigua.
  select string_agg(n.transaction_id::text,',' order by n.transaction_id)
  into bad_ids
  from pg_temp.finflow_legacy_payment_chain_nodes n
  join private.transaction_completion_receipts r on r.id=n.receipt_id
  left join public.transacoes t on t.id=n.transaction_id
  where t.id is null
     or t.transacao_pai_id is not null
     or t.status is distinct from 'paga'
     or round(t.valor,2) is distinct from r.realized_value
     or t.data_realizacao is distinct from r.realization_date
     or t.user_id is distinct from r.transaction_user_id
     or t.tipo is distinct from r.transaction_type
     or t.conta_id is distinct from r.account_id
     or t.categoria_id is distinct from r.category_id
     or t.data_vencimento is distinct from r.due_date
     or r.completed_description is null
     or t.descricao is distinct from r.completed_description
     or r.original_description is null
     or r.expected_value<=0
     or r.realized_value<=0
     or r.remaining_value<0
     or (r.remaining_transaction_id is null and r.remaining_value<>0)
     or (r.remaining_transaction_id is not null and r.remaining_value<=0);
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_PAID_STATE_CHANGED:'||left(bad_ids,1000);
  end if;

  -- A ligacao segura entre recibos e somente o ID do saldo criado. Valor,
  -- descricao, conta, categoria, tipo e vencimento podiam ser editados no
  -- saldo pendente entre duas baixas e devem ser preservados, nao rejeitados.
  select string_agg(current_node.transaction_id::text,',' order by current_node.transaction_id)
  into bad_ids
  from pg_temp.finflow_legacy_payment_chain_nodes current_node
  join pg_temp.finflow_legacy_payment_chain_nodes previous_node
    on previous_node.root_transaction_id=current_node.root_transaction_id
   and previous_node.chain_depth=current_node.chain_depth-1
  join private.transaction_completion_receipts previous_receipt
    on previous_receipt.id=previous_node.receipt_id
  join private.transaction_completion_receipts current_receipt_row
    on current_receipt_row.id=current_node.receipt_id
  where current_node.chain_depth>1
    and (
      previous_receipt.remaining_transaction_id is distinct from current_receipt_row.transaction_id
      or previous_receipt.transaction_user_id is distinct from current_receipt_row.transaction_user_id
    );
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_CHAIN_METADATA_CHANGED:'||left(bad_ids,1000);
  end if;

  -- O ultimo no termina em uma quitacao ou em um unico saldo ainda pendente.
  select string_agg(roots.root_transaction_id::text,',' order by roots.root_transaction_id)
  into bad_ids
  from pg_temp.finflow_legacy_payment_chain_roots roots
  join private.transaction_completion_receipts r on r.id=roots.last_receipt_id
  left join public.transacoes pending on pending.id=r.remaining_transaction_id
  where (r.remaining_transaction_id is null and r.remaining_value<>0)
     or (
       r.remaining_transaction_id is not null
       and (
         pending.id is null
         or pending.transacao_pai_id is not null
         or pending.status is distinct from 'pendente'
         or pending.data_realizacao is not null
         or pending.user_id is distinct from r.transaction_user_id
         or pending.tipo not in ('receita','despesa')
         or pending.valor<=0
         or pending.valor>999999999999.99
         or pending.categoria_id is null
         or exists(
           select 1 from private.transaction_completion_receipts next_receipt
           where next_receipt.reopened_at is null
             and next_receipt.transaction_id=r.remaining_transaction_id
         )
       )
     );
  if bad_ids is not null then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_TERMINAL_STATE_CHANGED:'||left(bad_ids,1000);
  end if;

  if exists (
    select 1
    from private.ai_invoice_payment_ledger ledger
    join pg_temp.finflow_legacy_payment_lineage_nodes lineage
      on lineage.transaction_id=ledger.payment_transaction_id
  ) then
    raise exception using errcode='P0001',message=
      'FINFLOW_LEGACY_PARTIAL_UNEXPECTED_INVOICE_REFERENCE';
  end if;

  -- Somente depois de todo o preflight concluido ocorre a primeira mutacao.
  -- Primeiro, todo recibo historico (inclusive um no profundo ja reaberto) e
  -- associado ao T0. O ID fisico anterior permanece auditavel sem FK.
  update private.transaction_completion_receipts historical
  set root_transaction_id=mapped.root_transaction_id,
      payment_transaction_id=mapped.original_transaction_id,
      transaction_id=mapped.root_transaction_id,
      remaining_transaction_id=null,
      remaining_description=null,
      result=historical.result||pg_catalog.jsonb_build_object(
        'transaction_id',mapped.root_transaction_id,
        'payment_id',historical.id,
        'payment_transaction_id',mapped.original_transaction_id,
        'remaining_transaction_id',null
      )
  from pg_temp.finflow_legacy_payment_lineage_receipts mapped
  where mapped.receipt_id=historical.id
    and historical.reopened_at is not null;

  for chain_root in
    select * from pg_temp.finflow_legacy_payment_chain_roots
    order by root_transaction_id
  loop
    select r.* into first_receipt
    from private.transaction_completion_receipts r
    where r.id=chain_root.first_receipt_id;
    select r.* into last_receipt
    from private.transaction_completion_receipts r
    where r.id=chain_root.last_receipt_id;
    select t.* into root_row from public.transacoes t
    where t.id=chain_root.root_transaction_id for update;

    terminal_is_paid:=last_receipt.remaining_transaction_id is null;
    if terminal_is_paid then
      select t.* into terminal_row from public.transacoes t
      where t.id=last_receipt.transaction_id for update;
      update public.transacoes
      set tipo=terminal_row.tipo,
          valor=terminal_row.valor,
          data_vencimento=terminal_row.data_vencimento,
          status='paga',
          data_realizacao=terminal_row.data_realizacao,
          descricao=last_receipt.original_description,
          categoria_id=terminal_row.categoria_id,
          conta_id=terminal_row.conta_id
      where id=chain_root.root_transaction_id;
    else
      select t.* into terminal_row from public.transacoes t
      where t.id=last_receipt.remaining_transaction_id for update;
      update public.transacoes
      set tipo=terminal_row.tipo,
          valor=terminal_row.valor,
          data_vencimento=terminal_row.data_vencimento,
          status='pendente',
          data_realizacao=null,
          descricao=terminal_row.descricao,
          categoria_id=terminal_row.categoria_id,
          conta_id=terminal_row.conta_id
      where id=chain_root.root_transaction_id;
    end if;

    cumulative_paid:=0;
    for chain_node in
      select n.*
      from pg_temp.finflow_legacy_payment_chain_nodes n
      where n.root_transaction_id=chain_root.root_transaction_id
      order by n.chain_depth
    loop
      select r.* into current_receipt
      from private.transaction_completion_receipts r
      where r.id=chain_node.receipt_id;
      cumulative_paid:=round(cumulative_paid+current_receipt.realized_value,2);

      if chain_node.chain_depth=chain_root.payment_count and terminal_is_paid then
        payment_transaction_id:=chain_root.root_transaction_id;
      elsif chain_node.chain_depth=1 then
        insert into public.transacoes(
          user_id,tipo,valor,data_vencimento,data_realizacao,descricao,
          categoria_id,conta_id,status,transacao_pai_id
        ) values (
          first_receipt.transaction_user_id,first_receipt.transaction_type,
          current_receipt.realized_value,first_receipt.due_date,
          current_receipt.realization_date,first_receipt.original_description,
          first_receipt.category_id,first_receipt.account_id,'paga',
          chain_root.root_transaction_id
        ) returning id into payment_transaction_id;
      else
        payment_transaction_id:=chain_node.transaction_id;
        update public.transacoes
        set transacao_pai_id=chain_root.root_transaction_id,
            valor=current_receipt.realized_value,
            status='paga',
            data_realizacao=current_receipt.realization_date,
            descricao=current_receipt.original_description
        where id=payment_transaction_id;
      end if;

      update private.transaction_completion_receipts
      set transaction_id=chain_root.root_transaction_id,
          root_transaction_id=chain_root.root_transaction_id,
          payment_transaction_id=payment_transaction_id,
          payment_sequence=chain_node.chain_depth,
          remaining_transaction_id=null,
          remaining_description=null,
          original_description=first_receipt.original_description,
          completed_description=first_receipt.original_description,
          result=current_receipt.result||pg_catalog.jsonb_build_object(
            'ok',true,
            'replayed',false,
            'transaction_id',chain_root.root_transaction_id,
            'payment_id',current_receipt.id,
            'payment_transaction_id',payment_transaction_id,
            'paid_total',cumulative_paid,
            'remaining_value',current_receipt.remaining_value,
            'remaining_transaction_id',null,
            'status',case when current_receipt.remaining_value=0 then 'paga' else 'pendente' end,
            'is_fully_paid',current_receipt.remaining_value=0
          )
      where id=current_receipt.id;
    end loop;

    if terminal_is_paid then
      if last_receipt.transaction_id<>chain_root.root_transaction_id then
        delete from public.transacoes where id=last_receipt.transaction_id;
      end if;
    else
      delete from public.transacoes where id=last_receipt.remaining_transaction_id;
    end if;

  end loop;

end;
$$;

-- Recibos fora das cadeias (pagamento unico integral ou historico isolado)
-- recebem o backfill simples e preservam o transaction_id auditavel.
update private.transaction_completion_receipts
set root_transaction_id=coalesce(root_transaction_id,transaction_id),
    payment_transaction_id=coalesce(payment_transaction_id,transaction_id),
    payment_sequence=coalesce(payment_sequence,1)
where root_transaction_id is null
   or payment_transaction_id is null
   or payment_sequence is null;

update private.transaction_reopen_receipts reopen
set transaction_id=completion.root_transaction_id,
    result=reopen.result||pg_catalog.jsonb_build_object(
      'transaction_id',completion.root_transaction_id
    )
from private.transaction_completion_receipts completion
join pg_temp.finflow_legacy_payment_receipts legacy on legacy.id=completion.id
where completion.id=reopen.completion_receipt_id;

-- A sequencia e uma linha do tempo da raiz, nao apenas do ledger ativo. Isso
-- cobre tambem quitar integralmente, estornar e quitar outra vez, alem das
-- cadeias parciais convertidas acima. Recibos reabertos nunca perdem sua ordem.
with ordered as (
  select r.id,row_number() over(
    partition by r.root_transaction_id
    order by r.created_at,r.id
  )::integer as sequence
  from private.transaction_completion_receipts r
)
update private.transaction_completion_receipts r
set payment_sequence=ordered.sequence
from ordered
where ordered.id=r.id
  and r.payment_sequence is distinct from ordered.sequence;

alter table private.transaction_completion_receipts
  alter column root_transaction_id set not null,
  alter column payment_transaction_id set not null,
  alter column payment_sequence set not null;

create index if not exists transaction_completion_receipts_root_history_idx
  on private.transaction_completion_receipts
  (root_transaction_id, payment_sequence, created_at, id);
create unique index if not exists transaction_completion_receipts_root_sequence_idx
  on private.transaction_completion_receipts (root_transaction_id,payment_sequence);
create unique index if not exists transaction_completion_receipts_active_payment_idx
  on private.transaction_completion_receipts (payment_transaction_id)
  where reopened_at is null and payment_transaction_id is not null;

-- Policies restritivas impedem que clientes forjem/editem filhos tecnicos.
-- Funcoes SECURITY DEFINER continuam sendo o unico caminho de escrita.
drop policy if exists "transacoes_payment_child_insert_guard" on public.transacoes;
create policy "transacoes_payment_child_insert_guard"
  on public.transacoes as restrictive for insert to authenticated
  with check (transacao_pai_id is null);

drop policy if exists "transacoes_payment_child_update_guard" on public.transacoes;
create policy "transacoes_payment_child_update_guard"
  on public.transacoes as restrictive for update to authenticated
  using (transacao_pai_id is null)
  with check (transacao_pai_id is null);

drop policy if exists "transacoes_payment_child_delete_guard" on public.transacoes;
create policy "transacoes_payment_child_delete_guard"
  on public.transacoes as restrictive for delete to authenticated
  using (transacao_pai_id is null);

create or replace function public.finflow_transaction_has_payment_history(
  p_transaction_id bigint
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists(
    select 1
    from private.transaction_completion_receipts r
    join public.transacoes t on t.id=r.root_transaction_id
    where r.root_transaction_id=p_transaction_id
      and r.reopened_at is null
      and (
        t.user_id=(select auth.uid())
        or exists(
          select 1 from public.contas c
          where c.id=t.conta_id
            and (
              c.user_id=(select auth.uid())
              or (
                coalesce(c.compartilhado,false)
                and public.is_parceiro(c.user_id,(select auth.uid()))
              )
            )
        )
      )
  );
$$;

revoke all on function public.finflow_transaction_has_payment_history(bigint)
  from public,anon;
grant execute on function public.finflow_transaction_has_payment_history(bigint)
  to authenticated;

create or replace function private.finflow_guard_transaction_payment_group()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare parent_row public.transacoes%rowtype;
begin
  if tg_op='DELETE' then
    if old.transacao_pai_id is null
       and public.finflow_transaction_has_payment_history(old.id) then
      raise exception using errcode='P0001', message='TRANSACTION_HAS_PAYMENT_HISTORY';
    end if;
    return old;
  end if;

  if new.transacao_pai_id is not null then
    select p.* into parent_row from public.transacoes p
    where p.id=new.transacao_pai_id;
    if not found or parent_row.transacao_pai_id is not null
       or new.status is distinct from 'paga' or new.data_realizacao is null
       or new.user_id is distinct from parent_row.user_id
       or new.tipo is distinct from parent_row.tipo
       or new.conta_id is distinct from parent_row.conta_id
       or new.categoria_id is distinct from parent_row.categoria_id
       or new.data_vencimento is distinct from parent_row.data_vencimento
       or new.descricao is distinct from parent_row.descricao then
      raise exception using errcode='P0001', message='TRANSACTION_PAYMENT_CHILD_INVALID';
    end if;
  end if;

  if tg_op='UPDATE' and old.transacao_pai_id is not null
     and new.transacao_pai_id is distinct from old.transacao_pai_id then
    raise exception using errcode='P0001', message='TRANSACTION_PAYMENT_CHILD_IMMUTABLE';
  end if;

  -- Um saldo restante pode ser editado individualmente. Pagamentos realizados
  -- e um raiz ja quitado continuam imutaveis fora das RPCs canonicas.
  if tg_op='UPDATE' and old.transacao_pai_id is null
     and current_user in ('authenticated','anon')
     and public.finflow_transaction_has_payment_history(old.id)
     and (
       old.status is distinct from 'pendente'
       or old.data_realizacao is not null
       or new.status is distinct from 'pendente'
       or new.data_realizacao is not null
       or new.transacao_pai_id is not null
     ) then
      raise exception using errcode='P0001', message='TRANSACTION_PAYMENT_LEDGER_RPC_REQUIRED';
  end if;
  return new;
end;
$$;

revoke all on function private.finflow_guard_transaction_payment_group()
  from public,anon,authenticated;

drop trigger if exists finflow_guard_transaction_payment_group on public.transacoes;
create trigger finflow_guard_transaction_payment_group
before insert or update or delete on public.transacoes
for each row execute function private.finflow_guard_transaction_payment_group();

-- Somente a RPC canonica consegue abrir esta janela, limitada a transacao
-- corrente. O trigger de plano ainda revalida pai, conta, ator e formato.
create or replace function private.finflow_authorize_payment_child_write(
  caller uuid,
  p_root_transaction_id bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if caller is null or caller is distinct from (select auth.uid()) then
    raise exception using errcode='42501', message='TRANSACTION_AUTH_REQUIRED';
  end if;
  if not exists (
    select 1
    from public.transacoes t
    join public.contas c on c.id=t.conta_id
    where t.id=p_root_transaction_id
      and t.transacao_pai_id is null
      and t.status='pendente'
      and not coalesce(c.arquivado,false)
      and (
        t.user_id=caller
        or c.user_id=caller
        or (
          coalesce(c.compartilhado,false)
          and public.is_parceiro(c.user_id,caller)
        )
      )
  ) then
    raise exception using errcode='42501', message='TRANSACTION_PAYMENT_CHILD_NOT_AUTHORIZED';
  end if;
  perform pg_catalog.set_config(
    'finflow.payment_child_root_id',p_root_transaction_id::text,true
  );
end;
$$;

revoke all on function private.finflow_authorize_payment_child_write(uuid,bigint)
  from public,anon,authenticated;

create or replace function public.enforce_finflow_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits_on boolean;
  current_plan text;
  allowed_count integer;
  used_count integer;
  should_enforce boolean:=false;
  old_active boolean;
  new_active boolean;
  actor_id uuid:=(select auth.uid());
  jwt_role text:=coalesce((select auth.jwt()->>'role'),'');
  privileged_execution boolean:=false;
  parent_row public.transacoes%rowtype;
  payment_root_setting text;
  shared_update_allowed boolean:=false;
begin
  privileged_execution:=jwt_role='service_role' or (
    actor_id is null and session_user in ('postgres','supabase_admin')
  );

  if tg_op='UPDATE' and new.user_id is distinct from old.user_id
     and not privileged_execution then
    raise exception using errcode='42501',message='invalid resource owner';
  end if;

  if not privileged_execution and actor_id is null then
    raise exception using errcode='42501',message='invalid resource owner';
  end if;

  if not privileged_execution and tg_table_name='transacoes'
     and tg_op='UPDATE' and new.user_id is distinct from actor_id then
    shared_update_allowed:=exists(
      select 1 from public.contas c
      where c.id=old.conta_id
        and (
          c.user_id=actor_id
          or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,actor_id))
        )
    ) and exists(
      select 1 from public.contas c
      where c.id=new.conta_id
        and (
          c.user_id=actor_id
          or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,actor_id))
        )
    );
    if not shared_update_allowed then
      raise exception using errcode='42501',message='invalid resource owner';
    end if;
  elsif not privileged_execution and tg_table_name='transacoes'
     and tg_op='INSERT' and new.transacao_pai_id is not null then
    payment_root_setting:=pg_catalog.current_setting(
      'finflow.payment_child_root_id',true
    );
    if payment_root_setting is null
       or payment_root_setting!~'^[0-9]+$'
       or payment_root_setting::bigint<>new.transacao_pai_id then
      raise exception using errcode='42501',message='invalid resource owner';
    end if;

    select p.* into parent_row from public.transacoes p
    where p.id=new.transacao_pai_id and p.transacao_pai_id is null;
    if not found or parent_row.status<>'pendente'
       or new.user_id is distinct from parent_row.user_id
       or new.conta_id is distinct from parent_row.conta_id
       or new.tipo is distinct from parent_row.tipo
       or new.categoria_id is distinct from parent_row.categoria_id
       or new.data_vencimento is distinct from parent_row.data_vencimento
       or new.descricao is distinct from parent_row.descricao
       or new.status is distinct from 'paga'
       or new.data_realizacao is null
       or not exists(
         select 1 from public.contas c
         where c.id=parent_row.conta_id
           and not coalesce(c.arquivado,false)
           and (
             c.user_id=actor_id
             or (
               coalesce(c.compartilhado,false)
               and public.is_parceiro(c.user_id,actor_id)
             )
           )
       ) then
      raise exception using errcode='42501',message='invalid resource owner';
    end if;

    -- Filho e apenas um evento financeiro do raiz: nao consome franquia.
    return new;
  elsif not privileged_execution and new.user_id is distinct from actor_id then
    raise exception using errcode='42501',message='invalid resource owner';
  end if;

  -- Qualquer escrita confiavel em filho continua fora da contagem mensal.
  if tg_table_name='transacoes' and new.transacao_pai_id is not null then
    return new;
  end if;

  select limits_enabled into limits_on
  from public.billing_settings where id=true;
  if not coalesce(limits_on,false) then return new; end if;

  if tg_op='INSERT' then
    should_enforce:=true;
  elsif tg_op='UPDATE' then
    if tg_table_name='contas' then
      should_enforce:=coalesce(old.arquivado,false) and not coalesce(new.arquivado,false);
    elsif tg_table_name='cartoes' then
      should_enforce:=not coalesce(old.ativo,true) and coalesce(new.ativo,true);
    elsif tg_table_name='caixinhas' then
      should_enforce:=coalesce(old.arquivado,false) and not coalesce(new.arquivado,false);
    elsif tg_table_name='categorias' then
      old_active:=coalesce(old.ativa::text,'true') not in ('0','false','f');
      new_active:=coalesce(new.ativa::text,'true') not in ('0','false','f');
      should_enforce:=new_active and (not old_active or new.tipo is distinct from old.tipo);
    elsif tg_table_name='transacoes' then
      should_enforce:=date_trunc('month',old.data_vencimento::date)
        is distinct from date_trunc('month',new.data_vencimento::date);
    end if;
  end if;
  if not should_enforce then return new; end if;

  select coalesce((
    select s.plan from public.subscriptions s
    where s.user_id=new.user_id
      and (s.status in ('active','grace_period')
        or (s.status='cancelled' and s.access_until>now()))
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc
    limit 1
  ),'free') into current_plan;
  if current_plan='premium' then return new; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(new.user_id::text),61004
  );

  if tg_table_name='contas' then
    allowed_count:=case current_plan when 'smart' then 5 else 2 end;
    select count(*) into used_count from public.contas
    where user_id=new.user_id and not coalesce(arquivado,false);
  elsif tg_table_name='cartoes' then
    allowed_count:=case current_plan when 'smart' then 3 else 1 end;
    select count(*) into used_count from public.cartoes
    where user_id=new.user_id and coalesce(ativo,true);
  elsif tg_table_name='caixinhas' then
    allowed_count:=case current_plan when 'smart' then 5 else 1 end;
    select count(*) into used_count from public.caixinhas
    where user_id=new.user_id and not coalesce(arquivado,false);
  elsif tg_table_name='categorias' then
    allowed_count:=case current_plan when 'smart' then 14 else 7 end;
    select count(*) into used_count from public.categorias
    where user_id=new.user_id and tipo=new.tipo
      and coalesce(ativa::text,'true') not in ('0','false','f');
  elsif tg_table_name='transacoes' then
    allowed_count:=case current_plan when 'smart' then 300 else 40 end;
    if tg_op='UPDATE' then
      select count(*) into used_count from public.transacoes
      where user_id=new.user_id and id<>old.id
        and transacao_pai_id is null
        and date_trunc('month',data_vencimento::date)
          =date_trunc('month',new.data_vencimento::date);
    else
      select count(*) into used_count from public.transacoes
      where user_id=new.user_id
        and transacao_pai_id is null
        and date_trunc('month',data_vencimento::date)
          =date_trunc('month',new.data_vencimento::date);
    end if;
  else
    return new;
  end if;

  if used_count>=allowed_count then
    raise exception using errcode='P0001',message='plan limit reached';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_finflow_plan_limit()
  from public,anon,authenticated;

-- A IA e os executores genericos nao podem receber um filho como agendamento.
create or replace function private.ai_assert_transaction(caller uuid, transaction_id bigint)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.transacoes t
    where t.id = transaction_id
      and t.transacao_pai_id is null
      and (
        t.user_id = caller
        or exists (
          select 1 from public.contas c
          where c.id = t.conta_id
            and (
              c.user_id=caller
              or (
                coalesce(c.compartilhado,false)
                and public.is_parceiro(c.user_id,caller)
              )
            )
        )
      )
  ) then
    perform private.ai_fail('AI_TRANSACTION_NOT_FOUND');
  end if;
end;
$$;

revoke all on function private.ai_assert_transaction(uuid,bigint)
  from public, anon, authenticated;

create or replace function public.complete_transaction_with_partial(
  p_transaction_id bigint,
  p_expected_value numeric,
  p_adjustment_type text,
  p_adjustment_value numeric,
  p_realized_value numeric,
  p_realization_date date,
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
  existing private.transaction_completion_receipts%rowtype;
  expected_value numeric(14,2);
  adjustment_type text;
  adjustment_value numeric(14,2);
  total_due numeric(20,2);
  realized_value numeric(14,2);
  paid_before numeric(20,2);
  paid_total numeric(20,2);
  remaining_value numeric(20,2);
  payment_transaction_id bigint;
  payment_sequence integer;
  receipt_id uuid;
  result_value jsonb;
begin
  if caller is null then
    raise exception using errcode='P0001', message='TRANSACTION_AUTH_REQUIRED';
  end if;
  if p_transaction_id is null or p_expected_value is null
     or p_realized_value is null or p_realization_date is null
     or p_idempotency_key is null then
    raise exception using errcode='P0001', message='TRANSACTION_COMPLETION_INVALID';
  end if;

  expected_value := round(p_expected_value, 2);
  adjustment_type := coalesce(p_adjustment_type, 'none');
  adjustment_value := round(coalesce(p_adjustment_value, 0), 2);
  realized_value := round(p_realized_value, 2);

  if expected_value <= 0 or realized_value <= 0
     or p_realization_date > (clock_timestamp() at time zone 'America/Sao_Paulo')::date then
    raise exception using errcode='P0001', message='TRANSACTION_COMPLETION_INVALID';
  end if;
  if adjustment_type not in ('none','interest','discount')
     or adjustment_value < 0
     or (adjustment_type='none' and adjustment_value<>0)
     or (adjustment_type='interest' and (adjustment_value<=0 or adjustment_value>expected_value))
     or (adjustment_type='discount' and (adjustment_value<=0 or adjustment_value>=expected_value)) then
    raise exception using errcode='P0001', message='TRANSACTION_ADJUSTMENT_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:transaction:'||p_transaction_id::text, 73117)
  );

  select t.* into root_row from public.transacoes t where t.id=p_transaction_id;
  if not found then
    raise exception using errcode='P0001', message='TRANSACTION_NOT_FOUND';
  end if;
  if root_row.transacao_pai_id is not null then
    raise exception using errcode='P0001', message='TRANSACTION_PAYMENT_CHILD_NOT_ACTIONABLE';
  end if;
  perform private.ai_lock_account(caller,root_row.conta_id,false,true);
  select t.* into root_row from public.transacoes t
  where t.id=p_transaction_id and t.conta_id=root_row.conta_id for update;
  if not found then
    raise exception using errcode='P0001', message='TRANSACTION_NOT_FOUND';
  end if;
  perform private.ai_assert_transaction(caller,p_transaction_id);

  total_due := case adjustment_type
    when 'interest' then expected_value+adjustment_value
    when 'discount' then expected_value-adjustment_value
    else expected_value end;
  if total_due<=0 or total_due>999999999999.99 then
    raise exception using errcode='P0001', message='TRANSACTION_TOTAL_DUE_OUT_OF_RANGE';
  end if;

  select * into existing
  from private.transaction_completion_receipts r
  where r.user_id=caller and r.idempotency_key=p_idempotency_key;
  if found then
    if existing.root_transaction_id is distinct from p_transaction_id
       or existing.expected_value is distinct from expected_value
       or existing.adjustment_type is distinct from adjustment_type
       or existing.adjustment_value is distinct from adjustment_value
       or existing.total_due is distinct from total_due
       or existing.realized_value is distinct from realized_value
       or existing.realization_date is distinct from p_realization_date then
      raise exception using errcode='P0001', message='TRANSACTION_COMPLETION_IDEMPOTENCY_CONFLICT';
    end if;
    if existing.reopened_at is not null then
      raise exception using errcode='P0001', message='TRANSACTION_COMPLETION_ALREADY_REOPENED';
    end if;
    if existing.payment_transaction_id is null or not exists (
      select 1 from public.transacoes p
      where p.id=existing.payment_transaction_id
        and p.status='paga'
        and round(p.valor,2)=existing.realized_value
        and p.data_realizacao=existing.realization_date
        and (p.id=p_transaction_id or p.transacao_pai_id=p_transaction_id)
    ) then
      raise exception using errcode='P0001', message='TRANSACTION_COMPLETION_STATE_CONFLICT';
    end if;
    return existing.result||pg_catalog.jsonb_build_object('replayed',true);
  end if;

  if root_row.status is distinct from 'pendente' then
    raise exception using errcode='P0001', message='TRANSACTION_ALREADY_COMPLETED';
  end if;
  if round(root_row.valor,2) is distinct from expected_value then
    raise exception using errcode='P0001', message='TRANSACTION_VALUE_CHANGED';
  end if;
  if root_row.tipo not in ('receita','despesa') or root_row.categoria_id is null
     or coalesce(root_row.descricao,'') like '[Transf.] %'
     or coalesce(root_row.descricao,'') ~ '\[(Destino:|Objetivo:|PagFatura:)' then
    raise exception using errcode='P0001', message='TRANSACTION_PARTIAL_NOT_SUPPORTED';
  end if;
  if p_realization_date <= root_row.data_vencimento
     and (adjustment_type<>'none' or adjustment_value<>0) then
    raise exception using errcode='P0001', message='TRANSACTION_ADJUSTMENT_NOT_ALLOWED_BEFORE_DUE_DATE';
  end if;
  if realized_value>total_due then
    raise exception using errcode='P0001', message='TRANSACTION_REALIZED_VALUE_TOO_HIGH';
  end if;

  select coalesce(sum(r.realized_value),0)
  into paid_before
  from private.transaction_completion_receipts r
  where r.root_transaction_id=p_transaction_id and r.reopened_at is null;

  -- A soma e apenas dos pagamentos ativos; a sequencia, por outro lado, e
  -- monotona sobre todo o historico, inclusive pagamentos ja estornados.
  select coalesce(max(r.payment_sequence),0)+1
  into payment_sequence
  from private.transaction_completion_receipts r
  where r.root_transaction_id=p_transaction_id;

  remaining_value := round(total_due-realized_value,2);
  paid_total := round(paid_before+realized_value,2);

  if remaining_value>0 then
    perform private.finflow_authorize_payment_child_write(caller,root_row.id);
    insert into public.transacoes(
      user_id,tipo,valor,data_vencimento,data_realizacao,descricao,
      categoria_id,conta_id,status,transacao_pai_id
    ) values (
      root_row.user_id,root_row.tipo,realized_value,root_row.data_vencimento,
      p_realization_date,root_row.descricao,root_row.categoria_id,
      root_row.conta_id,'paga',root_row.id
    ) returning * into payment_row;
    payment_transaction_id := payment_row.id;
    perform pg_catalog.set_config('finflow.payment_child_root_id','',true);

    update public.transacoes
    set valor=remaining_value,status='pendente',data_realizacao=null
    where id=root_row.id;
  else
    payment_transaction_id := root_row.id;
    update public.transacoes
    set valor=realized_value,status='paga',data_realizacao=p_realization_date
    where id=root_row.id;
  end if;

  receipt_id := extensions.gen_random_uuid();
  result_value := pg_catalog.jsonb_build_object(
    'ok',true,'replayed',false,
    'transaction_id',root_row.id,
    'payment_id',receipt_id,
    'payment_transaction_id',payment_transaction_id,
    'expected_value',expected_value,
    'adjustment_type',adjustment_type,
    'adjustment_value',adjustment_value,
    'total_due',total_due,
    'realized_value',realized_value,
    'paid_total',paid_total,
    'remaining_value',remaining_value,
    'remaining_transaction_id',null,
    'realization_date',p_realization_date,
    'status',case when remaining_value=0 then 'paga' else 'pendente' end,
    'is_fully_paid',remaining_value=0
  );

  insert into private.transaction_completion_receipts(
    id,user_id,idempotency_key,transaction_id,root_transaction_id,
    payment_transaction_id,payment_sequence,expected_value,adjustment_type,
    adjustment_value,total_due,realized_value,remaining_value,
    remaining_transaction_id,transaction_user_id,transaction_type,account_id,
    category_id,due_date,original_description,completed_description,
    realization_date,result
  ) values (
    receipt_id,caller,p_idempotency_key,root_row.id,root_row.id,
    payment_transaction_id,payment_sequence,expected_value,adjustment_type,
    adjustment_value,total_due,realized_value,remaining_value,
    null,root_row.user_id,root_row.tipo,root_row.conta_id,
    root_row.categoria_id,root_row.data_vencimento,root_row.descricao,
    root_row.descricao,p_realization_date,result_value
  );

  return result_value;
end;
$$;

revoke all on function public.complete_transaction_with_partial(bigint,numeric,text,numeric,numeric,date,uuid)
  from public,anon;
grant execute on function public.complete_transaction_with_partial(bigint,numeric,text,numeric,numeric,date,uuid)
  to authenticated;

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
    raise exception using errcode='P0001', message='TRANSACTION_NOT_COMPLETED';
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

create or replace function public.reopen_transaction_completion(
  p_transaction_id bigint,
  p_idempotency_key uuid
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.reverse_transaction_payment(
    p_transaction_id,null::uuid,p_idempotency_key
  );
$$;

revoke all on function public.reopen_transaction_completion(bigint,uuid)
  from public,anon;
grant execute on function public.reopen_transaction_completion(bigint,uuid)
  to authenticated;

create or replace function public.list_transaction_payment_summaries(
  p_transaction_ids bigint[]
)
returns table(
  root_transaction_id bigint,
  display_transaction_id bigint,
  current_pending_transaction_id bigint,
  last_paid_transaction_id bigint,
  technical_transaction_ids bigint[],
  total_value numeric,
  paid_total numeric,
  remaining_value numeric,
  is_fully_paid boolean,
  payment_count integer,
  scheduled_date date,
  last_realization_date date
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare caller uuid:=auth.uid();
begin
  if caller is null then
    raise exception using errcode='42501', message='TRANSACTION_AUTH_REQUIRED';
  end if;
  if coalesce(cardinality(p_transaction_ids),0)>500 then
    raise exception using errcode='22023', message='TRANSACTION_SUMMARY_LIMIT_EXCEEDED';
  end if;

  return query
  with requested as materialized (
    select distinct coalesce(t.transacao_pai_id,t.id) as root_id
    from public.transacoes t
    where t.id=any(coalesce(p_transaction_ids,'{}'::bigint[]))
  ), roots as materialized (
    select t.* from public.transacoes t join requested q on q.root_id=t.id
    where t.transacao_pai_id is null
      and (
        t.user_id=caller
        or exists(
          select 1 from public.contas c
          where c.id=t.conta_id
            and (
              c.user_id=caller
              or (
                coalesce(c.compartilhado,false)
                and public.is_parceiro(c.user_id,caller)
              )
            )
        )
      )
  ), ledger as materialized (
    select
      r.root_transaction_id as root_id,
      round(coalesce(sum(r.realized_value) filter(where r.reopened_at is null),0),2) as active_paid,
      count(*) filter(where r.reopened_at is null)::integer as active_count,
      (array_agg(r.payment_transaction_id order by r.payment_sequence desc,r.created_at desc,r.id desc)
        filter(where r.reopened_at is null))[1] as last_paid_id,
      (array_agg(r.realization_date order by r.payment_sequence desc,r.created_at desc,r.id desc)
        filter(where r.reopened_at is null))[1] as last_paid_date
    from private.transaction_completion_receipts r
    where r.root_transaction_id in (select q.root_id from requested q)
    group by r.root_transaction_id
  ), children as materialized (
    select p.transacao_pai_id as root_id,array_agg(p.id order by p.id)::bigint[] as ids
    from public.transacoes p
    where p.transacao_pai_id in (select q.root_id from requested q)
    group by p.transacao_pai_id
  )
  select
    root.id,
    root.id,
    case when root.status='pendente' then root.id else null end,
    case
      when coalesce(l.active_count,0)>0 then l.last_paid_id
      when root.status='paga' then root.id else null end,
    coalesce(ch.ids,'{}'::bigint[]),
    round(case
      when coalesce(l.active_count,0)>0
        then l.active_paid+case when root.status='pendente' then root.valor else 0 end
      else root.valor end,2),
    round(case
      when coalesce(l.active_count,0)>0 then l.active_paid
      when root.status='paga' then root.valor else 0 end,2),
    round(case when root.status='pendente' then root.valor else 0 end,2),
    root.status='paga',
    coalesce(l.active_count,0),
    root.data_vencimento,
    case
      when coalesce(l.active_count,0)>0 then l.last_paid_date
      when root.status='paga' then root.data_realizacao else null end
  from roots root
  left join ledger l on l.root_id=root.id
  left join children ch on ch.root_id=root.id
  order by root.id;
end;
$$;

revoke all on function public.list_transaction_payment_summaries(bigint[])
  from public,anon;
grant execute on function public.list_transaction_payment_summaries(bigint[])
  to authenticated;

create or replace function public.get_transaction_payment_history(
  p_transaction_id bigint
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  caller uuid:=auth.uid();
  root_id bigint;
  summary_value jsonb;
  payments_value jsonb;
begin
  if caller is null then
    raise exception using errcode='42501', message='TRANSACTION_AUTH_REQUIRED';
  end if;
  select coalesce(t.transacao_pai_id,t.id) into root_id
  from public.transacoes t where t.id=p_transaction_id;
  if not found then
    raise exception using errcode='P0001', message='TRANSACTION_NOT_FOUND';
  end if;
  perform private.ai_assert_transaction(caller,root_id);

  select to_jsonb(s) into summary_value
  from public.list_transaction_payment_summaries(array[root_id]) s;
  if summary_value is null then
    raise exception using errcode='P0001', message='TRANSACTION_NOT_FOUND';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'payment_id',r.id,
    'payment_sequence',r.payment_sequence,
    'transaction_id',r.payment_transaction_id,
    'value',r.realized_value,
    'realization_date',r.realization_date,
    'adjustment_type',r.adjustment_type,
    'adjustment_value',r.adjustment_value,
    'active',r.reopened_at is null,
    'reopened_at',r.reopened_at,
    'created_at',r.created_at
  ) order by r.payment_sequence,r.created_at,r.id),'[]'::jsonb)
  into payments_value
  from private.transaction_completion_receipts r
  where r.root_transaction_id=root_id;

  return pg_catalog.jsonb_build_object(
    'ok',true,'summary',summary_value,'payments',payments_value
  );
end;
$$;

revoke all on function public.get_transaction_payment_history(bigint)
  from public,anon;
grant execute on function public.get_transaction_payment_history(bigint)
  to authenticated;

-- O executor generico da IA nao pode editar/excluir um raiz com ledger. O
-- usuario deve estornar as baixas do mais recente para o mais antigo primeiro.
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

  if public.finflow_transaction_has_payment_history(
       (normalized->>'transaction_id')::bigint
     ) then
    if action_name='delete_transaction' then
      perform private.ai_fail('AI_TRANSACTION_PAYMENT_LEDGER_REQUIRES_REOPEN');
    elsif action_name='update_transaction'
       and coalesce(normalized->>'series_scope','one')<>'one' then
      perform private.ai_fail('AI_TRANSACTION_PARTIAL_REMAINDER_IS_INDIVIDUAL');
    end if;
  end if;

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
  from public,anon,authenticated;

comment on column public.transacoes.transacao_pai_id is
  'Vincula uma baixa parcial tecnica ao unico agendamento raiz exibido no app.';
comment on function public.list_transaction_payment_summaries(bigint[]) is
  'Resume pagamentos agrupados sem expor o ledger privado e sem N+1.';
comment on function public.get_transaction_payment_history(bigint) is
  'Retorna o resumo e o historico auditavel de pagamentos do agendamento.';

alter table public.transacoes
  validate constraint transacoes_payment_child_not_self;

commit;
