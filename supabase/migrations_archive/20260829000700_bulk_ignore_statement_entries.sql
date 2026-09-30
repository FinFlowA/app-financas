begin;

create or replace function public.ignore_bank_statement_entries(
  p_account_id bigint, p_entries jsonb, p_expected_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  requested_count integer;
  inserted_count integer;
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_account_id is null or pg_catalog.jsonb_typeof(p_entries)<>'array' then
    raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY';
  end if;
  requested_count := pg_catalog.jsonb_array_length(p_entries);
  if requested_count<1 or requested_count>500 then raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY'; end if;
  if not exists(select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
    and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))) then
    raise exception using errcode='42501',message='RECONCILIATION_ACCOUNT_DENIED';
  end if;
  if exists(
    select 1 from pg_catalog.jsonb_to_recordset(p_entries) as e(
      fingerprint text,entry_date date,entry_type text,entry_amount numeric,idempotency_key uuid
    ) where e.fingerprint !~ '^[0-9a-f]{64}$' or e.entry_date is null
      or e.entry_type not in ('receita','despesa') or e.entry_amount<=0 or e.idempotency_key is null
  ) then raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY'; end if;

  with inserted as (
    insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,
      entry_type,entry_amount,reconciliation_mode,transaction_id,idempotency_key)
    select caller,p_account_id,e.fingerprint,e.entry_date,e.entry_type,round(e.entry_amount,2),
      'ignored',null,e.idempotency_key
    from pg_catalog.jsonb_to_recordset(p_entries) as e(
      fingerprint text,entry_date date,entry_type text,entry_amount numeric,idempotency_key uuid
    )
    on conflict(user_id,account_id,entry_fingerprint) do nothing
    returning 1
  ) select count(*) into inserted_count from inserted;
  return jsonb_build_object('ok',true,'requested_count',requested_count,'inserted_count',inserted_count);
end;
$$;

revoke all on function public.ignore_bank_statement_entries(bigint,jsonb,uuid) from public,anon;
grant execute on function public.ignore_bank_statement_entries(bigint,jsonb,uuid) to authenticated;

commit;
