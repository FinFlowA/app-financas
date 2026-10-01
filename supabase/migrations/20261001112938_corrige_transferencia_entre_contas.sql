-- Corrige a transferência entre contas pelo site e pelo Finn.
--
-- Em private.ai_execute_transaction_action, a descrição da transferência era
-- montada com  ' [Destino:'||payload->>'destination_account_id'||']'.
-- No Postgres, || e ->> têm a mesma precedência e associam da esquerda para
-- a direita, então a expressão virava ('... [Destino:'||payload)->>'...',
-- texto ->> texto, e toda transferência entre contas falhava com 42883
-- (operator does not exist: text ->> unknown), inclusive as agendadas que
-- depois seriam conciliadas. A única mudança é o parêntese em
-- (payload->>'destination_account_id'); o resto do corpo é cópia literal
-- da linha de base. CREATE OR REPLACE mantém dono e permissões.
--
-- Reverter: recriar a função com o corpo de
--   supabase/migrations/20260929203600_linha_de_base_producao.sql
-- (bloco CREATE OR REPLACE FUNCTION "private"."ai_execute_transaction_action"),
-- o que volta a quebrar as transferências entre contas.

CREATE OR REPLACE FUNCTION "private"."ai_execute_transaction_action"("caller" "uuid", "action_name" "text", "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  transaction_row record;
  reference_row record;
  series_row record;
  transaction_id bigint;
  inserted_ids jsonb := '[]'::jsonb;
  series_id text;
  series_match text[];
  legacy_series_ids bigint[] := '{}';
  legacy_goal jsonb;
  goal_match text[];
  destination_match text[];
  occurrence_count integer;
  occurrence_index integer;
  occurrence_date date;
  base_date date;
  realization_date date;
  frequency_value text;
  status_value text;
  db_status text;
  db_type text;
  amount numeric;
  final_amount numeric;
  amount_cents bigint;
  per_cents bigint;
  remainder_cents integer;
  description_value text;
  final_description text;
  suffix text;
  goal_name text;
  field_name text;
  scope_value text;
  new_account_id bigint;
  new_category_id bigint;
  new_date date;
  rows_changed integer := 0;
begin
  if action_name='move_goal' then
    perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
    perform private.ai_lock_goal(caller,(payload->>'goal_id')::bigint,false,true);
    select nome into goal_name from public.caixinhas where id=(payload->>'goal_id')::bigint;
    amount:=(payload->>'value')::numeric;
    occurrence_count:=(payload->>'recurrence_count')::integer;
    if occurrence_count>1 then
      series_id:=private.ai_series_marker(); frequency_value:=payload->>'frequency';
      base_date:=(payload->>'scheduled_date')::date;
      for occurrence_index in 0..occurrence_count-1 loop
        occurrence_date:=case frequency_value
          when 'semanal' then private.ai_add_occurrence(base_date,occurrence_index,'weekly')
          when 'anual' then private.ai_add_occurrence(base_date,occurrence_index,'annual')
          else private.ai_add_occurrence(base_date,occurrence_index,'monthly') end;
        suffix:=case frequency_value when 'semanal' then ' (Fixa semanal)'
          when 'anual' then ' (Fixa anual)' else ' (Fixa)' end;
        final_description:=format('[Transf.] %s%s %s%s [Serie:%s] [Objetivo:%s:%s]',
          case when coalesce(payload->>'description','')='' then '' else payload->>'description'||' · ' end,
          case payload->>'operation' when 'guardar' then 'Guardar em:' else 'Resgate de:' end,
          goal_name,suffix,series_id,payload->>'goal_id',payload->>'operation');
        if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
        insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
        values(caller,case payload->>'operation' when 'guardar' then 'despesa' else 'receita' end,
          amount,final_description,occurrence_date,null,(payload->>'account_id')::bigint,null,'pendente')
        returning id into transaction_id;
        inserted_ids:=inserted_ids||jsonb_build_array(transaction_id);
      end loop;
      return jsonb_build_object('transaction_ids',inserted_ids,'series_id',series_id,
        'goal_id',(payload->>'goal_id')::bigint,'operation',payload->>'operation',
        'occurrences',occurrence_count,'frequency',frequency_value,'status','pendente');
    end if;
    final_description:=format('[Transf.] %s%s %s [Objetivo:%s:%s]',
      case when coalesce(payload->>'description','')='' then '' else payload->>'description'||' · ' end,
      case payload->>'operation' when 'guardar' then 'Guardar em:' else 'Resgate de:' end,
      goal_name,payload->>'goal_id',payload->>'operation');
    if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
    perform private.ai_adjust_goal_balance(caller,(payload->>'goal_id')::bigint,
      case payload->>'operation' when 'guardar' then 'save' else 'withdraw' end,amount,1);
    insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
    values(caller,case payload->>'operation' when 'guardar' then 'despesa' else 'receita' end,
      amount,final_description,(payload->>'realization_date')::date,(payload->>'realization_date')::date,
      (payload->>'account_id')::bigint,null,'paga') returning id into transaction_id;
    return jsonb_build_object('transaction_id',transaction_id,'goal_id',(payload->>'goal_id')::bigint,
      'operation',payload->>'operation','value',amount,'status','paga');
  end if;

  if action_name in ('create_transaction','transfer_between_accounts') then
    frequency_value:=payload->>'frequency';
    occurrence_count:=(payload->>'recurrence_count')::integer;
    base_date:=(payload->>'scheduled_date')::date;
    status_value:=payload->>'status';
    amount:=(payload->>'value')::numeric;
    description_value:=payload->>'description';
    if action_name='create_transaction' then
      perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
      db_type:=payload->>'type';
      perform private.ai_lock_category(caller,(payload->>'category_id')::bigint,db_type,true);
    else
      db_type:='despesa';
      if payload->>'account_id'=payload->>'destination_account_id' then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
      if (payload->>'account_id')::bigint < (payload->>'destination_account_id')::bigint then
        perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
        perform private.ai_lock_account(caller,(payload->>'destination_account_id')::bigint,false,true);
      else
        perform private.ai_lock_account(caller,(payload->>'destination_account_id')::bigint,false,true);
        perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
      end if;
    end if;
    if occurrence_count>1 then series_id:=private.ai_series_marker(); end if;
    if frequency_value='parcelada' then
      amount_cents:=round(amount*100)::bigint;
      per_cents:=amount_cents/occurrence_count;
      remainder_cents:=(amount_cents%occurrence_count)::integer;
      if per_cents<=0 then perform private.ai_fail('AI_INSTALLMENT_TOO_SMALL'); end if;
    end if;
    for occurrence_index in 0..occurrence_count-1 loop
      occurrence_date:=case frequency_value
        when 'unica' then base_date
        when 'parcelada' then private.ai_add_occurrence(base_date,occurrence_index,'monthly')
        when 'semanal' then private.ai_add_occurrence(base_date,occurrence_index,'weekly')
        when 'mensal' then private.ai_add_occurrence(base_date,occurrence_index,'monthly')
        else private.ai_add_occurrence(base_date,occurrence_index,'annual') end;
      final_amount:=case when frequency_value='parcelada'
        then (per_cents+case when occurrence_index<remainder_cents then 1 else 0 end)::numeric/100
        else amount end;
      suffix:=case frequency_value
        when 'parcelada' then format(' (%s/%s)',occurrence_index+1,occurrence_count)
        when 'semanal' then ' (Fixa semanal)'
        when 'mensal' then ' (Fixa)'
        when 'anual' then ' (Fixa anual)'
        else '' end;
      final_description:=description_value||suffix
        ||case when series_id is not null then ' [Serie:'||series_id||']' else '' end;
      if action_name='transfer_between_accounts' then
        final_description:='[Transf.] '||final_description||' [Destino:'||(payload->>'destination_account_id')||']';
      end if;
      if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
      db_status:=case when occurrence_index=0 and status_value='paga' then 'paga' else 'pendente' end;
      realization_date:=case when db_status='paga' then (payload->>'realization_date')::date else null end;
      insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
      values(caller,db_type,final_amount,final_description,occurrence_date,realization_date,
        (payload->>'account_id')::bigint,
        case when action_name='create_transaction' then (payload->>'category_id')::bigint else null end,db_status)
      returning id into transaction_id;
      inserted_ids:=inserted_ids||jsonb_build_array(transaction_id);
    end loop;
    return jsonb_build_object('transaction_ids',inserted_ids,'series_id',series_id,
      'occurrences',occurrence_count,'frequency',frequency_value);
  end if;

  if action_name in ('update_transaction','delete_transaction','complete_transaction','reopen_transaction') then
    transaction_id:=(payload->>'transaction_id')::bigint;
    select * into transaction_row from public.transacoes where id=transaction_id;
    if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
    perform private.ai_lock_account(caller,transaction_row.conta_id,false,false);
    select t.* into transaction_row from public.transacoes t
    where t.id=transaction_id and t.conta_id=transaction_row.conta_id for update;
    if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
    perform private.ai_assert_transaction(caller,transaction_id);
    if transaction_row.descricao like '%[PagFatura:%' then perform private.ai_fail('AI_USE_INVOICE_REVERSAL'); end if;
    if transaction_row.descricao not like '[Transf.] %' then
      if transaction_row.categoria_id is null then
        legacy_goal:=private.ai_resolve_legacy_goal_movement(caller,transaction_row.descricao);
        if legacy_goal is null then perform private.ai_fail('AI_CATEGORY_REQUIRED'); end if;
        if (legacy_goal->>'operation'='save' and transaction_row.tipo<>'despesa')
           or (legacy_goal->>'operation'='withdraw' and transaction_row.tipo<>'receita') then
          perform private.ai_fail('AI_LEGACY_GOAL_TYPE_MISMATCH');
        end if;
      elsif not exists(
        select 1 from public.categorias c where c.id=transaction_row.categoria_id
          and (c.tipo=transaction_row.tipo or c.tipo='ambos')
      ) then perform private.ai_fail('AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE'); end if;
    end if;
    series_match:=regexp_match(transaction_row.descricao,'\[Serie:([A-Za-z0-9_-]+)\]');
  end if;

  if action_name='update_transaction' then
    field_name:=payload->>'field'; scope_value:=payload->>'series_scope';
    if transaction_row.user_id<>caller and field_name in ('account_id','category_id') then
      perform private.ai_fail('AI_SHARED_TRANSACTION_OWNERSHIP_IMMUTABLE');
    end if;
    if transaction_row.status='paga' and scope_value<>'one' then perform private.ai_fail('AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL'); end if;
    if scope_value='open_series' and series_match is null then
      legacy_series_ids:=private.ai_legacy_series_ids(caller,transaction_id);
    end if;
    if scope_value='open_series' and transaction_row.status='paga' then perform private.ai_fail('AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL'); end if;
    if scope_value='one' then
      amount:=transaction_row.valor;
      final_description:=transaction_row.descricao;
      new_account_id:=transaction_row.conta_id;
      new_category_id:=transaction_row.categoria_id;
      new_date:=transaction_row.data_vencimento;
      if field_name='value' then amount:=(payload->>'new_value')::numeric; end if;
      if field_name='description' then
        if legacy_goal is not null then
          final_description:=format('[Transf.] %s · %s: %s [Objetivo:%s:%s]',
            payload->>'new_value',
            case legacy_goal->>'marker_operation' when 'guardar' then 'Guardar em' else 'Resgate de' end,
            legacy_goal->>'goal_name',legacy_goal->>'goal_id',legacy_goal->>'marker_operation');
          if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
        else
          final_description:=private.ai_replace_transaction_base(transaction_row.descricao,payload->>'new_value');
        end if;
      end if;
      if field_name='account_id' then
        new_account_id:=(payload->>'new_value')::bigint;
        perform private.ai_lock_account(caller,new_account_id,false,true);
      end if;
      if field_name='category_id' then
        if transaction_row.categoria_id is null then perform private.ai_fail('AI_INTERNAL_TRANSFER_HAS_NO_CATEGORY'); end if;
        new_category_id:=(payload->>'new_value')::bigint;
        perform private.ai_lock_category(caller,new_category_id,transaction_row.tipo,true);
      end if;
      if field_name='scheduled_date' then new_date:=(payload->>'new_value')::date; end if;
      destination_match:=regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]\s*$');
      if destination_match is not null then
        perform private.ai_lock_account(caller,destination_match[1]::bigint,false,true);
        if new_account_id=destination_match[1]::bigint then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
      end if;
      if transaction_row.status='paga' and amount<>transaction_row.valor
         and transaction_row.categoria_id is null then
        perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,transaction_row.valor,-1);
        perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,amount,1);
      end if;
      update public.transacoes set valor=amount,descricao=final_description,conta_id=new_account_id,
        categoria_id=new_category_id,data_vencimento=new_date where id=transaction_id;
      return jsonb_build_object('transaction_id',transaction_id,'updated',true,'scope','one','field',field_name);
    end if;

    -- Série: somente itens ainda pendentes; os concluídos permanecem imutáveis.
    for series_row in
      select * from public.transacoes t
      where (
          (series_match is not null and position('[Serie:'||series_match[1]||']' in t.descricao)>0)
          or (series_match is null and t.id=any(legacy_series_ids))
        )
        and t.status<>'paga'
        and (
          t.user_id=caller
          or exists(select 1 from public.contas c where c.id=t.conta_id
            and coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller))
        )
      order by t.data_vencimento,t.id for update
    loop
      perform private.ai_lock_account(caller,series_row.conta_id,false,false);
      perform private.ai_assert_transaction(caller,series_row.id);
      if series_row.user_id<>caller and field_name in ('account_id','category_id') then
        perform private.ai_fail('AI_SHARED_TRANSACTION_OWNERSHIP_IMMUTABLE');
      end if;
      amount:=series_row.valor; final_description:=series_row.descricao;
      new_account_id:=series_row.conta_id; new_category_id:=series_row.categoria_id;
      new_date:=series_row.data_vencimento;
      if field_name='value' then amount:=(payload->>'new_value')::numeric; end if;
      if field_name='description' then
        legacy_goal:=case when series_row.categoria_id is null
          then private.ai_resolve_legacy_goal_movement(caller,series_row.descricao)
          else null end;
        if legacy_goal is not null then
          final_description:=format('[Transf.] %s · %s: %s [Objetivo:%s:%s]',
            payload->>'new_value',
            case legacy_goal->>'marker_operation' when 'guardar' then 'Guardar em' else 'Resgate de' end,
            legacy_goal->>'goal_name',legacy_goal->>'goal_id',legacy_goal->>'marker_operation');
          if length(final_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
        else
          final_description:=private.ai_replace_transaction_base(series_row.descricao,payload->>'new_value');
        end if;
      end if;
      if field_name='account_id' then
        new_account_id:=(payload->>'new_value')::bigint;
        perform private.ai_lock_account(caller,new_account_id,false,true);
      end if;
      if field_name='category_id' then
        if series_row.categoria_id is null then perform private.ai_fail('AI_INTERNAL_TRANSFER_HAS_NO_CATEGORY'); end if;
        new_category_id:=(payload->>'new_value')::bigint;
        perform private.ai_lock_category(caller,new_category_id,series_row.tipo,true);
      end if;
      if field_name='scheduled_date' then
        if transaction_row.descricao like '%(Fixa semanal)%' then
          new_date:=(payload->>'new_value')::date+(series_row.data_vencimento-transaction_row.data_vencimento);
        else
          new_date:=make_date(extract(year from series_row.data_vencimento)::integer,
            extract(month from series_row.data_vencimento)::integer,
            least(extract(day from (payload->>'new_value')::date)::integer,
              extract(day from (date_trunc('month',series_row.data_vencimento)+interval '1 month - 1 day'))::integer));
        end if;
      end if;
      destination_match:=regexp_match(series_row.descricao,'\[Destino:([0-9]+)\]\s*$');
      if destination_match is not null then
        perform private.ai_lock_account(caller,destination_match[1]::bigint,false,true);
        if new_account_id=destination_match[1]::bigint then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
      end if;
      update public.transacoes set valor=amount,descricao=final_description,conta_id=new_account_id,
        categoria_id=new_category_id,data_vencimento=new_date where id=series_row.id;
      rows_changed:=rows_changed+1;
    end loop;
    if rows_changed=0 then perform private.ai_fail('AI_NO_OPEN_SERIES_ITEMS'); end if;
    return jsonb_build_object('transaction_id',transaction_id,'updated',true,'scope','open_series','updated_count',rows_changed,'field',field_name);
  end if;

  if action_name='delete_transaction' then
    scope_value:=payload->>'series_scope';
    if transaction_row.status='paga' and scope_value<>'one' then perform private.ai_fail('AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL'); end if;
    if scope_value='one' then
      if transaction_row.status='paga' and transaction_row.categoria_id is null then
        perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,transaction_row.valor,-1);
      end if;
      delete from public.transacoes where id=transaction_id;
      return jsonb_build_object('transaction_id',transaction_id,'deleted',true,'scope','one');
    end if;
    if series_match is null then
      legacy_series_ids:=private.ai_legacy_series_ids(caller,transaction_id);
    end if;
    for series_row in
      select t.* from public.transacoes t where t.status<>'paga'
        and (
          (series_match is not null and position('[Serie:'||series_match[1]||']' in t.descricao)>0)
          or (series_match is null and t.id=any(legacy_series_ids))
        )
        and (
          t.user_id=caller
          or exists(select 1 from public.contas c where c.id=t.conta_id
            and coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller))
        )
        and (scope_value='open_series' or t.data_vencimento>=transaction_row.data_vencimento)
      order by t.id for update
    loop
      perform private.ai_lock_account(caller,series_row.conta_id,false,false);
      perform private.ai_assert_transaction(caller,series_row.id);
      delete from public.transacoes where id=series_row.id and status<>'paga';
      if found then rows_changed:=rows_changed+1; end if;
    end loop;
    if rows_changed=0 then perform private.ai_fail('AI_NO_OPEN_SERIES_ITEMS'); end if;
    return jsonb_build_object('transaction_id',transaction_id,'deleted',true,'scope',scope_value,'deleted_count',rows_changed);
  end if;

  if action_name='complete_transaction' then
    if transaction_row.status='paga' then perform private.ai_fail('AI_TRANSACTION_ALREADY_COMPLETED'); end if;
    if round(transaction_row.valor,2)<>(payload->>'expected_value')::numeric then perform private.ai_fail('AI_TRANSACTION_VALUE_CHANGED'); end if;
    final_amount:=transaction_row.valor;
    if payload?'interest_value' then final_amount:=final_amount+(payload->>'interest_value')::numeric; end if;
    if payload?'interest_percent' then final_amount:=round(final_amount*(1+(payload->>'interest_percent')::numeric/100),2); end if;
    if final_amount<=0 then perform private.ai_fail('AI_INVALID_FINAL_VALUE'); end if;
    if not private.ai_can_access_account(caller,transaction_row.conta_id,true) then perform private.ai_fail('AI_ACCOUNT_ARCHIVED'); end if;
    destination_match:=regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]\s*$');
    if destination_match is not null then perform private.ai_lock_account(caller,destination_match[1]::bigint,false,true); end if;
    if transaction_row.categoria_id is null then
      perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,final_amount,1);
    end if;
    update public.transacoes set status='paga',valor=round(final_amount,2),
      data_realizacao=(payload->>'realization_date')::date where id=transaction_id;
    return jsonb_build_object('transaction_id',transaction_id,'completed',true,
      'value',round(final_amount,2),'realization_date',payload->>'realization_date');
  end if;

  if action_name='reopen_transaction' then
    if transaction_row.status<>'paga' then perform private.ai_fail('AI_TRANSACTION_NOT_COMPLETED'); end if;
    destination_match:=regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]\s*$');
    if destination_match is not null then perform private.ai_lock_account(caller,destination_match[1]::bigint,false,true); end if;
    if transaction_row.categoria_id is null then
      perform private.ai_adjust_goal_from_description(caller,transaction_row.descricao,transaction_row.valor,-1);
    end if;
    update public.transacoes set status='pendente',data_realizacao=null where id=transaction_id;
    return jsonb_build_object('transaction_id',transaction_id,'reopened',true,'status','pendente');
  end if;

  perform private.ai_fail('AI_UNSUPPORTED_TRANSACTION_ACTION');
  return null;
end;
$_$;
