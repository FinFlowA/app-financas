begin;

-- COALESCE é uma expressão nativa do PostgreSQL e não pode ser qualificada
-- como pg_catalog.coalesce. A qualificação anterior fazia delete_user falhar
-- antes de remover qualquer dado.
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

  -- Permite que os gatilhos financeiros acompanhem o cascade desta própria
  -- exclusão. As validações de sessão e pendências acima continuam obrigatórias.
  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_set(
      coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb),
      '{role}',
      '"service_role"'::jsonb
    )::text,
    true
  );

  amr_entries := coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb);
  for entry in select * from pg_catalog.jsonb_array_elements(amr_entries)
  loop
    entry_ts := nullif(entry ->> 'timestamp', '')::bigint;
    if entry_ts is not null and entry_ts > latest_ts then
      latest_ts := entry_ts;
    end if;
  end loop;

  if latest_ts = 0
     or pg_catalog.to_timestamp(latest_ts) < (pg_catalog.clock_timestamp() - interval '10 minutes') then
    raise exception using errcode = 'P0001', message = 'AUTH_STEP_UP_REQUIRED';
  end if;

  if exists (
    select 1
      from public.parcerias partnership
     where partnership.status in ('pendente', 'aceito')
       and (
         partnership.solicitante_id = uid
         or partnership.convidado_id = uid
         or pg_catalog.lower(coalesce(partnership.convidado_email, '')) =
            pg_catalog.lower(coalesce((select auth.jwt()) ->> 'email', ''))
       )
  ) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_PARTNERSHIP_PENDING';
  end if;

  if exists (
      select 1 from public.parceria_caixinha_decisoes decision_row
       where decision_row.user_id = uid and decision_row.status = 'pendente'
    ) or exists (
      select 1
        from public.parceria_dissolucao_itens item
        join public.parceria_dissolucao_resumos summary on summary.id = item.resumo_id
       where summary.user_id = uid and item.estado = 'pendente'
    ) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_DISSOLUTION_PENDING';
  end if;

  if exists (
    select 1 from public.subscriptions subscription
     where subscription.user_id = uid
       and subscription.status in ('pending', 'active', 'past_due', 'grace_period', 'paused')
  ) then
    raise exception using errcode = 'P0001', message = 'ACCOUNT_SUBSCRIPTION_ACTIVE';
  end if;

  perform 1 from auth.users u where u.id = uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'AUTH_REQUIRED';
  end if;

  perform 1 from public.transacoes t where t.user_id = uid order by t.id for update;
  perform 1 from public.cartoes c where c.user_id = uid order by c.id for update;

  delete from private.transaction_reopen_receipts reopen
   where exists (
        select 1 from private.transaction_completion_receipts completion
         where completion.id = reopen.completion_receipt_id
           and (
             completion.transaction_user_id = uid
             or exists (
               select 1 from public.transacoes transaction_row
                where transaction_row.user_id = uid
                  and transaction_row.id in (
                    completion.transaction_id, completion.root_transaction_id,
                    completion.payment_transaction_id, completion.remaining_transaction_id
                  )
             )
           )
      )
      or exists (
        select 1 from public.transacoes transaction_row
         where transaction_row.user_id = uid and transaction_row.id = reopen.transaction_id
      );

  delete from private.transaction_completion_receipts completion
   where completion.transaction_user_id = uid
      or exists (
        select 1 from public.transacoes transaction_row
         where transaction_row.user_id = uid
           and transaction_row.id in (
             completion.transaction_id, completion.root_transaction_id,
             completion.payment_transaction_id, completion.remaining_transaction_id
           )
      );

  delete from private.ai_invoice_payment_ledger ledger
   where ledger.user_id = uid
      or exists (select 1 from public.cartoes card_row where card_row.user_id = uid and card_row.id = ledger.card_id)
      or exists (select 1 from public.transacoes transaction_row where transaction_row.user_id = uid and transaction_row.id = ledger.payment_transaction_id);

  delete from public.transacoes where user_id = uid and transacao_pai_id is not null;
  delete from public.transacoes where user_id = uid and transacao_pai_id is null;
  delete from public.fatura_itens where user_id = uid;
  delete from public.cartoes where user_id = uid;
  delete from public.caixinhas where user_id = uid;
  delete from public.contas where user_id = uid;
  delete from public.categorias where user_id = uid;
  delete from public.chat_historico where user_id = uid;
  delete from public.feedbacks where user_id = uid;
  delete from public.parcerias where solicitante_id = uid or convidado_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_user() from public, anon;
grant execute on function public.delete_user() to authenticated;

commit;
