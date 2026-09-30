-- Vincula uma linha do extrato a um lançamento já concluído sem criar outra baixa.

begin;

create or replace function public.link_completed_bank_statement_entry(
  p_account_id bigint, p_entry_fingerprint text, p_entry_date date,
  p_entry_type text, p_entry_amount numeric, p_transaction_id bigint,
  p_idempotency_key uuid, p_expected_user_id uuid, p_client_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  transaction_row public.transacoes%rowtype;
  existing private.bank_reconciliation_receipts%rowtype;
  destination_id bigint;
  valid_account_side boolean := false;
begin
  if caller is null then raise exception using errcode='42501', message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode='42501', message='RECONCILIATION_AUTH_MISMATCH';
  end if;
  if p_idempotency_key is null or p_client_created_at is null
     or p_client_created_at < clock_timestamp() - interval '30 days'
     or p_client_created_at > clock_timestamp() + interval '5 minutes' then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_REQUEST';
  end if;
  if p_entry_fingerprint is null or p_entry_fingerprint !~ '^[0-9a-f]{64}$'
     or p_entry_date is null or p_entry_date > (clock_timestamp() at time zone 'America/Sao_Paulo')::date
     or p_entry_type not in ('receita','despesa') or p_entry_amount is null
     or p_entry_amount <= 0 or p_entry_amount > 999999999999.99 or p_transaction_id is null then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_ENTRY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text||':'||p_account_id::text||':'||p_entry_fingerprint,82901));
  select * into existing from private.bank_reconciliation_receipts r
   where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;

  select * into transaction_row from public.transacoes t
   where t.id=p_transaction_id and t.transacao_pai_id is null and t.status='paga'
     and not (coalesce(t.descricao,'') ~ '\[(Objetivo:|PagFatura:)') for update;
  if not found then raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;

  if coalesce(transaction_row.descricao,'') like '[Transf.]%' then
    destination_id := nullif((regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]'))[1],'')::bigint;
    valid_account_side := (p_entry_type='despesa' and transaction_row.conta_id=p_account_id)
      or (p_entry_type='receita' and destination_id=p_account_id);
  else
    valid_account_side := transaction_row.conta_id=p_account_id
      and transaction_row.tipo=p_entry_type and transaction_row.categoria_id is not null;
  end if;
  if not valid_account_side or round(p_entry_amount,2)<>round(transaction_row.valor,2) then
    raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE';
  end if;
  if not exists (
    select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
      and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))
  ) then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;

  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,
    entry_type,entry_amount,reconciliation_mode,transaction_id,idempotency_key)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    'existing',p_transaction_id,p_idempotency_key) returning * into existing;

  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',existing.id,
    'transaction_id',existing.transaction_id,'linked_only',true);
end;
$$;

revoke all on function public.link_completed_bank_statement_entry(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.link_completed_bank_statement_entry(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz)
  to authenticated;

comment on function public.link_completed_bank_statement_entry(bigint,text,date,text,numeric,bigint,uuid,uuid,timestamptz) is
  'Vincula uma linha de extrato a uma transação já concluída sem repetir a baixa financeira.';

commit;
