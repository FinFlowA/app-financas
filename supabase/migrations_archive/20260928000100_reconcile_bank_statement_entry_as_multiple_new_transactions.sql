-- Uma unica linha do extrato pode representar a soma de varios lancamentos
-- NOVOS (ex.: uma unica compra no cartao de debito que na verdade cobre duas
-- categorias diferentes). O modo "existente" ja permite isso desde
-- reconcile_bank_statement_entries; esta migracao espelha o mesmo
-- comportamento para o modo "novo", reaproveitando a mesma tabela de vinculo
-- (private.bank_reconciliation_transactions) para guardar cada lancamento
-- criado e o pedaco do valor que ele recebeu. A criacao e atomica: ou todos
-- os lancamentos sao criados, ou nenhum e alterado.

begin;

create or replace function public.reconcile_bank_statement_new_entries(
  p_account_id bigint,
  p_entry_fingerprint text,
  p_entry_date date,
  p_entry_type text,
  p_entry_amount numeric,
  p_entries jsonb,
  p_idempotency_key uuid,
  p_expected_user_id uuid,
  p_client_created_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  existing private.bank_reconciliation_receipts%rowtype;
  receipt private.bank_reconciliation_receipts%rowtype;
  entry jsonb;
  entry_index integer;
  entry_count integer;
  category_id bigint;
  description_value text;
  entry_value numeric(14,2);
  entries_total numeric(20,2) := 0;
  item_key_hash text;
  item_key uuid;
  action_result jsonb;
  transaction_id bigint;
  created_ids bigint[] := '{}';
  created_amounts numeric(14,2)[] := '{}';
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
     or p_entry_amount <= 0 or p_entry_amount > 999999999999.99 then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_ENTRY';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array'
     or octet_length(p_entries::text) > 16384 then
    raise exception using errcode='22023', message='RECONCILIATION_NEW_ENTRIES_INVALID';
  end if;

  select count(*) into entry_count from jsonb_array_elements(p_entries);
  if entry_count < 2 or entry_count > 50 then
    raise exception using errcode='22023', message='RECONCILIATION_NEW_ENTRIES_INVALID';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text||':'||p_account_id::text||':'||p_entry_fingerprint,82901)
  );
  select * into existing from private.bank_reconciliation_receipts r
  where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then
    return jsonb_build_object('ok',true,'replayed',true,'receipt_id',existing.id,
      'transaction_ids',(select coalesce(jsonb_agg(t.transaction_id order by t.transaction_id),'[]'::jsonb)
        from private.bank_reconciliation_transactions t where t.receipt_id=existing.id));
  end if;

  if not exists (
    select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
      and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))
  ) then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;

  -- Valida e soma todos os itens antes de criar qualquer lancamento: a soma
  -- precisa bater exatamente com o valor da linha do extrato, igual ao modo
  -- "existente" com varios agendamentos (reconcile_bank_statement_entries).
  for entry in select * from jsonb_array_elements(p_entries)
  loop
    category_id := nullif(entry->>'category_id','')::bigint;
    description_value := trim(coalesce(entry->>'description',''));
    entry_value := round(nullif(entry->>'value','')::numeric,2);
    if category_id is null or description_value = '' or length(description_value) > 100
       or entry_value is null or entry_value <= 0 or entry_value > 999999999999.99 then
      raise exception using errcode='22023', message='RECONCILIATION_NEW_ENTRIES_INVALID';
    end if;
    if not exists (
      select 1 from public.categorias c where c.id=category_id and c.user_id=caller
        and coalesce(c.ativa::integer,0)<>0 and c.tipo in (p_entry_type,'ambos')
    ) then raise exception using errcode='22023', message='RECONCILIATION_CATEGORY_INVALID'; end if;
    entries_total := entries_total + entry_value;
  end loop;
  if round(entries_total,2) <> round(p_entry_amount,2) then
    raise exception using errcode='22023', message='RECONCILIATION_NEW_ENTRIES_TOTAL_MISMATCH';
  end if;

  entry_index := 0;
  for entry in select * from jsonb_array_elements(p_entries)
  loop
    category_id := (entry->>'category_id')::bigint;
    description_value := trim(entry->>'description');
    entry_value := round((entry->>'value')::numeric,2);
    item_key_hash := md5(p_idempotency_key::text||':'||entry_index::text);
    item_key := (substr(item_key_hash,1,8)||'-'||substr(item_key_hash,9,4)||'-4'||
      substr(item_key_hash,14,3)||'-8'||substr(item_key_hash,18,3)||'-'||substr(item_key_hash,21,12))::uuid;
    action_result := public.execute_manual_financial_action(
      'create_transaction',
      jsonb_build_object(
        'type',p_entry_type,'value',entry_value,'description',description_value,
        'status','paga','scheduled_date',p_entry_date::text,'realization_date',p_entry_date::text,
        'account_id',p_account_id,'category_id',category_id,'frequency','unica'
      ),
      item_key,caller,p_client_created_at
    );
    if action_result is null or action_result->>'ok'<>'true' then
      raise exception using errcode='P0001', message='RECONCILIATION_CREATION_NOT_CONFIRMED';
    end if;
    transaction_id := (action_result->'result'->'transaction_ids'->>0)::bigint;
    if transaction_id is null then
      raise exception using errcode='P0001', message='RECONCILIATION_CREATION_NOT_CONFIRMED';
    end if;
    created_ids := array_append(created_ids,transaction_id);
    created_amounts := array_append(created_amounts,entry_value);
    entry_index := entry_index + 1;
  end loop;

  insert into private.bank_reconciliation_receipts(
    user_id,account_id,entry_fingerprint,entry_date,entry_type,entry_amount,
    reconciliation_mode,transaction_id,idempotency_key
  ) values (
    caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,
    round(p_entry_amount,2),'new',null,p_idempotency_key
  ) returning * into receipt;

  insert into private.bank_reconciliation_transactions(receipt_id,transaction_id,amount)
  select receipt.id, created_ids[i], created_amounts[i]
  from generate_subscripts(created_ids,1) as i;

  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',receipt.id,
    'transaction_ids',to_jsonb(created_ids),'total',entries_total);
end;
$$;

revoke all on function public.reconcile_bank_statement_new_entries(bigint,text,date,text,numeric,jsonb,uuid,uuid,timestamptz)
  from public,anon;
grant execute on function public.reconcile_bank_statement_new_entries(bigint,text,date,text,numeric,jsonb,uuid,uuid,timestamptz)
  to authenticated;

comment on function public.reconcile_bank_statement_new_entries(bigint,text,date,text,numeric,jsonb,uuid,uuid,timestamptz) is
  'Cria varios lancamentos novos a partir de uma unica linha de extrato, cuja soma precisa bater exatamente com o valor da linha.';

commit;
