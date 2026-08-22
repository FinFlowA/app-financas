-- FinFlow: mantém a exclusão de conta protegida por step-up e corrige a
-- ordem de remoção dos pagamentos e dos respectivos recibos privados.
--
-- transacoes.transacao_pai_id usa ON DELETE RESTRICT. Portanto, uma remoção
-- única de todas as transações do usuário pode ser recusada quando o conjunto
-- contém uma transação raiz e seus pagamentos parciais. Os filhos precisam
-- ser removidos explicitamente antes das raízes.
--
-- Há ainda dois bloqueios deliberados no núcleo financeiro:
-- 1. finflow_guard_transaction_payment_group impede apagar uma raiz enquanto
--    existir um recibo de conclusão ativo;
-- 2. ai_cartoes_protect_active_invoice_ledger impede apagar um cartão enquanto
--    existir um pagamento de fatura estornável.
--
-- Por isso os ledgers privados relacionados são apagados primeiro. A função
-- continua transacional: qualquer falha reverte também essas limpezas.

begin;

-- O ator que concluiu/reabriu uma transação compartilhada pode ser diferente
-- do dono do lançamento. ON DELETE CASCADE em receipts.user_id apagaria o
-- ledger financeiro do dono quando apenas o parceiro encerrasse a conta.
--
-- O ator passa a ser anulável e sua FK usa SET NULL. O vínculo financeiro
-- permanece em transaction_user_id/root_transaction_id e a ausência do ator
-- passa a significar explicitamente "conta do executor excluída".
do $$
declare
  target_table pg_catalog.regclass;
  actor_attnum smallint;
  constraint_row record;
begin
  foreach target_table in array array[
    'private.transaction_completion_receipts'::pg_catalog.regclass,
    'private.transaction_reopen_receipts'::pg_catalog.regclass
  ]
  loop
    select attribute.attnum
      into actor_attnum
      from pg_catalog.pg_attribute attribute
     where attribute.attrelid = target_table
       and attribute.attname = 'user_id'
       and not attribute.attisdropped;

    if actor_attnum is null then
      raise exception using errcode = 'P0001', message = 'FINFLOW_RECEIPT_ACTOR_COLUMN_MISSING';
    end if;

    for constraint_row in
      select constraint_definition.conname
        from pg_catalog.pg_constraint constraint_definition
       where constraint_definition.conrelid = target_table
         and constraint_definition.confrelid = 'auth.users'::pg_catalog.regclass
         and constraint_definition.contype = 'f'
         and constraint_definition.conkey = array[actor_attnum]::smallint[]
    loop
      execute pg_catalog.format(
        'alter table %s drop constraint %I',
        target_table,
        constraint_row.conname
      );
    end loop;
  end loop;
end;
$$;

alter table private.transaction_completion_receipts
  alter column user_id drop not null,
  add constraint transaction_completion_receipts_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

alter table private.transaction_reopen_receipts
  alter column user_id drop not null,
  add constraint transaction_reopen_receipts_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;

comment on column private.transaction_completion_receipts.user_id is
  'Ator que registrou a baixa. Fica NULL se a conta do ator for excluída; transaction_user_id identifica o dono do lançamento.';
comment on column private.transaction_reopen_receipts.user_id is
  'Ator que registrou o estorno. Fica NULL se a conta do ator for excluída; transaction_id e completion_receipt_id preservam o evento financeiro.';

create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  amr_entries jsonb;
  entry jsonb;
  entry_ts bigint;
  latest_ts bigint := 0;
