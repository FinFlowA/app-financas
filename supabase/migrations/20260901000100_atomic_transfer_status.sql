-- Conclusao/reabertura atomica de transferencias entre contas.
-- Transferencias nao sao receitas/despesas parciais e nao devem depender do
-- executor generico de ajustes financeiros para mudar de status.

begin;

create or replace function public.set_transfer_transaction_status(
  p_transaction_id bigint,
  p_expected_status text,
  p_new_status text,
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
  transaction_row public.transacoes%rowtype;
  destination_match text[];
  destination_account_id bigint;
  account_id_to_lock bigint;
begin
  if caller is null then
    raise exception using errcode = 'P0001', message = 'TRANSFER_AUTH_REQUIRED';
  end if;
  if p_transaction_id is null or p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'TRANSFER_INVALID_REQUEST';
  end if;
  if p_expected_status not in ('paga', 'pendente')
     or p_new_status not in ('paga', 'pendente')
     or p_expected_status = p_new_status then
    raise exception using errcode = 'P0001', message = 'TRANSFER_INVALID_STATUS';
  end if;
  if p_new_status = 'paga' and p_realization_date is null then
    raise exception using errcode = 'P0001', message = 'TRANSFER_REALIZATION_DATE_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:transfer:' || p_transaction_id::text, 73117)
  );

  select t.* into transaction_row
  from public.transacoes t
  where t.id = p_transaction_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRANSFER_NOT_FOUND';
  end if;

  destination_match := pg_catalog.regexp_match(
    pg_catalog.coalesce(transaction_row.descricao, ''),
    '\[Destino:([0-9]+)\]'
  );
  if pg_catalog.coalesce(transaction_row.descricao, '') not like '[Transf.] %'
     or destination_match is null then
    raise exception using errcode = 'P0001', message = 'TRANSFER_INVALID_TRANSACTION';
  end if;
  destination_account_id := destination_match[1]::bigint;
  if destination_account_id = transaction_row.conta_id then
    raise exception using errcode = 'P0001', message = 'TRANSFER_SAME_ACCOUNT';
  end if;

  -- Trava as duas contas sempre na mesma ordem, evitando deadlock entre
  -- transferencias simultaneas em sentidos opostos.
  for account_id_to_lock in
    select ids.account_id
    from pg_catalog.unnest(
      array[transaction_row.conta_id, destination_account_id]
    ) as ids(account_id)
    order by ids.account_id
  loop
    perform private.ai_lock_account(
      caller,
      account_id_to_lock,
      false,
      p_new_status = 'paga'
    );
  end loop;

  select t.* into transaction_row
  from public.transacoes t
  where t.id = p_transaction_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRANSFER_NOT_FOUND';
  end if;

  -- Uma repeticao da mesma requisicao recebe sucesso sem aplicar novamente.
  if transaction_row.status = p_new_status then
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'transaction_id', transaction_row.id,
      'status', transaction_row.status,
      'realization_date', transaction_row.data_realizacao
    );
  end if;
  if transaction_row.status <> p_expected_status then
    raise exception using errcode = 'P0001', message = 'TRANSFER_STATUS_CHANGED';
  end if;

  update public.transacoes
  set status = p_new_status,
      data_realizacao = case when p_new_status = 'paga' then p_realization_date else null end
  where id = p_transaction_id;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'transaction_id', p_transaction_id,
    'status', p_new_status,
    'realization_date', case when p_new_status = 'paga' then p_realization_date else null end
  );
end;
$$;

revoke all on function public.set_transfer_transaction_status(bigint,text,text,date,uuid)
  from public, anon, authenticated;
grant execute on function public.set_transfer_transaction_status(bigint,text,text,date,uuid)
  to authenticated;

comment on function public.set_transfer_transaction_status(bigint,text,text,date,uuid) is
  'Conclui ou reabre uma transferencia entre contas de forma atomica, autorizada e idempotente.';

commit;