begin
  if uid is null then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  amr_entries := coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb);
  for entry in select * from pg_catalog.jsonb_array_elements(amr_entries)
  loop
    entry_ts := nullif(entry ->> 'timestamp', '')::bigint;
    if entry_ts is not null and entry_ts > latest_ts then
      latest_ts := entry_ts;
    end if;
  end loop;

  -- A checagem ocorre antes de qualquer DELETE: falhar o step-up nunca pode
  -- deixar a conta parcialmente removida.
  if latest_ts = 0
     or pg_catalog.to_timestamp(latest_ts) < (pg_catalog.clock_timestamp() - interval '10 minutes') then
    raise exception using errcode = 'P0001', message = 'AUTH_STEP_UP_REQUIRED';
  end if;

  -- Uma parceria não pode ser simplesmente apagada junto com a identidade:
  -- o fluxo de dissolução é quem separa contas, lançamentos e objetivos sem
  -- retirar dinheiro ou histórico do outro participante. A mesma regra vale
  -- para decisões individuais ainda pendentes e para uma assinatura ativa.
  -- Essas garantias vivem também no servidor para proteger clientes antigos
  -- ou uma chamada direta à RPC.
  if exists (
    select 1
      from public.parcerias partnership
     where partnership.status in ('pendente', 'aceito')
       and (
         partnership.solicitante_id = uid
         or partnership.convidado_id = uid
         or pg_catalog.lower(pg_catalog.coalesce(partnership.convidado_email, '')) =
            pg_catalog.lower(pg_catalog.coalesce((select auth.jwt()) ->> 'email', ''))
       )
  ) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_PARTNERSHIP_PENDING';
  end if;

  if exists (
      select 1
        from public.parceria_caixinha_decisoes decision_row
       where decision_row.user_id = uid
         and decision_row.status = 'pendente'
    ) or exists (
      select 1
        from public.parceria_dissolucao_itens item
        join public.parceria_dissolucao_resumos summary
          on summary.id = item.resumo_id
       where summary.user_id = uid
         and item.estado = 'pendente'
    ) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DISSOLUTION_PENDING';
  end if;

  if exists (
    select 1
      from public.subscriptions subscription
     where subscription.user_id = uid
       and subscription.status in ('pending', 'active', 'past_due', 'grace_period', 'paused')
  ) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_SUBSCRIPTION_ACTIVE';
  end if;

  -- Serializa duas tentativas de exclusão da mesma identidade e impede que
  -- novos registros com FK para auth.users sejam inseridos enquanto a limpeza
  -- está em andamento. O lock só é adquirido depois do step-up ser validado.
  perform 1
    from auth.users u
   where u.id = uid
   for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  -- Bloqueia os recursos que alimentam os dois ledgers antes de calcular o
  -- conjunto a remover. Assim uma baixa concorrente não nasce entre a limpeza
  -- do recibo e a exclusão da transação/cartão.
  perform 1
    from public.transacoes t
   where t.user_id = uid
   order by t.id
   for update;
  perform 1
    from public.cartoes c
   where c.user_id = uid
   order by c.id
   for update;

  -- Reaberturas referenciam os recibos de conclusão com ON DELETE SET NULL.
  -- Apagá-las primeiro preserva a relação enquanto identificamos também
  -- recibos produzidos pelo parceiro para uma transação pertencente ao uid.
  -- Reaberturas em que uid foi somente o ator ficam preservadas e sua identidade
  -- é anonimizada pelo ON DELETE SET NULL da FK ao final.
  delete from private.transaction_reopen_receipts reopen
   where exists (
        select 1
          from private.transaction_completion_receipts completion
         where completion.id = reopen.completion_receipt_id
           and (
             completion.transaction_user_id = uid
             or exists (
               select 1
                 from public.transacoes transaction_row
                where transaction_row.user_id = uid
                  and transaction_row.id in (
                    completion.transaction_id,
                    completion.root_transaction_id,
                    completion.payment_transaction_id,
                    completion.remaining_transaction_id
                  )
             )
           )
      )
      or exists (
        select 1
          from public.transacoes transaction_row
         where transaction_row.user_id = uid
           and transaction_row.id = reopen.transaction_id
      );

  -- O recibo precisa desaparecer antes da raiz: o trigger de pagamentos usa
  -- exatamente este ledger para bloquear DELETE direto com histórico ativo.
  -- Os campos extras cobrem tanto o formato legado (transaction_id) quanto o
  -- ledger agrupado atual (root/payment/remaining_transaction_id).
  -- user_id não participa do predicado: ele representa o ator. Se o usuário
  -- apenas concluiu uma transação do parceiro, o recibo precisa sobreviver.
  delete from private.transaction_completion_receipts completion
   where completion.transaction_user_id = uid
      or exists (
        select 1
          from public.transacoes transaction_row
         where transaction_row.user_id = uid
           and transaction_row.id in (
             completion.transaction_id,
             completion.root_transaction_id,
             completion.payment_transaction_id,
             completion.remaining_transaction_id
           )
      );

  -- O ledger de faturas possui um trigger próprio que protege cartões com
  -- pagamentos ainda estornáveis. Incluímos os IDs do recurso para tolerar
  -- registros históricos cujo ator e dono do cartão possam ser diferentes.
  delete from private.ai_invoice_payment_ledger ledger
   where ledger.user_id = uid
      or exists (
        select 1
          from public.cartoes card_row
         where card_row.user_id = uid
           and card_row.id = ledger.card_id
      )
      or exists (
        select 1
          from public.transacoes transaction_row
         where transaction_row.user_id = uid
           and transaction_row.id = ledger.payment_transaction_id
      );

  -- A FK auto-referente é RESTRICT e não é diferível. Pagamentos técnicos
  -- nunca podem ser pais de outros pagamentos (regra do núcleo financeiro),
  -- então duas etapas cobrem toda a árvore permitida.
  delete from public.transacoes
   where user_id = uid
     and transacao_pai_id is not null;

  delete from public.transacoes
   where user_id = uid
     and transacao_pai_id is null;

  -- Estas tabelas legadas são removidas explicitamente porque nem todos os
  -- ambientes históricos nasceram com FKs ON DELETE CASCADE uniformes. As
  -- tabelas operacionais mais novas possuem FK para auth.users com CASCADE e
  -- são eliminadas pelo DELETE final (IA, fila offline, notificações,
  -- assinaturas, verificação de telefone e resumos de parceria). Recibos
  -- financeiros cross-user são preservados anonimamente pelas FKs SET NULL.
  delete from public.fatura_itens where user_id = uid;
  delete from public.cartoes      where user_id = uid;
  delete from public.caixinhas    where user_id = uid;
  delete from public.contas       where user_id = uid;
  delete from public.categorias   where user_id = uid;
  delete from public.chat_historico where user_id = uid;
  delete from public.feedbacks      where user_id = uid;
  delete from public.parcerias
    where solicitante_id = uid or convidado_id = uid;

  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;

comment on function public.delete_user() is
  'Apaga atomicamente a conta autenticada após step-up recente. Remove ledgers privados, pagamentos parciais e transações raiz na ordem exigida pelos triggers e FKs.';

commit;
