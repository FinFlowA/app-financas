-- FinFlow: linha de base do banco (schema de produção em 29/09/2026).
--
-- Substitui as 73 migrations anteriores (em supabase/migrations_archive/),
-- que não recriavam o banco do zero: as tabelas principais tinham sido criadas
-- pelo painel antes das migrations existirem. Gerado com
-- `supabase db dump` (schemas do app, sem dados) pelo workflow "schema" do
-- repositório privado FinFlowA/finflow-backups, mais os itens que o dump não
-- cobre (tarefas pg_cron e a configuração de papel do MFA), no final.
--
-- Não inclui (dependem do ambiente e são refeitos à parte, ver
-- docs/DEPLOY_E_OPERACAO.md): segredos do Vault (finflow_push_function_url),
-- configuração do Auth, secrets das Edge Functions e dados.
--
-- Reverter: não se aplica (é o ponto de partida). Em caso de problema,
-- restaure pelo backup (FinFlowA/finflow-backups).

-- Privilégios padrão do Supabase no schema public dariam acesso automático a
-- anon/authenticated/service_role em cada tabela, sequência e função criada
-- abaixo, e o banco recriado ficaria mais aberto que produção (o dump só
-- registra os GRANTs efetivos, não as revogações). Os GRANTs explícitos do
-- dump dão o acesso correto, e os privilégios padrão de produção voltam no
-- fim do dump (ALTER DEFAULT PRIVILEGES ... GRANT).
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON TABLES FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM "anon", "authenticated", "service_role";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" REVOKE ALL ON FUNCTIONS FROM "anon", "authenticated", "service_role";

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE SCHEMA IF NOT EXISTS "finflow_guard";


ALTER SCHEMA "finflow_guard" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "public";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "finflow_guard"."enforce_mfa"() RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
  claims jsonb;
  subject text;
BEGIN
  BEGIN
    claims := coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;

  IF claims ->> 'role' IS DISTINCT FROM 'authenticated' THEN
    RETURN;
  END IF;
  IF claims ->> 'aal' = 'aal2' THEN
    RETURN;
  END IF;

  subject := claims ->> 'sub';
  IF subject IS NULL
     OR subject !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM auth.mfa_factors factor
     WHERE factor.user_id = subject::uuid
       AND factor.status = 'verified'
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '42501',
      MESSAGE = 'FINFLOW_MFA_REQUIRED',
      HINT = 'Digite o código da verificação em duas etapas para continuar.';
  END IF;
END;
$_$;


ALTER FUNCTION "finflow_guard"."enforce_mfa"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_action_quota"("caller" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  entitlement record;
  local_day date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  window_start timestamptz;
  window_end timestamptz;
  action_limit integer;
  used_count integer;
  model_limit integer;
  model_used integer;
begin
  if caller is null or caller is distinct from (select auth.uid()) then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;
  select * into entitlement from public.get_my_entitlement();
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;
  window_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  window_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';
  action_limit:=case
    when not coalesce(entitlement.limits_enabled,false) then -1
    when entitlement.plan='premium' then 50
    when entitlement.plan='smart' then 15
    else 0
  end;
  model_limit:=case
    when not coalesce(entitlement.limits_enabled,false) then 300
    when entitlement.plan='premium' then 200
    when entitlement.plan='smart' then 60
    else 0
  end;
  select count(*) into used_count
  from public.ai_action_audit a
  where a.user_id=caller and a.event_type='succeeded'
    and a.action_id is not null
    and a.created_at>=window_start and a.created_at<window_end;
  select count(*) into model_used
  from public.ai_request_usage u
  where u.user_id=caller
    and u.created_at>=window_start and u.created_at<window_end
    and not (u.request_status='failed' and u.provider is not distinct from 'not_called');
  return jsonb_build_object(
    'plan',coalesce(entitlement.plan,'free'),
    'limits_enabled',coalesce(entitlement.limits_enabled,false),
    'limit',action_limit,
    'used',used_count,
    'remaining',case
      when action_limit<0 then -1 else greatest(action_limit-used_count,0)
    end,
    'model_limit',model_limit,
    'model_used',model_used,
    'model_remaining',greatest(model_limit-model_used,0),
    'window_start',window_start,
    'window_end',window_end,
    'timezone','America/Sao_Paulo'
  );
end;
$$;


ALTER FUNCTION "private"."ai_action_quota"("caller" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_action_state_fingerprint"("caller" "uuid", "action_name" "text", "payload" "jsonb", "p_lock" boolean) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  resource_id bigint;
  scope_value text;
  group_id bigint;
  resource_card_id bigint;
  marker text[];
  target_ids bigint[] := '{}';
  row_state jsonb;
  related_state jsonb;
  state_snapshot jsonb;
  transaction_row record;
  item_row record;
  reference_row record;
  card_row record;
  ledger_row record;
  ledger_found boolean := false;
  item_found boolean := false;
begin
  if caller is null or caller is distinct from (select auth.uid()) then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;

  if action_name=any(array[
    'create_account','create_category','create_goal','create_transaction',
    'transfer_between_accounts','create_card','create_card_purchase'
  ]) then
    return null;
  end if;

  if action_name=any(array['update_account','archive_account','delete_account','reactivate_account']) then
    resource_id:=(payload->>'account_id')::bigint;
    if p_lock then
      perform 1 from public.contas c where c.id=resource_id and c.user_id=caller for update;
    end if;
    select to_jsonb(c) into row_state from public.contas c
    where c.id=resource_id and c.user_id=caller;
    state_snapshot:=jsonb_build_object('kind','account','row',coalesce(row_state,'null'::jsonb));

  elsif action_name=any(array['update_category','archive_category','delete_category','reactivate_category']) then
    resource_id:=(payload->>'category_id')::bigint;
    if p_lock then
      perform 1 from public.categorias c where c.id=resource_id and c.user_id=caller for update;
    end if;
    select to_jsonb(c) into row_state from public.categorias c
    where c.id=resource_id and c.user_id=caller;
    state_snapshot:=jsonb_build_object('kind','category','row',coalesce(row_state,'null'::jsonb));

  elsif action_name=any(array['update_goal','archive_goal','delete_goal','reactivate_goal']) then
    resource_id:=(payload->>'goal_id')::bigint;
    if p_lock then
      perform 1 from public.caixinhas g where g.id=resource_id and g.user_id=caller for update;
    end if;
    select to_jsonb(g) into row_state from public.caixinhas g
    where g.id=resource_id and g.user_id=caller;
    state_snapshot:=jsonb_build_object('kind','goal','row',coalesce(row_state,'null'::jsonb));

  elsif action_name=any(array['update_card','archive_card','delete_card','reactivate_card']) then
    resource_id:=(payload->>'card_id')::bigint;
    if p_lock then
      perform 1 from public.cartoes c where c.id=resource_id and c.user_id=caller for update;
    end if;
    select to_jsonb(c) into row_state from public.cartoes c
    where c.id=resource_id and c.user_id=caller;
    state_snapshot:=jsonb_build_object('kind','card','row',coalesce(row_state,'null'::jsonb));

  elsif action_name='move_goal' then
    -- Mesma ordem do executor: parceria, conta e então objetivo. Os helpers
    -- revalidam autorização/ativo depois dos locks também na criação da prévia.
    perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
    perform private.ai_lock_goal(caller,(payload->>'goal_id')::bigint,false,true);
    select to_jsonb(c) into row_state from public.contas c
    where c.id=(payload->>'account_id')::bigint
      and private.ai_can_access_account(caller,c.id,false);
    select to_jsonb(g) into related_state from public.caixinhas g
    where g.id=(payload->>'goal_id')::bigint
      and private.ai_can_access_goal(caller,g.id,false);
    state_snapshot:=jsonb_build_object(
      'kind','goal_movement','account',coalesce(row_state,'null'::jsonb),
      'goal',coalesce(related_state,'null'::jsonb)
    );

  elsif action_name=any(array[
    'update_transaction','delete_transaction','complete_transaction','reopen_transaction'
  ]) then
    resource_id:=(payload->>'transaction_id')::bigint;
    -- Lê primeiro apenas para resolver o conjunto. O lock vem depois, sempre
    -- em ordem de id, evitando deadlock quando duas confirmações partem de
    -- itens diferentes da mesma série.
    select t.* into transaction_row from public.transacoes t where t.id=resource_id;

    if not found then
      state_snapshot:=jsonb_build_object('kind','transaction','rows','[]'::jsonb);
    else
      perform private.ai_lock_account(caller,transaction_row.conta_id,false,
        action_name='complete_transaction');
      perform private.ai_assert_transaction(caller,resource_id);
      target_ids:=array[resource_id];
      scope_value:=coalesce(payload->>'series_scope','one');
      if action_name in ('update_transaction','delete_transaction') and scope_value<>'one' then
        marker:=regexp_match(transaction_row.descricao,'\[Serie:([A-Za-z0-9_-]+)\]');
        if marker is not null then
          select coalesce(array_agg(t.id order by t.id),'{}') into target_ids
          from public.transacoes t
          where position('[Serie:'||marker[1]||']' in t.descricao)>0
            and t.status<>'paga'
            and (
              t.user_id=caller
              or exists(
                select 1 from public.contas c
                where c.id=t.conta_id and coalesce(c.compartilhado,false)
                  and public.is_parceiro(c.user_id,caller)
              )
            )
            and (scope_value<>'current_and_future'
              or t.data_vencimento>=transaction_row.data_vencimento);
        else
          target_ids:=coalesce(private.ai_legacy_series_ids(caller,resource_id),'{}');
          if scope_value='current_and_future' then
            select coalesce(array_agg(t.id order by t.id),'{}') into target_ids
            from public.transacoes t
            where t.id=any(target_ids) and t.status<>'paga'
              and t.data_vencimento>=transaction_row.data_vencimento;
          end if;
        end if;
      end if;
      for reference_row in
        select distinct t.conta_id from public.transacoes t
        where t.id=any(target_ids) order by t.conta_id
      loop
        perform private.ai_lock_account(caller,reference_row.conta_id,false,
          action_name='complete_transaction');
      end loop;
      if p_lock and cardinality(target_ids)>0 then
        perform 1 from public.transacoes t
        where t.id=any(target_ids)
        order by t.id for update;
      end if;
      select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb)
      into row_state
      from public.transacoes t where t.id=any(target_ids);
      state_snapshot:=jsonb_build_object('kind','transaction','rows',row_state);
    end if;

  elsif action_name=any(array['update_card_purchase','delete_card_purchase']) then
    resource_id:=(payload->>'purchase_id')::bigint;
    select i.* into item_row from public.fatura_itens i
    where i.id=resource_id and i.user_id=caller;
    item_found:=found;
    if item_found then
      resource_card_id:=item_row.cartao_id;
      perform private.ai_lock_card(caller,resource_card_id,true);
      -- Cartão antes dos itens: a mesma ordem usada por pagamento de fatura e
      -- exclusão/edição do cartão.
      if p_lock then
        select c.* into card_row from public.cartoes c
        where c.id=resource_card_id and c.user_id=caller for update;
        select i.* into item_row from public.fatura_itens i
        where i.id=resource_id and i.user_id=caller for update;
        item_found:=found and item_row.cartao_id=resource_card_id;
      else
        select c.* into card_row from public.cartoes c
        where c.id=resource_card_id and c.user_id=caller;
      end if;
    end if;
    if not item_found then
      state_snapshot:=jsonb_build_object('kind','card_purchase','card','null'::jsonb,'rows','[]'::jsonb);
    else
      target_ids:=array[resource_id];
      scope_value:=coalesce(payload->>'series_scope','one');
      if scope_value='open_series' then
        group_id:=coalesce(item_row.grupo_parcela_id,item_row.id);
        select coalesce(array_agg(i.id order by i.id),'{}') into target_ids
        from public.fatura_itens i
        where i.user_id=caller and coalesce(i.grupo_parcela_id,i.id)=group_id
          and not i.pago;
      end if;
      if p_lock and cardinality(target_ids)>0 then
        perform 1 from public.fatura_itens i
        where i.id=any(target_ids) order by i.id for update;
      end if;
      select coalesce(jsonb_agg(
        jsonb_build_object(
          'row',to_jsonb(i),
          'invoice_closed',private.ai_invoice_is_closed(i.mes_fatura,card_row.dia_fechamento)
        ) order by i.id
      ),'[]'::jsonb) into row_state
      from public.fatura_itens i where i.id=any(target_ids);
      state_snapshot:=jsonb_build_object(
        'kind','card_purchase','card',to_jsonb(card_row),'rows',row_state
      );
    end if;

  elsif action_name='pay_invoice' then
    resource_id:=(payload->>'card_id')::bigint;
    perform private.ai_lock_card(caller,resource_id,true);
    perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
    select c.* into card_row from public.cartoes c
    where c.id=resource_id and c.user_id=caller and coalesce(c.ativo,true);
    select to_jsonb(c) into related_state from public.contas c
    where c.id=(payload->>'account_id')::bigint;
    select coalesce(array_agg(i.id order by i.id),'{}') into target_ids
    from public.fatura_itens i
    where i.card_id=resource_id and i.user_id=caller
      and i.mes_fatura=payload->>'invoice_month';
    if p_lock and cardinality(target_ids)>0 then
      perform 1 from public.fatura_itens i
      where i.id=any(target_ids) order by i.id for update;
    end if;
    select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb)
    into row_state from public.fatura_itens i where i.id=any(target_ids);
    state_snapshot:=jsonb_build_object(
      'kind','invoice','card',case when card_row is null then 'null'::jsonb else to_jsonb(card_row) end,
      'account',coalesce(related_state,'null'::jsonb),'items',row_state
    );

  elsif action_name='reverse_invoice_payment' then
    resource_id:=(payload->>'transaction_id')::bigint;
    if p_lock then
      select t.* into transaction_row from public.transacoes t
      where t.id=resource_id and t.user_id=caller for update;
      select l.* into ledger_row from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=resource_id and l.user_id=caller for update;
      ledger_found:=found;
    else
      select t.* into transaction_row from public.transacoes t
      where t.id=resource_id and t.user_id=caller;
      select l.* into ledger_row from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=resource_id and l.user_id=caller;
      ledger_found:=found;
    end if;
    if ledger_found then
      target_ids:=coalesce(ledger_row.paid_item_ids,'{}');
      if ledger_row.linked_item_id is not null then
        target_ids:=array_append(target_ids,ledger_row.linked_item_id);
      end if;
      if p_lock and cardinality(target_ids)>0 then
        perform 1 from public.fatura_itens i
        where i.id=any(target_ids) order by i.id for update;
      end if;
      select coalesce(jsonb_agg(to_jsonb(i) order by i.id),'[]'::jsonb)
      into related_state from public.fatura_itens i where i.id=any(target_ids);
    else
      related_state:='[]'::jsonb;
    end if;
    state_snapshot:=jsonb_build_object(
      'kind','invoice_payment',
      'transaction',case when transaction_row is null then 'null'::jsonb else to_jsonb(transaction_row) end,
      'ledger',case when ledger_row is null then 'null'::jsonb else to_jsonb(ledger_row) end,
      'items',related_state
    );

  else
    perform private.ai_fail('AI_STATE_GUARD_UNSUPPORTED');
  end if;

  return encode(extensions.digest(
    convert_to(jsonb_build_array('finflow-ai-state-v1',action_name,state_snapshot)::text,'UTF8'),
    'sha256'
  ),'hex');
end;
$$;


ALTER FUNCTION "private"."ai_action_state_fingerprint"("caller" "uuid", "action_name" "text", "payload" "jsonb", "p_lock" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_add_month"("invoice_month" "text", "offset_months" integer) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare parsed date;
begin
  if invoice_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    perform private.ai_fail('AI_INVALID_MONTH');
  end if;
  parsed := (invoice_month || '-01')::date;
  return to_char(parsed + make_interval(months => offset_months), 'YYYY-MM');
end;
$_$;


ALTER FUNCTION "private"."ai_add_month"("invoice_month" "text", "offset_months" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_add_occurrence"("base_date" "date", "occurrence_index" integer, "frequency" "text") RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare
  target_month date;
  month_offset integer;
begin
  if occurrence_index < 0 then perform private.ai_fail('AI_INVALID_OCCURRENCE'); end if;
  if frequency = 'weekly' then return base_date + (occurrence_index * 7); end if;
  if frequency not in ('monthly','annual') then perform private.ai_fail('AI_INVALID_FREQUENCY'); end if;
  month_offset := occurrence_index * case when frequency = 'annual' then 12 else 1 end;
  target_month := (date_trunc('month', base_date)::date + make_interval(months => month_offset))::date;
  return make_date(
    extract(year from target_month)::integer,
    extract(month from target_month)::integer,
    least(extract(day from base_date)::integer,
      extract(day from (target_month + interval '1 month - 1 day'))::integer)
  );
end;
$$;


ALTER FUNCTION "private"."ai_add_occurrence"("base_date" "date", "occurrence_index" integer, "frequency" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_adjust_goal_balance"("caller" "uuid", "goal_id" bigint, "operation_name" "text", "amount" numeric, "direction" integer) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare current_balance numeric; new_balance numeric;
begin
  if operation_name not in ('save','withdraw') or amount<=0 or direction not in (-1,1) then
    perform private.ai_fail('AI_INVALID_GOAL_ADJUSTMENT');
  end if;
  perform private.ai_lock_goal(caller,goal_id,false,true);
  select g.saldo_atual into current_balance
  from public.caixinhas g
  where g.id=goal_id
    and not coalesce(g.arquivado,false)
    and (
      g.user_id=caller
      or (coalesce(g.compartilhado,false) and public.is_parceiro(g.user_id,caller))
    )
  for update;
  if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  new_balance := coalesce(current_balance,0)
    + case operation_name when 'save' then amount else -amount end * direction;
  if new_balance < 0 then perform private.ai_fail('AI_INSUFFICIENT_GOAL_BALANCE'); end if;
  perform pg_catalog.set_config('finflow.goal_balance_write_allowed', '1', true);
  update public.caixinhas set saldo_atual=round(new_balance,2) where id=goal_id;
  return round(new_balance,2);
end;
$$;


ALTER FUNCTION "private"."ai_adjust_goal_balance"("caller" "uuid", "goal_id" bigint, "operation_name" "text", "amount" numeric, "direction" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_adjust_goal_from_description"("caller" "uuid", "description" "text", "amount" numeric, "direction" integer) RETURNS numeric
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  marker text[];
  legacy_goal jsonb;
begin
  marker := regexp_match(description,'\[Objetivo:([0-9]+):(guardar|resgatar)\]\s*$');
  if marker is null then
    legacy_goal:=private.ai_resolve_legacy_goal_movement(caller,description);
    if legacy_goal is null then return null; end if;
    return private.ai_adjust_goal_balance(
      caller,(legacy_goal->>'goal_id')::bigint,legacy_goal->>'operation',amount,direction
    );
  end if;
  return private.ai_adjust_goal_balance(
    caller, marker[1]::bigint,
    case marker[2] when 'guardar' then 'save' else 'withdraw' end,
    amount, direction
  );
end;
$_$;


ALTER FUNCTION "private"."ai_adjust_goal_from_description"("caller" "uuid", "description" "text", "amount" numeric, "direction" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_account"("caller" "uuid", "account_id" bigint, "owner_only" boolean DEFAULT false, "require_active" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if owner_only then
    if not exists (
      select 1 from public.contas c
      where c.id = account_id and c.user_id = caller
        and (not require_active or not coalesce(c.arquivado, false))
    ) then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
  elsif not private.ai_can_access_account(caller, account_id, require_active) then
    perform private.ai_fail('AI_ACCOUNT_NOT_FOUND');
  end if;
end;
$$;


ALTER FUNCTION "private"."ai_assert_account"("caller" "uuid", "account_id" bigint, "owner_only" boolean, "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_allowed_keys"("payload" "jsonb", "allowed_keys" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare key_name text;
begin
  if jsonb_typeof(payload) <> 'object' or octet_length(payload::text) > 16384 then
    perform private.ai_fail('AI_INVALID_PAYLOAD');
  end if;
  for key_name in select jsonb_object_keys(payload) loop
    if not (key_name = any(allowed_keys)) then
      perform private.ai_fail('AI_UNKNOWN_FIELD');
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "private"."ai_assert_allowed_keys"("payload" "jsonb", "allowed_keys" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_authenticated"() RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := (select auth.uid());
begin
  if caller is null then perform private.ai_fail('AI_AUTH_REQUIRED'); end if;
  return caller;
end;
$$;


ALTER FUNCTION "private"."ai_assert_authenticated"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_card"("caller" "uuid", "card_id" bigint, "require_active" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.cartoes c
    where c.id = card_id and c.user_id = caller
      and (not require_active or coalesce(c.ativo, true))
  ) then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
end;
$$;


ALTER FUNCTION "private"."ai_assert_card"("caller" "uuid", "card_id" bigint, "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_card_item"("caller" "uuid", "item_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.fatura_itens i
    where i.id = item_id and i.user_id = caller
      and exists (
        select 1 from public.cartoes c
        where c.id = i.cartao_id and c.user_id = caller
      )
  ) then perform private.ai_fail('AI_CARD_PURCHASE_NOT_FOUND'); end if;
end;
$$;


ALTER FUNCTION "private"."ai_assert_card_item"("caller" "uuid", "item_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_category"("caller" "uuid", "category_id" bigint, "transaction_type" "text" DEFAULT NULL::"text", "require_active" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.categorias c
    where c.id = category_id and c.user_id = caller
      and (not require_active or coalesce(c.ativa::text, 'true') not in ('0','false','f'))
      and (
        transaction_type is null
        or c.tipo = transaction_type
        or c.tipo = 'ambos'
      )
  ) then perform private.ai_fail('AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE'); end if;
end;
$$;


ALTER FUNCTION "private"."ai_assert_category"("caller" "uuid", "category_id" bigint, "transaction_type" "text", "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_goal"("caller" "uuid", "goal_id" bigint, "owner_only" boolean DEFAULT false, "require_active" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if owner_only then
    if not exists (
      select 1 from public.caixinhas g
      where g.id = goal_id and g.user_id = caller
        and (not require_active or not coalesce(g.arquivado, false))
    ) then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  elsif not private.ai_can_access_goal(caller, goal_id, require_active) then
    perform private.ai_fail('AI_GOAL_NOT_FOUND');
  end if;
end;
$$;


ALTER FUNCTION "private"."ai_assert_goal"("caller" "uuid", "goal_id" bigint, "owner_only" boolean, "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_reactivation_limit"("caller" "uuid", "resource_kind" "text", "resource_type" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  entitlement record;
  allowed_count integer;
  used_count integer;
begin
  select * into entitlement from public.get_my_entitlement();
  if not coalesce(entitlement.limits_enabled,false) or entitlement.plan='premium' then return; end if;
  if resource_kind='account' then
    allowed_count := case entitlement.plan when 'smart' then 5 else 2 end;
    select count(*) into used_count from public.contas where user_id=caller and not coalesce(arquivado,false);
  elsif resource_kind='card' then
    allowed_count := case entitlement.plan when 'smart' then 3 else 1 end;
    select count(*) into used_count from public.cartoes where user_id=caller and coalesce(ativo,true);
  elsif resource_kind='goal' then
    allowed_count := case entitlement.plan when 'smart' then 5 else 1 end;
    select count(*) into used_count from public.caixinhas where user_id=caller and not coalesce(arquivado,false);
  elsif resource_kind='category' then
    allowed_count := case entitlement.plan when 'smart' then 14 else 7 end;
    select count(*) into used_count from public.categorias
    where user_id=caller and tipo=resource_type
      and coalesce(ativa::text,'true') not in ('0','false','f');
  else
    perform private.ai_fail('AI_INVALID_RESOURCE_KIND');
  end if;
  if used_count>=allowed_count then perform private.ai_fail('AI_PLAN_RESOURCE_LIMIT'); end if;
end;
$$;


ALTER FUNCTION "private"."ai_assert_reactivation_limit"("caller" "uuid", "resource_kind" "text", "resource_type" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_assert_transaction"("caller" "uuid", "transaction_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."ai_assert_transaction"("caller" "uuid", "transaction_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_can_access_account"("caller" "uuid", "account_id" bigint, "require_active" boolean DEFAULT true) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.contas c
    where c.id = account_id
      and (not require_active or not coalesce(c.arquivado, false))
      and (
        c.user_id = caller
        or (
          coalesce(c.compartilhado, false)
          and public.is_parceiro(c.user_id, caller)
        )
      )
  );
$$;


ALTER FUNCTION "private"."ai_can_access_account"("caller" "uuid", "account_id" bigint, "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_can_access_goal"("caller" "uuid", "goal_id" bigint, "require_active" boolean DEFAULT true) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select exists (
    select 1
    from public.caixinhas g
    where g.id = goal_id
      and (not require_active or not coalesce(g.arquivado, false))
      and (
        g.user_id = caller
        or (
          coalesce(g.compartilhado, false)
          and public.is_parceiro(g.user_id, caller)
        )
      )
  );
$$;


ALTER FUNCTION "private"."ai_can_access_goal"("caller" "uuid", "goal_id" bigint, "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_card_used_limit"("caller" "uuid", "card_id" bigint) RETURNS numeric
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
  select greatest(coalesce(sum(i.valor),0),0)
  from public.fatura_itens i
  where i.user_id=caller and i.cartao_id=card_id and not i.pago
    and i.mes_fatura>=to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM')
    and (
      i.descricao !~ '\(Fixa\)$'
      or i.mes_fatura=to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM')
    );
$_$;


ALTER FUNCTION "private"."ai_card_used_limit"("caller" "uuid", "card_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_choice"("payload" "jsonb", "key_name" "text", "choices" "text"[]) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare value text;
begin
  value := private.ai_text(payload, key_name, 40);
  if not (value = any(choices)) then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end if;
  return value;
end;
$$;


ALTER FUNCTION "private"."ai_choice"("payload" "jsonb", "key_name" "text", "choices" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_color"("payload" "jsonb", "key_name" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare value text := private.ai_text(payload, key_name, 7);
begin
  if value !~ '^#[0-9A-Fa-f]{6}$' then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end if;
  return upper(value);
end;
$_$;


ALTER FUNCTION "private"."ai_color"("payload" "jsonb", "key_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_date"("payload" "jsonb", "key_name" "text") RETURNS "date"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare raw text; parsed date;
begin
  raw := private.ai_text(payload, key_name, 10);
  if raw !~ '^[0-9]{4}-(0[1-9]|1[0-2])-([0-2][0-9]|3[01])$' then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  begin parsed := raw::date;
  exception when others then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end;
  if to_char(parsed, 'YYYY-MM-DD') <> raw then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end if;
  return parsed;
end;
$_$;


ALTER FUNCTION "private"."ai_date"("payload" "jsonb", "key_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_description"("payload" "jsonb", "key_name" "text", "max_length" integer DEFAULT 120) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare value text := private.ai_text(payload, key_name, max_length);
begin
  if value ~* '\[(Transf\.|Destino:|Objetivo:|Serie:|PagFatura:)' then
    perform private.ai_fail('AI_RESERVED_DESCRIPTION_MARKER');
  end if;
  return value;
end;
$$;


ALTER FUNCTION "private"."ai_description"("payload" "jsonb", "key_name" "text", "max_length" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_execute_card_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  card_row record;
  item_row record;
  transaction_row record;
  ledger_row record;
  purchase_id bigint;
  first_purchase_id bigint;
  payment_tx_id bigint;
  linked_item_id bigint;
  group_id bigint;
  occurrence_count integer;
  occurrence_index integer;
  frequency_value text;
  purchase_date date;
  occurrence_date date;
  first_invoice text;
  invoice_month text;
  current_month text := to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM');
  today date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  amount numeric;
  item_amount numeric;
  total_amount numeric;
  payment_amount numeric;
  remaining_amount numeric;
  interest_amount numeric := 0;
  amount_cents bigint;
  per_cents bigint;
  remainder_cents integer;
  used_limit numeric;
  limit_charge numeric;
  description_value text;
  final_description text;
  field_name text;
  scope_value text;
  remainder_mode text;
  paid_ids bigint[] := '{}';
  target_ids bigint[] := '{}';
  deleted_count integer;
  marker text[];
begin
  if action_name='create_card_purchase' then
    perform private.ai_lock_card(caller,(payload->>'card_id')::bigint,true);
    select * into card_row from public.cartoes
    where id=(payload->>'card_id')::bigint and user_id=caller and coalesce(ativo,true) for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    perform private.ai_lock_category(caller,(payload->>'category_id')::bigint,'despesa',true);
    frequency_value:=payload->>'frequency'; occurrence_count:=(payload->>'recurrence_count')::integer;
    purchase_date:=(payload->>'purchase_date')::date; amount:=(payload->>'value')::numeric;
    first_invoice:=private.ai_invoice_month(purchase_date,card_row.dia_fechamento);
    if private.ai_invoice_is_closed(first_invoice,card_row.dia_fechamento) then perform private.ai_fail('AI_INVOICE_CLOSED'); end if;
    if frequency_value='parcelada' then
      amount_cents:=round(amount*100)::bigint; per_cents:=amount_cents/occurrence_count;
      remainder_cents:=(amount_cents%occurrence_count)::integer;
      if per_cents<=0 then perform private.ai_fail('AI_INSTALLMENT_TOO_SMALL'); end if;
      limit_charge:=amount;
    elsif frequency_value='mensal' then
      limit_charge:=case when first_invoice=current_month then amount else 0 end;
    else limit_charge:=amount;
    end if;
    used_limit:=private.ai_card_used_limit(caller,card_row.id);
    if used_limit+limit_charge>card_row.limite then perform private.ai_fail('AI_CARD_LIMIT_EXCEEDED'); end if;

    for occurrence_index in 0..occurrence_count-1 loop
      invoice_month:=private.ai_add_month(first_invoice,occurrence_index);
      occurrence_date:=case when frequency_value='mensal'
        then private.ai_add_occurrence(purchase_date,occurrence_index,'monthly') else purchase_date end;
      item_amount:=case when frequency_value='parcelada'
        then (per_cents+case when occurrence_index<remainder_cents then 1 else 0 end)::numeric/100
        else amount end;
      final_description:=(payload->>'description')||case frequency_value
        when 'parcelada' then format(' (%s/%s)',occurrence_index+1,occurrence_count)
        when 'mensal' then ' (Fixa)' else '' end;
      insert into public.fatura_itens(
        cartao_id,user_id,descricao,valor,data_compra,mes_fatura,
        parcela_atual,total_parcelas,grupo_parcela_id,categoria_id,pago
      ) values(
        card_row.id,caller,final_description,item_amount,occurrence_date,invoice_month,
        occurrence_index+1,case when frequency_value='parcelada' then occurrence_count else 1 end,
        case when occurrence_index=0 then null else first_purchase_id end,
        (payload->>'category_id')::bigint,false
      ) returning id into purchase_id;
      if occurrence_index=0 then
        first_purchase_id:=purchase_id;
        update public.fatura_itens set grupo_parcela_id=first_purchase_id where id=first_purchase_id;
      end if;
      target_ids:=array_append(target_ids,purchase_id);
    end loop;
    return jsonb_build_object('purchase_ids',to_jsonb(target_ids),'group_id',first_purchase_id,
      'frequency',frequency_value,'occurrences',occurrence_count,'first_invoice',first_invoice);
  end if;

  if action_name in ('update_card_purchase','delete_card_purchase') then
    purchase_id:=(payload->>'purchase_id')::bigint;
    perform private.ai_assert_card_item(caller,purchase_id);
    select * into item_row from public.fatura_itens where id=purchase_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CARD_PURCHASE_NOT_FOUND'); end if;
    perform private.ai_lock_card(caller,item_row.cartao_id,true);
    select * into card_row from public.cartoes
    where id=item_row.cartao_id and user_id=caller and coalesce(ativo,true) for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    if item_row.descricao='Pagamento parcial da fatura'
       or item_row.descricao~'^Saldo da fatura anterior \(.+\)$' then
      perform private.ai_fail('AI_INVOICE_SYNTHETIC_ITEM_IMMUTABLE');
    end if;
    if item_row.pago then perform private.ai_fail('AI_CARD_PURCHASE_ALREADY_PAID'); end if;
    if exists(
      select 1
      from private.ai_invoice_payment_ledger l
      where l.user_id=caller and l.linked_item_id=purchase_id and l.reversed_at is null
    ) then
      perform private.ai_fail('AI_INVOICE_PAYMENT_ITEM_REQUIRES_REVERSAL');
    end if;
  end if;

  if action_name='update_card_purchase' then
    field_name:=payload->>'field'; scope_value:=coalesce(payload->>'series_scope','one');
    if field_name='category_id' then
      perform private.ai_lock_category(caller,(payload->>'new_value')::bigint,'despesa',true);
    end if;
    if scope_value='one' then
      if private.ai_invoice_is_closed(item_row.mes_fatura,card_row.dia_fechamento) then perform private.ai_fail('AI_INVOICE_CLOSED'); end if;
      if field_name='description' then
        description_value:=payload->>'new_value';
        if item_row.total_parcelas>1 then
          description_value:=description_value||format(' (%s/%s)',item_row.parcela_atual,item_row.total_parcelas);
        elsif item_row.descricao like '%(Fixa)' then description_value:=description_value||' (Fixa)'; end if;
        update public.fatura_itens set descricao=description_value where id=purchase_id;
      else
        update public.fatura_itens set categoria_id=(payload->>'new_value')::bigint where id=purchase_id;
      end if;
      return jsonb_build_object('purchase_id',purchase_id,'updated',true,'field',field_name,'scope','one','updated_count',1);
    end if;
    group_id:=coalesce(item_row.grupo_parcela_id,item_row.id);
    deleted_count:=0;
    for item_row in
      select i.* from public.fatura_itens i
      where i.user_id=caller and coalesce(i.grupo_parcela_id,i.id)=group_id and not i.pago
      order by i.mes_fatura,i.id for update
    loop
      if not private.ai_invoice_is_closed(item_row.mes_fatura,card_row.dia_fechamento) then
        if field_name='description' then
          description_value:=payload->>'new_value';
          if item_row.total_parcelas>1 then
            description_value:=description_value||format(' (%s/%s)',item_row.parcela_atual,item_row.total_parcelas);
          elsif item_row.descricao like '%(Fixa)' then description_value:=description_value||' (Fixa)'; end if;
          update public.fatura_itens set descricao=description_value where id=item_row.id;
        else
          update public.fatura_itens set categoria_id=(payload->>'new_value')::bigint where id=item_row.id;
        end if;
        deleted_count:=deleted_count+1;
      end if;
    end loop;
    if deleted_count=0 then perform private.ai_fail('AI_NO_OPEN_CARD_PURCHASES'); end if;
    return jsonb_build_object('purchase_id',purchase_id,'updated',true,'field',field_name,
      'scope','open_series','updated_count',deleted_count);
  end if;

  if action_name='delete_card_purchase' then
    scope_value:=payload->>'series_scope'; group_id:=coalesce(item_row.grupo_parcela_id,item_row.id);
    if scope_value='one' then
      if private.ai_invoice_is_closed(item_row.mes_fatura,card_row.dia_fechamento) then perform private.ai_fail('AI_INVOICE_CLOSED'); end if;
      delete from public.fatura_itens where id=purchase_id and user_id=caller and not pago;
      return jsonb_build_object('purchase_id',purchase_id,'deleted',true,'scope','one','deleted_count',1);
    end if;
    -- Somente cobranças ainda abertas: parcelas já pagas ou pertencentes a
    -- faturas fechadas permanecem intactas.
    for item_row in
      select i.* from public.fatura_itens i
      where i.user_id=caller and coalesce(i.grupo_parcela_id,i.id)=group_id and not i.pago
      order by i.mes_fatura,i.id for update
    loop
      if not private.ai_invoice_is_closed(item_row.mes_fatura,card_row.dia_fechamento) then
        target_ids:=array_append(target_ids,item_row.id);
      end if;
    end loop;
    if cardinality(target_ids)=0 then perform private.ai_fail('AI_NO_OPEN_CARD_PURCHASES'); end if;
    delete from public.fatura_itens where user_id=caller and id=any(target_ids);
    get diagnostics deleted_count=row_count;
    return jsonb_build_object('purchase_id',purchase_id,'deleted',true,'scope','open_series','deleted_count',deleted_count);
  end if;

  if action_name='pay_invoice' then
    perform private.ai_lock_card(caller,(payload->>'card_id')::bigint,true);
    perform private.ai_lock_account(caller,(payload->>'account_id')::bigint,false,true);
    select * into card_row from public.cartoes where id=(payload->>'card_id')::bigint and user_id=caller for update;
    if not found or not coalesce(card_row.ativo,true) then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    invoice_month:=payload->>'invoice_month';
    perform pg_advisory_xact_lock(hashtext('invoice:'||caller::text||':'||card_row.id::text),hashtext(invoice_month));
    perform 1 from public.fatura_itens i
      where i.user_id=caller and i.cartao_id=card_row.id and i.mes_fatura=invoice_month and not i.pago
      order by i.id for update;
    select coalesce(sum(i.valor),0),coalesce(array_agg(i.id order by i.id),'{}')
      into total_amount,paid_ids
    from public.fatura_itens i
    where i.user_id=caller and i.cartao_id=card_row.id and i.mes_fatura=invoice_month and not i.pago;
    if total_amount<=0 then perform private.ai_fail('AI_INVOICE_ALREADY_SETTLED'); end if;
    payment_amount:=(payload->>'payment_amount')::numeric;
    remainder_mode:=payload->>'remainder_mode';
    if payment_amount>total_amount then perform private.ai_fail('AI_PAYMENT_ABOVE_INVOICE'); end if;
    if remainder_mode='full' and payment_amount<>total_amount then perform private.ai_fail('AI_TOTAL_PAYMENT_MISMATCH'); end if;
    if remainder_mode<>'full' and payment_amount>=total_amount then perform private.ai_fail('AI_PARTIAL_PAYMENT_MISMATCH'); end if;
    remaining_amount:=round(total_amount-payment_amount,2);
    if remainder_mode='carry' then
      if payload?'interest_value' then interest_amount:=(payload->>'interest_value')::numeric;
      elsif payload?'interest_percent' then interest_amount:=round(remaining_amount*(payload->>'interest_percent')::numeric/100,2);
      end if;
    end if;
    if remainder_mode in ('full','carry') then
      update public.fatura_itens set pago=true where user_id=caller and id=any(paid_ids);
    end if;
    if remainder_mode='keep_open' then
      insert into public.fatura_itens(cartao_id,user_id,descricao,valor,data_compra,mes_fatura,
        parcela_atual,total_parcelas,grupo_parcela_id,categoria_id,pago)
      values(card_row.id,caller,'Pagamento parcial da fatura',-payment_amount,today,invoice_month,
        1,1,null,null,false) returning id into linked_item_id;
    elsif remainder_mode='carry' then
      insert into public.fatura_itens(cartao_id,user_id,descricao,valor,data_compra,mes_fatura,
        parcela_atual,total_parcelas,grupo_parcela_id,categoria_id,pago)
      values(card_row.id,caller,'Saldo da fatura anterior ('||invoice_month||')',remaining_amount+interest_amount,
        today,private.ai_add_month(invoice_month,1),1,1,null,null,false) returning id into linked_item_id;
    end if;
    final_description:=format('Fatura %s - %s [PagFatura:%s:%s:%s%s]',card_row.nome,invoice_month,
      card_row.id,invoice_month,
      case remainder_mode when 'full' then 'total' when 'keep_open' then 'parcial' else 'saldo_transferido' end,
      case when linked_item_id is null then '' else ':'||linked_item_id::text end);
    insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
    values(caller,'despesa',payment_amount,final_description,today,today,
      (payload->>'account_id')::bigint,null,'paga') returning id into payment_tx_id;
    insert into private.ai_invoice_payment_ledger(payment_transaction_id,action_id,user_id,card_id,
      invoice_month,mode,paid_item_ids,linked_item_id)
    values(payment_tx_id,pending_action_id,caller,card_row.id,invoice_month,
      case remainder_mode when 'full' then 'total' when 'keep_open' then 'partial' else 'carry_forward' end,
      case when remainder_mode='keep_open' then '{}'::bigint[] else paid_ids end,linked_item_id);
    return jsonb_build_object('payment_transaction_id',payment_tx_id,'card_id',card_row.id,
      'invoice_month',invoice_month,'mode',remainder_mode,'paid',payment_amount,
      'remaining',remaining_amount,'interest',interest_amount,'linked_item_id',linked_item_id);
  end if;

  if action_name='reverse_invoice_payment' then
    payment_tx_id:=(payload->>'transaction_id')::bigint;
    select * into transaction_row from public.transacoes
    where id=payment_tx_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_PAYMENT_TRANSACTION_NOT_FOUND'); end if;
    select * into ledger_row from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=payment_tx_id and l.user_id=caller for update;
    if found then
      if ledger_row.reversed_at is not null then perform private.ai_fail('AI_INVOICE_PAYMENT_ALREADY_REVERSED'); end if;
      if ledger_row.mode<>'partial' and exists(
        select 1
        from public.transacoes t
        where t.user_id=caller and t.id<>payment_tx_id
          and t.descricao like '%[PagFatura:'||ledger_row.card_id::text||':'||ledger_row.invoice_month||':%'
          and not exists(
            select 1 from private.ai_invoice_payment_ledger tracked
            where tracked.payment_transaction_id=t.id and tracked.user_id=caller
          )
      ) then perform private.ai_fail('AI_INVOICE_HAS_UNTRACKED_PAYMENT'); end if;
      if ledger_row.linked_item_id is not null and exists(
        select 1 from public.fatura_itens linked
        where linked.id=ledger_row.linked_item_id and linked.user_id=caller and linked.pago
      ) then perform private.ai_fail('AI_INVOICE_HAS_LATER_PAYMENT'); end if;
      if exists(
        select 1 from private.ai_invoice_payment_ledger later
        where later.user_id=caller and later.card_id=ledger_row.card_id
          and later.reversed_at is null
          and later.created_at>ledger_row.created_at
          and (
            later.paid_item_ids&&ledger_row.paid_item_ids
            or ledger_row.linked_item_id=any(later.paid_item_ids)
          )
      ) then perform private.ai_fail('AI_INVOICE_HAS_LATER_PAYMENT'); end if;
      if cardinality(ledger_row.paid_item_ids)>0 then
        update public.fatura_itens set pago=false
        where user_id=caller and id=any(ledger_row.paid_item_ids);
      end if;
      if ledger_row.linked_item_id is not null then
        delete from public.fatura_itens where id=ledger_row.linked_item_id and user_id=caller;
      end if;
      update private.ai_invoice_payment_ledger l set reversed_at=clock_timestamp()
      where l.payment_transaction_id=payment_tx_id;
      delete from public.transacoes where id=payment_tx_id;
      return jsonb_build_object('payment_transaction_id',payment_tx_id,'reversed',true,
        'card_id',ledger_row.card_id,'invoice_month',ledger_row.invoice_month);
    end if;

    -- Sem ledger não há snapshot confiável: o estorno legado falha fechado para
    -- não reabrir itens quitados por pagamentos anteriores ou posteriores.
    marker:=regexp_match(transaction_row.descricao,
      '\[PagFatura:([0-9]+):([0-9]{4}-[0-9]{2}):(total|parcial|saldo_transferido)(?::([0-9]+))?\]\s*$');
    if marker is null then perform private.ai_fail('AI_NOT_AN_INVOICE_PAYMENT'); end if;
    perform private.ai_assert_card(caller,marker[1]::bigint,false);
    perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
  end if;

  perform private.ai_fail('AI_UNSUPPORTED_CARD_ACTION');
  return null;
end;
$_$;


ALTER FUNCTION "private"."ai_execute_card_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_execute_financial_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."ai_execute_financial_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_execute_resource_action"("caller" "uuid", "action_name" "text", "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  resource_id bigint;
  field_name text := payload->>'field';
  row_count integer;
  current_type text;
  current_balance numeric;
  resource_name text;
  has_references boolean;
begin
  if action_name='create_account' then
    insert into public.contas(user_id,nome,saldo_inicial,cor,arquivado)
    values(caller,payload->>'name',(payload->>'initial_balance')::numeric,payload->>'color',false)
    returning id into resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'created',true);
  elsif action_name='update_account' then
    resource_id:=(payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    update public.contas set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      saldo_inicial=case when field_name='initial_balance' then (payload->>'new_value')::numeric else saldo_inicial end,
      cor=case when field_name='color' then payload->>'new_value' else cor end
    where id=resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'updated',true,'field',field_name);
  elsif action_name='archive_account' then
    resource_id:=(payload->>'account_id')::bigint;
    update public.contas set arquivado=true where id=resource_id and user_id=caller and not coalesce(arquivado,false);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_ACCOUNT_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','account','id',resource_id,'archived',true);
  elsif action_name='delete_account' then
    resource_id:=(payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    select exists(
      select 1
      from public.transacoes
      where conta_id=resource_id
         or position('[Destino:'||resource_id::text||']' in descricao)>0
    ) into has_references;
    if has_references then
      update public.contas set arquivado=true where id=resource_id;
      return jsonb_build_object('resource','account','id',resource_id,'deleted',false,'archived',true,'reason','has_transactions');
    end if;
    delete from public.contas where id=resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'deleted',true,'archived',false);
  elsif action_name='reactivate_account' then
    resource_id:=(payload->>'account_id')::bigint;
    perform 1 from public.contas where id=resource_id and user_id=caller and coalesce(arquivado,false) for update;
    if not found then perform private.ai_fail('AI_ACCOUNT_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'account');
    update public.contas set arquivado=false where id=resource_id;
    return jsonb_build_object('resource','account','id',resource_id,'reactivated',true);
  elsif action_name='create_category' then
    insert into public.categorias(user_id,nome,tipo,cor,icone,ativa)
    values(caller,payload->>'name',payload->>'type',payload->>'color',payload->>'icon',1)
    returning id into resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'created',true);
  elsif action_name='update_category' then
    resource_id:=(payload->>'category_id')::bigint;
    perform 1 from public.categorias where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    update public.categorias set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      cor=case when field_name='color' then payload->>'new_value' else cor end,
      icone=case when field_name='icon' then payload->>'new_value' else icone end
    where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'updated',true,'field',field_name);
  elsif action_name='archive_category' then
    resource_id:=(payload->>'category_id')::bigint;
    update public.categorias set ativa=0 where id=resource_id and user_id=caller
      and coalesce(ativa::text,'true') not in ('0','false','f');
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_CATEGORY_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','category','id',resource_id,'archived',true);
  elsif action_name='delete_category' then
    resource_id:=(payload->>'category_id')::bigint;
    perform 1 from public.categorias where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    select exists(select 1 from public.transacoes where categoria_id=resource_id)
      or exists(select 1 from public.fatura_itens where categoria_id=resource_id) into has_references;
    if has_references then
      update public.categorias set ativa=0 where id=resource_id;
      return jsonb_build_object('resource','category','id',resource_id,'deleted',false,'archived',true,'reason','has_entries');
    end if;
    delete from public.categorias where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'deleted',true,'archived',false);
  elsif action_name='reactivate_category' then
    resource_id:=(payload->>'category_id')::bigint;
    select tipo into current_type from public.categorias where id=resource_id and user_id=caller
      and coalesce(ativa::text,'true') in ('0','false','f') for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'category',current_type);
    update public.categorias set ativa=1 where id=resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'reactivated',true);
  elsif action_name='create_goal' then
    if (payload->>'target_amount')::numeric<1
       or (payload->>'initial_balance')::numeric>(payload->>'target_amount')::numeric then
      perform private.ai_fail('AI_INVALID_GOAL_VALUES');
    end if;
    insert into public.caixinhas(user_id,nome,meta_valor,saldo_atual,cor,icone,data_prazo,arquivado)
    values(caller,payload->>'name',(payload->>'target_amount')::numeric,
      (payload->>'initial_balance')::numeric,payload->>'color',payload->>'icon',
      case when payload?'target_date' then (payload->>'target_date')::date else null end,false)
    returning id into resource_id;
    return jsonb_build_object('resource','goal','id',resource_id,'created',true);
  elsif action_name='update_goal' then
    resource_id:=(payload->>'goal_id')::bigint;
    select saldo_atual into current_balance from public.caixinhas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    if field_name='target_amount' and (payload->>'new_value')::numeric<greatest(1,current_balance) then
      perform private.ai_fail('AI_TARGET_BELOW_CURRENT_BALANCE');
    end if;
    update public.caixinhas set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      meta_valor=case when field_name='target_amount' then (payload->>'new_value')::numeric else meta_valor end,
      cor=case when field_name='color' then payload->>'new_value' else cor end,
      icone=case when field_name='icon' then payload->>'new_value' else icone end,
      data_prazo=case when field_name='target_date' then
        case when payload->>'new_value'='clear' then null else (payload->>'new_value')::date end
        else data_prazo end
    where id=resource_id;
    return jsonb_build_object('resource','goal','id',resource_id,'updated',true,'field',field_name);
  elsif action_name='archive_goal' then
    resource_id:=(payload->>'goal_id')::bigint;
    update public.caixinhas set arquivado=true where id=resource_id and user_id=caller and not coalesce(arquivado,false);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_GOAL_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','goal','id',resource_id,'archived',true);
  elsif action_name='delete_goal' then
    resource_id:=(payload->>'goal_id')::bigint;
    select saldo_atual,nome into current_balance,resource_name
    from public.caixinhas where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    select exists(
      select 1
      from public.transacoes t
      where t.status<>'paga'
        and (
          t.user_id=caller
          or private.ai_can_access_account(caller,t.conta_id,false)
        )
        and (
          t.descricao like '%[Objetivo:'||resource_id::text||':%'
          or position('Guardar em: '||resource_name in t.descricao)>0
          or position('Resgate de: '||resource_name in t.descricao)>0
        )
    ) into has_references;
    if coalesce(current_balance,0)<>0 or has_references then
      update public.caixinhas set arquivado=true where id=resource_id;
      return jsonb_build_object('resource','goal','id',resource_id,'deleted',false,'archived',true,
        'reason',case when current_balance<>0 then 'has_balance' else 'has_entries_or_schedules' end);
    end if;
    delete from public.caixinhas where id=resource_id;
    return jsonb_build_object('resource','goal','id',resource_id,'deleted',true,'archived',false);
  elsif action_name='reactivate_goal' then
    resource_id:=(payload->>'goal_id')::bigint;
    perform 1 from public.caixinhas where id=resource_id and user_id=caller and coalesce(arquivado,false) for update;
    if not found then perform private.ai_fail('AI_GOAL_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'goal');
    update public.caixinhas set arquivado=false where id=resource_id;
    return jsonb_build_object('resource','goal','id',resource_id,'reactivated',true);
  elsif action_name='create_card' then
    insert into public.cartoes(user_id,nome,cor,limite,dia_vencimento,dia_fechamento,ativo)
    values(caller,payload->>'name',payload->>'color',(payload->>'value')::numeric,
      (payload->>'due_day')::integer,(payload->>'closing_day')::integer,true)
    returning id into resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'created',true);
  elsif action_name='update_card' then
    resource_id:=(payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    if field_name='value' and (payload->>'new_value')::numeric<private.ai_card_used_limit(caller,resource_id) then
      perform private.ai_fail('AI_LIMIT_BELOW_USED');
    end if;
    update public.cartoes set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      limite=case when field_name='value' then (payload->>'new_value')::numeric else limite end,
      cor=case when field_name='color' then payload->>'new_value' else cor end,
      dia_vencimento=case when field_name='due_day' then (payload->>'new_value')::integer else dia_vencimento end,
      dia_fechamento=case when field_name='closing_day' then (payload->>'new_value')::integer else dia_fechamento end
    where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'updated',true,'field',field_name);
  elsif action_name='archive_card' then
    resource_id:=(payload->>'card_id')::bigint;
    update public.cartoes set ativo=false where id=resource_id and user_id=caller and coalesce(ativo,true);
    get diagnostics row_count=row_count;
    if row_count<>1 then perform private.ai_fail('AI_CARD_NOT_ACTIVE'); end if;
    return jsonb_build_object('resource','card','id',resource_id,'archived',true);
  elsif action_name='delete_card' then
    resource_id:=(payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    select
      exists(select 1 from public.fatura_itens where cartao_id=resource_id)
      or exists(
        select 1 from private.ai_invoice_payment_ledger l
        where l.card_id=resource_id and l.reversed_at is null
      )
      or exists(
        select 1 from public.transacoes t
        where t.user_id=caller
          and t.descricao like '%[PagFatura:'||resource_id::text||':%'
      )
    into has_references;
    if has_references then
      update public.cartoes set ativo=false where id=resource_id;
      return jsonb_build_object('resource','card','id',resource_id,'deleted',false,'archived',true,
        'reason','has_purchases_or_payments');
    end if;
    delete from public.cartoes where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'deleted',true,'archived',false);
  elsif action_name='reactivate_card' then
    resource_id:=(payload->>'card_id')::bigint;
    perform 1 from public.cartoes where id=resource_id and user_id=caller and not coalesce(ativo,true) for update;
    if not found then perform private.ai_fail('AI_CARD_NOT_ARCHIVED'); end if;
    perform private.ai_assert_reactivation_limit(caller,'card');
    update public.cartoes set ativo=true where id=resource_id;
    return jsonb_build_object('resource','card','id',resource_id,'reactivated',true);
  end if;
  perform private.ai_fail('AI_UNSUPPORTED_RESOURCE_ACTION');
  return null;
end;
$$;


ALTER FUNCTION "private"."ai_execute_resource_action"("caller" "uuid", "action_name" "text", "payload" "jsonb") OWNER TO "postgres";


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
        final_description:='[Transf.] '||final_description||' [Destino:'||payload->>'destination_account_id'||']';
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


ALTER FUNCTION "private"."ai_execute_transaction_action"("caller" "uuid", "action_name" "text", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_execute_transaction_action_v2"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  transaction_row public.transacoes%rowtype;
  prepared jsonb;
  normalized jsonb;
  expected_value numeric(14,2);
  realized_value numeric(14,2);
  adjustment_type text := 'none';
  adjustment_value numeric(14,2) := 0;
  raw_adjustment numeric;
  result_value jsonb;
  canonical_error text;
  common_transaction boolean;
begin
  if action_name not in ('complete_transaction','reopen_transaction') then
    return private.ai_execute_transaction_action(caller,action_name,payload);
  end if;
  if caller is null or caller is distinct from (select auth.uid()) or pending_action_id is null then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:transaction:'||(payload->>'transaction_id'),73117)
  );

  -- Resolve primeiro sem confiar nessa leitura, trava parceria/conta e só
  -- então bloqueia e revalida o lançamento que será efetivamente alterado.
  select t.* into transaction_row
  from public.transacoes t
  where t.id=(payload->>'transaction_id')::bigint;
  if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
  perform private.ai_lock_account(
    caller,transaction_row.conta_id,false,action_name='complete_transaction'
  );
  select t.* into transaction_row
  from public.transacoes t
  where t.id=(payload->>'transaction_id')::bigint
    and t.conta_id=transaction_row.conta_id
  for update;
  if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;

  prepared:=private.ai_prepare_action(caller,action_name,payload);
  normalized:=prepared->'payload';
  perform private.ai_assert_transaction(caller,(normalized->>'transaction_id')::bigint);

  if coalesce(transaction_row.descricao,'') like '%[PagFatura:%' then
    perform private.ai_fail('AI_USE_INVOICE_REVERSAL');
  end if;

  common_transaction:=transaction_row.tipo in ('receita','despesa')
    and transaction_row.categoria_id is not null
    and coalesce(transaction_row.descricao,'') not like '[Transf.] %'
    and coalesce(transaction_row.descricao,'') !~ '\[(Destino:|Objetivo:|PagFatura:)';

  if common_transaction then
    -- A categoria histórica pode estar arquivada, mas precisa continuar
    -- existindo, pertencer ao titular do lançamento e ser compatível.
    perform 1 from public.categorias c
    where c.id=transaction_row.categoria_id
      and c.user_id=transaction_row.user_id
      and c.tipo in (transaction_row.tipo,'ambos')
    for share;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE'); end if;

    begin
      if action_name='reopen_transaction' then
        result_value:=public.reopen_transaction_completion(
          (normalized->>'transaction_id')::bigint,
          pending_action_id
        );
        return result_value||jsonb_build_object('reopened',true);
      end if;

      expected_value:=round((normalized->>'expected_value')::numeric,2);
      realized_value:=round((normalized->>'realized_value')::numeric,2);
      if normalized?'interest_value' then
        raw_adjustment:=round((normalized->>'interest_value')::numeric,2);
        if raw_adjustment>0 then
          adjustment_type:='interest'; adjustment_value:=raw_adjustment;
        elsif raw_adjustment<0 then
          adjustment_type:='discount'; adjustment_value:=abs(raw_adjustment);
        end if;
      elsif normalized?'interest_percent' then
        raw_adjustment:=round((normalized->>'interest_percent')::numeric,4);
        if raw_adjustment>0 then
          adjustment_type:='interest';
          adjustment_value:=round(expected_value*raw_adjustment/100,2);
        end if;
      end if;

      result_value:=public.complete_transaction_with_partial(
        (normalized->>'transaction_id')::bigint,
        expected_value,
        adjustment_type,
        adjustment_value,
        realized_value,
        (normalized->>'realization_date')::date,
        pending_action_id
      );
      return result_value||jsonb_build_object('completed',true);
    exception when others then
      get stacked diagnostics canonical_error=message_text;
      perform private.ai_fail(case canonical_error
        when 'TRANSACTION_AUTH_REQUIRED' then 'AI_AUTH_REQUIRED'
        when 'TRANSACTION_NOT_FOUND' then 'AI_TRANSACTION_NOT_FOUND'
        when 'TRANSACTION_ALREADY_COMPLETED' then 'AI_TRANSACTION_ALREADY_COMPLETED'
        when 'TRANSACTION_VALUE_CHANGED' then 'AI_TRANSACTION_VALUE_CHANGED'
        when 'TRANSACTION_ACCOUNT_ARCHIVED' then 'AI_ACCOUNT_ARCHIVED'
        when 'TRANSACTION_REALIZED_VALUE_TOO_HIGH' then 'AI_INVALID_REALIZED_VALUE'
        when 'TRANSACTION_ADJUSTMENT_INVALID' then 'AI_INVALID_TRANSACTION_ADJUSTMENT'
        when 'TRANSACTION_ADJUSTMENT_NOT_ALLOWED_BEFORE_DUE_DATE' then 'AI_TRANSACTION_ADJUSTMENT_NOT_ALLOWED'
        when 'TRANSACTION_COMPLETION_IDEMPOTENCY_CONFLICT' then 'AI_IDEMPOTENCY_CONFLICT'
        when 'TRANSACTION_COMPLETION_STATE_CONFLICT' then 'AI_ACTION_STATE_CHANGED'
        when 'TRANSACTION_COMPLETION_ALREADY_REOPENED' then 'AI_TRANSACTION_NOT_COMPLETED'
        when 'TRANSACTION_NOT_COMPLETED' then 'AI_TRANSACTION_NOT_COMPLETED'
        when 'TRANSACTION_REOPEN_IDEMPOTENCY_CONFLICT' then 'AI_IDEMPOTENCY_CONFLICT'
        when 'TRANSACTION_REOPEN_STATE_CONFLICT' then 'AI_ACTION_STATE_CHANGED'
        when 'TRANSACTION_REOPEN_REMAINDER_CHANGED' then 'AI_ACTION_STATE_CHANGED'
        when 'TRANSACTION_REOPEN_LEGACY_PARTIAL_UNSAFE' then 'AI_TRANSACTION_REOPEN_UNSAFE'
        else 'AI_TRANSACTION_COMPLETION_FAILED'
      end);
    end;
  end if;

  -- Transferências e objetivos continuam no executor especializado. Eles não
  -- representam receita/despesa parcial: a realização precisa ser integral e
  -- não aceita juros ou desconto.
  if action_name='complete_transaction' then
    expected_value:=round((normalized->>'expected_value')::numeric,2);
    realized_value:=round((normalized->>'realized_value')::numeric,2);
    if realized_value<>expected_value
       or normalized?'interest_value' or normalized?'interest_percent' then
      perform private.ai_fail('AI_INTERNAL_TRANSACTION_REQUIRES_FULL_VALUE');
    end if;
  end if;
  return private.ai_execute_transaction_action(caller,action_name,normalized);
end;
$$;


ALTER FUNCTION "private"."ai_execute_transaction_action_v2"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_expire_actions"("caller" "uuid", "only_action" "uuid" DEFAULT NULL::"uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare expired_count integer;
begin
  with expired as (
    update public.ai_pending_actions a
    set status='expired',last_error_code='AI_ACTION_EXPIRED'
    where a.user_id=caller and a.status='pending' and a.expires_at<=clock_timestamp()
      and (only_action is null or a.id=only_action)
    returning a.*
  )
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
  )
  select id,user_id,action_type,'expired',payload,'AI_ACTION_EXPIRED',idempotency_key from expired;
  get diagnostics expired_count=row_count;
  return expired_count;
end;
$$;


ALTER FUNCTION "private"."ai_expire_actions"("caller" "uuid", "only_action" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_fail"("code" "text") RETURNS "void"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
begin
  if code !~ '^AI_[A-Z0-9_]+$' then
    code := 'AI_INTERNAL_ERROR';
  end if;
  raise exception using errcode = 'P0001', message = code;
end;
$_$;


ALTER FUNCTION "private"."ai_fail"("code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_id"("payload" "jsonb", "key_name" "text") RETURNS bigint
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare value numeric;
begin
  value := private.ai_number(payload, key_name);
  if value <= 0 or trunc(value) <> value or value > 9223372036854775807::numeric then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value::bigint;
end;
$$;


ALTER FUNCTION "private"."ai_id"("payload" "jsonb", "key_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_integer"("payload" "jsonb", "key_name" "text", "min_value" integer, "max_value" integer) RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare value numeric;
begin
  value := private.ai_number(payload, key_name);
  if trunc(value) <> value or value < min_value or value > max_value then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value::integer;
end;
$$;


ALTER FUNCTION "private"."ai_integer"("payload" "jsonb", "key_name" "text", "min_value" integer, "max_value" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_invoice_is_closed"("invoice_month" "text", "closing_day" integer) RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $_$
declare
  month_start date;
  close_date date;
  local_now timestamp := clock_timestamp() at time zone 'America/Sao_Paulo';
begin
  if invoice_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' or closing_day not between 1 and 31 then
    perform private.ai_fail('AI_INVALID_INVOICE');
  end if;
  month_start := (invoice_month || '-01')::date;
  close_date := make_date(
    extract(year from month_start)::integer,
    extract(month from month_start)::integer,
    least(closing_day, extract(day from (month_start + interval '1 month - 1 day'))::integer)
  );
  return local_now > (close_date::timestamp + interval '23 hours 59 minutes 59 seconds');
end;
$_$;


ALTER FUNCTION "private"."ai_invoice_is_closed"("invoice_month" "text", "closing_day" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_invoice_month"("purchase_date" "date", "closing_day" integer) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
begin
  if closing_day not between 1 and 31 then perform private.ai_fail('AI_INVALID_CLOSING_DAY'); end if;
  return to_char(
    date_trunc('month', purchase_date)::date
      + case when extract(day from purchase_date)::integer > closing_day
        then interval '1 month' else interval '0 month' end,
    'YYYY-MM'
  );
end;
$$;


ALTER FUNCTION "private"."ai_invoice_month"("purchase_date" "date", "closing_day" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_legacy_series_descriptor"("description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare
  metadata text;
  visible text;
  matched text[];
  cadence text;
begin
  if description is null or description ~ '\[Serie:[A-Za-z0-9_-]+\]' then
    return null;
  end if;

  metadata:=coalesce(substring(description from
    '(\s*(?:\[(?:Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$'), '');
  visible:=btrim(regexp_replace(description,
    '(\s*(?:\[(?:Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$','','g'));

  matched:=regexp_match(visible,'\(([0-9]+)/([0-9]+)\)$');
  if matched is not null then
    if matched[1]::integer<1 or matched[2]::integer<2
       or matched[1]::integer>matched[2]::integer then
      return null;
    end if;
    return jsonb_build_object(
      'kind','parcelada',
      'base',btrim(regexp_replace(visible,'\s*\([0-9]+/[0-9]+\)$','')),
      'metadata',metadata,
      'item_index',matched[1]::integer,
      'item_total',matched[2]::integer
    );
  end if;

  matched:=regexp_match(visible,'\(Fixa(?: (semanal|anual))?\)$');
  if matched is null then return null; end if;
  cadence:=case coalesce(matched[1],'mensal')
    when 'semanal' then 'semanal'
    when 'anual' then 'anual'
    else 'mensal'
  end;
  return jsonb_build_object(
    'kind','recorrente',
    'base',btrim(regexp_replace(visible,'\s*\(Fixa(?: semanal| anual)?\)$','')),
    'metadata',metadata,
    'cadence',cadence
  );
end;
$_$;


ALTER FUNCTION "private"."ai_legacy_series_descriptor"("description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_legacy_series_ids"("caller" "uuid", "target_transaction_id" bigint) RETURNS bigint[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  target_row public.transacoes%rowtype;
  candidate_row public.transacoes%rowtype;
  target_descriptor jsonb;
  candidate_descriptor jsonb;
  result_ids bigint[]:='{}';
  seen_keys text[]:='{}';
  target_kind text;
  target_cadence text;
  target_base text;
  target_metadata text;
  target_total integer;
  item_index integer;
  anchor_month date;
  candidate_anchor_month date;
  expected_month date;
  expected_date date;
  last_day integer;
  maximum_day integer:=0;
  offset_value integer;
  minimum_offset integer:=2147483647;
  maximum_offset integer:=-2147483648;
  expected_items integer;
  duplicate_key text;
  candidate_id bigint;
begin
  select * into target_row
  from public.transacoes t
  where t.id=target_transaction_id
    and (
      t.user_id=caller
      or exists(
        select 1 from public.contas c
        where c.id=t.conta_id and coalesce(c.compartilhado,false)
          and public.is_parceiro(c.user_id,caller)
      )
    )
  for update;
  if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
  if target_row.status='paga' then
    perform private.ai_fail('AI_COMPLETED_SERIES_ITEM_IS_INDIVIDUAL');
  end if;

  target_descriptor:=private.ai_legacy_series_descriptor(target_row.descricao);
  if target_descriptor is null then perform private.ai_fail('AI_TRANSACTION_NOT_IN_SERIES'); end if;
  target_kind:=target_descriptor->>'kind';
  target_cadence:=target_descriptor->>'cadence';
  target_base:=target_descriptor->>'base';
  target_metadata:=target_descriptor->>'metadata';
  target_total:=coalesce((target_descriptor->>'item_total')::integer,0);
  if target_kind='recorrente' then
    perform private.ai_fail('AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL');
  end if;
  if target_kind='parcelada' then
    item_index:=(target_descriptor->>'item_index')::integer;
    anchor_month:=(date_trunc('month',target_row.data_vencimento)::date
      - make_interval(months=>item_index-1))::date;
  end if;

  for candidate_row in
    select t.*
    from public.transacoes t
    where t.status<>'paga'
      and t.user_id=target_row.user_id
      and t.conta_id=target_row.conta_id
      and t.tipo=target_row.tipo
      and t.categoria_id is not distinct from target_row.categoria_id
      and round(t.valor,2)=round(target_row.valor,2)
      and t.descricao !~ '\[Serie:[A-Za-z0-9_-]+\]'
      and (
        t.user_id=caller
        or exists(
          select 1 from public.contas c
          where c.id=t.conta_id and coalesce(c.compartilhado,false)
            and public.is_parceiro(c.user_id,caller)
        )
      )
    order by t.data_vencimento,t.id
    for update
  loop
    candidate_descriptor:=private.ai_legacy_series_descriptor(candidate_row.descricao);
    if candidate_descriptor is null
       or candidate_descriptor->>'kind'<>target_kind
       or candidate_descriptor->>'base'<>target_base
       or candidate_descriptor->>'metadata'<>target_metadata then
      continue;
    end if;

    if target_kind='parcelada' then
      if (candidate_descriptor->>'item_total')::integer<>target_total then continue; end if;
      item_index:=(candidate_descriptor->>'item_index')::integer;
      candidate_anchor_month:=(date_trunc('month',candidate_row.data_vencimento)::date
        - make_interval(months=>item_index-1))::date;
      if candidate_anchor_month<>anchor_month then continue; end if;
      duplicate_key:='parcel:'||item_index::text;
      offset_value:=item_index-1;
    else
      if candidate_descriptor->>'cadence'<>target_cadence then continue; end if;
      if target_cadence='semanal' then
        offset_value:=(candidate_row.data_vencimento-target_row.data_vencimento)/7;
        if (candidate_row.data_vencimento-target_row.data_vencimento)%7<>0 then continue; end if;
        duplicate_key:='week:'||candidate_row.data_vencimento::text;
      elsif target_cadence='anual' then
        offset_value:=extract(year from candidate_row.data_vencimento)::integer
          - extract(year from target_row.data_vencimento)::integer;
        if extract(month from candidate_row.data_vencimento)::integer
           <>extract(month from target_row.data_vencimento)::integer then continue; end if;
        duplicate_key:='year:'||extract(year from candidate_row.data_vencimento)::integer::text;
      else
        offset_value:=(extract(year from candidate_row.data_vencimento)::integer
          - extract(year from target_row.data_vencimento)::integer)*12
          + extract(month from candidate_row.data_vencimento)::integer
          - extract(month from target_row.data_vencimento)::integer;
        duplicate_key:='month:'||to_char(candidate_row.data_vencimento,'YYYY-MM');
      end if;
    end if;

    maximum_day:=greatest(maximum_day,extract(day from candidate_row.data_vencimento)::integer);
    if array_position(seen_keys,duplicate_key) is not null then
      perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
    end if;
    seen_keys:=array_append(seen_keys,duplicate_key);
    result_ids:=array_append(result_ids,candidate_row.id);
    minimum_offset:=least(minimum_offset,offset_value);
    maximum_offset:=greatest(maximum_offset,offset_value);
  end loop;

  if cardinality(result_ids)=0 or not (target_transaction_id=any(result_ids)) then
    perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
  end if;
  if target_kind='parcelada' and cardinality(result_ids)>target_total then
    perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
  elsif target_kind='recorrente' and (
    (target_cadence='semanal' and maximum_offset-minimum_offset>259)
    or (target_cadence='mensal' and maximum_offset-minimum_offset>59)
    or (target_cadence='anual' and maximum_offset-minimum_offset>4)
  ) then
    perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
  end if;

  -- Uma série recorrente antiga não possui um identificador persistido.
  -- Por isso, só aceitamos o fallback quando os itens pendentes formam uma
  -- sequência contígua e sem duplicatas na cadência declarada. Uma lacuna
  -- pode representar itens editados/excluídos ou duas séries diferentes e,
  -- nesses casos, a operação em massa falha fechada.
  if target_kind='recorrente' then
    expected_items:=maximum_offset-minimum_offset+1;
    if expected_items<>cardinality(result_ids) then
      perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
    end if;
  end if;

  -- Datas mensais, anuais e parceladas usam sempre o mesmo dia-base, limitado
  -- ao último dia do mês. O maior dia observado recupera 29/30/31 quando
  -- algum mês da série permite esse dia.
  if target_kind='parcelada' or target_cadence in ('mensal','anual') then
    foreach candidate_id in array result_ids loop
      select * into candidate_row from public.transacoes where id=candidate_id;
      candidate_descriptor:=private.ai_legacy_series_descriptor(candidate_row.descricao);
      if target_kind='parcelada' then
        item_index:=(candidate_descriptor->>'item_index')::integer;
        expected_month:=(anchor_month+make_interval(months=>item_index-1))::date;
      elsif target_cadence='anual' then
        offset_value:=extract(year from candidate_row.data_vencimento)::integer
          - extract(year from target_row.data_vencimento)::integer;
        expected_month:=(date_trunc('month',target_row.data_vencimento)::date
          + make_interval(months=>offset_value*12))::date;
      else
        offset_value:=(extract(year from candidate_row.data_vencimento)::integer
          - extract(year from target_row.data_vencimento)::integer)*12
          + extract(month from candidate_row.data_vencimento)::integer
          - extract(month from target_row.data_vencimento)::integer;
        expected_month:=(date_trunc('month',target_row.data_vencimento)::date
          + make_interval(months=>offset_value))::date;
      end if;
      last_day:=extract(day from (expected_month+interval '1 month - 1 day'))::integer;
      expected_date:=make_date(
        extract(year from expected_month)::integer,
        extract(month from expected_month)::integer,
        least(maximum_day,last_day)
      );
      if candidate_row.data_vencimento<>expected_date then
        perform private.ai_fail('AI_LEGACY_SERIES_AMBIGUOUS');
      end if;
    end loop;
  end if;
  return result_ids;
end;
$$;


ALTER FUNCTION "private"."ai_legacy_series_ids"("caller" "uuid", "target_transaction_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_lock_account"("caller" "uuid", "account_id" bigint, "owner_only" boolean DEFAULT false, "require_active" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare account_row public.contas%rowtype; observed_owner uuid;
begin
  select c.user_id into observed_owner from public.contas c where c.id=account_id;
  if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
  if observed_owner<>caller then perform private.ai_lock_partnership_access(caller,observed_owner); end if;
  select c.* into account_row from public.contas c where c.id=account_id for update;
  if not found
     or account_row.user_id is distinct from observed_owner
     or (require_active and coalesce(account_row.arquivado,false))
     or (owner_only and account_row.user_id<>caller) then
    perform private.ai_fail('AI_ACCOUNT_NOT_FOUND');
  end if;
  if account_row.user_id<>caller then
    if owner_only or not coalesce(account_row.compartilhado,false) then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    perform private.ai_lock_partnership_access(caller,account_row.user_id);
    if not coalesce(account_row.compartilhado,false)
       or not public.is_parceiro(account_row.user_id,caller) then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
  end if;
end;
$$;


ALTER FUNCTION "private"."ai_lock_account"("caller" "uuid", "account_id" bigint, "owner_only" boolean, "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_lock_card"("caller" "uuid", "card_id" bigint, "require_active" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare card_row public.cartoes%rowtype;
begin
  select c.* into card_row from public.cartoes c where c.id=card_id for update;
  if not found or card_row.user_id<>caller or (require_active and not coalesce(card_row.ativo,true)) then
    perform private.ai_fail('AI_CARD_NOT_FOUND');
  end if;
end;
$$;


ALTER FUNCTION "private"."ai_lock_card"("caller" "uuid", "card_id" bigint, "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_lock_category"("caller" "uuid", "category_id" bigint, "transaction_type" "text" DEFAULT NULL::"text", "require_active" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare category_row public.categorias%rowtype;
begin
  select c.* into category_row from public.categorias c where c.id=category_id for update;
  if not found or category_row.user_id<>caller
     or (require_active and coalesce(category_row.ativa::text,'true') in ('0','false','f'))
     or (transaction_type is not null and category_row.tipo not in (transaction_type,'ambos')) then
    perform private.ai_fail('AI_CATEGORY_NOT_FOUND_OR_INCOMPATIBLE');
  end if;
end;
$$;


ALTER FUNCTION "private"."ai_lock_category"("caller" "uuid", "category_id" bigint, "transaction_type" "text", "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_lock_goal"("caller" "uuid", "goal_id" bigint, "owner_only" boolean DEFAULT false, "require_active" boolean DEFAULT true) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare goal_row public.caixinhas%rowtype; observed_owner uuid;
begin
  select g.user_id into observed_owner from public.caixinhas g where g.id=goal_id;
  if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  if observed_owner<>caller then perform private.ai_lock_partnership_access(caller,observed_owner); end if;
  select g.* into goal_row from public.caixinhas g where g.id=goal_id for update;
  if not found
     or goal_row.user_id is distinct from observed_owner
     or (require_active and coalesce(goal_row.arquivado,false))
     or (owner_only and goal_row.user_id<>caller) then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  if goal_row.user_id<>caller then
    if owner_only or not coalesce(goal_row.compartilhado,false) then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    perform private.ai_lock_partnership_access(caller,goal_row.user_id);
    if not coalesce(goal_row.compartilhado,false)
       or not public.is_parceiro(goal_row.user_id,caller) then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
  end if;
end;
$$;


ALTER FUNCTION "private"."ai_lock_goal"("caller" "uuid", "goal_id" bigint, "owner_only" boolean, "require_active" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_lock_partnership_access"("caller" "uuid", "owner_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare partnership_id bigint;
begin
  if caller is null or caller is distinct from (select auth.uid()) then perform private.ai_fail('AI_AUTH_REQUIRED'); end if;
  if owner_id=caller then return; end if;
  select p.id into partnership_id
  from public.parcerias p
  where p.status='aceito'
    and ((p.solicitante_id=owner_id and p.convidado_id=caller)
      or (p.solicitante_id=caller and p.convidado_id=owner_id));
  if not found then perform private.ai_fail('AI_PARTNERSHIP_NOT_FOUND'); end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:partnership:'||partnership_id::text,73119)
  );
  perform 1 from public.parcerias p
  where p.id=partnership_id and p.status='aceito'
    and ((p.solicitante_id=owner_id and p.convidado_id=caller)
      or (p.solicitante_id=caller and p.convidado_id=owner_id))
  for share;
  if not found then perform private.ai_fail('AI_PARTNERSHIP_NOT_FOUND'); end if;
end;
$$;


ALTER FUNCTION "private"."ai_lock_partnership_access"("caller" "uuid", "owner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_number"("payload" "jsonb", "key_name" "text") RETURNS numeric
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare value numeric;
begin
  if jsonb_typeof(payload -> key_name) not in ('number','string')
     or (payload ->> key_name) !~ '^-?(0|[1-9][0-9]*)(\.[0-9]{1,4})?$' then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  begin value := (payload ->> key_name)::numeric;
  exception when others then perform private.ai_fail('AI_INVALID_' || upper(key_name)); end;
  if value = 'NaN'::numeric or value = 'Infinity'::numeric or value = '-Infinity'::numeric then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value;
end;
$_$;


ALTER FUNCTION "private"."ai_number"("payload" "jsonb", "key_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_prepare_action"("caller" "uuid", "action_name" "text", "raw_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  allowed text[];
  required text[];
  normalized jsonb := raw_payload;
  key_name text;
  field_name text;
  text_value text;
  numeric_value numeric;
  primary_name text;
  secondary_name text;
  frequency_value text;
  recurrence_count integer;
  installments integer;
  invoice_total numeric;
  completion_total numeric;
  legacy_descriptor jsonb;
  title text;
  summary text;
  consequences jsonb := '[]'::jsonb;
begin
  if caller is null or caller is distinct from (select auth.uid()) then perform private.ai_fail('AI_AUTH_REQUIRED'); end if;

  case action_name
    when 'create_account' then
      allowed:=array['name','initial_balance','color']; required:=array['name'];
    when 'update_account' then allowed:=array['account_id','field','new_value']; required:=allowed;
    when 'archive_account','delete_account','reactivate_account' then allowed:=array['account_id']; required:=allowed;
    when 'create_category' then
      allowed:=array['name','type','color','icon']; required:=array['name','type'];
    when 'update_category' then allowed:=array['category_id','field','new_value']; required:=allowed;
    when 'archive_category','delete_category','reactivate_category' then allowed:=array['category_id']; required:=allowed;
    when 'create_goal' then
      allowed:=array['name','target_amount','initial_balance','color','icon','target_date'];
      required:=array['name','target_amount'];
    when 'update_goal' then allowed:=array['goal_id','field','new_value']; required:=allowed;
    when 'archive_goal','delete_goal','reactivate_goal' then allowed:=array['goal_id']; required:=allowed;
    when 'move_goal' then
      allowed:=array['operation','goal_id','account_id','value','description','realization_date',
        'scheduled_date','frequency','recurrence_count'];
      required:=array['operation','goal_id','account_id','value','description'];
    when 'create_transaction' then
      allowed:=array['type','value','description','status','scheduled_date','realization_date','account_id','category_id','frequency','installments','installment_value','recurrence_count'];
      required:=array['type','value','description','status','scheduled_date','account_id','category_id','frequency'];
    when 'transfer_between_accounts' then
      allowed:=array['account_id','destination_account_id','value','description','status','scheduled_date','realization_date','frequency','installments','installment_value','recurrence_count'];
      required:=array['account_id','destination_account_id','value','description','status','scheduled_date','frequency'];
    when 'update_transaction' then
      allowed:=array['transaction_id','series_scope','field','new_value']; required:=allowed;
    when 'delete_transaction' then
      allowed:=array['transaction_id','series_scope']; required:=allowed;
    when 'complete_transaction' then
      allowed:=array['transaction_id','realization_date','expected_value','realized_value','interest_value','interest_percent'];
      required:=array['transaction_id','realization_date','expected_value','realized_value'];
    when 'reopen_transaction' then allowed:=array['transaction_id']; required:=allowed;
    when 'create_card' then
      allowed:=array['name','value','color','due_day','closing_day'];
      required:=array['name','value','due_day','closing_day'];
    when 'update_card' then allowed:=array['card_id','field','new_value']; required:=allowed;
    when 'archive_card','delete_card','reactivate_card' then allowed:=array['card_id']; required:=allowed;
    when 'create_card_purchase' then
      allowed:=array['card_id','category_id','description','value','purchase_date','frequency','installments','installment_value','recurrence_count'];
      required:=array['card_id','category_id','description','value','purchase_date','frequency'];
    when 'update_card_purchase' then
      allowed:=array['purchase_id','field','new_value','series_scope'];
      required:=array['purchase_id','field','new_value'];
    when 'delete_card_purchase' then allowed:=array['purchase_id','series_scope']; required:=allowed;
    when 'pay_invoice' then
      allowed:=array['card_id','invoice_month','account_id','payment_amount','remainder_mode','interest_value','interest_percent'];
      required:=array['card_id','invoice_month','account_id','payment_amount','remainder_mode'];
    when 'reverse_invoice_payment' then allowed:=array['transaction_id']; required:=allowed;
    else perform private.ai_fail('AI_UNSUPPORTED_ACTION');
  end case;
  perform private.ai_assert_allowed_keys(raw_payload,allowed);
  perform private.ai_require_keys(raw_payload,required);

  -- Defaults visuais/zerados são responsabilidade do servidor, não do modelo.
  if action_name='create_account' then
    if not normalized?'initial_balance' then normalized:=normalized||jsonb_build_object('initial_balance',0); end if;
    if not normalized?'color' then normalized:=normalized||jsonb_build_object('color','#2A9D8F'); end if;
  elsif action_name='create_category' then
    if not normalized?'color' then normalized:=normalized||jsonb_build_object('color','#6B7280'); end if;
    if not normalized?'icon' then normalized:=normalized||jsonb_build_object('icon','more-horiz'); end if;
  elsif action_name='create_goal' then
    if not normalized?'initial_balance' then normalized:=normalized||jsonb_build_object('initial_balance',0); end if;
    if not normalized?'color' then normalized:=normalized||jsonb_build_object('color','#2A9D8F'); end if;
    if not normalized?'icon' then normalized:=normalized||jsonb_build_object('icon','flag'); end if;
  elsif action_name='create_card' and not normalized?'color' then
    normalized:=normalized||jsonb_build_object('color','#457B9D');
  end if;

  foreach key_name in array array['account_id','destination_account_id','category_id','goal_id','card_id','transaction_id','purchase_id'] loop
    if raw_payload?key_name then
      normalized:=jsonb_set(normalized,array[key_name],to_jsonb(private.ai_id(raw_payload,key_name)),true);
    end if;
  end loop;
  foreach key_name in array array['initial_balance','target_amount','value','expected_value','realized_value','payment_amount','installment_value'] loop
    if raw_payload?key_name then
      numeric_value:=round(private.ai_number(raw_payload,key_name),2);
      if numeric_value<0 or (key_name not in ('initial_balance') and numeric_value<=0) then perform private.ai_fail('AI_INVALID_'||upper(key_name)); end if;
      if abs(numeric_value)>999999999999.99 then perform private.ai_fail('AI_INVALID_'||upper(key_name)); end if;
      normalized:=jsonb_set(normalized,array[key_name],to_jsonb(numeric_value),true);
    end if;
  end loop;
  foreach key_name in array array['scheduled_date','realization_date','target_date','purchase_date'] loop
    if raw_payload?key_name then normalized:=jsonb_set(normalized,array[key_name],to_jsonb(to_char(private.ai_date(raw_payload,key_name),'YYYY-MM-DD')),true); end if;
  end loop;
  if raw_payload?'name' then normalized:=jsonb_set(normalized,'{name}',to_jsonb(private.ai_text(raw_payload,'name',100)),true); end if;
  if raw_payload?'description' then normalized:=jsonb_set(normalized,'{description}',to_jsonb(private.ai_description(raw_payload,'description',100)),true); end if;
  if raw_payload?'color' then normalized:=jsonb_set(normalized,'{color}',to_jsonb(private.ai_color(raw_payload,'color')),true); end if;
  if raw_payload?'icon' then normalized:=jsonb_set(normalized,'{icon}',to_jsonb(private.ai_text(raw_payload,'icon',50)),true); end if;

  if raw_payload?'type' then
    text_value:=private.ai_choice(raw_payload,'type',array['receita','despesa']);
    normalized:=jsonb_set(normalized,'{type}',to_jsonb(text_value),true);
  end if;
  if raw_payload?'status' then
    text_value:=private.ai_choice(raw_payload,'status',array['pendente','paga']);
    normalized:=jsonb_set(normalized,'{status}',to_jsonb(text_value),true);
    if text_value='paga' and not raw_payload?'realization_date' then perform private.ai_fail('AI_REALIZATION_DATE_REQUIRED'); end if;
    if text_value='pendente' and raw_payload?'realization_date' then perform private.ai_fail('AI_REALIZATION_DATE_NOT_ALLOWED'); end if;
  end if;
  if raw_payload?'operation' then
    normalized:=jsonb_set(normalized,'{operation}',to_jsonb(private.ai_choice(raw_payload,'operation',array['guardar','resgatar'])),true);
  end if;
  if raw_payload?'frequency' then
    frequency_value:=private.ai_choice(raw_payload,'frequency',
      case when action_name='create_card_purchase' then array['unica','parcelada','mensal']
      when action_name='move_goal' then array['unica','semanal','mensal','anual']
      else array['unica','parcelada','semanal','mensal','anual'] end);
    normalized:=jsonb_set(normalized,'{frequency}',to_jsonb(frequency_value),true);
    if frequency_value='parcelada' then
      if not raw_payload?'installments' then perform private.ai_fail('AI_MISSING_INSTALLMENTS'); end if;
      -- Teto defensivo: 120 parcelas financeiras e 48 no cartão. O aplicativo
      -- atual não impõe teto às primeiras, mas o servidor não aceita escrita em
      -- massa sem limite.
      installments:=private.ai_integer(raw_payload,'installments',2,case when action_name='create_card_purchase' then 48 else 120 end);
      normalized:=jsonb_set(normalized,'{installments}',to_jsonb(installments),true);
      normalized:=normalized||jsonb_build_object('recurrence_count',installments);
    elsif frequency_value='unica' then
      if raw_payload?'installments'
         or (raw_payload?'recurrence_count' and private.ai_integer(raw_payload,'recurrence_count',1,1)<>1) then
        perform private.ai_fail('AI_SERIES_FIELDS_NOT_ALLOWED');
      end if;
      normalized:=normalized||jsonb_build_object('recurrence_count',1);
    else
      recurrence_count:=case when raw_payload?'recurrence_count'
        then private.ai_integer(raw_payload,'recurrence_count',2,
          case when action_name='create_card_purchase' then 60
            when frequency_value='semanal' then 260
            when frequency_value='mensal' then 60
            when frequency_value='anual' then 5
            else 120 end)
        -- Horizontes equivalentes ao app: 5 anos em qualquer frequência.
        else case frequency_value when 'weekly' then 260 when 'semanal' then 260
               when 'annual' then 5 when 'anual' then 5 else 60 end end;
      normalized:=jsonb_set(normalized,'{recurrence_count}',to_jsonb(recurrence_count),true);
      if raw_payload?'installments' then perform private.ai_fail('AI_INSTALLMENTS_NOT_ALLOWED'); end if;
    end if;
    if raw_payload?'installment_value' then
      if frequency_value<>'parcelada' then perform private.ai_fail('AI_INSTALLMENT_VALUE_NOT_ALLOWED'); end if;
      if abs((normalized->>'installment_value')::numeric*installments-(normalized->>'value')::numeric)>0.02 then
        perform private.ai_fail('AI_INSTALLMENT_TOTAL_MISMATCH');
      end if;
    end if;
  end if;
  if raw_payload?'recurrence_count' and not raw_payload?'frequency' then perform private.ai_fail('AI_RECURRENCE_WITHOUT_FREQUENCY'); end if;
  if action_name='move_goal' and not normalized?'frequency' then
    normalized:=normalized||jsonb_build_object('frequency','unica','recurrence_count',1);
  end if;
  if action_name='move_goal' then
    if (normalized->>'recurrence_count')::integer=1 and not normalized?'realization_date' then
      perform private.ai_fail('AI_REALIZATION_DATE_REQUIRED');
    elsif (normalized->>'recurrence_count')::integer>1 and (
      not normalized?'scheduled_date' or normalized?'realization_date'
    ) then perform private.ai_fail('AI_INVALID_GOAL_SERIES_DATES'); end if;
  end if;

  if raw_payload?'series_scope' then
    text_value:=private.ai_choice(raw_payload,'series_scope',
      case when action_name='delete_transaction' then array['one','current_and_future','open_series']
           when action_name='delete_card_purchase' then array['one','open_series']
           else array['one','open_series'] end);
    normalized:=jsonb_set(normalized,'{series_scope}',to_jsonb(text_value),true);
  end if;
  if action_name='update_card_purchase' and not normalized?'series_scope' then
    normalized:=normalized||jsonb_build_object('series_scope','one');
  end if;
  if raw_payload?'field' then
    field_name:=private.ai_text(raw_payload,'field',40);
    if (action_name='update_account' and field_name not in ('name','initial_balance','color'))
      or (action_name='update_category' and field_name not in ('name','color','icon'))
      or (action_name='update_goal' and field_name not in ('name','target_amount','color','icon','target_date'))
      or (action_name='update_transaction' and field_name not in ('description','value','scheduled_date','account_id','category_id'))
      or (action_name='update_card' and field_name not in ('name','value','color','due_day','closing_day'))
      or (action_name='update_card_purchase' and field_name not in ('description','category_id')) then
      perform private.ai_fail('AI_INVALID_FIELD');
    end if;
    normalized:=jsonb_set(normalized,'{field}',to_jsonb(field_name),true);
    if field_name in ('initial_balance','target_amount','value') then
      numeric_value:=round(private.ai_number(raw_payload,'new_value'),2);
      if numeric_value<0 or (field_name<>'initial_balance' and numeric_value<=0) then perform private.ai_fail('AI_INVALID_NEW_VALUE'); end if;
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(numeric_value),true);
    elsif field_name in ('account_id','category_id') then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_id(raw_payload,'new_value')),true);
    elsif field_name in ('due_day','closing_day') then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_integer(raw_payload,'new_value',1,31)),true);
    elsif field_name in ('scheduled_date','target_date') then
      if field_name='target_date' and lower(private.ai_text(raw_payload,'new_value',20)) in ('clear','null') then
        normalized:=jsonb_set(normalized,'{new_value}',to_jsonb('clear'::text),true);
      else
        normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(to_char(private.ai_date(raw_payload,'new_value'),'YYYY-MM-DD')),true);
      end if;
    elsif field_name='color' then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_color(raw_payload,'new_value')),true);
    elsif field_name='description' then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_description(raw_payload,'new_value',100)),true);
    elsif field_name='name' then
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_text(raw_payload,'new_value',100)),true);
    else
      normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(private.ai_text(raw_payload,'new_value',50)),true);
    end if;
  end if;

  if raw_payload?'interest_value' then
    numeric_value:=round(private.ai_number(raw_payload,'interest_value'),2);
    if action_name='pay_invoice' and numeric_value<0 then perform private.ai_fail('AI_INVALID_INTEREST'); end if;
    normalized:=jsonb_set(normalized,'{interest_value}',to_jsonb(numeric_value),true);
  end if;
  if raw_payload?'interest_percent' then
    numeric_value:=round(private.ai_number(raw_payload,'interest_percent'),4);
    if numeric_value<0 or numeric_value>1000 then perform private.ai_fail('AI_INVALID_INTEREST_PERCENT'); end if;
    normalized:=jsonb_set(normalized,'{interest_percent}',to_jsonb(numeric_value),true);
  end if;
  if raw_payload?'interest_value' and raw_payload?'interest_percent' then perform private.ai_fail('AI_MULTIPLE_INTEREST_MODES'); end if;
  if action_name='complete_transaction' then
    completion_total:=(normalized->>'expected_value')::numeric;
    if normalized?'interest_value' then
      if (normalized->>'interest_value')::numeric>completion_total
         or (normalized->>'interest_value')::numeric<=-completion_total then
        perform private.ai_fail('AI_INVALID_TRANSACTION_ADJUSTMENT');
      end if;
      completion_total:=round(completion_total+(normalized->>'interest_value')::numeric,2);
    elsif normalized?'interest_percent' then
      if (normalized->>'interest_percent')::numeric>100 then
        perform private.ai_fail('AI_INVALID_TRANSACTION_ADJUSTMENT');
      end if;
      completion_total:=round(completion_total*(1+(normalized->>'interest_percent')::numeric/100),2);
    end if;
    if completion_total<=0 or (normalized->>'realized_value')::numeric>completion_total then
      perform private.ai_fail('AI_INVALID_REALIZED_VALUE');
    end if;
  end if;
  if raw_payload?'invoice_month' then
    text_value:=private.ai_text(raw_payload,'invoice_month',7);
    if text_value!~'^[0-9]{4}-(0[1-9]|1[0-2])$' then perform private.ai_fail('AI_INVALID_INVOICE_MONTH'); end if;
    normalized:=jsonb_set(normalized,'{invoice_month}',to_jsonb(text_value),true);
  end if;
  if raw_payload?'remainder_mode' then
    text_value:=private.ai_choice(raw_payload,'remainder_mode',array['full','keep_open','carry']);
    normalized:=jsonb_set(normalized,'{remainder_mode}',to_jsonb(text_value),true);
    if text_value<>'carry' and (raw_payload?'interest_value' or raw_payload?'interest_percent') then perform private.ai_fail('AI_INTEREST_NOT_APPLICABLE'); end if;
  end if;
  if raw_payload?'due_day' then normalized:=jsonb_set(normalized,'{due_day}',to_jsonb(private.ai_integer(raw_payload,'due_day',1,31)),true); end if;
  if raw_payload?'closing_day' then normalized:=jsonb_set(normalized,'{closing_day}',to_jsonb(private.ai_integer(raw_payload,'closing_day',1,31)),true); end if;

  if normalized?'realization_date'
     and (normalized->>'realization_date')::date > (clock_timestamp() at time zone 'America/Sao_Paulo')::date then
    perform private.ai_fail('AI_FUTURE_REALIZATION_DATE');
  end if;
  if action_name='create_goal' and (
    (normalized->>'target_amount')::numeric < 1
    or (normalized->>'initial_balance')::numeric > (normalized->>'target_amount')::numeric
  ) then perform private.ai_fail('AI_INVALID_GOAL_VALUES'); end if;

  -- Resolução de IDs e compatibilidade de domínio.
  if normalized?'account_id' then
    perform private.ai_assert_account(caller,(normalized->>'account_id')::bigint,
      action_name in ('update_account','archive_account','delete_account','reactivate_account'),
      action_name<>'reactivate_account');
    select nome into primary_name from public.contas where id=(normalized->>'account_id')::bigint;
  end if;
  if normalized?'destination_account_id' then
    perform private.ai_assert_account(caller,(normalized->>'destination_account_id')::bigint,false,true);
    if normalized->>'account_id'=normalized->>'destination_account_id' then perform private.ai_fail('AI_SAME_ACCOUNT'); end if;
    select nome into secondary_name from public.contas where id=(normalized->>'destination_account_id')::bigint;
  end if;
  if normalized?'goal_id' then
    perform private.ai_assert_goal(caller,(normalized->>'goal_id')::bigint,
      action_name in ('update_goal','archive_goal','delete_goal','reactivate_goal'),action_name<>'reactivate_goal');
    select nome into secondary_name from public.caixinhas where id=(normalized->>'goal_id')::bigint;
  end if;
  if normalized?'category_id' then
    perform private.ai_assert_category(caller,(normalized->>'category_id')::bigint,
      case when action_name='create_transaction' then normalized->>'type'
           when action_name in ('create_card_purchase','update_card_purchase') then 'despesa' else null end,
      action_name<>'reactivate_category');
    select nome into secondary_name from public.categorias where id=(normalized->>'category_id')::bigint;
  end if;
  if normalized?'transaction_id' then
    perform private.ai_assert_transaction(caller,(normalized->>'transaction_id')::bigint);
    select descricao into primary_name from public.transacoes where id=(normalized->>'transaction_id')::bigint;
  end if;
  if action_name in ('update_transaction','delete_transaction')
     and normalized->>'series_scope'<>'one'
     and primary_name !~ '\[Serie:[A-Za-z0-9_-]+\]' then
    legacy_descriptor:=private.ai_legacy_series_descriptor(primary_name);
    if legacy_descriptor->>'kind'='recorrente' then
      perform private.ai_fail('AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL');
    end if;
  end if;
  if normalized?'card_id' then
    perform private.ai_assert_card(caller,(normalized->>'card_id')::bigint,action_name<>'reactivate_card');
    select nome into primary_name from public.cartoes where id=(normalized->>'card_id')::bigint;
  end if;
  if normalized?'purchase_id' then
    perform private.ai_assert_card_item(caller,(normalized->>'purchase_id')::bigint);
    select descricao into primary_name from public.fatura_itens where id=(normalized->>'purchase_id')::bigint;
  end if;
  if action_name='update_transaction' and field_name='account_id' then perform private.ai_assert_account(caller,(normalized->>'new_value')::bigint,false,true); end if;
  if action_name='update_transaction' and field_name='category_id' then
    select tipo into text_value from public.transacoes where id=(normalized->>'transaction_id')::bigint;
    perform private.ai_assert_category(caller,(normalized->>'new_value')::bigint,text_value,true);
  end if;
  if action_name='update_card_purchase' and field_name='category_id' then perform private.ai_assert_category(caller,(normalized->>'new_value')::bigint,'despesa',true); end if;

  if action_name='pay_invoice' then
    select nome into secondary_name from public.contas where id=(normalized->>'account_id')::bigint;
    select coalesce(sum(valor),0) into invoice_total from public.fatura_itens
    where cartao_id=(normalized->>'card_id')::bigint and user_id=caller
      and mes_fatura=normalized->>'invoice_month' and not pago;
    if invoice_total<=0 then perform private.ai_fail('AI_INVOICE_ALREADY_SETTLED'); end if;
    if (normalized->>'payment_amount')::numeric>invoice_total then perform private.ai_fail('AI_PAYMENT_ABOVE_INVOICE'); end if;
    if normalized->>'remainder_mode'='full' and (normalized->>'payment_amount')::numeric<>invoice_total then perform private.ai_fail('AI_TOTAL_PAYMENT_MISMATCH'); end if;
    if normalized->>'remainder_mode'<>'full' and (normalized->>'payment_amount')::numeric>=invoice_total then perform private.ai_fail('AI_PARTIAL_PAYMENT_MISMATCH'); end if;
    if normalized->>'remainder_mode'='carry' and not (normalized?'interest_value' or normalized?'interest_percent') then normalized:=normalized||jsonb_build_object('interest_value',0); end if;
  end if;

  title:=case
    when action_name like 'create_%' then 'Confirmar criação'
    when action_name like 'update_%' then 'Confirmar alteração'
    when action_name like 'delete_%' then 'Confirmar exclusão'
    when action_name like 'archive_%' then 'Confirmar arquivamento'
    when action_name like 'reactivate_%' then 'Confirmar reativação'
    when action_name='pay_invoice' then 'Confirmar pagamento da fatura'
    when action_name='reverse_invoice_payment' then 'Confirmar estorno da fatura'
    when action_name='complete_transaction' then 'Confirmar realização'
    when action_name='reopen_transaction' then 'Voltar para pendente'
    else 'Confirmar movimentação financeira' end;
  summary:=case
    when action_name='create_account' then format('Criar a conta %s com saldo inicial de R$ %s.',normalized->>'name',normalized->>'initial_balance')
    when action_name='create_category' then format('Criar a categoria %s.',normalized->>'name')
    when action_name='create_goal' then format('Criar o objetivo %s com R$ %s.',normalized->>'name',normalized->>'initial_balance')
    when action_name='create_card' then format('Criar o cartão %s com limite de R$ %s.',normalized->>'name',normalized->>'value')
    when action_name='create_transaction' then format('Lançar %s de R$ %s em %s%s.',normalized->>'type',normalized->>'value',primary_name,case when (normalized->>'recurrence_count')::integer>1 then format(' (%s ocorrências)',normalized->>'recurrence_count') else '' end)
    when action_name='transfer_between_accounts' then format('Transferir R$ %s de %s para %s%s.',normalized->>'value',primary_name,secondary_name,case when (normalized->>'recurrence_count')::integer>1 then format(' (%s ocorrências)',normalized->>'recurrence_count') else '' end)
    when action_name='move_goal' then format('%s R$ %s no objetivo %s usando %s%s.',initcap(normalized->>'operation'),normalized->>'value',secondary_name,primary_name,
      case when (normalized->>'recurrence_count')::integer>1 then format(' em %s ocorrências a partir de %s',normalized->>'recurrence_count',normalized->>'scheduled_date')
      else format(' em %s',normalized->>'realization_date') end)
    when action_name='create_card_purchase' then format('Adicionar %s cobrança(s) de R$ %s ao cartão %s.',normalized->>'recurrence_count',normalized->>'value',primary_name)
    when action_name='pay_invoice' then format('Pagar R$ %s da fatura %s do cartão %s usando %s.',normalized->>'payment_amount',normalized->>'invoice_month',primary_name,secondary_name)
    when action_name in ('update_account','update_category','update_goal','update_card') then
      format('Alterar %s de %s para %s.',normalized->>'field',coalesce(primary_name,secondary_name),
        case when normalized->>'new_value'='clear' then 'sem data' else normalized->>'new_value' end)
    when action_name='update_transaction' then
      format('Alterar %s para %s em %s (%s).',normalized->>'field',normalized->>'new_value',primary_name,
        case normalized->>'series_scope' when 'open_series' then 'todos os itens pendentes da série' else 'somente este lançamento' end)
    when action_name='delete_transaction' then
      format('Excluir %s (%s).',primary_name,case normalized->>'series_scope'
        when 'open_series' then 'todos os itens pendentes da série'
        when 'current_and_future' then 'este e os próximos itens pendentes'
        else 'somente este lançamento' end)
    when action_name='complete_transaction' then
      format('Concluir %s, previsto em R$ %s, com R$ %s efetivamente realizado na data %s%s.',primary_name,normalized->>'expected_value',normalized->>'realized_value',normalized->>'realization_date',
        case when normalized?'interest_value' then format(' com ajuste de R$ %s',normalized->>'interest_value')
          when normalized?'interest_percent' then format(' com ajuste de %s%%',normalized->>'interest_percent') else '' end)
    when action_name='reopen_transaction' then format('Reabrir %s como pendente e remover sua data de realização.',primary_name)
    when action_name='update_card_purchase' then
      format('Alterar %s para %s em %s (%s).',normalized->>'field',normalized->>'new_value',primary_name,
        case normalized->>'series_scope' when 'open_series' then 'todas as cobranças abertas da série' else 'somente esta cobrança' end)
    when action_name='delete_card_purchase' then
      format('Excluir %s (%s).',primary_name,case normalized->>'series_scope'
        when 'open_series' then 'todas as cobranças abertas da série' else 'somente esta cobrança' end)
    when action_name='reverse_invoice_payment' then format('Estornar o pagamento %s e restaurar somente os itens ligados a ele.',primary_name)
    when action_name like 'delete_%' then format('Excluir %s conforme as regras de preservação de histórico.',coalesce(primary_name,secondary_name))
    when action_name like 'archive_%' then format('Arquivar %s sem apagar seu histórico.',coalesce(primary_name,secondary_name))
    when action_name like 'reactivate_%' then format('Reativar %s respeitando o limite do plano.',coalesce(primary_name,secondary_name))
    else format('%s: %s.',replace(action_name,'_',' '),coalesce(primary_name,secondary_name,'dados informados')) end;
  if action_name like 'delete_%' or action_name='reverse_invoice_payment' then consequences:=consequences||jsonb_build_array('A operação pode remover dados financeiros e será auditada.'); end if;
  if coalesce((normalized->>'recurrence_count')::integer,1)>1 or normalized->>'series_scope'<>'one' then consequences:=consequences||jsonb_build_array('A ação afeta múltiplos lançamentos da mesma série.'); end if;
  if action_name in ('complete_transaction','reopen_transaction','move_goal','pay_invoice','reverse_invoice_payment') then consequences:=consequences||jsonb_build_array('Saldos e indicadores serão atualizados conforme a data realizada.'); end if;
  if action_name='delete_account' then consequences:=consequences||jsonb_build_array('A conta só será excluída se não tiver lançamentos; caso contrário, será arquivada.'); end if;
  if action_name='delete_category' then consequences:=consequences||jsonb_build_array('Se houver lançamentos ou compras vinculados, a categoria será arquivada e os vínculos serão preservados.'); end if;
  if action_name='delete_goal' then consequences:=consequences||jsonb_build_array('O objetivo só será excluído com saldo zero e sem agendamentos pendentes; caso contrário, será arquivado. Movimentos concluídos permanecem descritos no histórico.'); end if;
  if action_name='delete_card' then consequences:=consequences||jsonb_build_array('O cartão só será excluído sem compras; caso contrário, será arquivado.'); end if;
  if normalized->>'remainder_mode'='carry' then consequences:=consequences||jsonb_build_array('O saldo restante e os juros irão para a próxima fatura.'); end if;
  if consequences='[]'::jsonb then consequences:=jsonb_build_array('A alteração será aplicada imediatamente após a confirmação.'); end if;
  return jsonb_build_object('payload',normalized,'preview',jsonb_build_object('title',title,'summary',summary,'consequences',consequences));
end;
$_$;


ALTER FUNCTION "private"."ai_prepare_action"("caller" "uuid", "action_name" "text", "raw_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_protect_card_with_active_payment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if exists(select 1 from auth.users u where u.id=old.user_id)
     and exists(
       select 1 from private.ai_invoice_payment_ledger l
       where l.card_id=old.id and l.reversed_at is null
     ) then
    raise exception using errcode='P0001', message='AI_CARD_HAS_ACTIVE_INVOICE_PAYMENT';
  end if;
  return old;
end;
$$;


ALTER FUNCTION "private"."ai_protect_card_with_active_payment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_replace_transaction_base"("original_description" "text", "new_base" "text") RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $_$
declare
  metadata text := coalesce(substring(original_description from '(\s*(?:\[(?:Serie:[A-Za-z0-9_-]+|Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$'), '');
  visible text;
  recurrence text;
  goal_label text;
  result_description text;
  prefix text := case when original_description like '[Transf.] %' then '[Transf.] ' else '' end;
begin
  visible := btrim(regexp_replace(original_description,'(\s*(?:\[(?:Serie:[A-Za-z0-9_-]+|Destino:[0-9]+|Objetivo:[0-9]+:(?:guardar|resgatar))\]\s*)+)$',''));
  visible := regexp_replace(visible,'^\[Transf\.\]\s*','');
  recurrence := coalesce(substring(visible from '(\s+\([0-9]+/[0-9]+\)|\s+\(Fixa(?: semanal| anual)?\))$'),'');
  if original_description ~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]\s*$' then
    visible:=btrim(regexp_replace(visible,'(\s+\([0-9]+/[0-9]+\)|\s+\(Fixa(?: semanal| anual)?\))$',''));
    goal_label:=case when position(' · Guardar em:' in visible)>0 or position(' · Resgate de:' in visible)>0
      then substring(visible from position(' · ' in visible)+3)
      else visible end;
    result_description:=btrim('[Transf.] '||new_base||' · '||goal_label||recurrence||metadata);
    if length(result_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
    return result_description;
  end if;
  result_description:=btrim(prefix||new_base||recurrence||metadata);
  if length(result_description)>200 then perform private.ai_fail('AI_DESCRIPTION_TOO_LONG'); end if;
  return result_description;
end;
$_$;


ALTER FUNCTION "private"."ai_replace_transaction_base"("original_description" "text", "new_base" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_require_keys"("payload" "jsonb", "required_keys" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare key_name text;
begin
  foreach key_name in array required_keys loop
    if not payload ? key_name or payload -> key_name = 'null'::jsonb then
      perform private.ai_fail('AI_MISSING_' || upper(key_name));
    end if;
  end loop;
end;
$$;


ALTER FUNCTION "private"."ai_require_keys"("payload" "jsonb", "required_keys" "text"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_resolve_legacy_goal_movement"("caller" "uuid", "description" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  visible_description text;
  legacy_match text[];
  legacy_name text;
  resolved_goal_id bigint;
  resolved_goal_name text;
  matching_goals integer;
  operation_name text;
  marker_operation text;
begin
  if description is null
     or description ~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]'
     or description ~ '\[Destino:[0-9]+\]' then
    return null;
  end if;

  visible_description:=btrim(regexp_replace(description,
    '(\s*(?:\[(?:Serie:[A-Za-z0-9_-]+)\]\s*)+)$','','g'));
  visible_description:=btrim(regexp_replace(visible_description,'^\[Transf\.\]\s*','','i'));
  visible_description:=btrim(regexp_replace(visible_description,
    '\s*(\([0-9]+/[0-9]+\)|\(Fixa(?: semanal| anual)?\))$','','i'));
  legacy_match:=regexp_match(visible_description,
    '^(Guardar em|Resgate de):\s*(.+)$','i');
  if legacy_match is null or btrim(coalesce(legacy_match[2],''))='' then
    return null;
  end if;

  legacy_name:=btrim(legacy_match[2]);
  marker_operation:=case when lower(legacy_match[1])='guardar em'
    then 'guardar' else 'resgatar' end;
  operation_name:=case marker_operation when 'guardar' then 'save' else 'withdraw' end;

  select count(*),min(g.id),min(g.nome)
  into matching_goals,resolved_goal_id,resolved_goal_name
  from public.caixinhas g
  where lower(btrim(g.nome))=lower(legacy_name)
    and (
      g.user_id=caller
      or (coalesce(g.compartilhado,false) and public.is_parceiro(g.user_id,caller))
    );
  if matching_goals=0 then perform private.ai_fail('AI_LEGACY_GOAL_NOT_FOUND'); end if;
  if matching_goals<>1 then perform private.ai_fail('AI_LEGACY_GOAL_AMBIGUOUS'); end if;

  return jsonb_build_object(
    'goal_id',resolved_goal_id,
    'goal_name',resolved_goal_name,
    'operation',operation_name,
    'marker_operation',marker_operation
  );
end;
$_$;


ALTER FUNCTION "private"."ai_resolve_legacy_goal_movement"("caller" "uuid", "description" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_series_marker"() RETURNS "text"
    LANGUAGE "sql"
    SET "search_path" TO ''
    AS $$
  select replace(gen_random_uuid()::text, '-', '');
$$;


ALTER FUNCTION "private"."ai_series_marker"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_text"("payload" "jsonb", "key_name" "text", "max_length" integer, "allow_empty" boolean DEFAULT false) RETURNS "text"
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
declare value text;
begin
  if jsonb_typeof(payload -> key_name) <> 'string' then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  value := btrim(payload ->> key_name);
  if (not allow_empty and value = '') or length(value) > max_length then
    perform private.ai_fail('AI_INVALID_' || upper(key_name));
  end if;
  return value;
end;
$$;


ALTER FUNCTION "private"."ai_text"("payload" "jsonb", "key_name" "text", "max_length" integer, "allow_empty" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


ALTER FUNCTION "private"."ai_touch_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."ai_validate_message_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if not exists (
    select 1 from public.ai_conversations c
    where c.id = new.conversation_id and c.user_id = new.user_id
  ) then
    raise exception using errcode = '23514', message = 'AI_MESSAGE_OWNER_MISMATCH';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."ai_validate_message_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."assign_bank_reconciliation_payment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare root_id bigint; matched uuid;
begin
  if new.payment_id is not null or new.transaction_id is null then return new; end if;
  select coalesce(t.transacao_pai_id,t.id) into root_id from public.transacoes t where t.id=new.transaction_id;
  select p.id into matched from private.transaction_completion_receipts p
  where p.root_transaction_id=root_id and p.reopened_at is null and p.realization_date=new.entry_date
    and round(p.realized_value,2)=round(new.entry_amount,2)
    and not exists(select 1 from private.bank_reconciliation_receipts x where x.payment_id=p.id)
    and not exists(select 1 from private.bank_reconciliation_transactions x where x.payment_id=p.id)
  order by p.payment_sequence,p.created_at,p.id limit 1;
  new.payment_id:=matched; return new;
end; $$;


ALTER FUNCTION "private"."assign_bank_reconciliation_payment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."assign_bank_reconciliation_transaction_payment"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare root_id bigint; entry_date_value date; matched uuid;
begin
  if new.payment_id is not null then return new; end if;
  select r.entry_date into entry_date_value from private.bank_reconciliation_receipts r where r.id=new.receipt_id;
  select coalesce(t.transacao_pai_id,t.id) into root_id from public.transacoes t where t.id=new.transaction_id;
  select p.id into matched from private.transaction_completion_receipts p
  where p.root_transaction_id=root_id and p.reopened_at is null and p.realization_date=entry_date_value
    and round(p.realized_value,2)=round(new.amount,2)
    and not exists(select 1 from private.bank_reconciliation_receipts x where x.payment_id=p.id)
    and not exists(select 1 from private.bank_reconciliation_transactions x where x.payment_id=p.id)
  order by p.payment_sequence,p.created_at,p.id limit 1;
  new.payment_id:=matched; return new;
end; $$;


ALTER FUNCTION "private"."assign_bank_reconciliation_transaction_payment"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."cleanup_transaction_completion_receipts"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  deleted_reopens integer := 0;
  deleted_completions integer := 0;
begin
  delete from private.transaction_reopen_receipts r
  where r.created_at < clock_timestamp() - interval '90 days';
  get diagnostics deleted_reopens = row_count;

  delete from private.transaction_completion_receipts r
  where r.created_at < clock_timestamp() - interval '90 days'
    and (
      r.reopened_at is not null
      or not exists (
        select 1 from public.transacoes t where t.id = r.transaction_id
      )
    );
  get diagnostics deleted_completions = row_count;

  return deleted_reopens + deleted_completions;
end;
$$;


ALTER FUNCTION "private"."cleanup_transaction_completion_receipts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."enforce_finflow_financial_profile"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := auth.uid();
  jwt_role text := coalesce((select auth.jwt() ->> 'role'), '');
begin
  -- Migracoes sem JWT e backends com service_role sao fronteiras
  -- administrativas. Um request anonimo ainda traz role=anon e e recusado.
  if jwt_role = 'service_role' or (caller is null and jwt_role = '') then return null; end if;

  if caller is null or not private.finflow_profile_is_eligible(caller) then
    raise exception using errcode = 'P0001', message = 'FINFLOW_PROFILE_REQUIRED';
  end if;
  return null;
end;
$$;


ALTER FUNCTION "private"."enforce_finflow_financial_profile"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."enviar_push_notificacao_sistema"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_url TEXT;
BEGIN
  IF NEW.lida_em IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.dispositivos_push d WHERE d.user_id = NEW.destinatario_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT s.decrypted_secret
    INTO v_url
    FROM vault.decrypted_secrets s
   WHERE s.name = 'finflow_push_function_url'
   LIMIT 1;
  IF v_url IS NULL OR v_url = '' THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := jsonb_build_object('notificacao_id', NEW.id),
    headers := jsonb_build_object('Content-Type', 'application/json'),
    timeout_milliseconds := 5000
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;


ALTER FUNCTION "private"."enviar_push_notificacao_sistema"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finance_execute_invoice_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  payment_tx_id bigint;
begin
  if action_name not in ('pay_invoice','reverse_invoice_payment') then
    perform private.ai_fail('AI_UNSUPPORTED_CARD_ACTION');
  end if;

  if action_name='reverse_invoice_payment' then
    payment_tx_id:=(payload->>'transaction_id')::bigint;
    perform pg_advisory_xact_lock(
      hashtext(caller::text),
      hashtext('invoice-reversal:'||payment_tx_id::text)
    );
    if not exists(
      select 1
      from private.ai_invoice_payment_ledger l
      where l.payment_transaction_id=payment_tx_id
        and l.user_id=caller
    ) then
      perform private.finance_try_backfill_legacy_invoice_payment(
        caller,payment_tx_id
      );
    end if;
  end if;

  return private.ai_execute_card_action(
    caller,action_name,payload,pending_action_id
  );
end;
$$;


ALTER FUNCTION "private"."finance_execute_invoice_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finance_guard_invoice_item_dml"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $_$
declare
  old_is_synthetic boolean:=false;
  new_is_synthetic boolean:=false;
begin
  if current_user not in ('authenticated','anon') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op<>'INSERT' then
    old_is_synthetic:=old.descricao='Pagamento parcial da fatura'
      or coalesce(old.descricao,'')~'^Saldo da fatura anterior \(.+\)$';
  end if;
  if tg_op<>'DELETE' then
    new_is_synthetic:=new.descricao='Pagamento parcial da fatura'
      or coalesce(new.descricao,'')~'^Saldo da fatura anterior \(.+\)$';
  end if;

  if old_is_synthetic or new_is_synthetic then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_SYNTHETIC_ITEM_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='INSERT' and coalesce(new.pago,false) then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_PAID_STATE_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='UPDATE' and new.pago is distinct from old.pago then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_PAID_STATE_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='DELETE' and coalesce(old.pago,false) then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_PAID_ITEM_DIRECT_DELETE_FORBIDDEN';
  end if;
  if tg_op in ('UPDATE','DELETE')
     and public.finance_is_invoice_item_protected(old.id) then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_LEDGER_ITEM_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$_$;


ALTER FUNCTION "private"."finance_guard_invoice_item_dml"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finance_guard_invoice_transaction_dml"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  old_is_payment boolean:=false;
  new_is_payment boolean:=false;
begin
  if current_user not in ('authenticated','anon') then
    if tg_op='DELETE' then return old; end if;
    return new;
  end if;

  if tg_op<>'INSERT' then
    old_is_payment:=coalesce(old.descricao,'') like '%[PagFatura:%';
  end if;
  if tg_op<>'DELETE' then
    new_is_payment:=coalesce(new.descricao,'') like '%[PagFatura:%';
  end if;
  if old_is_payment or new_is_payment then
    raise exception using errcode='P0001',message='FINANCE_INVOICE_TRANSACTION_DIRECT_DML_FORBIDDEN';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."finance_guard_invoice_transaction_dml"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finance_touch_version"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if tg_op='INSERT' then
    new.version := 1;
  else
    new.version := old.version + 1;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;


ALTER FUNCTION "private"."finance_touch_version"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finance_try_backfill_legacy_invoice_payment"("caller" "uuid", "payment_transaction_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  tx record;
  marker text[];
  linked record;
  ledger_mode text;
  candidate_ids bigint[]:='{}';
  candidate_count integer:=0;
  other_payments integer:=0;
  invoice_total numeric:=0;
  remaining_amount numeric:=0;
  all_paid boolean:=false;
  has_synthetic boolean:=false;
begin
  select * into tx
  from public.transacoes t
  where t.id=payment_transaction_id and t.user_id=caller
  for update;
  if not found then perform private.ai_fail('AI_PAYMENT_TRANSACTION_NOT_FOUND'); end if;

  if exists(
    select 1 from private.ai_invoice_payment_ledger l
    where l.payment_transaction_id=payment_transaction_id and l.user_id=caller
  ) then return true; end if;

  marker:=regexp_match(tx.descricao,
    '\[PagFatura:([0-9]+):([0-9]{4}-[0-9]{2}):(total|parcial|saldo_transferido)(?::([0-9]+))?\]\s*$');
  if marker is null or tx.tipo<>'despesa' or tx.status<>'paga' or tx.valor<=0 then
    perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
  end if;
  perform private.ai_assert_card(caller,marker[1]::bigint,false);

  if marker[3] in ('total','saldo_transferido') then
    select count(*) into other_payments
    from public.transacoes other_tx
    where other_tx.user_id=caller and other_tx.id<>payment_transaction_id
      and other_tx.descricao like '%[PagFatura:'||marker[1]||':'||marker[2]||':%';
    if other_payments<>0 then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;

    perform 1 from public.fatura_itens i
    where i.user_id=caller and i.cartao_id=marker[1]::bigint and i.mes_fatura=marker[2]
    order by i.id for update;
    select count(*),coalesce(sum(i.valor),0),coalesce(bool_and(i.pago),false),
      coalesce(array_agg(i.id order by i.id),'{}'::bigint[]),
      coalesce(bool_or(
        i.descricao='Pagamento parcial da fatura'
        or coalesce(i.descricao,'')~'^Saldo da fatura anterior \(.+\)$'
      ),false)
    into candidate_count,invoice_total,all_paid,candidate_ids,has_synthetic
    from public.fatura_itens i
    where i.user_id=caller and i.cartao_id=marker[1]::bigint and i.mes_fatura=marker[2];
    if candidate_count=0 or not all_paid or has_synthetic then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
  end if;

  if marker[3]='total' then
    if marker[4] is not null or round(invoice_total,2)<>round(tx.valor,2) then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
    ledger_mode:='total';

  elsif marker[3]='parcial' then
    if marker[4] is null then perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED'); end if;
    select * into linked from public.fatura_itens i
    where i.id=marker[4]::bigint and i.user_id=caller
      and i.cartao_id=marker[1]::bigint and i.mes_fatura=marker[2]
    for update;
    if not found or linked.pago
       or linked.descricao<>'Pagamento parcial da fatura'
       or round(linked.valor,2)<>-round(tx.valor,2) then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
    candidate_ids:='{}';
    ledger_mode:='partial';

  elsif marker[3]='saldo_transferido' then
    if marker[4] is null or invoice_total<=tx.valor then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
    remaining_amount:=round(invoice_total-tx.valor,2);
    select * into linked from public.fatura_itens i
    where i.id=marker[4]::bigint and i.user_id=caller
      and i.cartao_id=marker[1]::bigint
      and i.mes_fatura=private.ai_add_month(marker[2],1)
    for update;
    if not found or linked.pago
       or linked.descricao<>'Saldo da fatura anterior ('||marker[2]||')'
       or round(linked.valor,2)<remaining_amount then
      perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
    end if;
    ledger_mode:='carry_forward';
  else
    perform private.ai_fail('AI_LEGACY_INVOICE_REVERSAL_UNSUPPORTED');
  end if;

  insert into private.ai_invoice_payment_ledger(
    payment_transaction_id,action_id,user_id,card_id,invoice_month,mode,
    paid_item_ids,linked_item_id,source
  ) values(
    payment_transaction_id,null,caller,marker[1]::bigint,marker[2],ledger_mode,
    candidate_ids,case when marker[4] is null then null else marker[4]::bigint end,'legacy'
  ) on conflict(payment_transaction_id) do nothing;
  return true;
end;
$_$;


ALTER FUNCTION "private"."finance_try_backfill_legacy_invoice_payment"("caller" "uuid", "payment_transaction_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_account_usage"("p_user_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select pg_catalog.count(*)::integer from public.contas c
  where not coalesce(c.arquivado, false) and (
    c.user_id = p_user_id or (coalesce(c.compartilhado, false) and public.is_parceiro(c.user_id, p_user_id))
  );
$$;


ALTER FUNCTION "private"."finflow_account_usage"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_add_months_clamped"("base_date" "date", "month_count" integer) RETURNS "date"
    LANGUAGE "sql" IMMUTABLE
    SET "search_path" TO ''
    AS $$
  select (date_trunc('month', base_date) + make_interval(
    months => month_count,
    days => least(extract(day from base_date)::integer,
      extract(day from (date_trunc('month', base_date) + make_interval(months => month_count + 1) - interval '1 day'))::integer) - 1
  ))::date;
$$;


ALTER FUNCTION "private"."finflow_add_months_clamped"("base_date" "date", "month_count" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_authorize_payment_child_write"("caller" "uuid", "p_root_transaction_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."finflow_authorize_payment_child_write"("caller" "uuid", "p_root_transaction_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_enforce_card_purchase_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare limits_on boolean; plan_name text; allowed_count integer; used_count integer;
begin
  select limits_enabled into limits_on from public.billing_settings where id = true;
  if not coalesce(limits_on,false) or new.categoria_id is null then return new; end if;
  plan_name := private.finflow_plan_for_user(new.user_id);
  if plan_name = 'premium' then return new; end if;
  allowed_count := case plan_name when 'smart' then 150 else 40 end;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(new.user_id::text), 61004);
  select
    (select pg_catalog.count(*) from public.transacoes t where t.user_id=new.user_id and t.transacao_pai_id is null and coalesce(t.descricao,'') not like '%[PagFatura:%' and pg_catalog.to_char(t.data_vencimento,'YYYY-MM')=new.mes_fatura)
    + (select pg_catalog.count(*) from public.fatura_itens i where i.user_id=new.user_id and i.id is distinct from new.id and i.categoria_id is not null and i.mes_fatura=new.mes_fatura)
    into used_count;
  if used_count >= allowed_count then raise exception using errcode='P0001', message='plan limit reached'; end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."finflow_enforce_card_purchase_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_enforce_goal_balance_write"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare caller uuid := (select auth.uid());
begin
  -- O dono sempre pôde escrever o próprio saldo; isso não muda aqui. Só o
  -- parceiro (caller distinto do dono da linha) passa a exigir a RPC.
  if caller is not null and caller = old.user_id then
    return new;
  end if;
  if pg_catalog.current_setting('finflow.goal_balance_write_allowed', true)
     is distinct from '1' then
    raise exception using
      errcode = '42501',
      message = 'FINFLOW_DIRECT_GOAL_BALANCE_UPDATE_BLOCKED';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."finflow_enforce_goal_balance_write"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_enforce_resource_sharing"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  accepted_count integer;
  accepted_partnership_id bigint;
begin
  if new.user_id is null then
    raise exception using errcode = 'P0001', message = 'FINFLOW_INVALID_RESOURCE_OWNER';
  end if;

  if coalesce(new.arquivado, false) then
    if coalesce(new.compartilhado, false) then
      if tg_op = 'INSERT' then
        raise exception using errcode = 'P0001', message = 'FINFLOW_RESOURCE_ARCHIVED';
      elsif not coalesce(old.compartilhado, false) then
        raise exception using errcode = 'P0001', message = 'FINFLOW_RESOURCE_ARCHIVED';
      end if;
    end if;
    new.compartilhado := false;
    return new;
  end if;

  if coalesce(new.compartilhado, false) then
    -- O aceite usa a mesma trava; assim dois aceites concorrentes nao podem
    -- passar entre esta validacao e o commit do compartilhamento direto.
    perform private.finflow_lock_participants(new.user_id, new.user_id);
    select pg_catalog.min(p.id), pg_catalog.count(*)
      into accepted_partnership_id, accepted_count
    from public.parcerias p
    where p.status = 'aceito'
      and p.convidado_id is not null
      and (
        (p.solicitante_id = new.user_id and p.convidado_id <> new.user_id)
        or (p.convidado_id = new.user_id and p.solicitante_id <> new.user_id)
      );
    if accepted_count <> 1 then
      raise exception using
        errcode = 'P0001',
        message = 'FINFLOW_EXACTLY_ONE_ACCEPTED_PARTNERSHIP_REQUIRED';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'finflow:partnership:' || accepted_partnership_id::text,
        73119
      )
    );
    perform 1
    from public.parcerias p
    where p.id = accepted_partnership_id
      and p.status = 'aceito'
      and p.convidado_id is not null
      and (
        (p.solicitante_id = new.user_id and p.convidado_id <> new.user_id)
        or (p.convidado_id = new.user_id and p.solicitante_id <> new.user_id)
      )
    for share;
    if not found then
      raise exception using
        errcode = 'P0001',
        message = 'FINFLOW_EXACTLY_ONE_ACCEPTED_PARTNERSHIP_REQUIRED';
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."finflow_enforce_resource_sharing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_enforce_shared_account_capacity"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare partner_id uuid; partner_plan text; partner_limit integer;
begin
  if not coalesce(new.compartilhado, false) or coalesce(new.arquivado, false)
     or (tg_op = 'UPDATE' and coalesce(old.compartilhado, false)) then return new; end if;
  select case when p.solicitante_id = new.user_id then p.convidado_id else p.solicitante_id end into partner_id
  from public.parcerias p where p.status = 'aceito' and new.user_id in (p.solicitante_id, p.convidado_id) limit 1;
  if partner_id is null then return new; end if;
  partner_plan := private.finflow_plan_for_user(partner_id);
  if partner_plan = 'premium' then return new; end if;
  partner_limit := case partner_plan when 'smart' then 5 else 2 end;
  if private.finflow_account_usage(partner_id) >= partner_limit then
    raise exception using errcode = 'P0001', message = 'shared account exceeds partner plan limit';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."finflow_enforce_shared_account_capacity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_enforce_shared_link_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  limits_on boolean;
  plan_name text;
  allowed_count integer;
  used_count integer;
begin
  if not coalesce(new.compartilhado, false)
     or coalesce(new.arquivado, false)
     or (tg_op = 'UPDATE' and coalesce(old.compartilhado, false)) then
    return new;
  end if;

  select limits_enabled into limits_on
  from public.billing_settings
  where id = true;
  if not coalesce(limits_on, false) then return new; end if;

  plan_name := private.finflow_plan_for_user(new.user_id);
  if plan_name = 'premium' then return new; end if;
  allowed_count := case plan_name when 'smart' then 3 else 1 end;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:shared-links:' || new.user_id::text, 73119)
  );

  select
    (select pg_catalog.count(*) from public.contas c
      where c.user_id = new.user_id
        and coalesce(c.compartilhado, false)
        and not coalesce(c.arquivado, false))
    +
    (select pg_catalog.count(*) from public.caixinhas g
      where g.user_id = new.user_id
        and coalesce(g.compartilhado, false)
        and not coalesce(g.arquivado, false))
  into used_count;

  if used_count >= allowed_count then
    raise exception using errcode = 'P0001', message = 'FINFLOW_SHARED_LINK_LIMIT';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."finflow_enforce_shared_link_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_enforce_single_accepted_partnership"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
begin
  if new.status is distinct from 'aceito' then
    return new;
  end if;
  if new.solicitante_id is null
     or new.convidado_id is null
     or new.solicitante_id = new.convidado_id then
    raise exception using errcode = 'P0001', message = 'FINFLOW_INVALID_PARTNERSHIP';
  end if;

  perform private.finflow_lock_participants(new.solicitante_id, new.convidado_id);

  if exists (
    select 1
    from public.parcerias p
    where p.status = 'aceito'
      and p.id is distinct from new.id
      and (
        p.solicitante_id in (new.solicitante_id, new.convidado_id)
        or p.convidado_id in (new.solicitante_id, new.convidado_id)
      )
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'FINFLOW_PARTNERSHIP_ALREADY_ACTIVE';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "private"."finflow_enforce_single_accepted_partnership"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_guard_direct_partnership_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  -- A RPC SECURITY DEFINER executa como seu proprietÃ¡rio. Apenas DML direto do
  -- cliente Ã© bloqueado aqui, inclusive se uma policy permissiva for criada no
  -- futuro por engano.
  if current_user in ('authenticated', 'anon')
     and old.status = 'aceito' then
    raise exception using
      errcode = '42501',
      message = 'FINFLOW_ACCEPTED_PARTNERSHIP_RPC_REQUIRED';
  end if;
  return old;
end;
$$;


ALTER FUNCTION "private"."finflow_guard_direct_partnership_delete"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_guard_transaction_payment_group"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "private"."finflow_guard_transaction_payment_group"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_lock_callers_partnership_for_sharing"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := auth.uid();
  accepted_partnership_id bigint;
  requester_id uuid;
  invitee_id uuid;
  first_participant uuid;
  second_participant uuid;
begin
  -- RPCs SECURITY DEFINER (inclusive a dissolucao) ja usam o lock canonico e
  -- nao podem inverter a ordem tentando adquirir a trava de participante aqui.
  -- O trigger por statement existe apenas para DML legado feito pela API.
  if current_user not in ('authenticated', 'anon') or caller is null then
    return null;
  end if;

  select p.id, p.solicitante_id, p.convidado_id
    into accepted_partnership_id, requester_id, invitee_id
  from public.parcerias p
  where p.status = 'aceito'
    and p.convidado_id is not null
    and (
      (p.solicitante_id = caller and p.convidado_id <> caller)
      or (p.convidado_id = caller and p.solicitante_id <> caller)
    )
  order by p.id
  limit 1;
  if not found then
    return null;
  end if;

  if requester_id::text <= invitee_id::text then
    first_participant := requester_id;
    second_participant := invitee_id;
  else
    first_participant := invitee_id;
    second_participant := requester_id;
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:participant:' || first_participant::text, 73119)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:participant:' || second_participant::text, 73119)
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'finflow:partnership:' || accepted_partnership_id::text,
      73119
    )
  );
  perform 1
  from public.parcerias p
  where p.id = accepted_partnership_id
    and p.status = 'aceito'
    and (
      (p.solicitante_id = caller and p.convidado_id <> caller)
      or (p.convidado_id = caller and p.solicitante_id <> caller)
    )
  for share;
  return null;
end;
$$;


ALTER FUNCTION "private"."finflow_lock_callers_partnership_for_sharing"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_lock_participants"("p_first" "uuid", "p_second" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  first_participant uuid;
  second_participant uuid;
begin
  if p_first is null or p_second is null then
    raise exception using errcode = 'P0001', message = 'FINFLOW_INVALID_PARTNERSHIP';
  end if;

  if p_first::text <= p_second::text then
    first_participant := p_first;
    second_participant := p_second;
  else
    first_participant := p_second;
    second_participant := p_first;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('finflow:participant:' || first_participant::text, 73119)
  );
  if second_participant is distinct from first_participant then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('finflow:participant:' || second_participant::text, 73119)
    );
  end if;
end;
$$;


ALTER FUNCTION "private"."finflow_lock_participants"("p_first" "uuid", "p_second" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_plan_for_user"("p_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce((select s.plan from public.subscriptions s
    where s.user_id = p_user_id and (s.status in ('active','grace_period') or (s.status = 'cancelled' and s.access_until > pg_catalog.now()))
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc limit 1), 'free');
$$;


ALTER FUNCTION "private"."finflow_plan_for_user"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_profile_is_eligible"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  metadata jsonb;
  birth_date date;
  accepted_at timestamptz;
  today_brazil date := (clock_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
  if p_user_id is null then return false; end if;

  select u.raw_user_meta_data into metadata
  from auth.users u
  where u.id = p_user_id;
  if not found or metadata is null then return false; end if;

  if coalesce(metadata ->> 'termos_versao', '') <> '2026-08-08-offline-seguranca-ia'
     or coalesce(metadata ->> 'data_nascimento', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or coalesce(metadata ->> 'termos_aceitos_em', '') = '' then
    return false;
  end if;

  begin
    birth_date := (metadata ->> 'data_nascimento')::date;
    accepted_at := (metadata ->> 'termos_aceitos_em')::timestamptz;
  exception when others then
    return false;
  end;

  return birth_date between date '1900-01-01' and today_brazil
    and accepted_at <= clock_timestamp() + interval '5 minutes';
end;
$_$;


ALTER FUNCTION "private"."finflow_profile_is_eligible"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."finflow_validate_financial_references"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  marker text[];
  referenced_id bigint;
  operation text;
begin
  if tg_table_name = 'transacoes' then
    if new.user_id is null or new.conta_id is null then
      raise exception using errcode='23514',message='FINFLOW_TRANSACTION_OWNER_ACCOUNT_REQUIRED';
    end if;
    if not exists (
      select 1 from public.contas account_row where account_row.id=new.conta_id and (
        account_row.user_id=new.user_id or (account_row.compartilhado is true and exists (
          select 1 from public.parcerias partnership_row where partnership_row.status='aceito' and (
            (partnership_row.solicitante_id=account_row.user_id and partnership_row.convidado_id=new.user_id)
            or (partnership_row.convidado_id=account_row.user_id and partnership_row.solicitante_id=new.user_id)
          )
        ))
      )
    ) then raise exception using errcode='23514',message='FINFLOW_TRANSACTION_ACCOUNT_INVALID'; end if;
    if new.categoria_id is not null then
      if not exists (select 1 from public.categorias category_row where category_row.id=new.categoria_id
        and category_row.user_id=new.user_id and category_row.tipo in (new.tipo,'ambos')) then
        raise exception using errcode='23514',message='FINFLOW_TRANSACTION_CATEGORY_INVALID';
      end if;
      return new;
    end if;
    marker:=regexp_match(coalesce(new.descricao,''),'\[Destino:([0-9]+)\]');
    if marker is not null then
      referenced_id:=marker[1]::bigint;
      if new.tipo<>'despesa' or not exists(select 1 from public.contas c where c.id=referenced_id and (
        c.user_id=new.user_id or (c.compartilhado is true and exists (
          select 1 from public.parcerias p where p.status='aceito' and (
            (p.solicitante_id=c.user_id and p.convidado_id=new.user_id)
            or (p.convidado_id=c.user_id and p.solicitante_id=new.user_id)
          )
        ))
      ))
      then raise exception using errcode='23514',message='FINFLOW_TRANSFER_DESTINATION_INVALID'; end if;
      return new;
    end if;
    marker:=regexp_match(coalesce(new.descricao,''),'\[Objetivo:([0-9]+):(guardar|resgatar)\]\s*$');
    if marker is not null then
      referenced_id:=marker[1]::bigint; operation:=marker[2];
      if (operation='guardar' and new.tipo<>'despesa') or (operation='resgatar' and new.tipo<>'receita')
        or not exists(select 1 from public.caixinhas g where g.id=referenced_id and (
          g.user_id=new.user_id or (g.compartilhado is true and exists (
            select 1 from public.parcerias p where p.status='aceito' and (
              (p.solicitante_id=g.user_id and p.convidado_id=new.user_id)
              or (p.convidado_id=g.user_id and p.solicitante_id=new.user_id)
            )
          ))
        ))
      then raise exception using errcode='23514',message='FINFLOW_GOAL_REFERENCE_INVALID'; end if;
      return new;
    end if;
    marker:=regexp_match(coalesce(new.descricao,''),'\[PagFatura:([0-9]+):[0-9]{4}-(0[1-9]|1[0-2]):(total|parcial|saldo_transferido)(:[0-9]+)?\]\s*$');
    if marker is not null then
      referenced_id:=marker[1]::bigint;
      if new.tipo<>'despesa' or not exists(select 1 from public.cartoes c where c.id=referenced_id and c.user_id=new.user_id)
      then raise exception using errcode='23514',message='FINFLOW_INVOICE_PAYMENT_REFERENCE_INVALID'; end if;
      return new;
    end if;
    raise exception using errcode='23514',message='FINFLOW_TRANSACTION_CATEGORY_REQUIRED';
  end if;

  if tg_table_name = 'fatura_itens' then
    if new.user_id is null or new.cartao_id is null or not exists (
      select 1 from public.cartoes c where c.id=new.cartao_id and c.user_id=new.user_id
    ) then raise exception using errcode='23514',message='FINFLOW_INVOICE_CARD_INVALID'; end if;
    if new.categoria_id is not null then
      if not exists(select 1 from public.categorias c where c.id=new.categoria_id
        and c.user_id=new.user_id and c.tipo in ('despesa','ambos'))
      then raise exception using errcode='23514',message='FINFLOW_INVOICE_CATEGORY_INVALID'; end if;
      return new;
    end if;
    if coalesce(new.descricao,'') <> 'Pagamento parcial da fatura'
       and coalesce(new.descricao,'') !~ '^Saldo da fatura anterior( \([0-9]{4}-(0[1-9]|1[0-2])\))?$' then
      raise exception using errcode='23514',message='FINFLOW_INVOICE_CATEGORY_REQUIRED';
    end if;
    return new;
  end if;
  raise exception using errcode='42P01',message='FINFLOW_UNSUPPORTED_FINANCIAL_TABLE';
end;
$_$;


ALTER FUNCTION "private"."finflow_validate_financial_references"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."offline_execute_optimistic_update"("caller" "uuid", "action_name" "text", "payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  resource_key text;
  resource_id bigint;
  expected_version bigint:=(payload->>'expected_version')::bigint;
  current_version bigint;
  final_version bigint;
  field_name text;
  field_value jsonb;
  action_payload jsonb;
  execution_result jsonb;
  execution_results jsonb:='[]'::jsonb;
begin
  case action_name
    when 'update_account' then
      resource_key:='account_id'; resource_id:=(payload->>'account_id')::bigint;
      select a.version into current_version from public.contas a
      where a.id=resource_id and a.user_id=caller for update;
      if not found then perform private.ai_fail('AI_ACCOUNT_NOT_FOUND'); end if;
    when 'update_category' then
      resource_key:='category_id'; resource_id:=(payload->>'category_id')::bigint;
      select c.version into current_version from public.categorias c
      where c.id=resource_id and c.user_id=caller for update;
      if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    when 'update_goal' then
      resource_key:='goal_id'; resource_id:=(payload->>'goal_id')::bigint;
      select g.version into current_version from public.caixinhas g
      where g.id=resource_id and g.user_id=caller for update;
      if not found then perform private.ai_fail('AI_GOAL_NOT_FOUND'); end if;
    when 'update_card' then
      resource_key:='card_id'; resource_id:=(payload->>'card_id')::bigint;
      select c.version into current_version from public.cartoes c
      where c.id=resource_id and c.user_id=caller for update;
      if not found then perform private.ai_fail('AI_CARD_NOT_FOUND'); end if;
    when 'update_transaction' then
      resource_key:='transaction_id'; resource_id:=(payload->>'transaction_id')::bigint;
      select t.version into current_version from public.transacoes t
      where t.id=resource_id and t.user_id=caller for update;
      if not found then perform private.ai_fail('AI_TRANSACTION_NOT_FOUND'); end if;
    else
      raise exception using errcode='P0001', message='OFFLINE_UNSUPPORTED_ACTION';
  end case;

  if current_version is distinct from expected_version then
    raise exception using errcode='P0001', message='OFFLINE_VERSION_CONFLICT';
  end if;

  for field_name,field_value in
    select e.key,e.value from pg_catalog.jsonb_each(payload->'changes') e order by e.key
  loop
    action_payload:=pg_catalog.jsonb_build_object(
      resource_key,resource_id,'field',field_name,'new_value',field_value
    );
    if action_name='update_transaction' then
      action_payload:=action_payload||pg_catalog.jsonb_build_object('series_scope','one');
    end if;
    execution_result:=private.ai_execute_financial_action(caller,action_name,action_payload,null);
    execution_results:=execution_results||pg_catalog.jsonb_build_array(execution_result);
  end loop;

  case action_name
    when 'update_account' then select version into final_version from public.contas where id=resource_id;
    when 'update_category' then select version into final_version from public.categorias where id=resource_id;
    when 'update_goal' then select version into final_version from public.caixinhas where id=resource_id;
    when 'update_card' then select version into final_version from public.cartoes where id=resource_id;
    when 'update_transaction' then select version into final_version from public.transacoes where id=resource_id;
  end case;

  return pg_catalog.jsonb_build_object(
    'resource_id',resource_id,
    'expected_version',expected_version,
    'version',final_version,
    'updated',true,
    'results',execution_results
  );
end;
$$;


ALTER FUNCTION "private"."offline_execute_optimistic_update"("caller" "uuid", "action_name" "text", "payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."offline_prepare_optimistic_update"("caller" "uuid", "action_name" "text", "raw_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  resource_key text;
  allowed_fields text[];
  resource_id bigint;
  expected_version bigint;
  field_name text;
  field_value jsonb;
  action_payload jsonb;
  prepared jsonb;
  normalized_changes jsonb := '{}'::jsonb;
  change_count integer;
begin
  if caller is null or caller is distinct from (select auth.uid()) then
    raise exception using errcode='P0001', message='OFFLINE_AUTH_MISMATCH';
  end if;
  if raw_payload is null or pg_catalog.jsonb_typeof(raw_payload)<>'object' then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_PAYLOAD';
  end if;

  case action_name
    when 'update_account' then
      resource_key:='account_id'; allowed_fields:=array['name','initial_balance','color'];
    when 'update_category' then
      resource_key:='category_id'; allowed_fields:=array['name','color','icon'];
    when 'update_goal' then
      resource_key:='goal_id'; allowed_fields:=array['name','target_amount','color','icon','target_date'];
    when 'update_card' then
      resource_key:='card_id'; allowed_fields:=array['name','value','color','due_day','closing_day'];
    when 'update_transaction' then
      resource_key:='transaction_id'; allowed_fields:=array['description','value','scheduled_date','account_id','category_id'];
    else
      raise exception using errcode='P0001', message='OFFLINE_UNSUPPORTED_ACTION';
  end case;

  perform private.ai_assert_allowed_keys(raw_payload,array[resource_key,'expected_version','changes']);
  perform private.ai_require_keys(raw_payload,array[resource_key,'expected_version','changes']);
  if pg_catalog.jsonb_typeof(raw_payload->'changes')<>'object' then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_UPDATE_CHANGES';
  end if;
  select count(*) into change_count
  from pg_catalog.jsonb_object_keys(raw_payload->'changes');
  if change_count<1 or change_count>pg_catalog.array_length(allowed_fields,1) then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_UPDATE_CHANGES';
  end if;

  resource_id:=private.ai_id(raw_payload,resource_key);
  expected_version:=private.ai_id(raw_payload,'expected_version');

  for field_name,field_value in
    select e.key,e.value from pg_catalog.jsonb_each(raw_payload->'changes') e order by e.key
  loop
    if not (field_name=any(allowed_fields)) then
      raise exception using errcode='P0001', message='OFFLINE_UNSUPPORTED_UPDATE_FIELD';
    end if;
    if field_value='null'::jsonb then
      if action_name='update_goal' and field_name='target_date' then
        field_value:=pg_catalog.to_jsonb('clear'::text);
      else
        raise exception using errcode='P0001', message='OFFLINE_INVALID_UPDATE_CHANGES';
      end if;
    end if;

    action_payload:=pg_catalog.jsonb_build_object(
      resource_key,resource_id,'field',field_name,'new_value',field_value
    );
    if action_name='update_transaction' then
      action_payload:=action_payload||pg_catalog.jsonb_build_object('series_scope','one');
    end if;
    prepared:=private.ai_prepare_action(caller,action_name,action_payload);
    normalized_changes:=pg_catalog.jsonb_set(
      normalized_changes,array[field_name],prepared->'payload'->'new_value',true
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    resource_key,resource_id,
    'expected_version',expected_version,
    'changes',normalized_changes
  );
end;
$$;


ALTER FUNCTION "private"."offline_prepare_optimistic_update"("caller" "uuid", "action_name" "text", "raw_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."release_bank_reconciliation_after_reopen"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare payment uuid; root_id bigint;
begin
  root_id:=case when tg_op='DELETE' then old.transacao_pai_id else new.id end;
  if tg_op='UPDATE' and old.status='paga' and new.status='pendente' then
    select r.id into payment from private.transaction_completion_receipts r where r.root_transaction_id=new.id and r.payment_transaction_id=old.id and r.reopened_at is null order by r.payment_sequence desc limit 1;
  elsif tg_op='DELETE' and old.transacao_pai_id is not null then
    select r.id into payment from private.transaction_completion_receipts r where r.root_transaction_id=old.transacao_pai_id and r.payment_transaction_id=old.id and r.reopened_at is null order by r.payment_sequence desc limit 1;
  else return coalesce(new,old); end if;
  if payment is not null then perform private.release_bank_reconciliation_for_payment(payment);
  elsif not exists(select 1 from private.transaction_completion_receipts r where r.root_transaction_id=root_id) then perform private.release_bank_reconciliation_for_transaction(root_id); end if;
  return coalesce(new,old);
end; $$;


ALTER FUNCTION "private"."release_bank_reconciliation_after_reopen"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."release_bank_reconciliation_for_payment"("p_payment_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare affected bigint[];
begin
  delete from private.bank_reconciliation_receipts r where r.payment_id=p_payment_id;
  with removed as (delete from private.bank_reconciliation_transactions r where r.payment_id=p_payment_id returning r.receipt_id)
  select array_agg(distinct receipt_id) into affected from removed;
  if affected is not null then delete from private.bank_reconciliation_receipts r where r.id=any(affected)
    and not exists(select 1 from private.bank_reconciliation_transactions x where x.receipt_id=r.id); end if;
end; $$;


ALTER FUNCTION "private"."release_bank_reconciliation_for_payment"("p_payment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."release_bank_reconciliation_for_transaction"("p_transaction_id" bigint) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare affected_receipts bigint[];
begin
  if p_transaction_id is null then return; end if;
  delete from private.bank_reconciliation_receipts r where r.transaction_id=p_transaction_id;
  with removed as (
    delete from private.bank_reconciliation_transactions rt where rt.transaction_id=p_transaction_id returning rt.receipt_id
  ) select array_agg(distinct receipt_id) into affected_receipts from removed;
  if affected_receipts is not null then
    delete from private.bank_reconciliation_receipts r where r.id=any(affected_receipts)
      and not exists (select 1 from private.bank_reconciliation_transactions rt where rt.receipt_id=r.id);
  end if;
end; $$;


ALTER FUNCTION "private"."release_bank_reconciliation_for_transaction"("p_transaction_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_adjust_model_request_v2"("p_usage_id" "uuid", "p_estimated_input_tokens" bigint, "p_max_output_tokens" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  usage_row public.ai_request_usage%rowtype;
  usage_user_id uuid;
  global_daily_token_limit bigint;
  global_minute_token_limit bigint;
  desired_token_total bigint;
  global_daily_tokens_used bigint;
  global_minute_tokens_used bigint;
  global_newest_at timestamptz;
  now_at timestamptz:=clock_timestamp();
  local_day date:=(now_at at time zone 'America/Sao_Paulo')::date;
  day_start timestamptz;
  day_end timestamptz;
  retry_after integer:=0;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  if p_usage_id is null then perform private.ai_fail('AI_INVALID_USAGE_ID'); end if;
  if p_estimated_input_tokens is null
     or p_estimated_input_tokens not between 1 and 1000000000
     or p_max_output_tokens is null
     or p_max_output_tokens not between 1 and 1000000000 then
    perform private.ai_fail('AI_INVALID_TOKEN_ESTIMATE');
  end if;
  desired_token_total:=p_estimated_input_tokens+p_max_output_tokens;

  select u.user_id into usage_user_id
  from public.ai_request_usage u where u.usage_id=p_usage_id;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;

  -- Mantém exatamente a mesma ordem das outras operações do ledger.
  perform pg_advisory_xact_lock(61005,1);
  perform pg_advisory_xact_lock(hashtext(usage_user_id::text),61001);

  select * into usage_row from public.ai_request_usage u
  where u.usage_id=p_usage_id for update;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
  if usage_row.request_status<>'reserved' then
    perform private.ai_fail('AI_USAGE_ADJUSTMENT_CONFLICT');
  end if;
  if usage_row.reserved_input_tokens=p_estimated_input_tokens
     and usage_row.reserved_output_tokens=p_max_output_tokens
     and usage_row.token_reserved_at is not null then
    return jsonb_build_object(
      'allowed',true,'reason',null,'retry_after',0,'usage_id',p_usage_id,
      'replayed',true,'estimated_input_tokens',p_estimated_input_tokens,
      'max_output_tokens',p_max_output_tokens
    );
  end if;
  if usage_row.token_reserved_at is not null then
    perform private.ai_fail('AI_USAGE_ADJUSTMENT_CONFLICT');
  end if;

  select ai_global_tokens_per_day,ai_global_tokens_per_minute
  into global_daily_token_limit,global_minute_token_limit
  from public.billing_settings where id=true;
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;
  if desired_token_total>global_minute_token_limit
     or desired_token_total>global_daily_token_limit then
    return jsonb_build_object(
      'allowed',false,'reason','request_tokens','retry_after',0,
      'usage_id',p_usage_id,'replayed',false,
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_minute_limit',global_minute_token_limit
    );
  end if;

  day_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  day_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';
  select coalesce(sum(greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )),0)::bigint
  into global_daily_tokens_used
  from public.ai_request_usage
  where usage_id<>p_usage_id
    and token_reserved_at>=day_start and token_reserved_at<day_end;
  if global_daily_tokens_used+desired_token_total>global_daily_token_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_tokens_daily','retry_after',retry_after,
      'usage_id',p_usage_id,'replayed',false,
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_daily_used',global_daily_tokens_used,
      'global_token_daily_remaining',greatest(
        global_daily_token_limit-global_daily_tokens_used,0
      )
    );
  end if;

  select coalesce(sum(greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )),0)::bigint,
  max(token_reserved_at) filter(where greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )>0)
  into global_minute_tokens_used,global_newest_at
  from public.ai_request_usage
  where usage_id<>p_usage_id
    and token_reserved_at>now_at-interval '60 seconds';
  if global_minute_tokens_used+desired_token_total>global_minute_token_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      coalesce(global_newest_at,now_at)+interval '60 seconds'-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_tokens_minute','retry_after',retry_after,
      'usage_id',p_usage_id,'replayed',false,
      'global_token_minute_limit',global_minute_token_limit,
      'global_token_minute_used',global_minute_tokens_used,
      'global_token_minute_remaining',greatest(
        global_minute_token_limit-global_minute_tokens_used,0
      )
    );
  end if;

  update public.ai_request_usage
  set reserved_input_tokens=p_estimated_input_tokens,
      reserved_output_tokens=p_max_output_tokens,
      token_reserved_at=clock_timestamp()
  where usage_id=p_usage_id;
  return jsonb_build_object(
    'allowed',true,'reason',null,'retry_after',0,'usage_id',p_usage_id,
    'replayed',false,'estimated_input_tokens',p_estimated_input_tokens,
    'max_output_tokens',p_max_output_tokens,
    'global_token_daily_limit',global_daily_token_limit,
    'global_token_daily_remaining',greatest(
      global_daily_token_limit-global_daily_tokens_used-desired_token_total,0
    ),
    'global_token_minute_limit',global_minute_token_limit,
    'global_token_minute_remaining',greatest(
      global_minute_token_limit-global_minute_tokens_used-desired_token_total,0
    )
  );
end;
$$;


ALTER FUNCTION "public"."ai_adjust_model_request_v2"("p_usage_id" "uuid", "p_estimated_input_tokens" bigint, "p_max_output_tokens" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_cancel_pending_action"("p_action_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller uuid:=private.ai_assert_authenticated(); action_row public.ai_pending_actions%rowtype;
begin
  perform private.ai_expire_actions(caller,p_action_id);
  select * into action_row from public.ai_pending_actions
    where id=p_action_id and user_id=caller for update;
  if not found then return jsonb_build_object('ok',false,'error_code','AI_ACTION_NOT_FOUND'); end if;
  if action_row.status='cancelled' then
    return jsonb_build_object('ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','cancelled','cancelled_at',action_row.cancelled_at,'replayed',true);
  end if;
  if action_row.status<>'pending' then
    return jsonb_build_object('ok',false,'action_id',action_row.id,'status',action_row.status,
      'error_code',case action_row.status when 'expired' then 'AI_ACTION_EXPIRED' else 'AI_ACTION_NOT_CANCELLABLE' end);
  end if;
  update public.ai_pending_actions set status='cancelled',cancelled_at=clock_timestamp(),
    last_error_code=null where id=action_row.id returning * into action_row;
  insert into public.ai_action_audit(action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key)
  values(action_row.id,caller,action_row.action_type,'cancelled',action_row.payload,action_row.idempotency_key);
  return jsonb_build_object('ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
    'status','cancelled','cancelled_at',action_row.cancelled_at,'replayed',false);
end;
$$;


ALTER FUNCTION "public"."ai_cancel_pending_action"("p_action_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_consume_analytical_action"("p_intent" "text", "p_idempotency_key" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid:=private.ai_assert_authenticated();
  entitlement record;
  quota jsonb;
  existing_id bigint;
  existing_intent text;
begin
  if p_intent not in ('category_analysis','budget_analysis','financial_projection') then
    perform private.ai_fail('AI_INVALID_ANALYTICAL_INTENT');
  end if;
  if p_idempotency_key is null or length(p_idempotency_key) not between 16 and 200
     or p_idempotency_key!~'^[A-Za-z0-9:_-]+$' then perform private.ai_fail('AI_INVALID_IDEMPOTENCY_KEY'); end if;
  perform pg_advisory_xact_lock(hashtext(caller::text),61002);
  select id,action_type into existing_id,existing_intent from public.ai_action_audit
  where user_id=caller and action_id is null and event_type='succeeded'
    and idempotency_key=p_idempotency_key;
  if found then
    if existing_intent<>p_intent then perform private.ai_fail('AI_IDEMPOTENCY_CONFLICT'); end if;
    return jsonb_build_object('ok',true,'intent',p_intent,'consumed',false,'replayed',true,
      'audit_id',existing_id,'quota',private.ai_action_quota(caller));
  end if;
  select * into entitlement from public.get_my_entitlement();
  if coalesce(entitlement.limits_enabled,false) and entitlement.plan<>'premium' then
    return jsonb_build_object('ok',false,'error_code','AI_ANALYTICS_PLAN_REQUIRED');
  end if;
  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    return jsonb_build_object('ok',false,'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota);
  end if;
  insert into public.ai_action_audit(
    user_id,action_type,event_type,payload_snapshot,result,idempotency_key
  ) values(
    caller,p_intent,'succeeded',jsonb_build_object('intent',p_intent),
    jsonb_build_object('analytical_action',true),p_idempotency_key
  ) returning id into existing_id;
  return jsonb_build_object('ok',true,'intent',p_intent,'consumed',true,'replayed',false,
    'audit_id',existing_id,'quota',private.ai_action_quota(caller));
end;
$_$;


ALTER FUNCTION "public"."ai_consume_analytical_action"("p_intent" "text", "p_idempotency_key" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_consume_pending_action"("p_action_id" "uuid", "p_confirmation_token" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid:=private.ai_assert_authenticated();
  action_row public.ai_pending_actions%rowtype;
  execution_result jsonb;
  quota jsonb;
  error_message text;
  error_state text;
  safe_error text;
  current_state_fingerprint text;
begin
  perform private.ai_expire_actions(caller,p_action_id);
  select * into action_row from public.ai_pending_actions
  where id=p_action_id and user_id=caller for update;
  if not found or action_row.confirmation_token is distinct from p_confirmation_token then
    return jsonb_build_object('ok',false,'error_code','AI_ACTION_NOT_FOUND');
  end if;
  if action_row.status='succeeded' then
    return jsonb_build_object(
      'ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','succeeded','result',action_row.result,'replayed',true
    );
  end if;
  if action_row.status<>'pending' then
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
      'status',action_row.status,
      'error_code',coalesce(
        action_row.last_error_code,
        case action_row.status
          when 'expired' then 'AI_ACTION_EXPIRED'
          when 'cancelled' then 'AI_ACTION_CANCELLED'
          else 'AI_ACTION_NOT_EXECUTABLE'
        end
      ),'replayed',coalesce(action_row.last_error_code='AI_ACTION_STATE_CHANGED',false)
    );
  end if;

  perform pg_advisory_xact_lock(hashtext(caller::text),61002);
  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'status','pending',
      'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota,'replayed',false
    );
  end if;

  if action_row.state_fingerprint is not null then
    begin
      current_state_fingerprint:=private.ai_action_state_fingerprint(
        caller,action_row.action_type,action_row.payload,true
      );
    exception when others then
      current_state_fingerprint:=null;
    end;
    if current_state_fingerprint is distinct from action_row.state_fingerprint then
      update public.ai_pending_actions
      set status='failed',last_error_code='AI_ACTION_STATE_CHANGED'
      where id=action_row.id;
      insert into public.ai_action_audit(
        action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
      ) values(
        action_row.id,caller,action_row.action_type,'failed',action_row.payload,
        'AI_ACTION_STATE_CHANGED',action_row.idempotency_key
      );
      return jsonb_build_object(
        'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
        'status','failed','error_code','AI_ACTION_STATE_CHANGED','replayed',false
      );
    end if;
  end if;

  update public.ai_pending_actions
  set status='executing',last_error_code=null
  where id=action_row.id;
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key
  ) values(
    action_row.id,caller,action_row.action_type,'executing',
    action_row.payload,action_row.idempotency_key
  );
  begin
    execution_result:=private.ai_execute_financial_action(
      caller,action_row.action_type,action_row.payload,action_row.id
    );
  exception when others then
    get stacked diagnostics
      error_message=message_text,
      error_state=returned_sqlstate;
    safe_error:=case
      when error_state='P0001' and error_message='plan limit reached'
        then 'AI_PLAN_RESOURCE_LIMIT'
      when error_message~'^AI_[A-Z0-9_]+$' then error_message
      else 'AI_ACTION_EXECUTION_FAILED'
    end;
    update public.ai_pending_actions
    set status='failed',last_error_code=safe_error
    where id=action_row.id;
    insert into public.ai_action_audit(
      action_id,user_id,action_type,event_type,payload_snapshot,error_code,idempotency_key
    ) values(
      action_row.id,caller,action_row.action_type,'failed',action_row.payload,
      safe_error,action_row.idempotency_key
    );
    return jsonb_build_object(
      'ok',false,'action_id',action_row.id,'action_type',action_row.action_type,
      'status','failed','error_code',safe_error,'replayed',false
    );
  end;
  update public.ai_pending_actions
  set status='succeeded',result=execution_result,
    executed_at=clock_timestamp(),last_error_code=null
  where id=action_row.id;
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,result,idempotency_key
  ) values(
    action_row.id,caller,action_row.action_type,'succeeded',action_row.payload,
    execution_result,action_row.idempotency_key
  );
  return jsonb_build_object(
    'ok',true,'action_id',action_row.id,'action_type',action_row.action_type,
    'status','succeeded','result',execution_result,'replayed',false
  );
end;
$_$;


ALTER FUNCTION "public"."ai_consume_pending_action"("p_action_id" "uuid", "p_confirmation_token" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_create_pending_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "text", "p_ttl_seconds" integer DEFAULT 600) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid:=private.ai_assert_authenticated();
  existing public.ai_pending_actions%rowtype;
  created public.ai_pending_actions%rowtype;
  prepared jsonb;
  normalized jsonb;
  server_preview jsonb;
  request_hash text;
  state_fingerprint text;
  verified_state_fingerprint text;
  quota jsonb;
  pending_count integer;
  recent_created_count integer;
  now_at timestamptz:=clock_timestamp();
begin
  if p_payload is null or jsonb_typeof(p_payload)<>'object'
     or octet_length(p_payload::text)>16384 then
    perform private.ai_fail('AI_INVALID_PAYLOAD');
  end if;
  if p_action_type is null or length(p_action_type)>80 then
    perform private.ai_fail('AI_UNSUPPORTED_ACTION');
  end if;
  if p_idempotency_key is null
     or length(p_idempotency_key) not between 16 and 200
     or p_idempotency_key!~'^[A-Za-z0-9:_-]+$' then
    perform private.ai_fail('AI_INVALID_IDEMPOTENCY_KEY');
  end if;
  if p_ttl_seconds is null or p_ttl_seconds not between 60 and 1800 then
    perform private.ai_fail('AI_INVALID_TTL');
  end if;
  request_hash:=encode(
    extensions.digest(
      convert_to(jsonb_build_array(p_action_type,p_payload)::text,'UTF8'),'sha256'
    ),'hex'
  );

  perform pg_advisory_xact_lock(hashtext(caller::text),61003);
  select * into existing from public.ai_pending_actions
  where user_id=caller and idempotency_key=p_idempotency_key;
  if found then
    if existing.action_type<>p_action_type or existing.payload_hash<>request_hash then
      perform private.ai_fail('AI_IDEMPOTENCY_CONFLICT');
    end if;
    perform private.ai_expire_actions(caller,existing.id);
    select * into existing from public.ai_pending_actions where id=existing.id;
    return jsonb_build_object(
      'ok',true,'id',existing.id,'action_type',existing.action_type,
      'payload',existing.payload,'preview',existing.preview,'status',existing.status,
      'expires_at',existing.expires_at,
      'confirmation_token',existing.confirmation_token,
      'created_at',existing.created_at,'replayed',true
    );
  end if;

  perform private.ai_expire_actions(caller,null);
  select count(*) into pending_count from public.ai_pending_actions
  where user_id=caller and status='pending';
  if pending_count>=10 then
    return jsonb_build_object(
      'ok',false,'error_code','AI_TOO_MANY_PENDING_ACTIONS','pending_limit',10
    );
  end if;
  select count(*) into recent_created_count from public.ai_action_audit
  where user_id=caller and event_type='created'
    and created_at>=clock_timestamp()-interval '1 hour';
  if recent_created_count>=60 then
    return jsonb_build_object(
      'ok',false,'error_code','AI_PROPOSAL_RATE_LIMITED','retry_after',3600
    );
  end if;

  quota:=private.ai_action_quota(caller);
  if (quota->>'remaining')::integer=0 then
    return jsonb_build_object(
      'ok',false,'error_code','AI_DAILY_QUOTA_EXCEEDED','quota',quota
    );
  end if;

  prepared:=private.ai_prepare_action(caller,p_action_type,p_payload);
  normalized:=prepared->'payload';
  server_preview:=prepared->'preview';
  state_fingerprint:=private.ai_action_state_fingerprint(
    caller,p_action_type,normalized,false
  );
  if state_fingerprint is not null then
    prepared:=private.ai_prepare_action(caller,p_action_type,normalized);
    normalized:=prepared->'payload';
    server_preview:=prepared->'preview';
    verified_state_fingerprint:=private.ai_action_state_fingerprint(
      caller,p_action_type,normalized,false
    );
    if verified_state_fingerprint is distinct from state_fingerprint then
      return jsonb_build_object(
        'ok',false,'error_code','AI_ACTION_STATE_CHANGED'
      );
    end if;
    state_fingerprint:=verified_state_fingerprint;
  end if;
  insert into public.ai_pending_actions(
    user_id,action_type,payload,payload_hash,state_fingerprint,preview,idempotency_key,
    confirmation_token,status,expires_at,created_at,updated_at
  ) values(
    caller,p_action_type,normalized,request_hash,state_fingerprint,server_preview,p_idempotency_key,
    gen_random_uuid(),'pending',now_at+make_interval(secs=>p_ttl_seconds),now_at,now_at
  ) on conflict(user_id,idempotency_key) do nothing
  returning * into created;
  if not found then
    select * into existing from public.ai_pending_actions
    where user_id=caller and idempotency_key=p_idempotency_key;
    if existing.action_type<>p_action_type or existing.payload_hash<>request_hash then
      perform private.ai_fail('AI_IDEMPOTENCY_CONFLICT');
    end if;
    return jsonb_build_object(
      'ok',true,'id',existing.id,'action_type',existing.action_type,
      'payload',existing.payload,'preview',existing.preview,'status',existing.status,
      'expires_at',existing.expires_at,
      'confirmation_token',existing.confirmation_token,
      'created_at',existing.created_at,'replayed',true
    );
  end if;
  insert into public.ai_action_audit(
    action_id,user_id,action_type,event_type,payload_snapshot,idempotency_key
  ) values(
    created.id,caller,created.action_type,'created',created.payload,
    created.idempotency_key
  );
  return jsonb_build_object(
    'ok',true,'id',created.id,'action_type',created.action_type,
    'payload',created.payload,'preview',created.preview,'status',created.status,
    'expires_at',created.expires_at,'confirmation_token',created.confirmation_token,
    'created_at',created.created_at,'replayed',false
  );
end;
$_$;


ALTER FUNCTION "public"."ai_create_pending_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "text", "p_ttl_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_finalize_model_request"("p_usage_id" "uuid", "p_provider" "text", "p_model" "text", "p_input_tokens" bigint, "p_output_tokens" bigint, "p_status" "text" DEFAULT 'completed'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  usage_row public.ai_request_usage%rowtype;
  usage_user_id uuid;
  normalized_provider text:=btrim(coalesce(p_provider,''));
  normalized_model text:=btrim(coalesce(p_model,''));
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  if p_usage_id is null then perform private.ai_fail('AI_INVALID_USAGE_ID'); end if;
  if length(normalized_provider) not between 1 and 40
     or length(normalized_model) not between 1 and 120 then
    perform private.ai_fail('AI_INVALID_MODEL_METADATA');
  end if;
  if p_input_tokens is null or p_input_tokens not between 0 and 1000000000
     or p_output_tokens is null or p_output_tokens not between 0 and 1000000000 then
    perform private.ai_fail('AI_INVALID_TOKEN_USAGE');
  end if;
  if p_status not in ('completed','failed') then
    perform private.ai_fail('AI_INVALID_USAGE_STATUS');
  end if;
  if p_status='completed' and (
    normalized_provider not in ('openai','groq')
    or normalized_model in ('not_called','unknown')
    or p_input_tokens<=0 or p_output_tokens<=0
  ) then
    perform private.ai_fail('AI_INVALID_COMPLETED_USAGE');
  end if;
  if p_status='failed' and normalized_provider='not_called' and (
    normalized_model<>'not_called'
    or p_input_tokens<>0 or p_output_tokens<>0
  ) then
    perform private.ai_fail('AI_INVALID_RELEASED_USAGE');
  end if;

  select u.user_id into usage_user_id from public.ai_request_usage u
  where u.usage_id=p_usage_id;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
  -- A finalização usa a mesma ordem global→usuário da reserva. Enquanto ela
  -- espera, o disjuntor continua vendo a reserva máxima, que é o estado seguro.
  perform pg_advisory_xact_lock(61005,1);
  perform pg_advisory_xact_lock(hashtext(usage_user_id::text),61001);

  select * into usage_row from public.ai_request_usage u
  where u.usage_id=p_usage_id for update;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
  if p_status='completed' and usage_row.token_reserved_at is null then
    perform private.ai_fail('AI_USAGE_NOT_ADJUSTED');
  end if;
  if usage_row.request_status<>'reserved' then
    if usage_row.provider=normalized_provider
       and usage_row.model=normalized_model
       and usage_row.input_tokens=p_input_tokens
       and usage_row.output_tokens=p_output_tokens
       and usage_row.request_status=p_status then
      return jsonb_build_object(
        'ok',true,'usage_id',p_usage_id,'status',p_status,'replayed',true
      );
    end if;
    perform private.ai_fail('AI_USAGE_FINALIZATION_CONFLICT');
  end if;

  update public.ai_request_usage
  set provider=normalized_provider,model=normalized_model,
    input_tokens=p_input_tokens,output_tokens=p_output_tokens,
    reserved_input_tokens=case
      when p_status='completed'
        or (normalized_provider='not_called' and normalized_model='not_called')
      then 0 else reserved_input_tokens
    end,
    reserved_output_tokens=case
      when p_status='completed'
        or (normalized_provider='not_called' and normalized_model='not_called')
      then 0 else reserved_output_tokens
    end,
    request_status=p_status,finalized_at=clock_timestamp()
  where usage_id=p_usage_id;
  return jsonb_build_object(
    'ok',true,'usage_id',p_usage_id,'status',p_status,'replayed',false
  );
end;
$$;


ALTER FUNCTION "public"."ai_finalize_model_request"("p_usage_id" "uuid", "p_provider" "text", "p_model" "text", "p_input_tokens" bigint, "p_output_tokens" bigint, "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_finalize_model_request_v2"("p_usage_id" "uuid", "p_provider" "text", "p_model" "text", "p_input_tokens" bigint, "p_output_tokens" bigint, "p_status" "text", "p_latency_ms" integer, "p_error_code" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  base_result jsonb;
  current_latency integer;
  current_error text;
  normalized_error text:=nullif(btrim(coalesce(p_error_code,'')),'');
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  if p_latency_ms is null or p_latency_ms not between 0 and 300000 then
    perform private.ai_fail('AI_INVALID_MONITORING_LATENCY');
  end if;
  if p_status='completed' and normalized_error is not null then
    perform private.ai_fail('AI_INVALID_MONITORING_ERROR');
  end if;
  if p_status='failed' and (
    normalized_error is null
    or length(normalized_error) not between 3 and 80
    or normalized_error !~ '^[A-Z][A-Z0-9_]+$'
  ) then
    perform private.ai_fail('AI_INVALID_MONITORING_ERROR');
  end if;

  base_result:=public.ai_finalize_model_request(
    p_usage_id,p_provider,p_model,p_input_tokens,p_output_tokens,p_status
  );

  select latency_ms,error_code into current_latency,current_error
  from public.ai_request_usage where usage_id=p_usage_id for update;
  if not found then perform private.ai_fail('AI_USAGE_NOT_FOUND'); end if;
  if current_latency is not null or current_error is not null then
    if current_latency is distinct from p_latency_ms
       or current_error is distinct from normalized_error then
      perform private.ai_fail('AI_USAGE_MONITORING_CONFLICT');
    end if;
    return base_result || jsonb_build_object('monitoring_replayed',true);
  end if;

  update public.ai_request_usage
  set latency_ms=p_latency_ms,error_code=normalized_error
  where usage_id=p_usage_id;
  return base_result || jsonb_build_object('monitoring_replayed',false);
end;
$_$;


ALTER FUNCTION "public"."ai_finalize_model_request_v2"("p_usage_id" "uuid", "p_provider" "text", "p_model" "text", "p_input_tokens" bigint, "p_output_tokens" bigint, "p_status" "text", "p_latency_ms" integer, "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_get_action_quota"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller uuid:=private.ai_assert_authenticated();
begin
  return private.ai_action_quota(caller);
end;
$$;


ALTER FUNCTION "public"."ai_get_action_quota"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_get_pending_action"("p_action_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller uuid:=private.ai_assert_authenticated(); action_row public.ai_pending_actions%rowtype;
begin
  perform private.ai_expire_actions(caller,p_action_id);
  select * into action_row from public.ai_pending_actions where id=p_action_id and user_id=caller;
  if not found then return jsonb_build_object('ok',false,'error_code','AI_ACTION_NOT_FOUND'); end if;
  return jsonb_build_object('ok',true,'id',action_row.id,'action_type',action_row.action_type,
    'payload',action_row.payload,'preview',action_row.preview,'status',action_row.status,
    'expires_at',action_row.expires_at,'created_at',action_row.created_at,
    'executed_at',action_row.executed_at,'cancelled_at',action_row.cancelled_at,
    'result',action_row.result,'error_code',action_row.last_error_code);
end;
$$;


ALTER FUNCTION "public"."ai_get_pending_action"("p_action_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_list_pending_actions"("p_limit" integer DEFAULT 20, "p_include_terminal" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller uuid:=private.ai_assert_authenticated(); result jsonb;
begin
  if p_limit is null or p_limit not between 1 and 100 then perform private.ai_fail('AI_INVALID_LIMIT'); end if;
  perform private.ai_expire_actions(caller,null);
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',x.id,'action_type',x.action_type,'payload',x.payload,'preview',x.preview,
    'status',x.status,'expires_at',x.expires_at,'created_at',x.created_at,
    'executed_at',x.executed_at,'cancelled_at',x.cancelled_at,
    'result',x.result,'error_code',x.last_error_code
  ) order by x.created_at desc),'[]'::jsonb) into result
  from (
    select * from public.ai_pending_actions a
    where a.user_id=caller and (p_include_terminal or a.status='pending')
    order by a.created_at desc limit p_limit
  ) x;
  return result;
end;
$$;


ALTER FUNCTION "public"."ai_list_pending_actions"("p_limit" integer, "p_include_terminal" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_monitor_health"("p_window_minutes" integer DEFAULT 60) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  safe_window integer:=least(greatest(coalesce(p_window_minutes,60),5),10080);
  cutoff timestamptz;
  total_count bigint;
  completed_count bigint;
  failed_count bigint;
  reserved_count bigint;
  average_latency numeric;
  p95_latency numeric;
  last_event timestamptz;
  last_success timestamptz;
  provider_rows jsonb;
  error_rows jsonb;
  health_status text;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  cutoff:=statement_timestamp()-make_interval(mins=>safe_window);

  select count(*),
    count(*) filter(where request_status='completed'),
    count(*) filter(where request_status='failed'),
    count(*) filter(where request_status='reserved'),
    round(avg(latency_ms)::numeric,2),
    round((percentile_cont(0.95) within group(order by latency_ms))::numeric,2),
    max(created_at),
    max(finalized_at) filter(where request_status='completed')
  into total_count,completed_count,failed_count,reserved_count,
    average_latency,p95_latency,last_event,last_success
  from public.ai_request_usage
  where created_at>=cutoff;

  select coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.requests desc),'[]'::jsonb)
  into provider_rows
  from (
    select coalesce(provider,'reserved') as provider,
      coalesce(model,'reserved') as model,
      request_status as status,
      count(*) as requests,
      round(avg(latency_ms)::numeric,2) as average_latency_ms
    from public.ai_request_usage
    where created_at>=cutoff
    group by provider,model,request_status
  ) grouped;

  select coalesce(jsonb_agg(to_jsonb(grouped) order by grouped.occurrences desc),'[]'::jsonb)
  into error_rows
  from (
    select error_code,count(*) as occurrences,max(finalized_at) as last_seen_at
    from public.ai_request_usage
    where created_at>=cutoff and request_status='failed' and error_code is not null
    group by error_code
    order by count(*) desc
    limit 20
  ) grouped;

  health_status:=case
    when total_count=0 then 'no_data'
    when reserved_count>greatest(3,total_count/4) then 'degraded'
    when failed_count::numeric/nullif(total_count,0)>=0.25 then 'degraded'
    when failed_count>0 then 'attention'
    else 'healthy'
  end;

  return jsonb_build_object(
    'status',health_status,
    'window_minutes',safe_window,
    'generated_at',statement_timestamp(),
    'requests',total_count,
    'completed',completed_count,
    'failed',failed_count,
    'reserved',reserved_count,
    'failure_rate',case when total_count=0 then 0
      else round((failed_count::numeric/total_count::numeric)*100,2) end,
    'average_latency_ms',average_latency,
    'p95_latency_ms',p95_latency,
    'last_event_at',last_event,
    'last_success_at',last_success,
    'providers',provider_rows,
    'errors',error_rows
  );
end;
$$;


ALTER FUNCTION "public"."ai_monitor_health"("p_window_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_reserve_model_request"("p_limit" integer DEFAULT 30, "p_window_seconds" integer DEFAULT 60) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid:=private.ai_assert_authenticated();
  entitlement record;
  effective_limit integer:=least(greatest(coalesce(p_limit,30),1),30);
  effective_window integer:=least(greatest(coalesce(p_window_seconds,60),60),3600);
  now_at timestamptz:=clock_timestamp();
  local_day date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
  day_start timestamptz;
  day_end timestamptz;
  daily_limit integer;
  daily_used integer;
  minute_used integer;
  oldest_at timestamptz;
  retry_after integer:=0;
  reserved_usage_id uuid;
begin
  select * into entitlement from public.get_my_entitlement();
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;
  daily_limit:=case
    when not coalesce(entitlement.limits_enabled,false) then 300
    when entitlement.plan='premium' then 200
    when entitlement.plan='smart' then 60
    else 0
  end;
  day_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  day_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';

  perform pg_advisory_xact_lock(hashtext(caller::text),61001);
  -- Retém 90 dias de contagens agregáveis, ainda sem qualquer conteúdo sensível.
  delete from public.ai_request_usage
  where user_id=caller and created_at<day_start-interval '90 days';
  select count(*) into daily_used from public.ai_request_usage
  where user_id=caller and created_at>=day_start and created_at<day_end;
  if daily_used>=daily_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','daily','retry_after',retry_after,'usage_id',null,
      'limit',effective_limit,'used',0,'remaining',0,'window_seconds',effective_window,
      'daily_limit',daily_limit,'daily_used',daily_used,'daily_remaining',0,
      'daily_window_start',day_start,'daily_window_end',day_end,
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),min(created_at) into minute_used,oldest_at
  from public.ai_request_usage
  where user_id=caller and created_at>now_at-make_interval(secs=>effective_window);
  if minute_used>=effective_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      oldest_at+make_interval(secs=>effective_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','minute','retry_after',retry_after,'usage_id',null,
      'limit',effective_limit,'used',minute_used,'remaining',0,
      'window_seconds',effective_window,
      'daily_limit',daily_limit,'daily_used',daily_used,
      'daily_remaining',greatest(daily_limit-daily_used,0),
      'daily_window_start',day_start,'daily_window_end',day_end,
      'timezone','America/Sao_Paulo'
    );
  end if;

  insert into public.ai_request_usage(user_id,created_at)
  values(caller,now_at)
  returning usage_id into reserved_usage_id;
  minute_used:=minute_used+1;
  daily_used:=daily_used+1;
  return jsonb_build_object(
    'allowed',true,'reason',null,'retry_after',0,'usage_id',reserved_usage_id,
    'limit',effective_limit,'used',minute_used,
    'remaining',greatest(effective_limit-minute_used,0),
    'window_seconds',effective_window,
    'daily_limit',daily_limit,'daily_used',daily_used,
    'daily_remaining',greatest(daily_limit-daily_used,0),
    'daily_window_start',day_start,'daily_window_end',day_end,
    'timezone','America/Sao_Paulo'
  );
end;
$$;


ALTER FUNCTION "public"."ai_reserve_model_request"("p_limit" integer, "p_window_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ai_reserve_model_request_v2"("p_user_id" "uuid", "p_user_limit" integer, "p_window_seconds" integer, "p_estimated_input_tokens" bigint, "p_max_output_tokens" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  limits_on boolean;
  current_plan text;
  global_daily_limit integer;
  global_minute_limit integer;
  global_daily_token_limit bigint;
  global_minute_token_limit bigint;
  effective_user_limit integer:=least(greatest(coalesce(p_user_limit,8),1),30);
  effective_window integer:=least(greatest(coalesce(p_window_seconds,60),60),3600);
  global_window integer:=60;
  reserved_token_total bigint;
  now_at timestamptz:=clock_timestamp();
  local_day date:=(now_at at time zone 'America/Sao_Paulo')::date;
  day_start timestamptz;
  day_end timestamptz;
  user_daily_limit integer;
  user_daily_used integer;
  user_daily_attempt_limit integer;
  user_daily_attempts integer;
  user_minute_used integer;
  global_daily_used integer;
  global_minute_used integer;
  global_daily_tokens_used bigint;
  global_minute_tokens_used bigint;
  user_oldest_at timestamptz;
  global_oldest_at timestamptz;
  global_newest_at timestamptz;
  retry_after integer:=0;
  reserved_usage_id uuid;
begin
  if coalesce((select auth.jwt()->>'role'),'')<>'service_role' then
    perform private.ai_fail('AI_SERVICE_ROLE_REQUIRED');
  end if;
  if p_user_id is null or not exists(select 1 from auth.users where id=p_user_id) then
    perform private.ai_fail('AI_AUTH_REQUIRED');
  end if;
  if p_estimated_input_tokens is null
     or p_estimated_input_tokens not between 1 and 1000000000
     or p_max_output_tokens is null
     or p_max_output_tokens not between 1 and 1000000000 then
    perform private.ai_fail('AI_INVALID_TOKEN_ESTIMATE');
  end if;
  reserved_token_total:=p_estimated_input_tokens+p_max_output_tokens;

  select limits_enabled,ai_global_requests_per_day,ai_global_requests_per_minute,
    ai_global_tokens_per_day,ai_global_tokens_per_minute
  into limits_on,global_daily_limit,global_minute_limit,
    global_daily_token_limit,global_minute_token_limit
  from public.billing_settings where id=true;
  if not found then perform private.ai_fail('AI_ENTITLEMENT_UNAVAILABLE'); end if;

  select coalesce((
    select s.plan from public.subscriptions s
    where s.user_id=p_user_id
      and (
        s.status in ('active','grace_period')
        or (s.status='cancelled' and s.access_until>now_at)
      )
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc
    limit 1
  ),'free') into current_plan;

  user_daily_limit:=case
    when not coalesce(limits_on,false) then 300
    when current_plan='premium' then 200
    when current_plan='smart' then 60
    else 0
  end;
  user_daily_attempt_limit:=case
    when user_daily_limit<=0 then 0 else user_daily_limit*2
  end;
  day_start:=local_day::timestamp at time zone 'America/Sao_Paulo';
  day_end:=(local_day+1)::timestamp at time zone 'America/Sao_Paulo';

  -- Ordem fixa global→usuário evita deadlock entre requisições concorrentes.
  perform pg_advisory_xact_lock(61005,1);
  perform pg_advisory_xact_lock(hashtext(p_user_id::text),61001);

  if reserved_token_total>global_minute_token_limit
     or reserved_token_total>global_daily_token_limit then
    return jsonb_build_object(
      'allowed',false,'reason','request_tokens','retry_after',0,'usage_id',null,
      'daily_limit',user_daily_limit,
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_minute_limit',global_minute_token_limit,
      'estimated_input_tokens',p_estimated_input_tokens,
      'max_output_tokens',p_max_output_tokens,
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*)
  into global_daily_used
  from public.ai_request_usage
  where created_at>=day_start and created_at<day_end;
  select coalesce(sum(greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )),0)::bigint
  into global_daily_tokens_used
  from public.ai_request_usage
  where token_reserved_at>=day_start and token_reserved_at<day_end;
  if global_daily_used>=global_daily_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_daily','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,'daily_remaining',0,
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',0,
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_daily_used',global_daily_tokens_used,
      'global_token_daily_remaining',greatest(global_daily_token_limit-global_daily_tokens_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  if global_daily_tokens_used+reserved_token_total>global_daily_token_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_tokens_daily','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'global_token_daily_limit',global_daily_token_limit,
      'global_token_daily_used',global_daily_tokens_used,
      'global_token_daily_remaining',greatest(global_daily_token_limit-global_daily_tokens_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),min(created_at)
  into global_minute_used,global_oldest_at
  from public.ai_request_usage
  where created_at>now_at-make_interval(secs=>global_window);
  select max(token_reserved_at),coalesce(sum(greatest(
    reserved_input_tokens+reserved_output_tokens,
    coalesce(input_tokens,0)+coalesce(output_tokens,0)
  )),0)::bigint
  into global_newest_at,global_minute_tokens_used
  from public.ai_request_usage
  where token_reserved_at>now_at-make_interval(secs=>global_window);
  if global_minute_used>=global_minute_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      global_oldest_at+make_interval(secs=>global_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_minute','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'global_token_minute_limit',global_minute_token_limit,
      'global_token_minute_used',global_minute_tokens_used,
      'global_token_minute_remaining',greatest(global_minute_token_limit-global_minute_tokens_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  if global_minute_tokens_used+reserved_token_total>global_minute_token_limit then
    -- Aguarda a janela inteira desde a reserva mais nova. É conservador, mas
    -- evita ciclos de nova tentativa enquanto ainda há tokens na janela.
    retry_after:=greatest(1,ceil(extract(epoch from (
      global_newest_at+make_interval(secs=>global_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','global_tokens_minute','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'global_token_minute_limit',global_minute_token_limit,
      'global_token_minute_used',global_minute_tokens_used,
      'global_token_minute_remaining',greatest(global_minute_token_limit-global_minute_tokens_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),count(*) filter(where not (
    request_status='failed' and provider is not distinct from 'not_called'
  ))
  into user_daily_attempts,user_daily_used
  from public.ai_request_usage
  where user_id=p_user_id and created_at>=day_start and created_at<day_end;
  if user_daily_attempt_limit>0
     and user_daily_used<user_daily_limit
     and user_daily_attempts>=user_daily_attempt_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','user_daily_attempts','retry_after',retry_after,
      'usage_id',null,'daily_limit',user_daily_limit,
      'daily_used',user_daily_used,
      'daily_remaining',greatest(user_daily_limit-user_daily_used,0),
      'attempt_limit',user_daily_attempt_limit,
      'attempt_used',user_daily_attempts,
      'timezone','America/Sao_Paulo'
    );
  end if;
  if user_daily_used>=user_daily_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (day_end-now_at)))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','daily','retry_after',retry_after,'usage_id',null,
      'daily_limit',user_daily_limit,'daily_used',user_daily_used,
      'daily_remaining',0,'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  select count(*),min(created_at) into user_minute_used,user_oldest_at
  from public.ai_request_usage
  where user_id=p_user_id
    and created_at>now_at-make_interval(secs=>effective_window);
  if user_minute_used>=effective_user_limit then
    retry_after:=greatest(1,ceil(extract(epoch from (
      user_oldest_at+make_interval(secs=>effective_window)-now_at
    )))::integer);
    return jsonb_build_object(
      'allowed',false,'reason','minute','retry_after',retry_after,'usage_id',null,
      'daily_limit',user_daily_limit,'daily_used',user_daily_used,
      'daily_remaining',greatest(user_daily_limit-user_daily_used,0),
      'global_daily_limit',global_daily_limit,
      'global_daily_remaining',greatest(global_daily_limit-global_daily_used,0),
      'timezone','America/Sao_Paulo'
    );
  end if;

  insert into public.ai_request_usage(
    user_id,created_at,reserved_input_tokens,reserved_output_tokens
  )
  values(p_user_id,now_at,p_estimated_input_tokens,p_max_output_tokens)
  returning usage_id into reserved_usage_id;
  return jsonb_build_object(
    'allowed',true,'reason',null,'retry_after',0,'usage_id',reserved_usage_id,
    'limit',effective_user_limit,'used',user_minute_used+1,
    'remaining',greatest(effective_user_limit-user_minute_used-1,0),
    'window_seconds',effective_window,
    'daily_limit',user_daily_limit,'daily_used',user_daily_used+1,
    'daily_remaining',greatest(user_daily_limit-user_daily_used-1,0),
    'attempt_limit',user_daily_attempt_limit,
    'attempt_used',user_daily_attempts+1,
    'global_daily_limit',global_daily_limit,
    'global_daily_remaining',greatest(global_daily_limit-global_daily_used-1,0),
    'global_token_daily_limit',global_daily_token_limit,
    'global_token_daily_remaining',greatest(
      global_daily_token_limit-global_daily_tokens_used-reserved_token_total,0
    ),
    'global_token_minute_limit',global_minute_token_limit,
    'global_token_minute_remaining',greatest(
      global_minute_token_limit-global_minute_tokens_used-reserved_token_total,0
    ),
    'timezone','America/Sao_Paulo'
  );
end;
$$;


ALTER FUNCTION "public"."ai_reserve_model_request_v2"("p_user_id" "uuid", "p_user_limit" integer, "p_window_seconds" integer, "p_estimated_input_tokens" bigint, "p_max_output_tokens" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bind_paddle_customer"("p_customer_id" "text", "p_email" "text", "p_user_id" "uuid" DEFAULT NULL::"uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  resolved_user_id uuid;
  normalized_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_customer_id !~ '^ctm_[a-z0-9]+$' or normalized_email = '' then
    raise exception using errcode = '22023', message = 'PADDLE_CUSTOMER_INVALID';
  end if;

  select pc.user_id into resolved_user_id
  from public.paddle_customers pc
  where pc.customer_id = p_customer_id;

  if resolved_user_id is null and p_user_id is not null then
    select u.id into resolved_user_id
    from auth.users u
    where u.id = p_user_id and lower(u.email) = normalized_email;
  end if;
  if resolved_user_id is null then
    select u.id into resolved_user_id
    from auth.users u
    where lower(u.email) = normalized_email
    order by u.created_at
    limit 1;
  end if;

  insert into public.paddle_customers (customer_id, user_id, email)
  values (p_customer_id, resolved_user_id, normalized_email)
  on conflict (customer_id) do update
  set user_id = coalesce(public.paddle_customers.user_id, excluded.user_id),
      email = excluded.email,
      updated_at = now();
  return resolved_user_id;
end;
$_$;


ALTER FUNCTION "public"."bind_paddle_customer"("p_customer_id" "text", "p_email" "text", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."bind_paddle_customer_environment"("p_customer_id" "text", "p_email" "text", "p_user_id" "uuid", "p_environment" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  resolved_user_id uuid;
  normalized_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_customer_id !~ '^ctm_[a-z0-9]+$'
     or normalized_email = ''
     or p_environment not in ('sandbox', 'production') then
    raise exception using errcode = '22023', message = 'PADDLE_CUSTOMER_INVALID';
  end if;

  select pc.user_id into resolved_user_id
  from public.paddle_customers pc
  where pc.customer_id = p_customer_id and pc.environment = p_environment;

  if resolved_user_id is null and p_user_id is not null then
    select u.id into resolved_user_id
    from auth.users u
    where u.id = p_user_id and lower(u.email) = normalized_email;
  end if;
  if resolved_user_id is null then
    select u.id into resolved_user_id
    from auth.users u
    where lower(u.email) = normalized_email
    order by u.created_at
    limit 1;
  end if;

  insert into public.paddle_customers (customer_id, user_id, email, environment)
  values (p_customer_id, resolved_user_id, normalized_email, p_environment)
  on conflict (customer_id) do update
  set user_id = coalesce(public.paddle_customers.user_id, excluded.user_id),
      email = excluded.email,
      environment = excluded.environment,
      updated_at = now();
  return resolved_user_id;
end;
$_$;


ALTER FUNCTION "public"."bind_paddle_customer_environment"("p_customer_id" "text", "p_email" "text", "p_user_id" "uuid", "p_environment" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_subscription_event"("p_provider" "text", "p_event_id" "text", "p_event_type" "text", "p_payload" "jsonb", "p_lease_seconds" integer DEFAULT 60) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  event_row public.subscription_events%rowtype;
  claim_token uuid := gen_random_uuid();
  now_at timestamptz := clock_timestamp();
  retry_after integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_provider <> 'mercado_pago'
     or p_event_id is null or length(p_event_id) not between 1 and 240
     or p_event_type is null or length(p_event_type) not between 1 and 100
     or p_payload is null or jsonb_typeof(p_payload) <> 'object'
     or octet_length(p_payload::text) > 4096
     or p_lease_seconds is null or p_lease_seconds not between 10 and 300 then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_WEBHOOK_CLAIM';
  end if;

  insert into public.subscription_events (
    provider, provider_event_id, event_type, payload,
    processing_token, processing_started_at, processing_locked_until,
    last_attempt_at, attempt_count
  ) values (
    p_provider, p_event_id, p_event_type, p_payload,
    claim_token, now_at, now_at + make_interval(secs => p_lease_seconds),
    now_at, 1
  )
  on conflict (provider, provider_event_id) do nothing
  returning * into event_row;

  if found then
    return jsonb_build_object(
      'claimed', true,
      'processed', false,
      'event_id', event_row.id,
      'processing_token', claim_token,
      'attempt_count', event_row.attempt_count
    );
  end if;

  select * into event_row
  from public.subscription_events
  where provider = p_provider
    and provider_event_id = p_event_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'FINFLOW_WEBHOOK_EVENT_NOT_FOUND';
  end if;
  if event_row.processed_at is not null then
    return jsonb_build_object(
      'claimed', false,
      'processed', true,
      'event_id', event_row.id,
      'attempt_count', event_row.attempt_count
    );
  end if;
  if event_row.processing_locked_until is not null
     and event_row.processing_locked_until > now_at then
    retry_after := greatest(
      1,
      ceil(extract(epoch from (event_row.processing_locked_until - now_at)))::integer
    );
    return jsonb_build_object(
      'claimed', false,
      'processed', false,
      'processing', true,
      'event_id', event_row.id,
      'retry_after', retry_after,
      'attempt_count', event_row.attempt_count
    );
  end if;

  update public.subscription_events
  set event_type = p_event_type,
      payload = p_payload,
      processing_token = claim_token,
      processing_started_at = now_at,
      processing_locked_until = now_at + make_interval(secs => p_lease_seconds),
      last_attempt_at = now_at,
      attempt_count = least(attempt_count + 1, 10000),
      error = null
  where id = event_row.id
  returning * into event_row;

  return jsonb_build_object(
    'claimed', true,
    'processed', false,
    'event_id', event_row.id,
    'processing_token', claim_token,
    'attempt_count', event_row.attempt_count
  );
end;
$$;


ALTER FUNCTION "public"."claim_subscription_event"("p_provider" "text", "p_event_id" "text", "p_event_type" "text", "p_payload" "jsonb", "p_lease_seconds" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_transaction_with_partial"("p_transaction_id" bigint, "p_expected_value" numeric, "p_adjustment_type" "text", "p_adjustment_value" numeric, "p_realized_value" numeric, "p_realization_date" "date", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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
  if false and p_realization_date <= root_row.data_vencimento
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


ALTER FUNCTION "public"."complete_transaction_with_partial"("p_transaction_id" bigint, "p_expected_value" numeric, "p_adjustment_type" "text", "p_adjustment_value" numeric, "p_realized_value" numeric, "p_realization_date" "date", "p_idempotency_key" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."complete_transaction_with_partial"("p_transaction_id" bigint, "p_expected_value" numeric, "p_adjustment_type" "text", "p_adjustment_value" numeric, "p_realized_value" numeric, "p_realization_date" "date", "p_idempotency_key" "uuid") IS 'Conclui receita/despesa e cria eventual saldo pendente de forma atomica e idempotente.';



CREATE OR REPLACE FUNCTION "public"."confirmar_resumo_dissolucao"("p_resumo_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_updated INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  UPDATE public.parceria_dissolucao_resumos
     SET visto_em = COALESCE(visto_em, now())
   WHERE id = p_resumo_id
     AND user_id = v_uid;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;


ALTER FUNCTION "public"."confirmar_resumo_dissolucao"("p_resumo_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."conta_visivel_para_usuario"("p_conta_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT NOT EXISTS (
    SELECT 1
    FROM public.contas_ocultas_usuario o
    WHERE o.conta_id = p_conta_id
      AND o.user_id = (SELECT auth.uid())
  );
$$;


ALTER FUNCTION "public"."conta_visivel_para_usuario"("p_conta_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."criar_categorias_padrao"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$BEGIN
  INSERT INTO public.categorias (nome, cor, icone, tipo, ativa, user_id)
  VALUES
    ('Alimentação', '#E76F51', 'label', 'despesa', 1, NEW.id),
    ('Transporte', '#F4A261', 'label', 'despesa', 1, NEW.id),
    ('Moradia', '#264653', 'label', 'despesa', 1, NEW.id),
    ('Lazer', '#E9C46A', 'label', 'despesa', 1, NEW.id),
    ('Salário', '#2A9D8F', 'label', 'receita', 1, NEW.id),
    ('Renda Extra', '#8AB17D', 'label', 'receita', 1, NEW.id);
  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."criar_categorias_padrao"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_user"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  perform pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_set(
      coalesce(nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb),
      '{role}',
      '"service_role"'::jsonb
    )::text,
    true
  );

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


ALTER FUNCTION "public"."delete_user"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."delete_user"() IS 'Apaga atomicamente a conta autenticada após step-up recente. Remove ledgers privados, pagamentos parciais e transações raiz na ordem exigida pelos triggers e FKs.';



CREATE OR REPLACE FUNCTION "public"."enforce_finflow_plan_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  limits_on boolean;
  current_plan text;
  allowed_count integer;
  used_count integer;
  should_enforce boolean := false;
  old_active boolean;
  new_active boolean;
  actor_id uuid := (select auth.uid());
  jwt_role text := coalesce((select auth.jwt()->>'role'), '');
  privileged_execution boolean := false;
  parent_row public.transacoes%rowtype;
  payment_root_setting text;
  shared_update_allowed boolean := false;
begin
  privileged_execution := jwt_role = 'service_role' or (
    actor_id is null and session_user in ('postgres', 'supabase_admin')
  );

  if tg_op = 'UPDATE'
     and new.user_id is distinct from old.user_id
     and not privileged_execution then
    raise exception using errcode = '42501', message = 'invalid resource owner';
  end if;

  if not privileged_execution and actor_id is null then
    raise exception using errcode = '42501', message = 'invalid resource owner';
  end if;

  if tg_table_name = 'transacoes' then
    -- A partir deste bloco NEW/OLD sao comprovadamente linhas de transacoes;
    -- portanto, os campos exclusivos da tabela podem ser acessados com seguranca.
    if not privileged_execution
       and tg_op = 'UPDATE'
       and new.user_id is distinct from actor_id then
      shared_update_allowed := exists(
        select 1
        from public.contas c
        where c.id = old.conta_id
          and (
            c.user_id = actor_id
            or (
              coalesce(c.compartilhado, false)
              and public.is_parceiro(c.user_id, actor_id)
            )
          )
      ) and exists(
        select 1
        from public.contas c
        where c.id = new.conta_id
          and (
            c.user_id = actor_id
            or (
              coalesce(c.compartilhado, false)
              and public.is_parceiro(c.user_id, actor_id)
            )
          )
      );
      if not shared_update_allowed then
        raise exception using errcode = '42501', message = 'invalid resource owner';
      end if;
    elsif not privileged_execution
       and tg_op = 'INSERT'
       and new.transacao_pai_id is not null then
      payment_root_setting := pg_catalog.current_setting(
        'finflow.payment_child_root_id', true
      );
      if payment_root_setting is null
         or payment_root_setting !~ '^[0-9]+$'
         or payment_root_setting::bigint <> new.transacao_pai_id then
        raise exception using errcode = '42501', message = 'invalid resource owner';
      end if;

      select p.* into parent_row
      from public.transacoes p
      where p.id = new.transacao_pai_id
        and p.transacao_pai_id is null;
      if not found
         or parent_row.status <> 'pendente'
         or new.user_id is distinct from parent_row.user_id
         or new.conta_id is distinct from parent_row.conta_id
         or new.tipo is distinct from parent_row.tipo
         or new.categoria_id is distinct from parent_row.categoria_id
         or new.data_vencimento is distinct from parent_row.data_vencimento
         or new.descricao is distinct from parent_row.descricao
         or new.status is distinct from 'paga'
         or new.data_realizacao is null
         or not exists(
           select 1
           from public.contas c
           where c.id = parent_row.conta_id
             and not coalesce(c.arquivado, false)
             and (
               c.user_id = actor_id
               or (
                 coalesce(c.compartilhado, false)
                 and public.is_parceiro(c.user_id, actor_id)
               )
             )
         ) then
        raise exception using errcode = '42501', message = 'invalid resource owner';
      end if;

      -- Filho e apenas um evento financeiro do raiz: nao consome franquia.
      return new;
    elsif not privileged_execution
       and new.user_id is distinct from actor_id then
      raise exception using errcode = '42501', message = 'invalid resource owner';
    end if;

    -- Qualquer escrita confiavel em filho continua fora da contagem mensal.
    if new.transacao_pai_id is not null then
      return new;
    end if;
    if coalesce(new.descricao, '') like '%[PagFatura:%' then
      return new;
    end if;
  elsif not privileged_execution
     and new.user_id is distinct from actor_id then
    -- As demais tabelas do trigger possuem user_id, mas nao os campos de
    -- transacoes. A propriedade continua sendo validada sem tocar nesses campos.
    raise exception using errcode = '42501', message = 'invalid resource owner';
  end if;

  select limits_enabled into limits_on
  from public.billing_settings
  where id = true;
  if not coalesce(limits_on, false) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    should_enforce := true;
  elsif tg_op = 'UPDATE' then
    if tg_table_name = 'contas' then
      should_enforce := coalesce(old.arquivado, false)
        and not coalesce(new.arquivado, false);
    elsif tg_table_name = 'cartoes' then
      should_enforce := not coalesce(old.ativo, true)
        and coalesce(new.ativo, true);
    elsif tg_table_name = 'caixinhas' then
      should_enforce := coalesce(old.arquivado, false)
        and not coalesce(new.arquivado, false);
    elsif tg_table_name = 'categorias' then
      old_active := coalesce(old.ativa::text, 'true') not in ('0', 'false', 'f');
      new_active := coalesce(new.ativa::text, 'true') not in ('0', 'false', 'f');
      should_enforce := new_active
        and (not old_active or new.tipo is distinct from old.tipo);
    elsif tg_table_name = 'transacoes' then
      should_enforce := pg_catalog.date_trunc('month', old.data_vencimento::date)
        is distinct from pg_catalog.date_trunc('month', new.data_vencimento::date);
    end if;
  end if;
  if not should_enforce then
    return new;
  end if;

  select coalesce((
    select s.plan
    from public.subscriptions s
    where s.user_id = new.user_id
      and (
        s.status in ('active', 'grace_period')
        or (s.status = 'cancelled' and s.access_until > pg_catalog.now())
      )
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc
    limit 1
  ), 'free') into current_plan;
  if current_plan = 'premium' then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(new.user_id::text), 61004
  );

  if tg_table_name = 'contas' then
    allowed_count := case current_plan when 'smart' then 5 else 2 end;
    select count(*) into used_count
    from public.contas
    where not coalesce(arquivado, false)
      and (
        user_id = new.user_id
        or (coalesce(compartilhado, false) and public.is_parceiro(user_id, new.user_id))
      );
  elsif tg_table_name = 'cartoes' then
    allowed_count := case current_plan when 'smart' then 3 else 1 end;
    select count(*) into used_count
    from public.cartoes
    where user_id = new.user_id
      and coalesce(ativo, true);
  elsif tg_table_name = 'caixinhas' then
    allowed_count := case current_plan when 'smart' then 3 else 1 end;
    select count(*) into used_count
    from public.caixinhas
    where not coalesce(arquivado, false)
      and (
        user_id = new.user_id
        or (coalesce(compartilhado, false) and public.is_parceiro(user_id, new.user_id))
      );
  elsif tg_table_name = 'categorias' then
    allowed_count := case current_plan when 'smart' then 14 else 7 end;
    select count(*) into used_count
    from public.categorias
    where user_id = new.user_id
      and tipo = new.tipo
      and coalesce(ativa::text, 'true') not in ('0', 'false', 'f');
  elsif tg_table_name = 'transacoes' then
    allowed_count := case current_plan when 'smart' then 150 else 40 end;
    if tg_op = 'UPDATE' then
      select count(*) into used_count
      from public.transacoes
      where user_id = new.user_id
        and id <> old.id
        and transacao_pai_id is null
        and pg_catalog.date_trunc('month', data_vencimento::date)
          = pg_catalog.date_trunc('month', new.data_vencimento::date);
    else
      select count(*) into used_count
      from public.transacoes
      where user_id = new.user_id
        and transacao_pai_id is null
        and pg_catalog.date_trunc('month', data_vencimento::date)
          = pg_catalog.date_trunc('month', new.data_vencimento::date);
    end if;
    select used_count + pg_catalog.count(*) into used_count
    from public.fatura_itens
    where user_id = new.user_id
      and mes_fatura = pg_catalog.to_char(new.data_vencimento::date, 'YYYY-MM')
      and categoria_id is not null;
  else
    return new;
  end if;

  if used_count >= allowed_count then
    raise exception using errcode = 'P0001', message = 'plan limit reached';
  end if;
  return new;
end;
$_$;


ALTER FUNCTION "public"."enforce_finflow_plan_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."execute_manual_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := auth.uid();
  request_hash text;
  existing private.offline_action_receipts%rowtype;
  prepared jsonb;
  normalized jsonb;
  execution_result jsonb;
  recent_count integer;
begin
  if caller is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_REQUIRED';
  end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_MISMATCH';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_client_created_at is null
     or p_client_created_at < pg_catalog.clock_timestamp() - interval '30 days'
     or p_client_created_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'OFFLINE_OPERATION_EXPIRED';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 16384 then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_PAYLOAD';
  end if;
  if p_action_type is null or not (p_action_type = any(array[
    'create_account', 'update_account', 'archive_account', 'delete_account', 'reactivate_account',
    'create_category', 'update_category', 'archive_category', 'delete_category', 'reactivate_category',
    'create_goal', 'update_goal', 'archive_goal', 'delete_goal', 'reactivate_goal', 'move_goal',
    'create_transaction', 'transfer_between_accounts', 'update_transaction', 'delete_transaction',
    'complete_transaction', 'reopen_transaction',
    'create_card', 'update_card', 'archive_card', 'delete_card', 'reactivate_card',
    'create_card_purchase', 'update_card_purchase', 'delete_card_purchase',
    'pay_invoice', 'reverse_invoice_payment'
  ]::text[])) then
    raise exception using errcode = 'P0001', message = 'OFFLINE_UNSUPPORTED_ACTION';
  end if;

  request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(pg_catalog.jsonb_build_array(p_action_type, p_payload)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- Serializa operacoes manuais do mesmo usuario e torna o request_id
  -- repetivel sem duplicar lancamentos, parcelas ou transferencias.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text, 81277)
  );

  select * into existing
  from private.offline_action_receipts r
  where r.user_id = caller and r.idempotency_key = p_idempotency_key;

  if found then
    if existing.action_type <> p_action_type or existing.payload_hash <> request_hash then
      raise exception using errcode = 'P0001', message = 'OFFLINE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'receipt_id', existing.id,
      'result', existing.result
    );
  end if;

  select pg_catalog.count(*) into recent_count
  from private.offline_action_receipts r
  where r.user_id = caller
    and r.created_at >= pg_catalog.clock_timestamp() - interval '1 hour';
  if recent_count >= 180 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'OFFLINE_RATE_LIMITED',
      'retry_after_seconds', 3600
    );
  end if;

  -- Pagamento e estorno de fatura possuem RPCs manuais proprias que já fazem
  -- sua própria validação completa (ai_prepare_action interno, locks e
  -- revalidações). Chamar ai_prepare_action aqui também, com o payload bruto,
  -- duplicava essa validação com regras diferentes das da RPC dedicada (ex.:
  -- rejeitava juros fora do modo carry mesmo quando o modo é keep_open, que
  -- finance_pay_invoice trata corretamente sozinho). Por isso essas duas ações
  -- não passam pelo normalizador genérico.
  if p_action_type = 'pay_invoice' then
    execution_result := public.finance_pay_invoice(
      (p_payload ->> 'card_id')::bigint,
      p_payload ->> 'invoice_month',
      (p_payload ->> 'account_id')::bigint,
      (p_payload ->> 'payment_amount')::numeric,
      p_payload ->> 'remainder_mode',
      case when p_payload ? 'interest_value'
        then (p_payload ->> 'interest_value')::numeric else null end,
      case when p_payload ? 'interest_percent'
        then (p_payload ->> 'interest_percent')::numeric else null end,
      p_idempotency_key
    );
  elsif p_action_type = 'reverse_invoice_payment' then
    execution_result := public.finance_reverse_invoice_payment(
      (p_payload ->> 'transaction_id')::bigint,
      p_idempotency_key
    );
  else
    prepared := private.ai_prepare_action(caller, p_action_type, p_payload);
    normalized := prepared -> 'payload';
    -- A leitura com lock impede que uma previa antiga seja aplicada sobre um
    -- saldo ou serie que mudou durante a operacao.
    perform private.ai_action_state_fingerprint(caller, p_action_type, normalized, true);
    execution_result := private.ai_execute_financial_action(
      caller,
      p_action_type,
      normalized,
      -- complete/reopen exigem uma chave canonica nao nula para seus recibos.
      -- Os demais executores ignoram este argumento.
      p_idempotency_key
    );
  end if;

  insert into private.offline_action_receipts (
    user_id,
    idempotency_key,
    action_type,
    payload_hash,
    result,
    client_created_at
  ) values (
    caller,
    p_idempotency_key,
    p_action_type,
    request_hash,
    execution_result,
    p_client_created_at
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'receipt_id', existing.id,
    'result', execution_result
  );
end;
$$;


ALTER FUNCTION "public"."execute_manual_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."execute_manual_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) IS 'Executa acoes financeiras manuais do site com validacao de dominio, lock, auditoria e idempotencia; nunca aceita user_id no payload.';



CREATE OR REPLACE FUNCTION "public"."execute_offline_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := auth.uid();
  request_hash text;
  existing private.offline_action_receipts%rowtype;
  prepared jsonb;
  normalized jsonb;
  execution_result jsonb;
  recent_count integer;
begin
  if caller is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_REQUIRED';
  end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_MISMATCH';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_client_created_at is null
     or p_client_created_at < pg_catalog.clock_timestamp() - interval '30 days'
     or p_client_created_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'OFFLINE_OPERATION_EXPIRED';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or pg_catalog.octet_length(p_payload::text) > 8192 then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_PAYLOAD';
  end if;
  if p_action_type is null or not (p_action_type = any(array[
    'create_account',
    'create_category',
    'create_goal',
    'create_card',
    'create_transaction',
    'transfer_between_accounts',
    'move_goal',
    'create_card_purchase'
  ]::text[])) then
    raise exception using errcode = 'P0001', message = 'OFFLINE_UNSUPPORTED_ACTION';
  end if;

  request_hash := encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_array(p_action_type, p_payload)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  );

  -- Serializa ações do mesmo usuário. Além de fechar a corrida da chave
  -- idempotente, impede que chamadas paralelas ultrapassem o limite horário.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text, 81277)
  );

  select * into existing
  from private.offline_action_receipts r
  where r.user_id = caller and r.idempotency_key = p_idempotency_key;

  if found then
    if existing.action_type <> p_action_type or existing.payload_hash <> request_hash then
      raise exception using errcode = 'P0001', message = 'OFFLINE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'receipt_id', existing.id,
      'result', existing.result
    );
  end if;

  select count(*) into recent_count
  from private.offline_action_receipts r
  where r.user_id = caller
    and r.created_at >= pg_catalog.clock_timestamp() - interval '1 hour';
  if recent_count >= 120 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'OFFLINE_RATE_LIMITED',
      'retry_after_seconds', 3600
    );
  end if;

  -- Estas funções são o mesmo núcleo que rejeita campos extras, referências de
  -- outro usuário, fatura fechada, limite/cartão inválido e regras de plano.
  prepared := private.ai_prepare_action(caller, p_action_type, p_payload);
  normalized := prepared -> 'payload';

  -- Bloqueia as linhas relacionadas até o fim desta transação. A execução faz
  -- uma segunda validação imediatamente antes do DML.
  perform private.ai_action_state_fingerprint(caller, p_action_type, normalized, true);
  execution_result := private.ai_execute_financial_action(
    caller,
    p_action_type,
    normalized,
    null
  );

  insert into private.offline_action_receipts (
    user_id,
    idempotency_key,
    action_type,
    payload_hash,
    result,
    client_created_at
  ) values (
    caller,
    p_idempotency_key,
    p_action_type,
    request_hash,
    execution_result,
    p_client_created_at
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'receipt_id', existing.id,
    'result', execution_result
  );
end;
$$;


ALTER FUNCTION "public"."execute_offline_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."execute_offline_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) IS 'Executa de forma idempotente somente criações financeiras offline validadas no servidor; não aceita JWT/user_id no payload.';



CREATE OR REPLACE FUNCTION "public"."execute_offline_optimistic_update"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid:=auth.uid();
  request_hash text;
  existing private.offline_action_receipts%rowtype;
  prepared jsonb;
  execution_result jsonb;
  recent_count integer;
begin
  if caller is null then
    raise exception using errcode='P0001', message='OFFLINE_AUTH_REQUIRED';
  end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode='P0001', message='OFFLINE_AUTH_MISMATCH';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_client_created_at is null
     or p_client_created_at<pg_catalog.clock_timestamp()-interval '30 days'
     or p_client_created_at>pg_catalog.clock_timestamp()+interval '5 minutes' then
    raise exception using errcode='P0001', message='OFFLINE_OPERATION_EXPIRED';
  end if;
  if p_payload is null or pg_catalog.jsonb_typeof(p_payload)<>'object'
     or pg_catalog.octet_length(p_payload::text)>8192 then
    raise exception using errcode='P0001', message='OFFLINE_INVALID_PAYLOAD';
  end if;
  if p_action_type is null or not (p_action_type=any(array[
    'update_account','update_category','update_goal','update_card','update_transaction'
  ]::text[])) then
    raise exception using errcode='P0001', message='OFFLINE_UNSUPPORTED_ACTION';
  end if;

  request_hash:=pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(jsonb_build_array(p_action_type,p_payload)::text,'UTF8'),
      'sha256'
    ),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text,81277)
  );

  select * into existing from private.offline_action_receipts r
  where r.user_id=caller and r.idempotency_key=p_idempotency_key;
  if found then
    if existing.action_type<>p_action_type or existing.payload_hash<>request_hash then
      raise exception using errcode='P0001', message='OFFLINE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok',true,'replayed',true,'receipt_id',existing.id,'result',existing.result
    );
  end if;

  select count(*) into recent_count from private.offline_action_receipts r
  where r.user_id=caller and r.created_at>=pg_catalog.clock_timestamp()-interval '1 hour';
  if recent_count>=120 then
    return pg_catalog.jsonb_build_object(
      'ok',false,'error_code','OFFLINE_RATE_LIMITED','retry_after_seconds',3600
    );
  end if;

  prepared:=private.offline_prepare_optimistic_update(caller,p_action_type,p_payload);
  execution_result:=private.offline_execute_optimistic_update(caller,p_action_type,prepared);

  insert into private.offline_action_receipts(
    user_id,idempotency_key,action_type,payload_hash,result,client_created_at
  ) values (
    caller,p_idempotency_key,p_action_type,request_hash,execution_result,p_client_created_at
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'ok',true,'replayed',false,'receipt_id',existing.id,'result',execution_result
  );
end;
$$;


ALTER FUNCTION "public"."execute_offline_optimistic_update"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."execute_offline_optimistic_update"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) IS 'Aplica edições offline allowlisted com expected_version, lock de linha, conflito otimista e recibo idempotente.';



CREATE OR REPLACE FUNCTION "public"."finalize_subscription_event"("p_event_id" "uuid", "p_processing_token" "uuid", "p_subscription_id" "uuid" DEFAULT NULL::"uuid", "p_error_code" "text" DEFAULT NULL::"text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  normalized_error text := nullif(btrim(coalesce(p_error_code, '')), '');
  changed integer := 0;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_event_id is null or p_processing_token is null then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_WEBHOOK_FINALIZATION';
  end if;
  if normalized_error is not null
     and (length(normalized_error) not between 3 and 80
       or normalized_error !~ '^[A-Z][A-Z0-9_]+$') then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_WEBHOOK_ERROR';
  end if;
  if normalized_error is null and p_subscription_id is null then
    raise exception using errcode = '22023', message = 'FINFLOW_SUBSCRIPTION_REQUIRED';
  end if;

  if normalized_error is null then
    update public.subscription_events
    set subscription_id = p_subscription_id,
        processed_at = clock_timestamp(),
        error = null,
        processing_token = null,
        processing_locked_until = null
    where id = p_event_id
      and processing_token = p_processing_token
      and processed_at is null;
  else
    update public.subscription_events
    set error = normalized_error,
        processing_token = null,
        processing_locked_until = null
    where id = p_event_id
      and processing_token = p_processing_token
      and processed_at is null;
  end if;

  get diagnostics changed = row_count;
  return changed = 1;
end;
$_$;


ALTER FUNCTION "public"."finalize_subscription_event"("p_event_id" "uuid", "p_processing_token" "uuid", "p_subscription_id" "uuid", "p_error_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_ai_context_snapshot"("p_current_date" "date", "p_focus_month" "text", "p_years" integer[], "p_scope_account_ids" bigint[] DEFAULT NULL::bigint[], "p_analytics_allowed" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO ''
    AS $_$
declare
  focus_start date;
  focus_end date;
  current_month date;
  entitlement record;
  include_analytics boolean := false;
  result jsonb;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if p_current_date is null
     or p_focus_month is null
     or p_focus_month !~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])$' then
    raise exception using errcode = '22023', message = 'invalid financial context period';
  end if;

  if coalesce(cardinality(p_years), 0) > 8 then
    raise exception using errcode = '22023', message = 'too many financial context years';
  end if;

  if coalesce(cardinality(p_scope_account_ids), 0) > 100 then
    raise exception using errcode = '22023', message = 'too many financial context accounts';
  end if;

  -- O parâmetro só pode reduzir dados. O cliente autenticado não consegue
  -- promover o próprio plano chamando a RPC diretamente com true.
  select * into entitlement from public.get_my_entitlement();
  if not found then
    raise exception using errcode = '42501', message = 'financial entitlement unavailable';
  end if;
  include_analytics := coalesce(p_analytics_allowed, false) and (
    not coalesce(entitlement.limits_enabled, false)
    or entitlement.plan = 'premium'
  );

  focus_start := (p_focus_month || '-01')::date;
  focus_end := (focus_start + interval '1 month - 1 day')::date;
  current_month := date_trunc('month', p_current_date)::date;

  with
  selected_years as materialized (
    select distinct requested_year as year
    from unnest(
      coalesce(p_years, array[]::integer[])
      || array[extract(year from focus_start)::integer]
    ) requested_year
    where requested_year between 1900 and 2100
  ),
  accessible_accounts as materialized (
    select
      a.id::bigint as id,
      coalesce(a.saldo_inicial, 0)::numeric as initial_balance,
      coalesce(a.arquivado, false) as archived
    from public.contas a
  ),
  active_accounts as materialized (
    select a.id, a.initial_balance
    from accessible_accounts a
    where not a.archived
  ),
  scope_accounts as materialized (
    select a.id, a.initial_balance
    from accessible_accounts a
    where case
      when coalesce(cardinality(p_scope_account_ids), 0) = 0 then not a.archived
      else a.id = any(p_scope_account_ids)
    end
  ),
  accessible_goals as materialized (
    select
      g.id::bigint as id,
      g.nome::text as name,
      lower(btrim(g.nome::text)) as normalized_name,
      coalesce(g.saldo_atual, 0)::numeric as balance,
      g.data_prazo::date as target_date
    from public.caixinhas g
  ),
  accessible_categories as materialized (
    select c.id::bigint as id, c.nome::text as name
    from public.categorias c
  ),
  accessible_cards as materialized (
    select c.id::bigint as id, coalesce(c.limite, 0)::numeric as card_limit
    from public.cartoes c
  ),
  tx_raw as materialized (
    select
      t.id::bigint as id,
      t.tipo::text as type,
      coalesce(t.valor, 0)::numeric as value,
      coalesce(t.descricao, '')::text as description,
      t.status::text as status,
      t.categoria_id::bigint as category_id,
      t.conta_id::bigint as source_account_id,
      t.data_vencimento::date as scheduled_date,
      t.data_realizacao::date as realization_date,
      case
        when t.status = 'paga' then coalesce(t.data_realizacao, t.data_vencimento)::date
        else t.data_vencimento::date
      end as effective_date,
      substring(coalesce(t.descricao, '') from '\[Destino:([0-9]+)\]\s*$')::bigint as destination_account_id,
      regexp_match(coalesce(t.descricao, ''), '\[Objetivo:([0-9]+):(guardar|resgatar)\]\s*$') as goal_marker,
      regexp_match(coalesce(t.descricao, ''), '\[PagFatura:([0-9]+):((19|20)[0-9]{2}-(0[1-9]|1[0-2])):([^:\]]+)(:([0-9]+))?\]') as invoice_marker,
      position('[Transf.]' in coalesce(t.descricao, '')) > 0 as internal_transfer,
      btrim(regexp_replace(
        regexp_replace(
          coalesce(t.descricao, ''),
          '\s*\[(Serie:[^]]+|Destino:[0-9]+|Objetivo:[0-9]+:(guardar|resgatar)|PagFatura:[^]]+)\]\s*',
          ' ',
          'g'
        ),
        '^\[Transf\.\]\s*',
        '',
        'i'
      )) as visible_description
    from public.transacoes t
  ),
  tx_classified as materialized (
    select
      t.*,
      case
        when t.goal_marker is not null then t.goal_marker[2]
        when t.internal_transfer and t.visible_description ~* '^Guardar em:\s*' then 'guardar'
        when t.internal_transfer and t.visible_description ~* '^Resgate de:\s*' then 'resgatar'
        else null
      end as goal_operation,
      case
        when t.goal_marker is not null then (t.goal_marker[1])::bigint
        else g.id
      end as goal_id,
      case
        when t.internal_transfer
          and t.destination_account_id is null
          and t.goal_marker is null
          and t.visible_description !~* '^(Guardar em|Resgate de):\s*'
        then concat_ws('|',
          lower(btrim(t.visible_description)),
          t.value::text,
          t.status,
          coalesce(t.scheduled_date::text, ''),
          coalesce(t.realization_date::text, '')
        )
        else null
      end as legacy_pair_key
    from tx_raw t
    left join lateral (
      -- Formato legado guarda apenas o nome. Em caso de nomes homônimos,
      -- escolhemos deterministicamente o menor ID sem multiplicar a linha.
      select candidate.id
      from accessible_goals candidate
      where t.goal_marker is null
        and t.internal_transfer
        and lower(btrim(regexp_replace(
          regexp_replace(t.visible_description, '^(Guardar em|Resgate de):\s*', '', 'i'),
          '\s*\([^)]*\)\s*$',
          '',
          'i'
        ))) = candidate.normalized_name
      order by candidate.id
      limit 1
    ) g on true
  ),
  tx_numbered as materialized (
    select
      t.*,
      row_number() over (
        partition by t.legacy_pair_key, t.type
        order by t.id
      ) as legacy_pair_number
    from tx_classified t
  ),
  tx_with_pair as materialized (
    select
      t.*,
      pair.source_account_id as paired_account_id
    from tx_numbered t
    left join tx_numbered pair
      on t.legacy_pair_key is not null
     and pair.legacy_pair_key = t.legacy_pair_key
     and pair.legacy_pair_number = t.legacy_pair_number
     and pair.type = case when t.type = 'receita' then 'despesa' else 'receita' end
  ),
  account_delta_lines as materialized (
    select
      t.source_account_id as account_id,
      case
        when t.destination_account_id is not null then -t.value
        when t.goal_operation = 'guardar' then -t.value
        when t.goal_operation = 'resgatar' then t.value
        when t.type = 'receita' then t.value
        else -t.value
      end as delta
    from tx_with_pair t
    where t.status = 'paga'

    union all

    select t.destination_account_id as account_id, t.value as delta
    from tx_with_pair t
    where t.status = 'paga'
      and t.destination_account_id is not null
  ),
  account_balances as materialized (
    select
      a.id as account_id,
      round(a.initial_balance + coalesce(sum(d.delta), 0), 2) as balance
    from accessible_accounts a
    left join account_delta_lines d on d.account_id = a.id
    group by a.id, a.initial_balance
  ),
  event_rows as materialized (
    -- Transferência moderna: só cruza o fluxo quando uma única ponta está no escopo.
    select
      t.id,
      t.source_account_id,
      t.destination_account_id,
      case when src.id is not null then t.source_account_id else t.destination_account_id end as account_id,
      case when src.id is not null then 'despesa' else 'receita' end as type,
      t.value,
      case when src.id is not null then -t.value else t.value end as delta,
      t.status,
      t.effective_date,
      t.category_id,
      true as account_transfer,
      false as goal_transfer,
      null::bigint as goal_id,
      null::text as goal_operation,
      false as invoice_payment
    from tx_with_pair t
    left join scope_accounts src on src.id = t.source_account_id
    left join scope_accounts dst on dst.id = t.destination_account_id
    where t.destination_account_id is not null
      and ((src.id is not null) <> (dst.id is not null))

    union all

    -- Guardar/resgatar altera saldo, mas não é receita/despesa operacional.
    select
      t.id,
      t.source_account_id,
      null::bigint,
      t.source_account_id,
      case when t.goal_operation = 'guardar' then 'despesa' else 'receita' end,
      t.value,
      case when t.goal_operation = 'guardar' then -t.value else t.value end,
      t.status,
      t.effective_date,
      t.category_id,
      false,
      true,
      t.goal_id,
      t.goal_operation,
      false
    from tx_with_pair t
    join scope_accounts src on src.id = t.source_account_id
    where t.destination_account_id is null
      and t.goal_operation is not null

    union all

    -- Lançamentos comuns e transferências legadas que cruzam o escopo.
    select
      t.id,
      t.source_account_id,
      null::bigint,
      t.source_account_id,
      case when t.type = 'receita' then 'receita' else 'despesa' end,
      t.value,
      case when t.type = 'receita' then t.value else -t.value end,
      t.status,
      t.effective_date,
      t.category_id,
      t.internal_transfer,
      false,
      null::bigint,
      null::text,
      t.invoice_marker is not null
    from tx_with_pair t
    join scope_accounts src on src.id = t.source_account_id
    where t.destination_account_id is null
      and t.goal_operation is null
      and not (
        t.legacy_pair_key is not null
        and t.paired_account_id is not null
        and exists (select 1 from scope_accounts paired where paired.id = t.paired_account_id)
      )
  ),
  scalar_balances as materialized (
    select
      round(coalesce((
        select sum(b.balance)
        from account_balances b
        join active_accounts a on a.id = b.account_id
      ), 0), 2) as global_active_balance,
      round(
        coalesce((select sum(s.initial_balance) from scope_accounts s), 0)
        + coalesce((select sum(e.delta) from event_rows e where e.status = 'paga'), 0),
        2
      ) as current_balance,
      round(
        coalesce((select sum(s.initial_balance) from scope_accounts s), 0)
        + coalesce((select sum(e.delta) from event_rows e where e.effective_date <= focus_end), 0),
        2
      ) as predicted_end_balance,
      coalesce((select sum(s.initial_balance) from scope_accounts s), 0)::numeric as scope_initial_balance
  ),
  dashboard_flow as materialized (
    select
      p_focus_month as month,
      round(coalesce(sum(e.value) filter (
        where e.type = 'receita' and e.status = 'paga'
      ), 0), 2) as realized_income,
      round(coalesce(sum(e.value) filter (
        where e.type = 'despesa' and e.status = 'paga'
      ), 0), 2) as realized_expense,
      round(coalesce(sum(e.value) filter (
        where e.type = 'receita' and e.status <> 'paga'
      ), 0), 2) as pending_income,
      round(coalesce(sum(e.value) filter (
        where e.type = 'despesa' and e.status <> 'paga'
      ), 0), 2) as pending_expense
    from event_rows e
    where e.effective_date between focus_start and focus_end
      and not e.goal_transfer
      and not e.invoice_payment
  ),
  month_rows as materialized (
    select
      make_date(y.year, m.month_number, 1) as month_start,
      (make_date(y.year, m.month_number, 1) + interval '1 month - 1 day')::date as month_end
    from selected_years y
    cross join generate_series(1, 12) m(month_number)
  ),
  monthly_flows as materialized (
    select
      to_char(m.month_start, 'YYYY-MM') as month,
      round(coalesce(sum(e.value) filter (
        where e.type = 'receita' and e.status = 'paga'
      ), 0), 2) as realized_income,
      round(coalesce(sum(e.value) filter (
        where e.type = 'despesa' and e.status = 'paga'
      ), 0), 2) as realized_expense,
      round(coalesce(sum(e.value) filter (
        where e.type = 'receita' and e.status <> 'paga'
      ), 0), 2) as pending_income,
      round(coalesce(sum(e.value) filter (
        where e.type = 'despesa' and e.status <> 'paga'
      ), 0), 2) as pending_expense,
      round(case
        when m.month_start < current_month then
          b.scope_initial_balance + coalesce((
            select sum(history.delta)
            from event_rows history
            where history.status = 'paga'
              and history.effective_date <= m.month_end
          ), 0)
        else
          b.current_balance + coalesce((
            select sum(forecast.delta)
            from event_rows forecast
            where forecast.status <> 'paga'
              and forecast.effective_date <= m.month_end
          ), 0)
      end, 2) as account_balance,
      (
        m.month_start >= current_month
        and (
          m.month_start <> current_month
          or exists (
            select 1 from event_rows pending
            where pending.status <> 'paga'
              and pending.effective_date <= m.month_end
          )
        )
      ) as balance_is_projection
    from month_rows m
    cross join scalar_balances b
    left join event_rows e
      on not e.goal_transfer
     and e.effective_date >= m.month_start
     and e.effective_date <= m.month_end
    group by m.month_start, m.month_end, b.scope_initial_balance, b.current_balance
    order by m.month_start
  ),
  all_active_selected as materialized (
    select (
      not exists (
        select a.id from active_accounts a
        except
        select s.id from scope_accounts s
      )
      and not exists (
        select s.id from scope_accounts s
        except
        select a.id from active_accounts a
      )
    ) as value
  ),
  invoice_base as materialized (
    select
      i.id::bigint as id,
      i.cartao_id::bigint as card_id,
      i.categoria_id::bigint as category_id,
      coalesce(i.descricao, '')::text as description,
      coalesce(i.valor, 0)::numeric as value,
      i.data_compra::date as purchase_date,
      i.mes_fatura::text as invoice_month,
      coalesce(i.pago, false) as paid,
      (
        i.categoria_id is null
        and (
          (lower(btrim(coalesce(i.descricao, ''))) = 'pagamento parcial da fatura' and coalesce(i.valor, 0) < 0)
          or lower(btrim(coalesce(i.descricao, ''))) like 'saldo da fatura anterior (%'
        )
      ) as synthetic_ledger_item
    from public.fatura_itens i
  ),
  category_lines as materialized (
    select
      extract(year from e.effective_date)::integer as year,
      e.category_id,
      e.type,
      case when e.status = 'paga' then e.value else 0 end as actual,
      e.value as forecast
    from event_rows e
    where include_analytics
      and e.effective_date is not null
      and extract(year from e.effective_date)::integer in (select year from selected_years)
      and not e.account_transfer
      and not e.goal_transfer
      and not e.invoice_payment

    union all

    select
      extract(year from i.purchase_date)::integer,
      i.category_id,
      'despesa'::text,
      i.value,
      i.value
    from invoice_base i
    cross join all_active_selected aas
    where include_analytics
      and aas.value
      and not i.synthetic_ledger_item
      and i.purchase_date is not null
      and extract(year from i.purchase_date)::integer in (select year from selected_years)
  ),
  category_totals as materialized (
    select
      l.year,
      l.category_id,
      l.type,
      case when l.category_id is null then 'Sem categoria' else coalesce(c.name, 'Sem categoria') end as name,
      round(sum(l.actual), 2) as actual,
      round(sum(l.forecast), 2) as forecast
    from category_lines l
    left join accessible_categories c on c.id = l.category_id
    group by l.year, l.category_id, l.type, c.name
  ),
  category_year_rows as materialized (
    select
      y.year,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'category_id', c.category_id,
          'name', c.name,
          'type', c.type,
          'actual', c.actual,
          'forecast', c.forecast
        ) order by c.forecast desc, c.actual desc, c.name)
        from category_totals c
        where c.year = y.year and c.type = 'receita'
      ), '[]'::jsonb) as income,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'category_id', c.category_id,
          'name', c.name,
          'type', c.type,
          'actual', c.actual,
          'forecast', c.forecast
        ) order by c.forecast desc, c.actual desc, c.name)
        from category_totals c
        where c.year = y.year and c.type = 'despesa'
      ), '[]'::jsonb) as expenses
    from selected_years y
  ),
  card_purchase_totals as materialized (
    select
      to_char(i.purchase_date, 'YYYY-MM') as month,
      round(sum(i.value), 2) as total
    from invoice_base i
    cross join all_active_selected aas
    where aas.value
      and not i.synthetic_ledger_item
      and i.purchase_date is not null
    group by to_char(i.purchase_date, 'YYYY-MM')
  ),
  goal_forecasts as materialized (
    select
      g.id as goal_id,
      round(
        g.balance + coalesce(sum(t.value) filter (
          where t.status <> 'paga'
            and t.goal_operation = 'guardar'
            and t.goal_id = g.id
            and t.scheduled_date <= make_date(extract(year from p_current_date)::integer, 12, 31)
        ), 0),
        2
      ) as expected_by_year_end,
      case
        when g.target_date is not null
          and g.target_date >= p_current_date
          and coalesce(sum(t.value) filter (
            where t.status <> 'paga'
              and t.goal_operation = 'guardar'
              and t.goal_id = g.id
              and t.scheduled_date <= g.target_date
          ), 0) > 0
        then round(
          g.balance + coalesce(sum(t.value) filter (
            where t.status <> 'paga'
              and t.goal_operation = 'guardar'
              and t.goal_id = g.id
              and t.scheduled_date <= g.target_date
          ), 0),
          2
        )
        else null
      end as expected_by_target_date
    from accessible_goals g
    left join tx_with_pair t on t.goal_id = g.id
    group by g.id, g.balance, g.target_date
  ),
  invoice_item_summaries as materialized (
    select
      i.card_id,
      i.invoice_month,
      round(coalesce(sum(i.value) filter (where not i.paid), 0), 2) as open,
      round(coalesce(sum(i.value) filter (where i.paid), 0), 2) as closed_items_total
    from invoice_base i
    where i.invoice_month ~ '^(19|20)[0-9]{2}-(0[1-9]|1[0-2])$'
    group by i.card_id, i.invoice_month
  ),
  invoice_payment_summaries as materialized (
    select
      (t.invoice_marker[1])::bigint as card_id,
      t.invoice_marker[2] as invoice_month,
      round(sum(t.value), 2) as payments_total
    from tx_with_pair t
    where t.status = 'paga'
      and t.invoice_marker is not null
    group by (t.invoice_marker[1])::bigint, t.invoice_marker[2]
  ),
  invoice_keys as materialized (
    select i.card_id, i.invoice_month from invoice_item_summaries i
    union
    select p.card_id, p.invoice_month from invoice_payment_summaries p
  ),
  invoice_summaries as materialized (
    select
      k.card_id,
      k.invoice_month,
      coalesce(i.open, 0) as open,
      coalesce(i.closed_items_total, 0) as closed_items_total,
      coalesce(p.payments_total, 0) as payments_total
    from invoice_keys k
    left join invoice_item_summaries i
      on i.card_id = k.card_id and i.invoice_month = k.invoice_month
    left join invoice_payment_summaries p
      on p.card_id = k.card_id and p.invoice_month = k.invoice_month
  ),
  card_metrics as materialized (
    select
      c.id as card_id,
      round(coalesce((
        select sum(i.value)
        from invoice_base i
        where i.card_id = c.id
          and not i.paid
          and i.invoice_month >= to_char(current_month, 'YYYY-MM')
          and not (
            right(i.description, 6) = '(Fixa)'
            and i.invoice_month <> to_char(current_month, 'YYYY-MM')
          )
      ), 0), 2) as used_limit,
      round(greatest(0, c.card_limit - coalesce((
        select sum(i.value)
        from invoice_base i
        where i.card_id = c.id
          and not i.paid
          and i.invoice_month >= to_char(current_month, 'YYYY-MM')
          and not (
            right(i.description, 6) = '(Fixa)'
            and i.invoice_month <> to_char(current_month, 'YYYY-MM')
          )
      ), 0)), 2) as available_limit,
      case
        when not exists (
          select 1 from invoice_base i
          where i.card_id = c.id and i.invoice_month = to_char(current_month, 'YYYY-MM')
        ) or coalesce((
          select sum(i.value) from invoice_base i
          where i.card_id = c.id
            and i.invoice_month = to_char(current_month, 'YYYY-MM')
            and not i.paid
        ), 0) = 0
        then to_char(current_month + interval '1 month', 'YYYY-MM')
        else to_char(current_month, 'YYYY-MM')
      end as displayed_invoice_month
    from accessible_cards c
  ),
  card_metrics_with_open as materialized (
    select
      m.card_id,
      m.used_limit,
      m.available_limit,
      m.displayed_invoice_month,
      round(coalesce((
        select sum(i.value)
        from invoice_base i
        where i.card_id = m.card_id
          and i.invoice_month = m.displayed_invoice_month
          and not i.paid
      ), 0), 2) as displayed_invoice_open
    from card_metrics m
  ),
  source_counts as materialized (
    select
      (select count(*) from tx_with_pair)::bigint as transactions,
      (select count(*) from invoice_base)::bigint as invoice_items
  )
  select jsonb_build_object(
    'calculation_version', 1,
    'complete', true,
    'source_counts', jsonb_build_object(
      'transactions', counts.transactions,
      'invoice_items', counts.invoice_items
    ),
    'account_balances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'account_id', b.account_id,
        'balance', b.balance
      ) order by b.account_id)
      from account_balances b
    ), '[]'::jsonb),
    'global_active_balance', balances.global_active_balance,
    'scope_account_ids', coalesce((
      select jsonb_agg(s.id order by s.id) from scope_accounts s
    ), '[]'::jsonb),
    'current_balance', balances.current_balance,
    'predicted_end_balance', balances.predicted_end_balance,
    'dashboard_flow', (
      select to_jsonb(d) from dashboard_flow d
    ),
    'monthly_cash_flow', coalesce((
      select jsonb_agg(to_jsonb(m) order by m.month) from monthly_flows m
    ), '[]'::jsonb),
    'categories_by_year', coalesce((
      select jsonb_agg(jsonb_build_object(
        'year', y.year,
        'income', y.income,
        'expenses', y.expenses
      ) order by y.year)
      from category_year_rows y
    ), '[]'::jsonb),
    'card_purchases_by_month', coalesce((
      select jsonb_agg(jsonb_build_object(
        'month', p.month,
        'total', p.total
      ) order by p.month)
      from card_purchase_totals p
    ), '[]'::jsonb),
    'goal_forecasts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'goal_id', g.goal_id,
        'expected_by_year_end', g.expected_by_year_end,
        'expected_by_target_date', g.expected_by_target_date
      ) order by g.goal_id)
      from goal_forecasts g
    ), '[]'::jsonb),
    'invoice_summaries', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.invoice_month desc, i.card_id)
      from invoice_summaries i
    ), '[]'::jsonb),
    'card_metrics', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.card_id)
      from card_metrics_with_open c
    ), '[]'::jsonb)
  )
  into result
  from scalar_balances balances
  cross join source_counts counts;

  return coalesce(result, jsonb_build_object(
    'calculation_version', 1,
    'complete', false,
    'error', 'aggregate context unavailable'
  ));
end;
$_$;


ALTER FUNCTION "public"."finance_ai_context_snapshot"("p_current_date" "date", "p_focus_month" "text", "p_years" integer[], "p_scope_account_ids" bigint[], "p_analytics_allowed" boolean) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."finance_ai_context_snapshot"("p_current_date" "date", "p_focus_month" "text", "p_years" integer[], "p_scope_account_ids" bigint[], "p_analytics_allowed" boolean) IS 'Agrega o contexto financeiro da IA sob a sessão e as políticas RLS do usuário; não retorna descrições nem linhas brutas.';



CREATE OR REPLACE FUNCTION "public"."finance_is_invoice_item_protected"("p_item_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select case
    when (select auth.uid()) is null then true
    else exists(
      select 1
      from private.ai_invoice_payment_ledger l
      where l.user_id=(select auth.uid())
        and l.reversed_at is null
        and (
          l.linked_item_id=p_item_id
          or p_item_id=any(l.paid_item_ids)
        )
    )
  end;
$$;


ALTER FUNCTION "public"."finance_is_invoice_item_protected"("p_item_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_pay_invoice"("p_card_id" bigint, "p_invoice_month" "text", "p_account_id" bigint, "p_payment_amount" numeric, "p_remainder_mode" "text", "p_interest_value" numeric, "p_interest_percent" numeric, "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid:=private.ai_assert_authenticated();
  existing private.ai_invoice_payment_ledger%rowtype;
  prepared jsonb;
  payload jsonb;
  normalized jsonb;
  result jsonb;
  v_payment_transaction_id bigint;
  linked_item_id bigint;
  remaining_amount numeric:=0;
  interest_amount numeric:=0;
  changed integer;
begin
  if p_request_id is null then perform private.ai_fail('AI_INVALID_REQUEST_ID'); end if;
  perform pg_advisory_xact_lock(hashtext(caller::text),hashtext(p_request_id::text));

  select * into existing
  from private.ai_invoice_payment_ledger l
  where l.user_id=caller and l.request_id=p_request_id
  for update;
  if found then
    return coalesce(existing.operation_result,'{}'::jsonb)||jsonb_build_object(
      'payment_transaction_id',existing.payment_transaction_id,
      'card_id',coalesce(existing.card_id,(existing.operation_result->>'card_id')::bigint),
      'invoice_month',existing.invoice_month,
      'source',existing.source,
      'reversed',existing.reversed_at is not null,
      'replayed',true
    );
  end if;

  -- O normalizador-base aceita juros somente em carry. Para keep_open os juros
  -- são aplicados logo depois pelo próprio RPC, ainda na mesma transação.
  payload:=jsonb_strip_nulls(jsonb_build_object(
    'card_id',p_card_id,
    'invoice_month',p_invoice_month,
    'account_id',p_account_id,
    'payment_amount',p_payment_amount,
    'remainder_mode',p_remainder_mode,
    'interest_value',case when p_remainder_mode='carry' then p_interest_value else null end,
    'interest_percent',case when p_remainder_mode='carry' then p_interest_percent else null end
  ));
  prepared:=private.ai_prepare_action(caller,'pay_invoice',payload);
  normalized:=prepared->'payload';
  result:=private.finance_execute_invoice_action(caller,'pay_invoice',normalized,null);

  if p_remainder_mode='keep_open'
     and (p_interest_value is not null or p_interest_percent is not null) then
    remaining_amount:=(result->>'remaining')::numeric;
    if p_interest_value is not null then
      interest_amount:=round(p_interest_value,2);
    else
      interest_amount:=round(remaining_amount*p_interest_percent/100,2);
    end if;
    if interest_amount<0 then perform private.ai_fail('AI_INVALID_INTEREST'); end if;
    linked_item_id:=(result->>'linked_item_id')::bigint;
    if linked_item_id is null then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;
    update public.fatura_itens i
      set valor=round(i.valor+interest_amount,2)
      where i.id=linked_item_id and i.user_id=caller and not i.pago;
    get diagnostics changed=row_count;
    if changed<>1 then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;
    result:=result||jsonb_build_object(
      'remaining',round(remaining_amount+interest_amount,2),
      'interest',interest_amount
    );
  end if;

  v_payment_transaction_id:=(result->>'payment_transaction_id')::bigint;
  update private.ai_invoice_payment_ledger l
  set source='manual',request_id=p_request_id,operation_result=result
  where l.payment_transaction_id=v_payment_transaction_id and l.user_id=caller;
  get diagnostics changed=row_count;
  if changed<>1 then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;

  return result||jsonb_build_object('source','manual','replayed',false);
end;
$$;


ALTER FUNCTION "public"."finance_pay_invoice"("p_card_id" bigint, "p_invoice_month" "text", "p_account_id" bigint, "p_payment_amount" numeric, "p_remainder_mode" "text", "p_interest_value" numeric, "p_interest_percent" numeric, "p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finance_reverse_invoice_payment"("p_transaction_id" bigint, "p_request_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid:=private.ai_assert_authenticated();
  existing private.ai_invoice_payment_ledger%rowtype;
  prepared jsonb;
  result jsonb;
  changed integer;
begin
  if p_request_id is null then perform private.ai_fail('AI_INVALID_REQUEST_ID'); end if;
  perform pg_advisory_xact_lock(hashtext(caller::text),hashtext(p_request_id::text));

  select * into existing
  from private.ai_invoice_payment_ledger l
  where l.user_id=caller and l.reversal_request_id=p_request_id
  for update;
  if found then
    return coalesce(existing.reversal_result,'{}'::jsonb)||jsonb_build_object(
      'payment_transaction_id',existing.payment_transaction_id,
      'card_id',coalesce(existing.card_id,(existing.reversal_result->>'card_id')::bigint),
      'invoice_month',existing.invoice_month,
      'source',existing.source,
      'reversed',true,
      'replayed',true
    );
  end if;

  prepared:=private.ai_prepare_action(
    caller,'reverse_invoice_payment',jsonb_build_object('transaction_id',p_transaction_id)
  );
  result:=private.finance_execute_invoice_action(
    caller,'reverse_invoice_payment',prepared->'payload',null
  );

  update private.ai_invoice_payment_ledger l
  set reversal_request_id=p_request_id,reversal_result=result
  where l.payment_transaction_id=p_transaction_id and l.user_id=caller
    and l.reversed_at is not null;
  get diagnostics changed=row_count;
  if changed<>1 then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;
  select * into existing
  from private.ai_invoice_payment_ledger l
  where l.user_id=caller and l.payment_transaction_id=p_transaction_id;
  if not found then perform private.ai_fail('AI_INVOICE_LEDGER_WRITE_FAILED'); end if;
  return result||jsonb_build_object('source',existing.source,'replayed',false);
end;
$$;


ALTER FUNCTION "public"."finance_reverse_invoice_payment"("p_transaction_id" bigint, "p_request_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finflow_cleanup_ai_retention"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  chat_cutoff timestamptz:=clock_timestamp()-interval '24 hours';
  action_cutoff timestamptz:=clock_timestamp()-interval '30 days';
  usage_cutoff timestamptz:=clock_timestamp()-interval '90 days';
  deleted_messages bigint:=0;
  deleted_conversations bigint:=0;
  deleted_actions bigint:=0;
  deleted_audit bigint:=0;
  deleted_usage bigint:=0;
begin
  delete from public.ai_action_audit
  where created_at<action_cutoff;
  get diagnostics deleted_audit=row_count;

  delete from public.ai_pending_actions
  where updated_at<action_cutoff;
  get diagnostics deleted_actions=row_count;

  delete from public.ai_messages
  where created_at<chat_cutoff;
  get diagnostics deleted_messages=row_count;

  delete from public.ai_conversations c
  where c.updated_at<chat_cutoff
    and not exists(
      select 1 from public.ai_messages m
      where m.conversation_id=c.id and m.created_at>=chat_cutoff
    );
  get diagnostics deleted_conversations=row_count;

  delete from public.ai_request_usage
  where created_at<usage_cutoff;
  get diagnostics deleted_usage=row_count;

  return jsonb_build_object(
    'deleted_messages',deleted_messages,
    'deleted_conversations',deleted_conversations,
    'deleted_actions',deleted_actions,
    'deleted_audit',deleted_audit,
    'deleted_usage',deleted_usage
  );
end;
$$;


ALTER FUNCTION "public"."finflow_cleanup_ai_retention"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finflow_cleanup_cron_job_run_details"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  deleted_runs bigint := 0;
begin
  delete from cron.job_run_details
  where end_time < clock_timestamp() - interval '14 days';
  get diagnostics deleted_runs = row_count;

  return jsonb_build_object('deleted_job_run_details', deleted_runs);
end;
$$;


ALTER FUNCTION "public"."finflow_cleanup_cron_job_run_details"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finflow_cleanup_external_edge_retention"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  deleted_events bigint := 0;
  deleted_limits bigint := 0;
begin
  delete from public.subscription_events
  where (
      processed_at is not null
      and processed_at < clock_timestamp() - interval '180 days'
    ) or (
      processed_at is null
      and created_at < clock_timestamp() - interval '30 days'
      and coalesce(processing_locked_until, '-infinity'::timestamptz) <= clock_timestamp()
    );
  get diagnostics deleted_events = row_count;

  delete from private.edge_rate_limits
  where last_attempt_at < clock_timestamp() - interval '8 days';
  get diagnostics deleted_limits = row_count;

  return jsonb_build_object(
    'deleted_subscription_events', deleted_events,
    'deleted_edge_rate_limits', deleted_limits
  );
end;
$$;


ALTER FUNCTION "public"."finflow_cleanup_external_edge_retention"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finflow_cleanup_stale_phone_changes"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  affected integer;
begin
  delete from private.phone_verification_reservations
  where expires_at <= now();

  update auth.users
  set phone_change = '',
      phone_change_token = '',
      phone_change_sent_at = null
  where coalesce(phone_change, '') <> ''
    and phone_change_sent_at is not null
    and phone_change_sent_at < now() - interval '20 minutes';

  get diagnostics affected = row_count;
  return affected;
end;
$$;


ALTER FUNCTION "public"."finflow_cleanup_stale_phone_changes"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finflow_transaction_has_payment_history"("p_transaction_id" bigint) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."finflow_transaction_has_payment_history"("p_transaction_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_bank_reconciliation_adjustment"("p_transaction_id" bigint) RETURNS TABLE("scheduled_amount" numeric, "interest_amount" numeric, "entry_amount" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select r.scheduled_amount,r.interest_amount,r.entry_amount
  from private.bank_reconciliation_receipts r
  join public.transacoes t on t.id=r.transaction_id
  where r.transaction_id=p_transaction_id and r.user_id=auth.uid()
    and (t.user_id=auth.uid() or public.is_parceiro(t.user_id,auth.uid()))
    and r.interest_amount is not null
  order by r.id desc limit 1;
$$;


ALTER FUNCTION "public"."get_bank_reconciliation_adjustment"("p_transaction_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_meu_resumo_dissolucao"() RETURNS TABLE("resumo_id" bigint, "parceria_id" bigint, "iniciada_por" "uuid", "criado_em" timestamp with time zone, "itens" "jsonb")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT
    r.id,
    r.parceria_id,
    r.iniciada_por,
    r.created_at,
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'tipo', i.tipo,
          'source_id', i.source_id,
          'source_owner_id', i.source_owner_id,
          'nome', i.nome,
          'saldo_final', i.saldo_final,
          'possui_lancamentos', i.possui_lancamentos,
          'estado', i.estado
        )
        ORDER BY CASE WHEN i.tipo = 'conta' THEN 0 ELSE 1 END, i.id
      )
      FROM public.parceria_dissolucao_itens i
      WHERE i.resumo_id = r.id
    ), '[]'::jsonb)
  FROM public.parceria_dissolucao_resumos r
  WHERE r.user_id = (SELECT auth.uid())
    AND r.visto_em IS NULL
  ORDER BY r.created_at, r.id
  LIMIT 1;
$$;


ALTER FUNCTION "public"."get_meu_resumo_dissolucao"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_minhas_decisoes_caixinha"() RETURNS TABLE("id" bigint, "nome" "text", "meta_valor" numeric, "saldo_total" numeric, "saldo_disponivel" numeric, "cor" "text", "icone" "text", "data_prazo" "date")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT
    d.id,
    d.nome,
    d.meta_valor,
    d.saldo_total,
    greatest(
      0,
      d.saldo_total - coalesce((
        SELECT sum(outra.saldo_definido)
        FROM public.parceria_caixinha_decisoes outra
        WHERE outra.parceria_id = d.parceria_id
          AND outra.source_caixinha_id = d.source_caixinha_id
          AND outra.user_id <> d.user_id
          AND outra.status = 'mantida'
      ), 0)
    ) AS saldo_disponivel,
    d.cor,
    d.icone,
    d.data_prazo
  FROM public.parceria_caixinha_decisoes d
  WHERE d.user_id = (SELECT auth.uid())
    AND d.status = 'pendente'
  ORDER BY d.created_at, d.id;
$$;


ALTER FUNCTION "public"."get_minhas_decisoes_caixinha"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_minhas_decisoes_conta_dissolucao"() RETURNS TABLE("id" bigint, "nome" "text", "saldo_final" numeric, "possui_lancamentos" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  SELECT i.id, i.nome, i.saldo_final, i.possui_lancamentos
  FROM public.parceria_dissolucao_itens i
  JOIN public.parceria_dissolucao_resumos r ON r.id = i.resumo_id
  WHERE r.user_id = (SELECT auth.uid())
    AND i.tipo = 'conta'
    AND i.estado = 'pendente'
    AND i.target_conta_id IS NOT NULL
  ORDER BY r.created_at, i.id;
$$;


ALTER FUNCTION "public"."get_minhas_decisoes_conta_dissolucao"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_entitlement"() RETURNS TABLE("plan" "text", "subscription_status" "text", "billing_cycle" "text", "provider" "text", "access_until" timestamp with time zone, "billing_enabled" boolean, "limits_enabled" boolean)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with settings as (
    select bs.billing_enabled, bs.limits_enabled
    from public.billing_settings bs where bs.id = true
  ), current_subscription as (
    select s.plan, s.status, s.billing_cycle, s.provider, s.access_until
    from public.subscriptions s
    where s.user_id = (select auth.uid()) and (
      s.status in ('active', 'trialing', 'grace_period')
      or (s.status = 'cancelled' and s.access_until > now())
    )
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc,
      s.access_until desc nulls last limit 1
  )
  select coalesce(cs.plan, 'free')::text, coalesce(cs.status, 'none')::text,
    cs.billing_cycle, cs.provider, cs.access_until,
    coalesce(st.billing_enabled, false), coalesce(st.limits_enabled, false)
  from settings st left join current_subscription cs on true;
$$;


ALTER FUNCTION "public"."get_my_entitlement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_plan_usage"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller uuid := auth.uid(); plan_name text; month_start date := pg_catalog.date_trunc('month', pg_catalog.current_date)::date;
begin
  if caller is null then raise exception using errcode = '42501', message = 'authentication required'; end if;
  plan_name := private.finflow_plan_for_user(caller);
  return pg_catalog.jsonb_build_object(
    'plan', plan_name,
    'limits', case plan_name when 'premium' then pg_catalog.jsonb_build_object('transactions',null,'accounts',null,'cards',null,'goals',null,'categories_per_type',null)
      when 'smart' then pg_catalog.jsonb_build_object('transactions',150,'accounts',5,'cards',3,'goals',3,'categories_per_type',14)
      else pg_catalog.jsonb_build_object('transactions',40,'accounts',2,'cards',1,'goals',1,'categories_per_type',7) end,
    'usage', pg_catalog.jsonb_build_object(
      'transactions', (select pg_catalog.count(*) from public.transacoes t where t.user_id=caller and t.transacao_pai_id is null and coalesce(t.descricao,'') not like '%[PagFatura:%' and t.data_vencimento >= month_start and t.data_vencimento < month_start + interval '1 month') + (select pg_catalog.count(*) from public.fatura_itens i where i.user_id=caller and i.categoria_id is not null and i.mes_fatura=pg_catalog.to_char(month_start,'YYYY-MM')),
      'accounts', private.finflow_account_usage(caller),
      'cards', (select pg_catalog.count(*) from public.cartoes c where c.user_id=caller and coalesce(c.ativo,true)),
      'goals', (select pg_catalog.count(*) from public.caixinhas g where g.user_id=caller and not coalesce(g.arquivado,false))
    ));
end;
$$;


ALTER FUNCTION "public"."get_my_plan_usage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_transaction_payment_history"("p_transaction_id" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare caller uuid:=auth.uid(); root_id bigint; summary_value jsonb; payments_value jsonb;
begin
  if caller is null then raise exception using errcode='42501',message='TRANSACTION_AUTH_REQUIRED'; end if;
  select coalesce(t.transacao_pai_id,t.id) into root_id from public.transacoes t where t.id=p_transaction_id;
  if not found then raise exception using errcode='P0001',message='TRANSACTION_NOT_FOUND'; end if;
  perform private.ai_assert_transaction(caller,root_id);
  select to_jsonb(s) into summary_value from public.list_transaction_payment_summaries(array[root_id]) s;
  select coalesce(jsonb_agg(jsonb_build_object('payment_id',p.id,'payment_sequence',p.payment_sequence,'transaction_id',p.payment_transaction_id,'value',p.realized_value,'realization_date',p.realization_date,'adjustment_type',p.adjustment_type,'adjustment_value',p.adjustment_value,'active',p.reopened_at is null,'reopened_at',p.reopened_at,'created_at',p.created_at,'reconciled',p.reopened_at is null and (exists(select 1 from private.bank_reconciliation_receipts br where br.user_id=caller and br.payment_id=p.id) or exists(select 1 from private.bank_reconciliation_transactions rt join private.bank_reconciliation_receipts br on br.id=rt.receipt_id where br.user_id=caller and rt.payment_id=p.id))) order by p.payment_sequence,p.created_at,p.id),'[]'::jsonb)
  into payments_value from private.transaction_completion_receipts p where p.root_transaction_id=root_id;
  return jsonb_build_object('ok',true,'summary',summary_value,'payments',payments_value);
end; $$;


ALTER FUNCTION "public"."get_transaction_payment_history"("p_transaction_id" bigint) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_transaction_payment_history"("p_transaction_id" bigint) IS 'Retorna o historico de baixas e o estado individual de conciliacao sem expor dados do extrato.';



CREATE OR REPLACE FUNCTION "public"."get_user_name"("user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select coalesce(
    u.raw_user_meta_data ->> 'nome_usuario',
    u.raw_user_meta_data ->> 'full_name',
    'Parceiro(a)'
  )
  from auth.users u
  where u.id = user_id
    and (
      u.id = (select auth.uid())
      or public.is_parceiro(u.id, (select auth.uid()))
    );
$$;


ALTER FUNCTION "public"."get_user_name"("user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ignore_bank_statement_entries"("p_account_id" bigint, "p_entries" "jsonb", "p_expected_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."ignore_bank_statement_entries"("p_account_id" bigint, "p_entries" "jsonb", "p_expected_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ignore_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid := auth.uid();
  receipt private.bank_reconciliation_receipts%rowtype;
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_account_id is null or p_entry_fingerprint !~ '^[0-9a-f]{64}$' or p_entry_date is null
    or p_entry_type not in ('receita','despesa') or p_entry_amount<=0 or p_idempotency_key is null then
    raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY';
  end if;
  if not exists(select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
    and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))) then
    raise exception using errcode='42501',message='RECONCILIATION_ACCOUNT_DENIED';
  end if;
  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,
    entry_type,entry_amount,reconciliation_mode,transaction_id,idempotency_key)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    'ignored',null,p_idempotency_key)
  on conflict(user_id,account_id,entry_fingerprint) do nothing;
  select * into receipt from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  return jsonb_build_object('ok',true,'receipt_id',receipt.id,'ignored',receipt.reconciliation_mode='ignored');
end;
$_$;


ALTER FUNCTION "public"."ignore_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."iniciar_dissolucao_parceria"("p_parceria_id" bigint) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
  v_uid UUID := auth.uid();
  v_parceria public.parcerias%ROWTYPE;
  v_decisoes INTEGER := 0;
  v_resumo_solicitante BIGINT;
  v_resumo_convidado BIGINT;
  v_resumo_atual BIGINT;
  v_participante UUID;
  v_conta RECORD;
  v_saldo_pessoal NUMERIC;
  v_possui_lancamentos BOOLEAN;
  v_target_conta_id BIGINT;
  v_estado TEXT;
  v_arquivar BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  SELECT *
    INTO v_parceria
    FROM public.parcerias
   WHERE id = p_parceria_id
     AND status = 'aceito'
     AND (solicitante_id = v_uid OR convidado_id = v_uid)
   FOR UPDATE;

  IF NOT FOUND OR v_parceria.convidado_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'active partnership not found';
  END IF;

  INSERT INTO public.parceria_dissolucao_resumos (
    parceria_id, user_id, iniciada_por
  ) VALUES (
    v_parceria.id, v_parceria.solicitante_id, v_uid
  )
  RETURNING id INTO v_resumo_solicitante;

  INSERT INTO public.parceria_dissolucao_resumos (
    parceria_id, user_id, iniciada_por
  ) VALUES (
    v_parceria.id, v_parceria.convidado_id, v_uid
  )
  RETURNING id INTO v_resumo_convidado;

  -- Separa cada conta por participante. O saldo inicial pertence ao criador;
  -- receitas, despesas e transferências pertencem ao user_id do lançamento.
  FOR v_conta IN
    SELECT c.id, c.user_id, c.nome, c.saldo_inicial, c.cor
    FROM public.contas c
    WHERE c.compartilhado IS TRUE
      AND c.user_id IN (v_parceria.solicitante_id, v_parceria.convidado_id)
    ORDER BY c.id
    FOR UPDATE
  LOOP
    FOREACH v_participante IN ARRAY ARRAY[
      v_parceria.solicitante_id,
      v_parceria.convidado_id
    ]
    LOOP
      v_resumo_atual := CASE
        WHEN v_participante = v_parceria.solicitante_id THEN v_resumo_solicitante
        ELSE v_resumo_convidado
      END;

      SELECT
        (CASE WHEN v_participante = v_conta.user_id
          THEN COALESCE(v_conta.saldo_inicial, 0)
          ELSE 0
        END)
        + COALESCE((
          SELECT sum(
            CASE
              WHEN t.tipo = 'receita' THEN COALESCE(t.valor, 0)
              WHEN t.tipo = 'despesa' THEN -COALESCE(t.valor, 0)
              ELSE 0
            END
          )
          FROM public.transacoes t
          WHERE t.user_id = v_participante
            AND t.conta_id = v_conta.id
            AND t.status = 'paga'
        ), 0)
        + COALESCE((
          SELECT sum(COALESCE(t.valor, 0))
          FROM public.transacoes t
          WHERE t.user_id = v_participante
            AND t.status = 'paga'
            AND substring(COALESCE(t.descricao, '') FROM '\[Destino:([0-9]+)\]\s*$') = v_conta.id::text
        ), 0),
        EXISTS (
          SELECT 1
          FROM public.transacoes t
          WHERE t.user_id = v_participante
            AND (
              t.conta_id = v_conta.id
              OR substring(COALESCE(t.descricao, '') FROM '\[Destino:([0-9]+)\]\s*$') = v_conta.id::text
            )
        )
      INTO v_saldo_pessoal, v_possui_lancamentos;

      v_target_conta_id := NULL;
      v_estado := 'removida';

      IF v_participante = v_conta.user_id THEN
        v_target_conta_id := v_conta.id;
      ELSIF v_possui_lancamentos OR abs(v_saldo_pessoal) > 0.005 THEN
        INSERT INTO public.contas (
          nome, saldo_inicial, user_id, compartilhado, cor, arquivado
        ) VALUES (
          v_conta.nome, 0, v_participante, false, COALESCE(v_conta.cor, '#16966E'),
          v_possui_lancamentos
        )
        RETURNING id INTO v_target_conta_id;
      END IF;

      IF v_target_conta_id IS NOT NULL THEN
        IF v_possui_lancamentos THEN
          v_estado := 'pendente';
          v_arquivar := true;
        ELSIF abs(v_saldo_pessoal) > 0.005 THEN
          v_estado := 'mantida';
          v_arquivar := false;
        ELSE
          v_estado := 'removida';
          v_arquivar := true;
        END IF;

        UPDATE public.contas
           SET compartilhado = false,
               arquivado = v_arquivar
         WHERE id = v_target_conta_id
           AND user_id = v_participante;
      END IF;

      INSERT INTO public.parceria_dissolucao_itens (
        resumo_id, tipo, source_id, target_conta_id, source_owner_id,
        nome, saldo_final, possui_lancamentos, estado
      ) VALUES (
        v_resumo_atual, 'conta', v_conta.id, v_target_conta_id,
        v_conta.user_id, v_conta.nome, v_saldo_pessoal,
        v_possui_lancamentos, v_estado
      );
    END LOOP;
  END LOOP;

  -- Move cada lançamento para a conta individual do próprio autor. O mapa
  -- também inclui a conta original do criador, portanto nenhum caso especial é
  -- necessário aqui.
  UPDATE public.transacoes t
     SET conta_id = i.target_conta_id
    FROM public.parceria_dissolucao_itens i
    JOIN public.parceria_dissolucao_resumos r ON r.id = i.resumo_id
   WHERE r.parceria_id = v_parceria.id
     AND r.user_id = t.user_id
     AND i.tipo = 'conta'
     AND i.source_id = t.conta_id
     AND i.target_conta_id IS NOT NULL
     AND t.conta_id IS DISTINCT FROM i.target_conta_id;

  -- Atualiza o destino das transferências com o mesmo mapa old -> target do
  -- autor, preservando transferências entre várias contas que foram clonadas.
  UPDATE public.transacoes t
     SET descricao = regexp_replace(
       t.descricao,
       '\[Destino:[0-9]+\]\s*$',
       format('[Destino:%s]', i.target_conta_id)
     )
    FROM public.parceria_dissolucao_itens i
    JOIN public.parceria_dissolucao_resumos r ON r.id = i.resumo_id
   WHERE r.parceria_id = v_parceria.id
     AND r.user_id = t.user_id
     AND i.tipo = 'conta'
     AND i.target_conta_id IS NOT NULL
     AND substring(COALESCE(t.descricao, '') FROM '\[Destino:([0-9]+)\]\s*$') = i.source_id::text;

  -- Zero sem lancamentos deve sumir das listas do participante, inclusive do
  -- hub de arquivadas, mas o registro continua recuperavel no banco. O mapa e
  -- gravado somente quando a conta-alvo realmente pertence ao destinatario do
  -- resumo; assim a ocultacao nunca vaza de um participante para o outro.
  INSERT INTO public.contas_ocultas_usuario (
    conta_id, user_id, resumo_id, motivo
  )
  SELECT
    i.target_conta_id,
    r.user_id,
    r.id,
    'dissolucao_parceria'
  FROM public.parceria_dissolucao_itens i
  JOIN public.parceria_dissolucao_resumos r ON r.id = i.resumo_id
  JOIN public.contas c
    ON c.id = i.target_conta_id
   AND c.user_id = r.user_id
  WHERE r.parceria_id = v_parceria.id
    AND i.tipo = 'conta'
    AND i.estado = 'removida'
    AND i.target_conta_id IS NOT NULL
  ON CONFLICT (conta_id, user_id) DO NOTHING;

  -- Fotografia dos objetivos. A escolha do saldo individual continua sendo
  -- feita pelas decisões atômicas de parceria_caixinha_decisoes.
  WITH destinatarios(user_id, resumo_id) AS (
    VALUES
      (v_parceria.solicitante_id, v_resumo_solicitante),
      (v_parceria.convidado_id, v_resumo_convidado)
  )
  INSERT INTO public.parceria_dissolucao_itens (
    resumo_id, tipo, source_id, target_conta_id, source_owner_id,
    nome, saldo_final, possui_lancamentos, estado
  )
  SELECT
    d.resumo_id,
    'caixinha',
    c.id,
    NULL,
    c.user_id,
    c.nome,
    greatest(0, COALESCE(c.saldo_atual, 0)),
    false,
    'informativo'
  FROM public.caixinhas c
  CROSS JOIN destinatarios d
  WHERE c.compartilhado IS TRUE
    AND c.user_id IN (v_parceria.solicitante_id, v_parceria.convidado_id);

  INSERT INTO public.parceria_caixinha_decisoes (
    parceria_id,
    source_caixinha_id,
    user_id,
    source_owner_id,
    nome,
    meta_valor,
    saldo_total,
    cor,
    icone,
    data_prazo
  )
  SELECT
    v_parceria.id,
    c.id,
    participante.user_id,
    c.user_id,
    c.nome,
    c.meta_valor,
    greatest(0, COALESCE(c.saldo_atual, 0)),
    c.cor,
    c.icone,
    c.data_prazo
  FROM public.caixinhas c
  CROSS JOIN LATERAL (
    VALUES (v_parceria.solicitante_id), (v_parceria.convidado_id)
  ) AS participante(user_id)
  WHERE c.compartilhado IS TRUE
    AND c.user_id IN (v_parceria.solicitante_id, v_parceria.convidado_id)
  ON CONFLICT (parceria_id, source_caixinha_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_decisoes = ROW_COUNT;

  UPDATE public.caixinhas
     SET compartilhado = false,
         arquivado = true
   WHERE compartilhado IS TRUE
     AND user_id IN (v_parceria.solicitante_id, v_parceria.convidado_id);

  DELETE FROM public.parcerias WHERE id = v_parceria.id;

  RETURN v_decisoes;
END;
$_$;


ALTER FUNCTION "public"."iniciar_dissolucao_parceria"("p_parceria_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_parceiro"("dono" "uuid", "visitante" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select
    (select auth.uid()) is not null
    and visitante = (select auth.uid())
    and exists (
      select 1
      from public.parcerias p
      where p.status = 'aceito'
        and (
          (p.solicitante_id = dono and p.convidado_id = visitante)
          or
          (p.solicitante_id = visitante and p.convidado_id = dono)
        )
    );
$$;


ALTER FUNCTION "public"."is_parceiro"("dono" "uuid", "visitante" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."limpar_minhas_notificacoes_sistema_expiradas"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_removidas INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  DELETE FROM public.notificacoes_sistema
   WHERE destinatario_id = v_uid
     AND expira_em <= now();
  GET DIAGNOSTICS v_removidas = ROW_COUNT;
  RETURN v_removidas;
END;
$$;


ALTER FUNCTION "public"."limpar_minhas_notificacoes_sistema_expiradas"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."link_completed_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."link_completed_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."link_completed_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) IS 'Vincula uma linha de extrato a uma transação já concluída sem repetir a baixa financeira.';



CREATE OR REPLACE FUNCTION "public"."list_bank_reconciled_transaction_ids"() RETURNS TABLE("transaction_id" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select distinct linked.transaction_id
  from (
    select r.transaction_id
    from private.bank_reconciliation_receipts r
    where r.user_id=auth.uid() and r.transaction_id is not null
    union all
    select rt.transaction_id
    from private.bank_reconciliation_transactions rt
    join private.bank_reconciliation_receipts r on r.id=rt.receipt_id
    where r.user_id=auth.uid()
  ) linked
  where linked.transaction_id is not null
  order by linked.transaction_id;
$$;


ALTER FUNCTION "public"."list_bank_reconciled_transaction_ids"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_bank_reconciliation_fingerprints"() RETURNS TABLE("account_id" bigint, "entry_fingerprint" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select r.account_id, r.entry_fingerprint
  from private.bank_reconciliation_receipts r
  where r.user_id = auth.uid()
  order by r.id;
$$;


ALTER FUNCTION "public"."list_bank_reconciliation_fingerprints"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_bank_reconciliation_progress"() RETURNS TABLE("receipt_id" bigint, "account_id" bigint, "entry_fingerprint" "text", "entry_amount" numeric, "reconciled_amount" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select r.id,r.account_id,r.entry_fingerprint,r.entry_amount,
    case when exists (select 1 from private.bank_reconciliation_transactions x where x.receipt_id=r.id)
      then coalesce((select round(sum(x.amount),2) from private.bank_reconciliation_transactions x where x.receipt_id=r.id),0)
      else r.entry_amount end
  from private.bank_reconciliation_receipts r where r.user_id=auth.uid() order by r.id;
$$;


ALTER FUNCTION "public"."list_bank_reconciliation_progress"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_pending_bank_transfer_counterparts"() RETURNS TABLE("transaction_id" bigint, "account_id" bigint, "entry_type" "text", "description" "text", "due_date" "date", "amount" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  with reconciled as (
    select r.transaction_id, min(r.account_id) as reconciled_account, count(*) as side_count
    from private.bank_reconciliation_receipts r
    where r.user_id=auth.uid() and r.transaction_id is not null
    group by r.transaction_id
  ), transfers as (
    select t.*, nullif((regexp_match(t.descricao,'\[Destino:([0-9]+)\]'))[1],'')::bigint as destination_id
    from public.transacoes t join reconciled r on r.transaction_id=t.id and r.side_count=1
    where t.status='paga' and t.transacao_pai_id is null and coalesce(t.descricao,'') like '[Transf.]%'
  )
  select t.id,
    case when r.reconciled_account=t.conta_id then t.destination_id else t.conta_id end,
    case when r.reconciled_account=t.conta_id then 'receita' else 'despesa' end,
    t.descricao,t.data_vencimento,t.valor
  from transfers t join reconciled r on r.transaction_id=t.id
  where t.destination_id is not null
    and r.reconciled_account in (t.conta_id,t.destination_id)
    and exists(select 1 from public.contas c
      where c.id=case when r.reconciled_account=t.conta_id then t.destination_id else t.conta_id end
      and not coalesce(c.arquivado,false)
      and (c.user_id=auth.uid() or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,auth.uid()))));
$$;


ALTER FUNCTION "public"."list_pending_bank_transfer_counterparts"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_transaction_payment_summaries"("p_transaction_ids" bigint[]) RETURNS TABLE("root_transaction_id" bigint, "display_transaction_id" bigint, "current_pending_transaction_id" bigint, "last_paid_transaction_id" bigint, "technical_transaction_ids" bigint[], "total_value" numeric, "paid_total" numeric, "remaining_value" numeric, "is_fully_paid" boolean, "payment_count" integer, "scheduled_date" "date", "last_realization_date" "date")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."list_transaction_payment_summaries"("p_transaction_ids" bigint[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."list_transaction_payment_summaries"("p_transaction_ids" bigint[]) IS 'Resume pagamentos agrupados sem expor o ledger privado e sem N+1.';



CREATE OR REPLACE FUNCTION "public"."marcar_notificacao_sistema_lida"("p_id" bigint) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_atualizadas INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  UPDATE public.notificacoes_sistema
     SET lida_em = COALESCE(lida_em, now())
   WHERE id = p_id
     AND destinatario_id = v_uid;

  GET DIAGNOSTICS v_atualizadas = ROW_COUNT;
  RETURN v_atualizadas = 1;
END;
$$;


ALTER FUNCTION "public"."marcar_notificacao_sistema_lida"("p_id" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notificar_encerramento_parceria"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_ator UUID := auth.uid();
  v_ator_nome TEXT;
  v_destinatario UUID;
BEGIN
  IF OLD.status <> 'aceito' OR OLD.convidado_id IS NULL THEN
    RETURN OLD;
  END IF;

  SELECT COALESCE(
           NULLIF(btrim(u.raw_user_meta_data ->> 'nome_usuario'), ''),
           NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
           split_part(COALESCE(u.email, ''), '@', 1),
           'Seu parceiro'
         )
    INTO v_ator_nome
    FROM auth.users u
   WHERE u.id = v_ator;

  FOREACH v_destinatario IN ARRAY ARRAY[OLD.solicitante_id, OLD.convidado_id]
  LOOP
    CONTINUE WHEN v_ator IS NOT NULL AND v_destinatario = v_ator;

    INSERT INTO public.notificacoes_sistema (
      destinatario_id, tipo, referencia_id, titulo, mensagem, dados, expira_em
    ) VALUES (
      v_destinatario,
      'parceria_encerrada',
      OLD.id,
      'Parceria encerrada',
      format('%s encerrou a parceria. Os recursos compartilhados foram separados com segurança.', COALESCE(v_ator_nome, 'Seu parceiro')),
      jsonb_build_object('parceria_id', OLD.id, 'encerrada_por', v_ator),
      now() + interval '5 days'
    )
    ON CONFLICT (destinatario_id, tipo, referencia_id) DO NOTHING;
  END LOOP;

  RETURN OLD;
END;
$$;


ALTER FUNCTION "public"."notificar_encerramento_parceria"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preserve_finflow_row_identity"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin
  if tg_table_name = 'parcerias' then
    if new.id is distinct from old.id
       or new.solicitante_id is distinct from old.solicitante_id
       or lower(new.convidado_email) is distinct from lower(old.convidado_email) then
      raise exception using errcode = '42501', message = 'partnership identity cannot be changed';
    end if;
  elsif new.user_id is distinct from old.user_id then
    raise exception using errcode = '42501', message = 'resource owner cannot be changed';
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."preserve_finflow_row_identity"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_bank_goal_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid := auth.uid();
  transaction_row public.transacoes%rowtype;
  existing private.bank_reconciliation_receipts%rowtype;
  action_result jsonb;
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

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text||':'||p_account_id::text||':'||p_entry_fingerprint,82901)
  );
  select * into existing from private.bank_reconciliation_receipts r
  where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;

  select * into transaction_row from public.transacoes t
  where t.id=p_transaction_id and t.transacao_pai_id is null and t.status='pendente'
    and t.conta_id=p_account_id and t.tipo=p_entry_type
    and coalesce(t.descricao,'') ~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]'
  for update;
  if not found then raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  if round(p_entry_amount,2)<>round(transaction_row.valor,2) then
    raise exception using errcode='22023', message='RECONCILIATION_GOAL_REQUIRES_EXACT_VALUE';
  end if;
  if not exists (
    select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
      and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))
  ) then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;

  action_result := public.execute_manual_financial_action(
    'complete_transaction',
    jsonb_build_object(
      'transaction_id',transaction_row.id,
      'realization_date',p_entry_date::text,
      'expected_value',transaction_row.valor,
      'realized_value',transaction_row.valor
    ),
    p_idempotency_key,caller,p_client_created_at
  );
  if action_result is null or action_result->>'ok'<>'true' then
    raise exception using errcode='P0001', message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
  end if;

  insert into private.bank_reconciliation_receipts(
    user_id,account_id,entry_fingerprint,entry_date,entry_type,entry_amount,
    reconciliation_mode,transaction_id,idempotency_key
  ) values (
    caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,
    round(p_entry_amount,2),'existing',transaction_row.id,p_idempotency_key
  ) returning * into existing;

  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',existing.id,
    'transaction_id',transaction_row.id,'result',action_result);
end;
$_$;


ALTER FUNCTION "public"."reconcile_bank_goal_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_bank_invoice_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_amount" numeric, "p_card_id" bigint, "p_invoice_month" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid := auth.uid();
  existing private.bank_reconciliation_receipts%rowtype;
  invoice_total numeric;
  payment_result jsonb;
  payment_transaction_id bigint;
  payment_mode text;
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
     or p_entry_amount is null or p_entry_amount <= 0 or p_entry_amount > 999999999999.99
     or p_invoice_month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_ENTRY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text||':'||p_account_id::text||':'||p_entry_fingerprint,82901)
  );
  select * into existing from private.bank_reconciliation_receipts r
   where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;

  if not exists (
    select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
      and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))
  ) then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;
  if not exists (
    select 1 from public.cartoes c where c.id=p_card_id and c.user_id=caller and coalesce(c.ativo,true)
  ) then raise exception using errcode='22023', message='RECONCILIATION_INVOICE_UNAVAILABLE'; end if;

  perform 1 from public.fatura_itens i
   where i.user_id=caller and i.cartao_id=p_card_id and i.mes_fatura=p_invoice_month and not i.pago
   order by i.id for update;
  select round(coalesce(sum(i.valor),0),2) into invoice_total
    from public.fatura_itens i
   where i.user_id=caller and i.cartao_id=p_card_id and i.mes_fatura=p_invoice_month and not i.pago;
  if invoice_total <= 0 or round(p_entry_amount,2) > invoice_total then
    raise exception using errcode='22023', message='RECONCILIATION_INVOICE_AMOUNT_MISMATCH';
  end if;

  payment_mode := case when round(p_entry_amount,2)=invoice_total then 'full' else 'keep_open' end;
  payment_result := public.finance_pay_invoice(
    p_card_id,p_invoice_month,p_account_id,round(p_entry_amount,2),payment_mode,null,null,p_idempotency_key
  );
  payment_transaction_id := (payment_result->>'payment_transaction_id')::bigint;
  if payment_transaction_id is null then
    raise exception using errcode='P0001', message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
  end if;

  -- A data financeira deve ser a data efetiva do banco, não o dia da importação.
  update public.transacoes set data_vencimento=p_entry_date,data_realizacao=p_entry_date
   where id=payment_transaction_id and user_id=caller;

  insert into private.bank_reconciliation_receipts(
    user_id,account_id,entry_fingerprint,entry_date,entry_type,entry_amount,
    reconciliation_mode,transaction_id,idempotency_key
  ) values (
    caller,p_account_id,p_entry_fingerprint,p_entry_date,'despesa',round(p_entry_amount,2),
    'existing',payment_transaction_id,p_idempotency_key
  ) returning * into existing;

  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',existing.id,
    'transaction_id',payment_transaction_id,'result',payment_result);
end;
$_$;


ALTER FUNCTION "public"."reconcile_bank_invoice_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_amount" numeric, "p_card_id" bigint, "p_invoice_month" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_bank_statement_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_ids" bigint[], "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid := auth.uid();
  existing private.bank_reconciliation_receipts%rowtype;
  receipt private.bank_reconciliation_receipts%rowtype;
  transaction_row public.transacoes%rowtype;
  transaction_id bigint;
  normalized_ids bigint[];
  selected_total numeric(20,2);
  completion_key uuid;
  completion_hash text;
  action_result jsonb;
  completed_ids bigint[] := '{}';
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

  select array_agg(id order by id) into normalized_ids
  from (select distinct unnest(p_transaction_ids) as id) selected;
  if coalesce(cardinality(normalized_ids),0) < 2 or cardinality(normalized_ids) > 50
     or array_position(normalized_ids,null) is not null then
    raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_REQUIRED';
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

  perform 1 from public.transacoes t where t.id=any(normalized_ids) order by t.id for update;
  if (select count(*) from public.transacoes t where t.id=any(normalized_ids)) <> cardinality(normalized_ids)
     or exists (
       select 1 from public.transacoes t where t.id=any(normalized_ids)
         and (t.transacao_pai_id is not null or t.status not in ('pendente','paga') or t.conta_id<>p_account_id
           or t.tipo<>p_entry_type
           or (t.categoria_id is null and coalesce(t.descricao,'') !~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]')
           or coalesce(t.descricao,'') ~ '\[(PagFatura:|Destino:)')
     ) then
    raise exception using errcode='22023', message='RECONCILIATION_MULTIPLE_NOT_SUPPORTED';
  end if;

  select round(sum(t.valor),2) into selected_total
  from public.transacoes t where t.id=any(normalized_ids);
  if selected_total is distinct from round(p_entry_amount,2) then
    raise exception using errcode='22023', message='RECONCILIATION_MULTIPLE_TOTAL_MISMATCH';
  end if;

  if exists (
    select 1 from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.account_id=p_account_id
      and (r.transaction_id=any(normalized_ids) or exists (
        select 1 from private.bank_reconciliation_transactions rt
        where rt.receipt_id=r.id and rt.transaction_id=any(normalized_ids)
      ))
  ) then
    raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE';
  end if;

  foreach transaction_id in array normalized_ids loop
    select * into transaction_row from public.transacoes t where t.id=transaction_id;
    if transaction_row.status='pendente' then
      completion_hash := md5(p_idempotency_key::text||':'||transaction_row.id::text);
      completion_key := (substr(completion_hash,1,8)||'-'||substr(completion_hash,9,4)||'-4'||
        substr(completion_hash,14,3)||'-8'||substr(completion_hash,18,3)||'-'||substr(completion_hash,21,12))::uuid;
      if coalesce(transaction_row.descricao,'') ~ '\[Objetivo:[0-9]+:(guardar|resgatar)\]' then
        action_result := public.execute_manual_financial_action(
          'complete_transaction',
          jsonb_build_object('transaction_id',transaction_row.id,'realization_date',p_entry_date::text,
            'expected_value',transaction_row.valor,'realized_value',transaction_row.valor),
          completion_key,caller,p_client_created_at
        );
      else
        action_result := public.complete_transaction_with_partial(
          transaction_row.id, transaction_row.valor, 'none', 0,
          transaction_row.valor, p_entry_date, completion_key
        );
      end if;
      if action_result is null or action_result->>'ok'<>'true' then
        raise exception using errcode='P0001', message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
      end if;
    end if;
    completed_ids := array_append(completed_ids,transaction_row.id);
  end loop;

  insert into private.bank_reconciliation_receipts(
    user_id,account_id,entry_fingerprint,entry_date,entry_type,entry_amount,
    reconciliation_mode,transaction_id,idempotency_key
  ) values (
    caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,
    round(p_entry_amount,2),'existing',null,p_idempotency_key
  ) returning * into receipt;

  insert into private.bank_reconciliation_transactions(receipt_id,transaction_id,amount)
  select receipt.id,t.id,round(t.valor,2) from public.transacoes t where t.id=any(normalized_ids);

  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',receipt.id,
    'transaction_ids',to_jsonb(completed_ids),'total',selected_total);
end;
$_$;


ALTER FUNCTION "public"."reconcile_bank_statement_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_ids" bigint[], "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid := auth.uid();
  account_row public.contas%rowtype;
  transaction_row public.transacoes%rowtype;
  existing private.bank_reconciliation_receipts%rowtype;
  action_result jsonb;
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
     or p_entry_type not in ('receita','despesa')
     or p_entry_amount is null or p_entry_amount <= 0 or p_entry_amount > 999999999999.99
     or p_mode not in ('existing','new') then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_ENTRY';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(caller::text || ':' || p_account_id::text || ':' || p_entry_fingerprint, 82901));
  select * into existing from private.bank_reconciliation_receipts r
  where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then
    return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id);
  end if;

  select * into account_row from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false) and (
    c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller))
  ) for update;
  if not found then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;

  if p_mode='existing' then
    if p_transaction_id is null then raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_REQUIRED'; end if;
    select * into transaction_row from public.transacoes t
    where t.id=p_transaction_id and t.transacao_pai_id is null and t.status='pendente'
      and t.conta_id=p_account_id and t.tipo=p_entry_type
      and t.categoria_id is not null
      and t.descricao !~ '\[(Destino:|Objetivo:|PagFatura:)'
      and not (t.descricao like '%[Transferencia]%' or t.descricao like '%[Transferência]%')
    for update;
    if not found then raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
    if p_entry_amount > transaction_row.valor then
      raise exception using errcode='22023', message='RECONCILIATION_AMOUNT_EXCEEDS_REMAINDER';
    end if;
    action_result := public.complete_transaction_with_partial(
      transaction_row.id,
      transaction_row.valor,
      'none',
      0,
      p_entry_amount,
      p_entry_date,
      p_idempotency_key
    );
    if action_result is null or action_result->>'ok' <> 'true' then
      raise exception using errcode='P0001', message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
    end if;
  else
    if p_category_id is null or not exists (
      select 1 from public.categorias c where c.id=p_category_id and c.user_id=caller
        and coalesce(c.ativa::integer,0)<>0 and c.tipo in (p_entry_type,'ambos')
    ) then raise exception using errcode='22023', message='RECONCILIATION_CATEGORY_INVALID'; end if;
    if p_description is null or length(trim(p_description))=0 or length(trim(p_description))>100 then
      raise exception using errcode='22023', message='RECONCILIATION_DESCRIPTION_INVALID';
    end if;
    action_result := public.execute_manual_financial_action(
      'create_transaction',
      jsonb_build_object(
        'type',p_entry_type,'value',round(p_entry_amount,2),'description',trim(p_description),
        'status','paga','scheduled_date',p_entry_date::text,'realization_date',p_entry_date::text,
        'account_id',p_account_id,'category_id',p_category_id,'frequency','unica'
      ),
      p_idempotency_key,
      caller,
      p_client_created_at
    );
    if action_result is null or action_result->>'ok' <> 'true' then
      raise exception using errcode='P0001', message='RECONCILIATION_CREATION_NOT_CONFIRMED';
    end if;
  end if;

  insert into private.bank_reconciliation_receipts(
    user_id,account_id,entry_fingerprint,entry_date,entry_type,entry_amount,
    reconciliation_mode,transaction_id,idempotency_key
  ) values (
    caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    p_mode,case when p_mode='existing' then p_transaction_id else null end,p_idempotency_key
  ) returning * into existing;

  return jsonb_build_object(
    'ok',true,'replayed',false,'receipt_id',existing.id,
    'transaction_id',existing.transaction_id,'result',action_result
  );
end;
$_$;


ALTER FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) IS 'Concilia atomicamente uma linha de extrato sem persistir o arquivo ou a descrição bancária bruta.';



CREATE OR REPLACE FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone, "p_excess_as_interest" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid := auth.uid();
  account_row public.contas%rowtype;
  transaction_row public.transacoes%rowtype;
  existing private.bank_reconciliation_receipts%rowtype;
  action_result jsonb;
  is_transfer boolean := false;
  destination_id bigint;
  excess numeric(14,2) := 0;
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
     or p_entry_amount <= 0 or p_entry_amount > 999999999999.99
     or p_mode not in ('existing','new') then
    raise exception using errcode='22023', message='RECONCILIATION_INVALID_ENTRY';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(caller::text||':'||p_account_id::text||':'||p_entry_fingerprint,82901));
  select * into existing from private.bank_reconciliation_receipts r
   where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;

  select * into account_row from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
    and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller))) for update;
  if not found then raise exception using errcode='42501', message='RECONCILIATION_ACCOUNT_DENIED'; end if;

  if p_mode='existing' then
    if p_transaction_id is null then raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_REQUIRED'; end if;
    select * into transaction_row from public.transacoes t
     where t.id=p_transaction_id and t.transacao_pai_id is null and t.status='pendente'
       and not (t.descricao ~ '\[(Objetivo:|PagFatura:)') for update;
    if not found then raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;

    is_transfer := coalesce(transaction_row.descricao,'') like '[Transf.]%';
    if is_transfer then
      destination_id := nullif((regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]'))[1],'')::bigint;
      if not ((p_entry_type='despesa' and transaction_row.conta_id=p_account_id)
           or (p_entry_type='receita' and destination_id=p_account_id))
         or round(p_entry_amount,2)<>round(transaction_row.valor,2) then
        raise exception using errcode='22023', message='RECONCILIATION_TRANSFER_REQUIRES_EXACT_VALUE';
      end if;
      action_result := public.execute_manual_financial_action(
        'complete_transaction',
        jsonb_build_object('transaction_id',transaction_row.id,'realization_date',p_entry_date::text,
          'expected_value',transaction_row.valor,'realized_value',transaction_row.valor),
        p_idempotency_key,caller,p_client_created_at
      );
    else
      if transaction_row.conta_id<>p_account_id or transaction_row.tipo<>p_entry_type
         or transaction_row.categoria_id is null then
        raise exception using errcode='22023', message='RECONCILIATION_TRANSACTION_UNAVAILABLE';
      end if;
      excess := greatest(round(p_entry_amount-transaction_row.valor,2),0);
      if excess>0 and not coalesce(p_excess_as_interest,false) then
        raise exception using errcode='22023', message='RECONCILIATION_EXCESS_CONFIRMATION_REQUIRED';
      end if;
      action_result := public.complete_transaction_with_partial(
        transaction_row.id, transaction_row.valor,
        case when excess>0 then 'interest' else 'none' end,
        excess, p_entry_amount, p_entry_date, p_idempotency_key
      );
    end if;
    if action_result is null or action_result->>'ok'<>'true' then
      raise exception using errcode='P0001', message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
    end if;
  else
    if p_category_id is null or not exists (
      select 1 from public.categorias c where c.id=p_category_id and c.user_id=caller
       and coalesce(c.ativa::integer,0)<>0 and c.tipo in (p_entry_type,'ambos')
    ) then raise exception using errcode='22023', message='RECONCILIATION_CATEGORY_INVALID'; end if;
    if p_description is null or length(trim(p_description))=0 or length(trim(p_description))>100 then
      raise exception using errcode='22023', message='RECONCILIATION_DESCRIPTION_INVALID';
    end if;
    action_result := public.execute_manual_financial_action(
      'create_transaction',jsonb_build_object('type',p_entry_type,'value',round(p_entry_amount,2),
       'description',trim(p_description),'status','paga','scheduled_date',p_entry_date::text,
       'realization_date',p_entry_date::text,'account_id',p_account_id,'category_id',p_category_id,'frequency','unica'),
      p_idempotency_key,caller,p_client_created_at
    );
    if action_result is null or action_result->>'ok'<>'true' then
      raise exception using errcode='P0001', message='RECONCILIATION_CREATION_NOT_CONFIRMED';
    end if;
  end if;

  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,entry_type,
    entry_amount,reconciliation_mode,transaction_id,idempotency_key)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),p_mode,
    case when p_mode='existing' then p_transaction_id else null end,p_idempotency_key)
  returning * into existing;
  return jsonb_build_object('ok',true,'replayed',false,'receipt_id',existing.id,
    'transaction_id',existing.transaction_id,'result',action_result);
end;
$_$;


ALTER FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone, "p_excess_as_interest" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_bank_statement_excess_interest"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid := auth.uid();
  transaction_row public.transacoes%rowtype;
  existing private.bank_reconciliation_receipts%rowtype;
  completion_result jsonb;
  scheduled_value numeric(14,2);
  interest_value numeric(14,2);
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_account_id is null or p_entry_fingerprint !~ '^[0-9a-f]{64}$' or p_entry_date is null
    or p_entry_type not in ('receita','despesa') or p_entry_amount<=0 or p_transaction_id is null
    or p_idempotency_key is null or p_client_created_at is null then
    raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finflow:bank-interest:'||p_transaction_id::text,82905));
  select * into existing from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;
  select * into transaction_row from public.transacoes t where t.id=p_transaction_id
    and t.transacao_pai_id is null and t.status='pendente' and t.conta_id=p_account_id
    and t.tipo=p_entry_type and t.categoria_id is not null
    and coalesce(t.descricao,'') not like '[Transf.]%'
    and coalesce(t.descricao,'') !~ '\[(Destino:|Objetivo:|PagFatura:)' for update;
  if not found then raise exception using errcode='22023',message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  scheduled_value := round(transaction_row.valor,2);
  interest_value := round(p_entry_amount-scheduled_value,2);
  if interest_value<=0 then raise exception using errcode='22023',message='RECONCILIATION_EXCESS_CONFIRMATION_REQUIRED'; end if;

  -- O total realizado permanece no próprio agendamento. Os componentes são
  -- preservados no recibo privado da conciliação para exibição e auditoria.
  update public.transacoes set valor=round(p_entry_amount,2) where id=transaction_row.id;
  completion_result := public.complete_transaction_with_partial(transaction_row.id,round(p_entry_amount,2),
    'none',0,round(p_entry_amount,2),p_entry_date,p_idempotency_key);
  if completion_result is null or completion_result->>'ok'<>'true' then
    raise exception using errcode='P0001',message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
  end if;
  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,entry_type,
    entry_amount,reconciliation_mode,transaction_id,idempotency_key,scheduled_amount,interest_amount)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    'existing',transaction_row.id,p_idempotency_key,scheduled_value,interest_value) returning * into existing;
  return jsonb_build_object('ok',true,'receipt_id',existing.id,'transaction_id',transaction_row.id,
    'scheduled_amount',scheduled_value,'interest_amount',interest_value,'completion',completion_result);
end;
$_$;


ALTER FUNCTION "public"."reconcile_bank_statement_excess_interest"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_bank_statement_new_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_entries" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
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
$_$;


ALTER FUNCTION "public"."reconcile_bank_statement_new_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_entries" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reconcile_bank_statement_new_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_entries" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) IS 'Cria varios lancamentos novos a partir de uma unica linha de extrato, cuja soma precisa bater exatamente com o valor da linha.';



CREATE OR REPLACE FUNCTION "public"."reconcile_bank_transfer_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  caller uuid := auth.uid();
  transaction_row public.transacoes%rowtype;
  existing private.bank_reconciliation_receipts%rowtype;
  destination_id bigint;
  prior_account bigint;
  action_result jsonb;
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_account_id is null or p_entry_fingerprint !~ '^[0-9a-f]{64}$' or p_entry_date is null
    or p_entry_type not in ('receita','despesa') or p_entry_amount<=0 or p_transaction_id is null
    or p_idempotency_key is null or p_client_created_at is null then
    raise exception using errcode='22023',message='RECONCILIATION_INVALID_ENTRY';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('finflow:bank-transfer:'||p_transaction_id::text,82903));
  select * into existing from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.account_id=p_account_id and r.entry_fingerprint=p_entry_fingerprint;
  if found then return jsonb_build_object('ok',true,'replayed',true,'transaction_id',existing.transaction_id); end if;
  if not exists(select 1 from public.contas c where c.id=p_account_id and not coalesce(c.arquivado,false)
    and (c.user_id=caller or (coalesce(c.compartilhado,false) and public.is_parceiro(c.user_id,caller)))) then
    raise exception using errcode='42501',message='RECONCILIATION_ACCOUNT_DENIED';
  end if;
  select * into transaction_row from public.transacoes t where t.id=p_transaction_id
    and t.transacao_pai_id is null and coalesce(t.descricao,'') like '[Transf.]%' for update;
  if not found then raise exception using errcode='22023',message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  destination_id := nullif((regexp_match(transaction_row.descricao,'\[Destino:([0-9]+)\]'))[1],'')::bigint;
  if not ((p_entry_type='despesa' and transaction_row.conta_id=p_account_id)
       or (p_entry_type='receita' and destination_id=p_account_id))
     or round(p_entry_amount,2)<>round(transaction_row.valor,2) then
    raise exception using errcode='22023',message='RECONCILIATION_TRANSFER_REQUIRES_EXACT_VALUE';
  end if;
  select r.account_id into prior_account from private.bank_reconciliation_receipts r
    where r.user_id=caller and r.transaction_id=transaction_row.id limit 1;
  if transaction_row.status='pendente' and prior_account is null then
    action_result := public.execute_manual_financial_action('complete_transaction',
      jsonb_build_object('transaction_id',transaction_row.id,'realization_date',p_entry_date::text,
        'expected_value',transaction_row.valor,'realized_value',transaction_row.valor),
      p_idempotency_key,caller,p_client_created_at);
  elsif transaction_row.status='paga' and prior_account is not null and prior_account<>p_account_id then
    action_result := jsonb_build_object('ok',true,'counterpart_only',true);
  else
    raise exception using errcode='22023',message='RECONCILIATION_TRANSFER_SIDE_UNAVAILABLE';
  end if;
  if action_result is null or action_result->>'ok'<>'true' then
    raise exception using errcode='P0001',message='RECONCILIATION_COMPLETION_NOT_CONFIRMED';
  end if;
  insert into private.bank_reconciliation_receipts(user_id,account_id,entry_fingerprint,entry_date,entry_type,
    entry_amount,reconciliation_mode,transaction_id,idempotency_key)
  values(caller,p_account_id,p_entry_fingerprint,p_entry_date,p_entry_type,round(p_entry_amount,2),
    'existing',transaction_row.id,p_idempotency_key) returning * into existing;
  return jsonb_build_object('ok',true,'receipt_id',existing.id,'transaction_id',transaction_row.id,'result',action_result);
end;
$_$;


ALTER FUNCTION "public"."reconcile_bank_transfer_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reconcile_reopened_bank_statement_entry"("p_receipt_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid:=auth.uid(); receipt private.bank_reconciliation_receipts%rowtype;
  transaction_row public.transacoes%rowtype; reconciled_total numeric(20,2); available_amount numeric(20,2); action_result jsonb;
begin
  if caller is null then raise exception using errcode='42501',message='RECONCILIATION_AUTH_REQUIRED'; end if;
  if caller is distinct from p_expected_user_id then raise exception using errcode='42501',message='RECONCILIATION_AUTH_MISMATCH'; end if;
  if p_idempotency_key is null or p_client_created_at is null
    or p_client_created_at<clock_timestamp()-interval '30 days' or p_client_created_at>clock_timestamp()+interval '5 minutes'
  then raise exception using errcode='22023',message='RECONCILIATION_INVALID_REQUEST'; end if;
  select * into receipt from private.bank_reconciliation_receipts r
  where r.id=p_receipt_id and r.user_id=caller and r.entry_fingerprint=p_entry_fingerprint
    and r.entry_date=p_entry_date and r.entry_type=p_entry_type for update;
  if not found then raise exception using errcode='22023',message='RECONCILIATION_PARTIAL_RECEIPT_UNAVAILABLE'; end if;
  select coalesce(round(sum(rt.amount),2),0) into reconciled_total
  from private.bank_reconciliation_transactions rt where rt.receipt_id=receipt.id;
  available_amount:=round(receipt.entry_amount-reconciled_total,2);
  if available_amount<=0 or round(p_entry_amount,2) is distinct from available_amount then
    raise exception using errcode='22023',message='RECONCILIATION_PARTIAL_AMOUNT_CHANGED'; end if;
  select * into transaction_row from public.transacoes t
  where t.id=p_transaction_id and t.transacao_pai_id is null and t.status='pendente'
    and t.conta_id=receipt.account_id and t.tipo=receipt.entry_type and t.categoria_id is not null
    and coalesce(t.descricao,'') !~ '\[(Destino:|Objetivo:|PagFatura:)' for update;
  if not found or round(transaction_row.valor,2) is distinct from available_amount then
    raise exception using errcode='22023',message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  if exists (select 1 from private.bank_reconciliation_receipts r
    left join private.bank_reconciliation_transactions rt on rt.receipt_id=r.id
    where r.user_id=caller and (r.transaction_id=p_transaction_id or rt.transaction_id=p_transaction_id))
  then raise exception using errcode='22023',message='RECONCILIATION_TRANSACTION_UNAVAILABLE'; end if;
  action_result:=public.complete_transaction_with_partial(transaction_row.id,transaction_row.valor,'none',0,available_amount,p_entry_date,p_idempotency_key);
  if action_result is null or action_result->>'ok'<>'true' then
    raise exception using errcode='P0001',message='RECONCILIATION_COMPLETION_NOT_CONFIRMED'; end if;
  insert into private.bank_reconciliation_transactions(receipt_id,transaction_id,amount)
  values(receipt.id,transaction_row.id,available_amount);
  return jsonb_build_object('ok',true,'receipt_id',receipt.id,'transaction_id',transaction_row.id,
    'reconciled_amount',receipt.entry_amount,'remaining_amount',0);
end; $$;


ALTER FUNCTION "public"."reconcile_reopened_bank_statement_entry"("p_receipt_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_my_recurring_schedules"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := auth.uid();
  horizon date := (current_date + interval '5 years')::date;
  recurring record;
  transaction_template public.transacoes%rowtype;
  card_template public.fatura_itens%rowtype;
  next_date date;
  next_invoice text;
  created_transactions integer := 0;
  created_card_items integer := 0;
  series_created integer := 0;
  scheduled_count integer := 0;
  target_count integer := 0;
begin
  if caller is null then raise exception 'AUTH_REQUIRED'; end if;
  perform pg_advisory_xact_lock(hashtextextended('finflow-recurring:' || caller::text, 0));

  for recurring in
    select distinct (regexp_match(t.descricao, '\[Serie:([^]]+)\]'))[1] as series_id,
      case when t.descricao like '%(Fixa semanal)%' then 'semanal'
           when t.descricao like '%(Fixa anual)%' then 'anual' else 'mensal' end as frequency
    from public.transacoes t
    where t.user_id = caller and t.descricao ~ '\[Serie:[^]]+\]' and t.descricao like '%(Fixa%'
      and exists (
        select 1 from public.transacoes pending
        where pending.user_id = caller
          and pending.descricao like '%[Serie:' || (regexp_match(t.descricao, '\[Serie:([^]]+)\]'))[1] || ']%'
          and pending.status = 'pendente' and pending.data_vencimento >= current_date
      )
  loop
    transaction_template := null;
    select t.* into transaction_template from public.transacoes t
    where t.user_id = caller and t.descricao like '%[Serie:' || recurring.series_id || ']%'
    order by t.data_vencimento desc, t.id desc limit 1;
    if transaction_template.id is null then continue; end if;

    series_created := 0;
    target_count := case recurring.frequency when 'semanal' then 260 when 'anual' then 5 else 60 end;
    select count(*) into scheduled_count from public.transacoes t
    where t.user_id = caller
      and t.descricao like '%[Serie:' || recurring.series_id || ']%'
      and t.status = 'pendente'
      and t.data_vencimento >= current_date;
    next_date := case recurring.frequency when 'semanal' then transaction_template.data_vencimento + 7
      when 'anual' then private.finflow_add_months_clamped(transaction_template.data_vencimento, 12)
      else private.finflow_add_months_clamped(transaction_template.data_vencimento, 1) end;
    while scheduled_count < target_count and series_created < target_count loop
      insert into public.transacoes(user_id,tipo,valor,descricao,data_vencimento,data_realizacao,conta_id,categoria_id,status)
      values(caller,transaction_template.tipo,transaction_template.valor,transaction_template.descricao,next_date,null,
        transaction_template.conta_id,transaction_template.categoria_id,'pendente') returning * into transaction_template;
      created_transactions := created_transactions + 1;
      series_created := series_created + 1;
      scheduled_count := scheduled_count + 1;
      next_date := case recurring.frequency when 'semanal' then next_date + 7
        when 'anual' then private.finflow_add_months_clamped(next_date, 12)
        else private.finflow_add_months_clamped(next_date, 1) end;
    end loop;
  end loop;

  for recurring in
    select distinct fi.grupo_parcela_id as group_id from public.fatura_itens fi
    where fi.user_id = caller and fi.grupo_parcela_id is not null and fi.descricao like '%(Fixa)%'
      and exists (
        select 1 from public.fatura_itens pending
        where pending.user_id = caller and pending.grupo_parcela_id = fi.grupo_parcela_id
          and pending.descricao like '%(Fixa)%' and not pending.pago and pending.data_compra >= current_date
      )
  loop
    card_template := null;
    select fi.* into card_template from public.fatura_itens fi
    where fi.user_id = caller and fi.grupo_parcela_id = recurring.group_id and fi.descricao like '%(Fixa)%'
    order by fi.data_compra desc, fi.id desc limit 1;
    if card_template.id is null then continue; end if;

    series_created := 0;
    select count(*) into scheduled_count from public.fatura_itens fi
    where fi.user_id = caller and fi.grupo_parcela_id = recurring.group_id
      and fi.descricao like '%(Fixa)%' and not fi.pago and fi.data_compra >= current_date;
    next_date := private.finflow_add_months_clamped(card_template.data_compra, 1);
    next_invoice := to_char(to_date(card_template.mes_fatura || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
    while scheduled_count < 60 and series_created < 60 loop
      insert into public.fatura_itens(cartao_id,user_id,descricao,valor,data_compra,mes_fatura,parcela_atual,total_parcelas,grupo_parcela_id,categoria_id,pago)
      values(card_template.cartao_id,caller,card_template.descricao,card_template.valor,next_date,next_invoice,
        card_template.parcela_atual + 1,1,recurring.group_id,card_template.categoria_id,false) returning * into card_template;
      created_card_items := created_card_items + 1;
      series_created := series_created + 1;
      scheduled_count := scheduled_count + 1;
      next_date := private.finflow_add_months_clamped(next_date, 1);
      next_invoice := to_char(to_date(next_invoice || '-01', 'YYYY-MM-DD') + interval '1 month', 'YYYY-MM');
    end loop;
  end loop;

  return jsonb_build_object('transactions_created',created_transactions,'card_items_created',created_card_items,'horizon',horizon);
end;
$$;


ALTER FUNCTION "public"."refresh_my_recurring_schedules"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_dispositivo_push"("p_token" "text", "p_plataforma" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  IF p_token IS NULL OR p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'
     OR p_plataforma IS NULL OR p_plataforma NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid push token';
  END IF;

  INSERT INTO public.dispositivos_push (token, user_id, plataforma)
  VALUES (p_token, v_uid, p_plataforma)
  ON CONFLICT (token) DO UPDATE
    SET user_id = EXCLUDED.user_id,
        plataforma = EXCLUDED.plataforma,
        atualizado_em = now();

  DELETE FROM public.dispositivos_push d
   WHERE d.user_id = v_uid
     AND d.token NOT IN (
       SELECT r.token FROM public.dispositivos_push r
        WHERE r.user_id = v_uid
        ORDER BY r.atualizado_em DESC
        LIMIT 10
     );

  RETURN TRUE;
END;
$_$;


ALTER FUNCTION "public"."registrar_dispositivo_push"("p_token" "text", "p_plataforma" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."registrar_evento_obrigatorio_parceria"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_ator UUID := auth.uid();
  v_convidado_id UUID;
  v_solicitante_nome TEXT;
  v_convidado_nome TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT u.id
      INTO v_convidado_id
      FROM auth.users u
     WHERE lower(u.email) = lower(NEW.convidado_email)
     ORDER BY u.created_at
     LIMIT 1;

    -- O proprio app informa que o parceiro precisa estar cadastrado. Falhar a
    -- transacao aqui evita um convite que jamais poderia ser entregue.
    IF v_convidado_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = 'finflow_invitee_not_found';
    END IF;

    SELECT COALESCE(
             NULLIF(btrim(u.raw_user_meta_data ->> 'nome_usuario'), ''),
             NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
             split_part(COALESCE(u.email, ''), '@', 1),
             'Um usuário'
           )
      INTO v_solicitante_nome
      FROM auth.users u
     WHERE u.id = NEW.solicitante_id;

    INSERT INTO public.notificacoes_sistema (
      destinatario_id, tipo, referencia_id, titulo, mensagem, dados
    ) VALUES (
      v_convidado_id,
      'convite_parceria',
      NEW.id,
      'Convite de parceria',
      format('%s convidou você para vincular as contas no FinFlow.', v_solicitante_nome),
      jsonb_build_object(
        'parceria_id', NEW.id,
        'solicitante_id', NEW.solicitante_id,
        'solicitante_nome', v_solicitante_nome,
        'acao', 'abrir_convite'
      )
    )
    ON CONFLICT (destinatario_id, tipo, referencia_id) DO NOTHING;

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.status = 'pendente'
     AND NEW.status = 'aceito' THEN
    SELECT COALESCE(
             NULLIF(btrim(u.raw_user_meta_data ->> 'nome_usuario'), ''),
             NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
             split_part(COALESCE(u.email, ''), '@', 1),
             'Seu parceiro'
           )
      INTO v_convidado_nome
      FROM auth.users u
     WHERE u.id = NEW.convidado_id;

    -- O convite deixa de ser pendente para quem acabou de responder.
    UPDATE public.notificacoes_sistema
       SET lida_em = COALESCE(lida_em, now())
     WHERE destinatario_id = NEW.convidado_id
       AND tipo = 'convite_parceria'
       AND referencia_id = NEW.id;

    INSERT INTO public.notificacoes_sistema (
      destinatario_id, tipo, referencia_id, titulo, mensagem, dados
    ) VALUES (
      NEW.solicitante_id,
      'parceria_aceita',
      NEW.id,
      'Parceria formada!',
      format('%s aceitou seu convite. Agora vocês podem usar os recursos compartilhados.', v_convidado_nome),
      jsonb_build_object(
        'parceria_id', NEW.id,
        'convidado_id', NEW.convidado_id,
        'convidado_nome', v_convidado_nome
      )
    )
    ON CONFLICT (destinatario_id, tipo, referencia_id) DO NOTHING;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' AND OLD.status = 'pendente' THEN
    SELECT u.id,
           COALESCE(
             NULLIF(btrim(u.raw_user_meta_data ->> 'nome_usuario'), ''),
             NULLIF(btrim(u.raw_user_meta_data ->> 'full_name'), ''),
             split_part(COALESCE(u.email, ''), '@', 1),
             'O convidado'
           )
      INTO v_convidado_id, v_convidado_nome
      FROM auth.users u
     WHERE lower(u.email) = lower(OLD.convidado_email)
     ORDER BY u.created_at
     LIMIT 1;

    -- Tanto a recusa quanto o cancelamento encerram o aviso do convidado.
    IF v_convidado_id IS NOT NULL THEN
      UPDATE public.notificacoes_sistema
         SET lida_em = COALESCE(lida_em, now())
       WHERE destinatario_id = v_convidado_id
         AND tipo = 'convite_parceria'
         AND referencia_id = OLD.id;
    END IF;

    -- Quem enviou apenas cancela. Uma exclusao feita pelo e-mail convidado e
    -- uma recusa e precisa avisar o solicitante.
    IF v_ator IS NOT NULL AND v_ator <> OLD.solicitante_id THEN
      INSERT INTO public.notificacoes_sistema (
        destinatario_id, tipo, referencia_id, titulo, mensagem, dados
      ) VALUES (
        OLD.solicitante_id,
        'parceria_recusada',
        OLD.id,
        'Convite recusado',
        format('%s recusou seu convite de parceria.', v_convidado_nome),
        jsonb_build_object(
          'parceria_id', OLD.id,
          'convidado_id', v_convidado_id,
          'convidado_nome', v_convidado_nome
        )
      )
      ON CONFLICT (destinatario_id, tipo, referencia_id) DO NOTHING;
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."registrar_evento_obrigatorio_parceria"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remover_dispositivo_push"("p_token" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_removidos INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;
  DELETE FROM public.dispositivos_push
   WHERE token = p_token
     AND user_id = v_uid;
  GET DIAGNOSTICS v_removidos = ROW_COUNT;
  RETURN v_removidos > 0;
END;
$$;


ALTER FUNCTION "public"."remover_dispositivo_push"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reopen_transaction_completion"("p_transaction_id" bigint, "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select public.reverse_transaction_payment(
    p_transaction_id,null::uuid,p_idempotency_key
  );
$$;


ALTER FUNCTION "public"."reopen_transaction_completion"("p_transaction_id" bigint, "p_idempotency_key" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."reopen_transaction_completion"("p_transaction_id" bigint, "p_idempotency_key" "uuid") IS 'Reabre receita/despesa de forma atomica, remove o saldo parcial intacto e restaura o valor agendado original.';



CREATE OR REPLACE FUNCTION "public"."reserve_edge_rate_limit"("p_scope" "text", "p_subject" "text", "p_cooldown_seconds" integer, "p_window_seconds" integer, "p_max_attempts" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_subject_hash text;
  current_row private.edge_rate_limits%rowtype;
  now_at timestamptz := clock_timestamp();
  retry_after integer;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if p_scope not in ('sms_verification', 'subscription_checkout')
     or p_subject is null or length(p_subject) not between 8 and 300
     or p_cooldown_seconds is null or p_cooldown_seconds not between 1 and 3600
     or p_window_seconds is null or p_window_seconds not between 60 and 604800
     or p_max_attempts is null or p_max_attempts not between 1 and 1000 then
    raise exception using errcode = '22023', message = 'FINFLOW_INVALID_RATE_LIMIT';
  end if;

  v_subject_hash := encode(
    extensions.digest(convert_to(jsonb_build_array(p_scope, p_subject)::text, 'UTF8'), 'sha256'),
    'hex'
  );
  perform pg_advisory_xact_lock(hashtext(p_scope), hashtext(v_subject_hash));

  select * into current_row
  from private.edge_rate_limits
  where scope = p_scope and edge_rate_limits.subject_hash = v_subject_hash
  for update;

  if not found or current_row.window_started_at + make_interval(secs => p_window_seconds) <= now_at then
    insert into private.edge_rate_limits (
      scope, subject_hash, window_started_at, attempts, last_attempt_at
    ) values (
      p_scope, v_subject_hash, now_at, 1, now_at
    )
    on conflict (scope, subject_hash) do update
      set window_started_at = excluded.window_started_at,
          attempts = 1,
          last_attempt_at = excluded.last_attempt_at;
    return jsonb_build_object('allowed', true, 'remaining', p_max_attempts - 1);
  end if;

  if current_row.last_attempt_at + make_interval(secs => p_cooldown_seconds) > now_at then
    retry_after := greatest(
      1,
      ceil(extract(epoch from (
        current_row.last_attempt_at + make_interval(secs => p_cooldown_seconds) - now_at
      )))::integer
    );
    return jsonb_build_object(
      'allowed', false,
      'reason', 'cooldown',
      'retry_after', retry_after,
      'remaining', greatest(p_max_attempts - current_row.attempts, 0)
    );
  end if;

  if current_row.attempts >= p_max_attempts then
    retry_after := greatest(
      1,
      ceil(extract(epoch from (
        current_row.window_started_at + make_interval(secs => p_window_seconds) - now_at
      )))::integer
    );
    return jsonb_build_object(
      'allowed', false,
      'reason', 'window',
      'retry_after', retry_after,
      'remaining', 0
    );
  end if;

  update private.edge_rate_limits
  set attempts = attempts + 1,
      last_attempt_at = now_at
  where scope = p_scope and edge_rate_limits.subject_hash = v_subject_hash;

  return jsonb_build_object(
    'allowed', true,
    'remaining', greatest(p_max_attempts - current_row.attempts - 1, 0)
  );
end;
$$;


ALTER FUNCTION "public"."reserve_edge_rate_limit"("p_scope" "text", "p_subject" "text", "p_cooldown_seconds" integer, "p_window_seconds" integer, "p_max_attempts" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reserve_phone_verification"("p_user_id" "uuid", "p_phone" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $_$
declare
  affected integer;
begin
  if p_user_id is null or p_phone !~ '^\+55[1-9]{2}9[0-9]{8}$' then
    return false;
  end if;

  delete from private.phone_verification_reservations
  where expires_at <= now();

  delete from private.phone_verification_reservations
  where user_id = p_user_id
    and phone <> p_phone;

  insert into private.phone_verification_reservations (phone, user_id, expires_at)
  values (p_phone, p_user_id, now() + interval '20 minutes')
  on conflict (phone) do update
    set expires_at = excluded.expires_at
    where private.phone_verification_reservations.user_id = excluded.user_id;

  get diagnostics affected = row_count;
  return affected = 1;
end;
$_$;


ALTER FUNCTION "public"."reserve_phone_verification"("p_user_id" "uuid", "p_phone" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolver_decisao_caixinha"("p_decisao_id" bigint, "p_manter" boolean, "p_saldo" numeric DEFAULT NULL::numeric) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_decisao public.parceria_caixinha_decisoes%ROWTYPE;
  v_ja_destinado NUMERIC := 0;
  v_disponivel NUMERIC := 0;
  v_updated INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  -- Bloqueia as duas decisões da mesma caixinha para impedir saldo duplicado.
  PERFORM 1
    FROM public.parceria_caixinha_decisoes
   WHERE parceria_id = (
     SELECT parceria_id
       FROM public.parceria_caixinha_decisoes
      WHERE id = p_decisao_id AND user_id = v_uid
   )
     AND source_caixinha_id = (
       SELECT source_caixinha_id
         FROM public.parceria_caixinha_decisoes
        WHERE id = p_decisao_id AND user_id = v_uid
     )
   FOR UPDATE;

  SELECT *
    INTO v_decisao
    FROM public.parceria_caixinha_decisoes
   WHERE id = p_decisao_id
     AND user_id = v_uid
     AND status = 'pendente'
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'pending decision not found';
  END IF;

  SELECT coalesce(sum(saldo_definido), 0)
    INTO v_ja_destinado
    FROM public.parceria_caixinha_decisoes
   WHERE parceria_id = v_decisao.parceria_id
     AND source_caixinha_id = v_decisao.source_caixinha_id
     AND user_id <> v_uid
     AND status = 'mantida';

  v_disponivel := greatest(0, v_decisao.saldo_total - v_ja_destinado);

  IF p_manter THEN
    IF p_saldo IS NULL OR p_saldo < 0 OR p_saldo > v_disponivel THEN
      RAISE EXCEPTION USING
        ERRCODE = '22003',
        MESSAGE = 'balance must be between zero and the available balance';
    END IF;

    IF v_decisao.source_owner_id = v_uid THEN
      UPDATE public.caixinhas
         SET saldo_atual = p_saldo,
             compartilhado = false,
             arquivado = false
       WHERE id = v_decisao.source_caixinha_id
         AND user_id = v_uid;
      GET DIAGNOSTICS v_updated = ROW_COUNT;
    END IF;

    IF v_updated = 0 THEN
      INSERT INTO public.caixinhas (
        nome, meta_valor, saldo_atual, cor, icone, user_id,
        compartilhado, data_prazo, arquivado
      ) VALUES (
        v_decisao.nome,
        v_decisao.meta_valor,
        p_saldo,
        v_decisao.cor,
        v_decisao.icone,
        v_uid,
        false,
        v_decisao.data_prazo,
        false
      );
    END IF;

    UPDATE public.parceria_caixinha_decisoes
       SET status = 'mantida',
           saldo_definido = p_saldo,
           resolved_at = now()
     WHERE id = v_decisao.id;
  ELSE
    IF v_decisao.source_owner_id = v_uid THEN
      DELETE FROM public.caixinhas
       WHERE id = v_decisao.source_caixinha_id
         AND user_id = v_uid;
    END IF;

    UPDATE public.parceria_caixinha_decisoes
       SET status = 'descartada',
           saldo_definido = 0,
           resolved_at = now()
     WHERE id = v_decisao.id;
  END IF;
END;
$$;


ALTER FUNCTION "public"."resolver_decisao_caixinha"("p_decisao_id" bigint, "p_manter" boolean, "p_saldo" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolver_decisao_conta_dissolucao"("p_item_id" bigint, "p_manter_ativa" boolean) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_item public.parceria_dissolucao_itens%ROWTYPE;
  v_updated INTEGER := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'authentication required';
  END IF;

  SELECT i.*
    INTO v_item
    FROM public.parceria_dissolucao_itens i
    JOIN public.parceria_dissolucao_resumos r ON r.id = i.resumo_id
   WHERE i.id = p_item_id
     AND i.tipo = 'conta'
     AND i.estado = 'pendente'
     AND i.target_conta_id IS NOT NULL
     AND r.user_id = v_uid
   FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'pending account decision not found';
  END IF;

  UPDATE public.contas
     SET compartilhado = false,
         arquivado = NOT p_manter_ativa
   WHERE id = v_item.target_conta_id
     AND user_id = v_uid;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'account not found';
  END IF;

  UPDATE public.parceria_dissolucao_itens
     SET estado = CASE WHEN p_manter_ativa THEN 'mantida' ELSE 'arquivada' END,
         resolved_at = now()
   WHERE id = v_item.id;
END;
$$;


ALTER FUNCTION "public"."resolver_decisao_conta_dissolucao"("p_item_id" bigint, "p_manter_ativa" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reverse_selected_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."reverse_selected_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reverse_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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


ALTER FUNCTION "public"."reverse_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_financial_resource_sharing"("p_resource_type" "text", "p_resource_id" bigint, "p_shared" boolean, "p_expected_version" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  caller uuid := auth.uid();
  action_name text;
  request_payload jsonb;
  request_hash text;
  existing private.offline_action_receipts%rowtype;
  partnership_id bigint;
  current_version bigint;
  final_version bigint;
  current_shared boolean;
  is_archived boolean;
  execution_result jsonb;
  recent_count integer;
begin
  if caller is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_REQUIRED';
  end if;
  if p_expected_user_id is null or caller is distinct from p_expected_user_id then
    raise exception using errcode = 'P0001', message = 'OFFLINE_AUTH_MISMATCH';
  end if;
  if p_resource_type is null or p_resource_type not in ('account', 'goal')
     or p_resource_id is null or p_resource_id <= 0
     or p_shared is null
     or p_expected_version is null or p_expected_version <= 0 then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_PAYLOAD';
  end if;
  if p_idempotency_key is null then
    raise exception using errcode = 'P0001', message = 'OFFLINE_INVALID_IDEMPOTENCY_KEY';
  end if;
  if p_client_created_at is null
     or p_client_created_at < pg_catalog.clock_timestamp() - interval '30 days'
     or p_client_created_at > pg_catalog.clock_timestamp() + interval '5 minutes' then
    raise exception using errcode = 'P0001', message = 'OFFLINE_OPERATION_EXPIRED';
  end if;

  action_name := 'set_' || p_resource_type || '_sharing';
  request_payload := pg_catalog.jsonb_build_object(
    'resource_type', p_resource_type,
    'resource_id', p_resource_id,
    'shared', p_shared,
    'expected_version', p_expected_version
  );
  request_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(action_name, request_payload)::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  -- Mantem a mesma serializacao por usuario dos executores financeiro e
  -- offline. Isso tambem protege o namespace compartilhado de request_id.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(caller::text, 81277)
  );

  select * into existing
  from private.offline_action_receipts r
  where r.user_id = caller and r.idempotency_key = p_idempotency_key;

  if found then
    if existing.action_type <> action_name or existing.payload_hash <> request_hash then
      raise exception using errcode = 'P0001', message = 'OFFLINE_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'ok', true,
      'replayed', true,
      'receipt_id', existing.id,
      'result', existing.result
    );
  end if;

  select pg_catalog.count(*) into recent_count
  from private.offline_action_receipts r
  where r.user_id = caller
    and r.created_at >= pg_catalog.clock_timestamp() - interval '1 hour';
  if recent_count >= 180 then
    return pg_catalog.jsonb_build_object(
      'ok', false,
      'error_code', 'OFFLINE_RATE_LIMITED',
      'retry_after_seconds', 3600
    );
  end if;

  -- Para expor um recurso, usa exatamente a trava canonica da dissolucao e das
  -- operacoes financeiras: advisory da parceria, linha da parceria e recurso.
  if p_shared then
    perform private.finflow_lock_participants(caller, caller);
    select p.id into partnership_id
    from public.parcerias p
    where p.status = 'aceito'
      and p.convidado_id is not null
      and (
        (p.solicitante_id = caller and p.convidado_id <> caller)
        or (p.convidado_id = caller and p.solicitante_id <> caller)
    )
    order by p.id
    limit 1;

    if not found then
      raise exception using errcode = 'P0001', message = 'AI_PARTNERSHIP_NOT_FOUND';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('finflow:partnership:' || partnership_id::text, 73119)
    );
    perform 1
    from public.parcerias p
    where p.id = partnership_id
      and p.status = 'aceito'
      and p.convidado_id is not null
      and (
        (p.solicitante_id = caller and p.convidado_id <> caller)
        or (p.convidado_id = caller and p.solicitante_id <> caller)
      )
    for share;
    if not found then
      raise exception using errcode = 'P0001', message = 'AI_PARTNERSHIP_NOT_FOUND';
    end if;
  end if;

  if p_resource_type = 'account' then
    select c.version, coalesce(c.compartilhado, false), coalesce(c.arquivado, false)
      into current_version, current_shared, is_archived
    from public.contas c
    where c.id = p_resource_id and c.user_id = caller
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'AI_ACCOUNT_NOT_FOUND';
    end if;
  else
    select g.version, coalesce(g.compartilhado, false), coalesce(g.arquivado, false)
      into current_version, current_shared, is_archived
    from public.caixinhas g
    where g.id = p_resource_id and g.user_id = caller
    for update;
    if not found then
      raise exception using errcode = 'P0001', message = 'AI_GOAL_NOT_FOUND';
    end if;
  end if;

  if p_shared and is_archived then
    raise exception using errcode = 'P0001', message = 'FINFLOW_RESOURCE_ARCHIVED';
  end if;

  -- Uma repeticao com outra chave continua sendo segura: se o estado desejado
  -- ja foi atingido, retorna sucesso sem incrementar a versao novamente.
  if current_shared is distinct from p_shared then
    if current_version is distinct from p_expected_version then
      raise exception using errcode = 'P0001', message = 'OFFLINE_VERSION_CONFLICT';
    end if;
    if p_resource_type = 'account' then
      update public.contas
      set compartilhado = p_shared
      where id = p_resource_id and user_id = caller;
      select version into final_version from public.contas where id = p_resource_id;
    else
      update public.caixinhas
      set compartilhado = p_shared
      where id = p_resource_id and user_id = caller;
      select version into final_version from public.caixinhas where id = p_resource_id;
    end if;
  else
    final_version := current_version;
  end if;

  execution_result := pg_catalog.jsonb_build_object(
    'resource', p_resource_type,
    'id', p_resource_id,
    'shared', p_shared,
    'changed', current_shared is distinct from p_shared,
    'version', final_version,
    'partnership_id', partnership_id
  );

  insert into private.offline_action_receipts (
    user_id,
    idempotency_key,
    action_type,
    payload_hash,
    result,
    client_created_at
  ) values (
    caller,
    p_idempotency_key,
    action_name,
    request_hash,
    execution_result,
    p_client_created_at
  ) returning * into existing;

  return pg_catalog.jsonb_build_object(
    'ok', true,
    'replayed', false,
    'receipt_id', existing.id,
    'result', execution_result
  );
end;
$$;


ALTER FUNCTION "public"."set_financial_resource_sharing"("p_resource_type" "text", "p_resource_id" bigint, "p_shared" boolean, "p_expected_version" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_financial_resource_sharing"("p_resource_type" "text", "p_resource_id" bigint, "p_shared" boolean, "p_expected_version" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) IS 'Compartilha ou torna privada uma conta/objetivo do titular com parceria aceita, versao otimista, lock e recibo idempotente.';



CREATE OR REPLACE FUNCTION "public"."set_transfer_transaction_status"("p_transaction_id" bigint, "p_expected_status" "text", "p_new_status" "text", "p_realization_date" "date", "p_idempotency_key" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
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

  for account_id_to_lock in
    select ids.account_id
    from pg_catalog.unnest(
      array[transaction_row.conta_id, destination_account_id]
    ) as ids(account_id)
    order by ids.account_id
  loop
    -- `require_active=false`: a conta precisa continuar existente e acessível,
    -- mas pode ter sido arquivada depois que a transferência foi agendada.
    perform private.ai_lock_account(caller, account_id_to_lock, false, false);
  end loop;

  select t.* into transaction_row
  from public.transacoes t
  where t.id = p_transaction_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'TRANSFER_NOT_FOUND';
  end if;

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


ALTER FUNCTION "public"."set_transfer_transaction_status"("p_transaction_id" bigint, "p_expected_status" "text", "p_new_status" "text", "p_realization_date" "date", "p_idempotency_key" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."set_transfer_transaction_status"("p_transaction_id" bigint, "p_expected_status" "text", "p_new_status" "text", "p_realization_date" "date", "p_idempotency_key" "uuid") IS 'Conclui ou reabre uma transferencia existente, inclusive quando uma conta foi arquivada depois do agendamento.';



CREATE OR REPLACE FUNCTION "public"."upsert_paddle_subscription"("p_user_id" "uuid", "p_product_code" "text", "p_plan" "text", "p_billing_cycle" "text", "p_subscription_id" "text", "p_customer_id" "text", "p_status" "text", "p_price_id" "text", "p_product_id" "text", "p_started_at" timestamp with time zone, "p_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean, "p_cancelled_at" timestamp with time zone, "p_scheduled_action" "text", "p_scheduled_at" timestamp with time zone, "p_event_at" timestamp with time zone, "p_payload" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  subscription_row_id uuid;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'FINFLOW_SERVICE_ROLE_REQUIRED';
  end if;
  if not exists (
    select 1 from public.paddle_customers pc
    where pc.customer_id = p_customer_id and pc.user_id = p_user_id
  ) then
    raise exception using errcode = '23503', message = 'PADDLE_CUSTOMER_NOT_BOUND';
  end if;

  insert into public.subscriptions (
    user_id, product_code, plan, billing_cycle, provider,
    provider_subscription_id, provider_customer_id, status,
    started_at, current_period_end, access_until,
    cancel_at_period_end, cancelled_at, last_provider_sync_at,
    provider_payload, price_id, product_id,
    scheduled_change_action, scheduled_change_at, last_provider_event_at
  ) values (
    p_user_id, p_product_code, p_plan, p_billing_cycle, 'paddle',
    p_subscription_id, p_customer_id, p_status,
    p_started_at, p_period_end, p_period_end,
    coalesce(p_cancel_at_period_end, false), p_cancelled_at, now(),
    coalesce(p_payload, '{}'::jsonb), p_price_id, p_product_id,
    p_scheduled_action, p_scheduled_at, p_event_at
  )
  on conflict (provider, provider_subscription_id)
    where provider_subscription_id is not null
  do update set
    user_id = excluded.user_id,
    product_code = excluded.product_code,
    plan = excluded.plan,
    billing_cycle = excluded.billing_cycle,
    provider_customer_id = excluded.provider_customer_id,
    status = excluded.status,
    started_at = coalesce(excluded.started_at, public.subscriptions.started_at),
    current_period_end = excluded.current_period_end,
    access_until = excluded.access_until,
    cancel_at_period_end = excluded.cancel_at_period_end,
    cancelled_at = excluded.cancelled_at,
    last_provider_sync_at = now(),
    provider_payload = excluded.provider_payload,
    price_id = excluded.price_id,
    product_id = excluded.product_id,
    scheduled_change_action = excluded.scheduled_change_action,
    scheduled_change_at = excluded.scheduled_change_at,
    last_provider_event_at = excluded.last_provider_event_at,
    updated_at = now()
  where public.subscriptions.last_provider_event_at is null
     or excluded.last_provider_event_at >= public.subscriptions.last_provider_event_at
  returning id into subscription_row_id;

  if subscription_row_id is null then
    select s.id into subscription_row_id from public.subscriptions s
    where s.provider = 'paddle' and s.provider_subscription_id = p_subscription_id;
  end if;
  return subscription_row_id;
end;
$$;


ALTER FUNCTION "public"."upsert_paddle_subscription"("p_user_id" "uuid", "p_product_code" "text", "p_plan" "text", "p_billing_cycle" "text", "p_subscription_id" "text", "p_customer_id" "text", "p_status" "text", "p_price_id" "text", "p_product_id" "text", "p_started_at" timestamp with time zone, "p_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean, "p_cancelled_at" timestamp with time zone, "p_scheduled_action" "text", "p_scheduled_at" timestamp with time zone, "p_event_at" timestamp with time zone, "p_payload" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "private"."ai_invoice_payment_ledger" (
    "payment_transaction_id" bigint NOT NULL,
    "action_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "card_id" bigint,
    "invoice_month" "text" NOT NULL,
    "mode" "text" NOT NULL,
    "paid_item_ids" bigint[] DEFAULT '{}'::bigint[] NOT NULL,
    "linked_item_id" bigint,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "reversed_at" timestamp with time zone,
    "source" "text" DEFAULT 'ai'::"text" NOT NULL,
    "request_id" "uuid",
    "reversal_request_id" "uuid",
    "operation_result" "jsonb",
    "reversal_result" "jsonb",
    CONSTRAINT "ai_invoice_payment_ledger_invoice_month_check" CHECK (("invoice_month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'::"text")),
    CONSTRAINT "ai_invoice_payment_ledger_mode_check" CHECK (("mode" = ANY (ARRAY['total'::"text", 'partial'::"text", 'carry_forward'::"text"]))),
    CONSTRAINT "ai_invoice_payment_ledger_operation_result_size_check" CHECK ((("operation_result" IS NULL) OR ("octet_length"(("operation_result")::"text") <= 32768))),
    CONSTRAINT "ai_invoice_payment_ledger_reversal_result_size_check" CHECK ((("reversal_result" IS NULL) OR ("octet_length"(("reversal_result")::"text") <= 32768))),
    CONSTRAINT "ai_invoice_payment_ledger_source_check" CHECK (("source" = ANY (ARRAY['ai'::"text", 'manual'::"text", 'legacy'::"text"])))
);


ALTER TABLE "private"."ai_invoice_payment_ledger" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."bank_reconciliation_receipts" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "account_id" bigint NOT NULL,
    "entry_fingerprint" "text" NOT NULL,
    "entry_date" "date" NOT NULL,
    "entry_type" "text" NOT NULL,
    "entry_amount" numeric(14,2) NOT NULL,
    "reconciliation_mode" "text" NOT NULL,
    "transaction_id" bigint,
    "idempotency_key" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "scheduled_amount" numeric(14,2),
    "interest_amount" numeric(14,2),
    "payment_id" "uuid",
    CONSTRAINT "bank_reconciliation_receipts_entry_amount_check" CHECK ((("entry_amount" > (0)::numeric) AND ("entry_amount" <= 999999999999.99))),
    CONSTRAINT "bank_reconciliation_receipts_entry_fingerprint_check" CHECK (("entry_fingerprint" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "bank_reconciliation_receipts_entry_type_check" CHECK (("entry_type" = ANY (ARRAY['receita'::"text", 'despesa'::"text"]))),
    CONSTRAINT "bank_reconciliation_receipts_interest_amount_check" CHECK ((("interest_amount" IS NULL) OR ("interest_amount" > (0)::numeric))),
    CONSTRAINT "bank_reconciliation_receipts_reconciliation_mode_check" CHECK (("reconciliation_mode" = ANY (ARRAY['existing'::"text", 'new'::"text", 'ignored'::"text"])))
);


ALTER TABLE "private"."bank_reconciliation_receipts" OWNER TO "postgres";


ALTER TABLE "private"."bank_reconciliation_receipts" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "private"."bank_reconciliation_receipts_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "private"."bank_reconciliation_transactions" (
    "receipt_id" bigint NOT NULL,
    "transaction_id" bigint NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "payment_id" "uuid",
    CONSTRAINT "bank_reconciliation_transactions_amount_check" CHECK (("amount" > (0)::numeric))
);


ALTER TABLE "private"."bank_reconciliation_transactions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."edge_rate_limits" (
    "scope" "text" NOT NULL,
    "subject_hash" "text" NOT NULL,
    "window_started_at" timestamp with time zone NOT NULL,
    "attempts" integer NOT NULL,
    "last_attempt_at" timestamp with time zone NOT NULL,
    CONSTRAINT "edge_rate_limits_attempts_check" CHECK ((("attempts" >= 1) AND ("attempts" <= 10000))),
    CONSTRAINT "edge_rate_limits_hash_check" CHECK (("subject_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "edge_rate_limits_scope_check" CHECK (("scope" = ANY (ARRAY['sms_verification'::"text", 'subscription_checkout'::"text"])))
);


ALTER TABLE "private"."edge_rate_limits" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."offline_action_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "idempotency_key" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "payload_hash" "text" NOT NULL,
    "result" "jsonb" NOT NULL,
    "client_created_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "offline_action_receipts_payload_hash_check" CHECK (("payload_hash" ~ '^[0-9a-f]{64}$'::"text"))
);


ALTER TABLE "private"."offline_action_receipts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."phone_verification_reservations" (
    "phone" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "phone_verification_reservations_phone_format" CHECK (("phone" ~ '^\+55[1-9]{2}9[0-9]{8}$'::"text"))
);


ALTER TABLE "private"."phone_verification_reservations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "private"."transaction_completion_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "idempotency_key" "uuid" NOT NULL,
    "transaction_id" bigint NOT NULL,
    "expected_value" numeric(14,2) NOT NULL,
    "adjustment_type" "text" NOT NULL,
    "adjustment_value" numeric(14,2) NOT NULL,
    "total_due" numeric(14,2) NOT NULL,
    "realized_value" numeric(14,2) NOT NULL,
    "remaining_value" numeric(14,2) DEFAULT 0 NOT NULL,
    "remaining_transaction_id" bigint,
    "remaining_description" "text",
    "transaction_user_id" "uuid",
    "transaction_type" "text",
    "account_id" bigint,
    "category_id" bigint,
    "due_date" "date",
    "original_description" "text",
    "completed_description" "text",
    "realization_date" "date" NOT NULL,
    "result" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "reopened_at" timestamp with time zone,
    "reopened_by" "uuid",
    "root_transaction_id" bigint NOT NULL,
    "payment_transaction_id" bigint NOT NULL,
    "payment_sequence" integer NOT NULL,
    CONSTRAINT "transaction_completion_receipts_adjustment_type_check" CHECK (("adjustment_type" = ANY (ARRAY['none'::"text", 'interest'::"text", 'discount'::"text"]))),
    CONSTRAINT "transaction_completion_receipts_adjustment_value_check" CHECK (("adjustment_value" >= (0)::numeric)),
    CONSTRAINT "transaction_completion_receipts_remaining_value_check" CHECK (("remaining_value" >= (0)::numeric))
);


ALTER TABLE "private"."transaction_completion_receipts" OWNER TO "postgres";


COMMENT ON COLUMN "private"."transaction_completion_receipts"."user_id" IS 'Ator que registrou a baixa. Fica NULL se a conta do ator for excluída; transaction_user_id identifica o dono do lançamento.';



CREATE TABLE IF NOT EXISTS "private"."transaction_reopen_receipts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "idempotency_key" "uuid" NOT NULL,
    "transaction_id" bigint NOT NULL,
    "completion_receipt_id" "uuid",
    "result" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);


ALTER TABLE "private"."transaction_reopen_receipts" OWNER TO "postgres";


COMMENT ON COLUMN "private"."transaction_reopen_receipts"."user_id" IS 'Ator que registrou o estorno. Fica NULL se a conta do ator for excluída; transaction_id e completion_receipt_id preservam o evento financeiro.';



CREATE TABLE IF NOT EXISTS "public"."ai_action_audit" (
    "id" bigint NOT NULL,
    "action_id" "uuid",
    "user_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "payload_snapshot" "jsonb",
    "result" "jsonb",
    "error_code" "text",
    "idempotency_key" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "ai_action_audit_error_code_check" CHECK ((("error_code" IS NULL) OR ("error_code" ~ '^AI_[A-Z0-9_]+$'::"text"))),
    CONSTRAINT "ai_action_audit_event_type_check" CHECK (("event_type" = ANY (ARRAY['created'::"text", 'executing'::"text", 'succeeded'::"text", 'failed'::"text", 'cancelled'::"text", 'expired'::"text", 'quota_rejected'::"text", 'replayed'::"text", 'no_op'::"text"]))),
    CONSTRAINT "ai_action_audit_payload_snapshot_check" CHECK ((("payload_snapshot" IS NULL) OR ("octet_length"(("payload_snapshot")::"text") <= 16384))),
    CONSTRAINT "ai_action_audit_result_check" CHECK ((("result" IS NULL) OR ("octet_length"(("result")::"text") <= 32768)))
);


ALTER TABLE "public"."ai_action_audit" OWNER TO "postgres";


ALTER TABLE "public"."ai_action_audit" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_action_audit_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "state" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    CONSTRAINT "ai_conversations_state_check" CHECK ((("jsonb_typeof"("state") = 'object'::"text") AND ("octet_length"(("state")::"text") <= 32768)))
);


ALTER TABLE "public"."ai_conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_messages" (
    "id" bigint NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "content" "text" NOT NULL,
    "intent" "text",
    "provider" "text",
    "model" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "market_indicators" "jsonb",
    "account_balances" "jsonb",
    CONSTRAINT "ai_messages_account_balances_check" CHECK ((("account_balances" IS NULL) OR (("jsonb_typeof"("account_balances") = 'object'::"text") AND (((("account_balances" - 'accounts'::"text") - 'hiddenCount'::"text") - 'totalBalance'::"text") = '{}'::"jsonb") AND ("jsonb_typeof"(("account_balances" -> 'accounts'::"text")) = 'array'::"text") AND (("jsonb_array_length"(("account_balances" -> 'accounts'::"text")) >= 1) AND ("jsonb_array_length"(("account_balances" -> 'accounts'::"text")) <= 6)) AND ("jsonb_typeof"(("account_balances" -> 'hiddenCount'::"text")) = 'number'::"text") AND ("jsonb_typeof"(("account_balances" -> 'totalBalance'::"text")) = 'number'::"text")))),
    CONSTRAINT "ai_messages_content_check" CHECK ((("length"("btrim"("content")) >= 1) AND ("length"("btrim"("content")) <= 2000) AND ("content" !~* '(sb_secret_|service_role[^[:space:]]{0,8}[=:]|gsk_[A-Za-z0-9_-]{20,}|authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{20,})'::"text"))),
    CONSTRAINT "ai_messages_intent_check" CHECK ((("intent" IS NULL) OR (("length"("intent") >= 1) AND ("length"("intent") <= 80)))),
    CONSTRAINT "ai_messages_market_indicators_check" CHECK ((("market_indicators" IS NULL) OR (("jsonb_typeof"("market_indicators") = 'object'::"text") AND (("market_indicators" ->> 'source'::"text") = 'bcb_sgs'::"text") AND (((((((((("market_indicators" - 'selic_rate_annual'::"text") - 'selic_reference_date'::"text") - 'cdi_rate_annual'::"text") - 'cdi_reference_date'::"text") - 'ipca_12m_percent'::"text") - 'ipca_reference_date'::"text") - 'igpm_12m_percent'::"text") - 'igpm_reference_date'::"text") - 'source'::"text") = '{}'::"jsonb")))),
    CONSTRAINT "ai_messages_model_check" CHECK ((("model" IS NULL) OR (("length"("model") >= 1) AND ("length"("model") <= 120)))),
    CONSTRAINT "ai_messages_no_sensitive_data_check" CHECK (("content" !~* ((((((((((((('('::"text" || 'sb_secret_[A-Za-z0-9_-]*'::"text") || '|service_role[^[:space:]]{0,8}[=:]'::"text") || '|gsk_[A-Za-z0-9_-]{20,}'::"text") || '|authorization[[:space:]]*:[[:space:]]*bearer[[:space:]]+[A-Za-z0-9._-]{20,}'::"text") || '|xkeysib-[A-Za-z0-9_-]{20,}'::"text") || '|xai-[A-Za-z0-9_-]{20,}'::"text") || '|sk-(ant-)?[A-Za-z0-9_-]{20,}'::"text") || '|AIza[A-Za-z0-9_-]{20,}'::"text") || '|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}'::"text") || '|[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}'::"text") || '|(senha([[:space:]]+(banc[aá]ria|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|password|pin([[:space:]]+(banc[aá]rio|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|c[oó]digo[[:space:]]+(banc[aá]rio|de[[:space:]]+(acesso|seguran[cç]a|verifica[cç][aã]o|autentica[cç][aã]o)|do[[:space:]]+(app|cart[aã]o|internet[[:space:]]+banking)))[[:space:]]*(é|e|eh|:|=)[[:space:]]*[^[:space:],;]{3,}'::"text") || '|(minha|meu)[[:space:]]+(senha([[:space:]]+(banc[aá]ria|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|password|pin([[:space:]]+(banc[aá]rio|do[[:space:]]+banco|da[[:space:]]+conta|do[[:space:]]+cart[aã]o|do[[:space:]]+app))?|c[oó]digo[[:space:]]+(banc[aá]rio|de[[:space:]]+(acesso|seguran[cç]a|verifica[cç][aã]o|autentica[cç][aã]o)|do[[:space:]]+(app|cart[aã]o|internet[[:space:]]+banking)))[[:space:]]+((é|e|eh)[[:space:]]+)?[^[:space:],;]{3,}'::"text") || ')'::"text"))),
    CONSTRAINT "ai_messages_provider_check" CHECK ((("provider" IS NULL) OR (("length"("provider") >= 1) AND ("length"("provider") <= 80)))),
    CONSTRAINT "ai_messages_role_check" CHECK (("role" = ANY (ARRAY['user'::"text", 'assistant'::"text"])))
);


ALTER TABLE "public"."ai_messages" OWNER TO "postgres";


ALTER TABLE "public"."ai_messages" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_messages_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_pending_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "action_type" "text" NOT NULL,
    "payload" "jsonb" NOT NULL,
    "payload_hash" "text" NOT NULL,
    "state_fingerprint" "text",
    "preview" "jsonb" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "confirmation_token" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "result" "jsonb",
    "last_error_code" "text",
    "created_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "executed_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    CONSTRAINT "ai_pending_actions_action_type_check" CHECK (("action_type" = ANY (ARRAY['create_account'::"text", 'update_account'::"text", 'archive_account'::"text", 'delete_account'::"text", 'reactivate_account'::"text", 'create_category'::"text", 'update_category'::"text", 'archive_category'::"text", 'delete_category'::"text", 'reactivate_category'::"text", 'create_goal'::"text", 'update_goal'::"text", 'archive_goal'::"text", 'delete_goal'::"text", 'reactivate_goal'::"text", 'move_goal'::"text", 'create_transaction'::"text", 'update_transaction'::"text", 'delete_transaction'::"text", 'complete_transaction'::"text", 'reopen_transaction'::"text", 'transfer_between_accounts'::"text", 'create_card'::"text", 'update_card'::"text", 'archive_card'::"text", 'delete_card'::"text", 'reactivate_card'::"text", 'create_card_purchase'::"text", 'update_card_purchase'::"text", 'delete_card_purchase'::"text", 'pay_invoice'::"text", 'reverse_invoice_payment'::"text"]))),
    CONSTRAINT "ai_pending_actions_check" CHECK ((("expires_at" > "created_at") AND ("expires_at" <= ("created_at" + '00:30:00'::interval)))),
    CONSTRAINT "ai_pending_actions_idempotency_key_check" CHECK ((("length"("idempotency_key") >= 16) AND ("length"("idempotency_key") <= 200) AND ("idempotency_key" ~ '^[A-Za-z0-9:_-]+$'::"text"))),
    CONSTRAINT "ai_pending_actions_last_error_code_check" CHECK ((("last_error_code" IS NULL) OR ("last_error_code" ~ '^AI_[A-Z0-9_]+$'::"text"))),
    CONSTRAINT "ai_pending_actions_payload_check" CHECK ((("jsonb_typeof"("payload") = 'object'::"text") AND ("octet_length"(("payload")::"text") <= 16384))),
    CONSTRAINT "ai_pending_actions_payload_hash_check" CHECK (("payload_hash" ~ '^[0-9a-f]{64}$'::"text")),
    CONSTRAINT "ai_pending_actions_preview_check" CHECK ((("jsonb_typeof"("preview") = 'object'::"text") AND ("octet_length"(("preview")::"text") <= 8192))),
    CONSTRAINT "ai_pending_actions_result_check" CHECK ((("result" IS NULL) OR ("octet_length"(("result")::"text") <= 32768))),
    CONSTRAINT "ai_pending_actions_state_fingerprint_check" CHECK ((("state_fingerprint" IS NULL) OR ("state_fingerprint" ~ '^[0-9a-f]{64}$'::"text"))),
    CONSTRAINT "ai_pending_actions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'executing'::"text", 'succeeded'::"text", 'failed'::"text", 'cancelled'::"text", 'expired'::"text"])))
);


ALTER TABLE "public"."ai_pending_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_request_usage" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "usage_id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text",
    "model" "text",
    "input_tokens" bigint,
    "output_tokens" bigint,
    "request_status" "text" DEFAULT 'reserved'::"text" NOT NULL,
    "finalized_at" timestamp with time zone,
    "reserved_input_tokens" bigint DEFAULT 0 NOT NULL,
    "reserved_output_tokens" bigint DEFAULT 0 NOT NULL,
    "token_reserved_at" timestamp with time zone,
    "latency_ms" integer,
    "error_code" "text",
    CONSTRAINT "ai_request_usage_error_code_check" CHECK ((("error_code" IS NULL) OR (("length"("error_code") >= 3) AND ("length"("error_code") <= 80) AND ("error_code" ~ '^[A-Z][A-Z0-9_]+$'::"text")))),
    CONSTRAINT "ai_request_usage_finalization_check" CHECK (((("request_status" = 'reserved'::"text") AND ("finalized_at" IS NULL)) OR (("request_status" = ANY (ARRAY['completed'::"text", 'failed'::"text"])) AND ("finalized_at" IS NOT NULL)))),
    CONSTRAINT "ai_request_usage_input_tokens_check" CHECK ((("input_tokens" IS NULL) OR (("input_tokens" >= 0) AND ("input_tokens" <= 1000000000)))),
    CONSTRAINT "ai_request_usage_latency_ms_check" CHECK ((("latency_ms" IS NULL) OR (("latency_ms" >= 0) AND ("latency_ms" <= 300000)))),
    CONSTRAINT "ai_request_usage_model_check" CHECK ((("model" IS NULL) OR (("length"("btrim"("model")) >= 1) AND ("length"("btrim"("model")) <= 120)))),
    CONSTRAINT "ai_request_usage_output_tokens_check" CHECK ((("output_tokens" IS NULL) OR (("output_tokens" >= 0) AND ("output_tokens" <= 1000000000)))),
    CONSTRAINT "ai_request_usage_provider_check" CHECK ((("provider" IS NULL) OR (("length"("btrim"("provider")) >= 1) AND ("length"("btrim"("provider")) <= 40)))),
    CONSTRAINT "ai_request_usage_reserved_input_tokens_check" CHECK ((("reserved_input_tokens" >= 0) AND ("reserved_input_tokens" <= 1000000000))),
    CONSTRAINT "ai_request_usage_reserved_output_tokens_check" CHECK ((("reserved_output_tokens" >= 0) AND ("reserved_output_tokens" <= 1000000000))),
    CONSTRAINT "ai_request_usage_status_check" CHECK (("request_status" = ANY (ARRAY['reserved'::"text", 'completed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."ai_request_usage" OWNER TO "postgres";


COMMENT ON COLUMN "public"."ai_request_usage"."latency_ms" IS 'Latencia tecnica total da requisicao da IA; nao contem conteudo financeiro.';



COMMENT ON COLUMN "public"."ai_request_usage"."error_code" IS 'Codigo tecnico allowlisted; nunca armazena mensagem, prompt ou resposta.';



ALTER TABLE "public"."ai_request_usage" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."ai_request_usage_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."ai_transaction_origins" (
    "transaction_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source" "text" DEFAULT 'ai'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_transaction_origins_source_check" CHECK (("source" = 'ai'::"text"))
);


ALTER TABLE "public"."ai_transaction_origins" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_products" (
    "code" "text" NOT NULL,
    "plan" "text" NOT NULL,
    "billing_cycle" "text" NOT NULL,
    "amount_brl" numeric(10,2) NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "mercado_pago_plan_id" "text",
    "google_play_product_id" "text",
    "apple_product_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "billing_products_amount_brl_check" CHECK (("amount_brl" > (0)::numeric)),
    CONSTRAINT "billing_products_billing_cycle_check" CHECK (("billing_cycle" = ANY (ARRAY['monthly'::"text", 'annual'::"text"]))),
    CONSTRAINT "billing_products_plan_check" CHECK (("plan" = ANY (ARRAY['smart'::"text", 'premium'::"text"])))
);


ALTER TABLE "public"."billing_products" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."billing_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "billing_enabled" boolean DEFAULT false NOT NULL,
    "limits_enabled" boolean DEFAULT false NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_global_requests_per_day" integer DEFAULT 900 NOT NULL,
    "ai_global_requests_per_minute" integer DEFAULT 100 NOT NULL,
    "ai_global_tokens_per_day" bigint DEFAULT 5000000 NOT NULL,
    "ai_global_tokens_per_minute" bigint DEFAULT 180000 NOT NULL,
    CONSTRAINT "billing_settings_ai_global_requests_day_check" CHECK ((("ai_global_requests_per_day" >= 100) AND ("ai_global_requests_per_day" <= 1000000))),
    CONSTRAINT "billing_settings_ai_global_requests_minute_check" CHECK ((("ai_global_requests_per_minute" >= 10) AND ("ai_global_requests_per_minute" <= 10000))),
    CONSTRAINT "billing_settings_ai_global_tokens_day_check" CHECK ((("ai_global_tokens_per_day" >= 10000) AND ("ai_global_tokens_per_day" <= '1000000000000'::bigint))),
    CONSTRAINT "billing_settings_ai_global_tokens_minute_check" CHECK ((("ai_global_tokens_per_minute" >= 1000) AND ("ai_global_tokens_per_minute" <= 1000000000))),
    CONSTRAINT "billing_settings_id_check" CHECK ("id")
);


ALTER TABLE "public"."billing_settings" OWNER TO "postgres";


COMMENT ON TABLE "public"."billing_settings" IS 'Chaves operacionais. limits_enabled=false libera limites durante desenvolvimento sem conceder plano pago.';



CREATE TABLE IF NOT EXISTS "public"."caixinhas" (
    "id" bigint NOT NULL,
    "nome" "text" NOT NULL,
    "meta_valor" numeric NOT NULL,
    "saldo_atual" numeric DEFAULT 0,
    "cor" "text" NOT NULL,
    "icone" "text" NOT NULL,
    "user_id" "uuid",
    "compartilhado" boolean DEFAULT false,
    "data_prazo" "date",
    "arquivado" boolean DEFAULT false,
    "version" bigint DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);


ALTER TABLE "public"."caixinhas" OWNER TO "postgres";


ALTER TABLE "public"."caixinhas" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."caixinhas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."cartoes" (
    "id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "nome" character varying(100) NOT NULL,
    "cor" character varying(20) DEFAULT '#457B9D'::character varying NOT NULL,
    "limite" numeric(12,2) DEFAULT 0 NOT NULL,
    "dia_vencimento" integer DEFAULT 10 NOT NULL,
    "dia_fechamento" integer DEFAULT 3 NOT NULL,
    "ativo" boolean DEFAULT true NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"(),
    "version" bigint DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);


ALTER TABLE "public"."cartoes" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."cartoes_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."cartoes_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."cartoes_id_seq" OWNED BY "public"."cartoes"."id";



CREATE TABLE IF NOT EXISTS "public"."categorias" (
    "id" bigint NOT NULL,
    "nome" "text" NOT NULL,
    "cor" "text" NOT NULL,
    "icone" "text" NOT NULL,
    "tipo" "text" NOT NULL,
    "ativa" smallint DEFAULT 1,
    "user_id" "uuid",
    "bloqueado_plano" boolean DEFAULT false NOT NULL,
    "version" bigint DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);


ALTER TABLE "public"."categorias" OWNER TO "postgres";


ALTER TABLE "public"."categorias" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."categorias_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."chat_historico" (
    "id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "texto" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."chat_historico" OWNER TO "postgres";


ALTER TABLE "public"."chat_historico" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."chat_historico_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."contas" (
    "id" bigint NOT NULL,
    "nome" "text" NOT NULL,
    "saldo_inicial" numeric DEFAULT 0 NOT NULL,
    "user_id" "uuid",
    "compartilhado" boolean DEFAULT false,
    "cor" "text",
    "arquivado" boolean DEFAULT false,
    "version" bigint DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL
);


ALTER TABLE "public"."contas" OWNER TO "postgres";


ALTER TABLE "public"."contas" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."contas_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."contas_ocultas_usuario" (
    "conta_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "resumo_id" bigint NOT NULL,
    "motivo" "text" DEFAULT 'dissolucao_parceria'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."contas_ocultas_usuario" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."dispositivos_push" (
    "token" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "plataforma" "text" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "atualizado_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "dispositivos_push_plataforma_check" CHECK (("plataforma" = ANY (ARRAY['ios'::"text", 'android'::"text"]))),
    CONSTRAINT "dispositivos_push_token_check" CHECK (("token" ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$'::"text"))
);


ALTER TABLE "public"."dispositivos_push" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."fatura_itens" (
    "id" integer NOT NULL,
    "cartao_id" integer NOT NULL,
    "user_id" "uuid" NOT NULL,
    "descricao" character varying(200) NOT NULL,
    "valor" numeric(12,2) NOT NULL,
    "data_compra" "date" NOT NULL,
    "mes_fatura" character varying(7) NOT NULL,
    "parcela_atual" integer DEFAULT 1 NOT NULL,
    "total_parcelas" integer DEFAULT 1 NOT NULL,
    "grupo_parcela_id" integer,
    "categoria_id" integer,
    "pago" boolean DEFAULT false NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."fatura_itens" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."fatura_itens_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."fatura_itens_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."fatura_itens_id_seq" OWNED BY "public"."fatura_itens"."id";



CREATE TABLE IF NOT EXISTS "public"."feedbacks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid",
    "tipo" "text" NOT NULL,
    "mensagem" "text" NOT NULL,
    "criado_em" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."feedbacks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notificacoes_sistema" (
    "id" bigint NOT NULL,
    "destinatario_id" "uuid" NOT NULL,
    "tipo" "text" NOT NULL,
    "referencia_id" bigint NOT NULL,
    "titulo" "text" NOT NULL,
    "mensagem" "text" NOT NULL,
    "dados" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "criada_em" timestamp with time zone DEFAULT "now"() NOT NULL,
    "lida_em" timestamp with time zone,
    "expira_em" timestamp with time zone DEFAULT ("now"() + '5 days'::interval) NOT NULL,
    "push_enviado_em" timestamp with time zone,
    CONSTRAINT "notificacoes_sistema_tipo_check" CHECK (("tipo" = ANY (ARRAY['convite_parceria'::"text", 'parceria_aceita'::"text", 'parceria_recusada'::"text", 'parceria_encerrada'::"text"])))
);


ALTER TABLE "public"."notificacoes_sistema" OWNER TO "postgres";


ALTER TABLE "public"."notificacoes_sistema" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."notificacoes_sistema_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."paddle_customers" (
    "customer_id" "text" NOT NULL,
    "user_id" "uuid",
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "environment" "text" DEFAULT 'sandbox'::"text" NOT NULL,
    CONSTRAINT "paddle_customers_customer_id_check" CHECK (("customer_id" ~ '^ctm_[a-z0-9]+$'::"text")),
    CONSTRAINT "paddle_customers_environment_check" CHECK (("environment" = ANY (ARRAY['sandbox'::"text", 'production'::"text"])))
);


ALTER TABLE "public"."paddle_customers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."parceria_caixinha_decisoes" (
    "id" bigint NOT NULL,
    "parceria_id" bigint NOT NULL,
    "source_caixinha_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "source_owner_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "meta_valor" numeric NOT NULL,
    "saldo_total" numeric NOT NULL,
    "cor" "text" NOT NULL,
    "icone" "text" NOT NULL,
    "data_prazo" "date",
    "status" "text" DEFAULT 'pendente'::"text" NOT NULL,
    "saldo_definido" numeric,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "parceria_caixinha_decisoes_saldo_definido_check" CHECK (("saldo_definido" >= (0)::numeric)),
    CONSTRAINT "parceria_caixinha_decisoes_saldo_total_check" CHECK (("saldo_total" >= (0)::numeric)),
    CONSTRAINT "parceria_caixinha_decisoes_status_check" CHECK (("status" = ANY (ARRAY['pendente'::"text", 'mantida'::"text", 'descartada'::"text"])))
);


ALTER TABLE "public"."parceria_caixinha_decisoes" OWNER TO "postgres";


ALTER TABLE "public"."parceria_caixinha_decisoes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."parceria_caixinha_decisoes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."parceria_dissolucao_itens" (
    "id" bigint NOT NULL,
    "resumo_id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "source_id" bigint NOT NULL,
    "target_conta_id" bigint,
    "source_owner_id" "uuid" NOT NULL,
    "nome" "text" NOT NULL,
    "saldo_final" numeric NOT NULL,
    "possui_lancamentos" boolean DEFAULT false NOT NULL,
    "estado" "text" NOT NULL,
    "resolved_at" timestamp with time zone,
    CONSTRAINT "parceria_dissolucao_itens_estado_check" CHECK (("estado" = ANY (ARRAY['informativo'::"text", 'pendente'::"text", 'mantida'::"text", 'arquivada'::"text", 'removida'::"text"]))),
    CONSTRAINT "parceria_dissolucao_itens_tipo_check" CHECK (("tipo" = ANY (ARRAY['conta'::"text", 'caixinha'::"text"])))
);


ALTER TABLE "public"."parceria_dissolucao_itens" OWNER TO "postgres";


ALTER TABLE "public"."parceria_dissolucao_itens" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."parceria_dissolucao_itens_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."parceria_dissolucao_resumos" (
    "id" bigint NOT NULL,
    "parceria_id" bigint NOT NULL,
    "user_id" "uuid" NOT NULL,
    "iniciada_por" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "visto_em" timestamp with time zone
);


ALTER TABLE "public"."parceria_dissolucao_resumos" OWNER TO "postgres";


ALTER TABLE "public"."parceria_dissolucao_resumos" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."parceria_dissolucao_resumos_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."parcerias" (
    "id" bigint NOT NULL,
    "solicitante_id" "uuid",
    "convidado_email" "text" NOT NULL,
    "convidado_id" "uuid",
    "status" "text" DEFAULT 'pendente'::"text"
);


ALTER TABLE "public"."parcerias" OWNER TO "postgres";


ALTER TABLE "public"."parcerias" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."parcerias_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



CREATE TABLE IF NOT EXISTS "public"."subscription_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "provider_event_id" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "subscription_id" "uuid",
    "payload" "jsonb" NOT NULL,
    "processed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processing_token" "uuid",
    "processing_started_at" timestamp with time zone,
    "processing_locked_until" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    CONSTRAINT "subscription_events_attempt_count_check" CHECK ((("attempt_count" >= 0) AND ("attempt_count" <= 10000)))
);


ALTER TABLE "public"."subscription_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "product_code" "text" NOT NULL,
    "plan" "text" NOT NULL,
    "billing_cycle" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "provider_subscription_id" "text",
    "provider_customer_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "started_at" timestamp with time zone,
    "current_period_end" timestamp with time zone,
    "access_until" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "cancelled_at" timestamp with time zone,
    "last_provider_sync_at" timestamp with time zone,
    "provider_payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "checkout_idempotency_key" "text",
    "checkout_error_code" "text",
    "checkout_last_attempt_at" timestamp with time zone,
    "checkout_attempt_count" integer DEFAULT 0 NOT NULL,
    "price_id" "text",
    "product_id" "text",
    "scheduled_change_action" "text",
    "scheduled_change_at" timestamp with time zone,
    "last_provider_event_at" timestamp with time zone,
    CONSTRAINT "subscriptions_billing_cycle_check" CHECK (("billing_cycle" = ANY (ARRAY['monthly'::"text", 'annual'::"text"]))),
    CONSTRAINT "subscriptions_checkout_attempt_count_check" CHECK ((("checkout_attempt_count" >= 0) AND ("checkout_attempt_count" <= 10000))),
    CONSTRAINT "subscriptions_checkout_error_code_check" CHECK ((("checkout_error_code" IS NULL) OR (("length"("checkout_error_code") >= 3) AND ("length"("checkout_error_code") <= 80) AND ("checkout_error_code" ~ '^[A-Z][A-Z0-9_]+$'::"text")))),
    CONSTRAINT "subscriptions_checkout_idempotency_key_check" CHECK ((("checkout_idempotency_key" IS NULL) OR (("length"("checkout_idempotency_key") >= 8) AND ("length"("checkout_idempotency_key") <= 160) AND ("checkout_idempotency_key" ~ '^[A-Za-z0-9:_-]+$'::"text")))),
    CONSTRAINT "subscriptions_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'smart'::"text", 'premium'::"text"]))),
    CONSTRAINT "subscriptions_provider_check" CHECK (("provider" = ANY (ARRAY['mercado_pago'::"text", 'google_play'::"text", 'apple'::"text", 'paddle'::"text"]))),
    CONSTRAINT "subscriptions_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'active'::"text", 'trialing'::"text", 'past_due'::"text", 'grace_period'::"text", 'paused'::"text", 'cancelled'::"text", 'expired'::"text", 'refunded'::"text"])))
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


COMMENT ON TABLE "public"."subscriptions" IS 'Fonte oficial de direitos. Nunca permita escrita direta pelo aplicativo.';



CREATE TABLE IF NOT EXISTS "public"."transacoes" (
    "id" bigint NOT NULL,
    "tipo" "text" NOT NULL,
    "valor" numeric NOT NULL,
    "data_vencimento" "date",
    "descricao" "text" NOT NULL,
    "status" "text" DEFAULT 'pendente'::"text",
    "categoria_id" bigint,
    "conta_id" bigint,
    "user_id" "uuid",
    "data_realizacao" "date",
    "version" bigint DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "clock_timestamp"() NOT NULL,
    "transacao_pai_id" bigint,
    CONSTRAINT "transacoes_payment_child_not_self" CHECK ((("transacao_pai_id" IS NULL) OR ("transacao_pai_id" <> "id")))
);


ALTER TABLE "public"."transacoes" OWNER TO "postgres";


COMMENT ON COLUMN "public"."transacoes"."data_realizacao" IS 'Data em que a movimentação foi efetivamente paga ou recebida. data_vencimento permanece como data agendada.';



COMMENT ON COLUMN "public"."transacoes"."transacao_pai_id" IS 'Vincula uma baixa parcial tecnica ao unico agendamento raiz exibido no app.';



ALTER TABLE "public"."transacoes" ALTER COLUMN "id" ADD GENERATED BY DEFAULT AS IDENTITY (
    SEQUENCE NAME "public"."transacoes_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);



ALTER TABLE ONLY "public"."cartoes" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."cartoes_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."fatura_itens" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."fatura_itens_id_seq"'::"regclass");



ALTER TABLE ONLY "private"."ai_invoice_payment_ledger"
    ADD CONSTRAINT "ai_invoice_payment_ledger_pkey" PRIMARY KEY ("payment_transaction_id");



ALTER TABLE ONLY "private"."bank_reconciliation_receipts"
    ADD CONSTRAINT "bank_reconciliation_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "private"."bank_reconciliation_receipts"
    ADD CONSTRAINT "bank_reconciliation_receipts_user_id_account_id_entry_finge_key" UNIQUE ("user_id", "account_id", "entry_fingerprint");



ALTER TABLE ONLY "private"."bank_reconciliation_receipts"
    ADD CONSTRAINT "bank_reconciliation_receipts_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "private"."bank_reconciliation_transactions"
    ADD CONSTRAINT "bank_reconciliation_transactions_pkey" PRIMARY KEY ("receipt_id", "transaction_id");



ALTER TABLE ONLY "private"."edge_rate_limits"
    ADD CONSTRAINT "edge_rate_limits_pkey" PRIMARY KEY ("scope", "subject_hash");



ALTER TABLE ONLY "private"."offline_action_receipts"
    ADD CONSTRAINT "offline_action_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "private"."offline_action_receipts"
    ADD CONSTRAINT "offline_action_receipts_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "private"."phone_verification_reservations"
    ADD CONSTRAINT "phone_verification_reservations_pkey" PRIMARY KEY ("phone");



ALTER TABLE ONLY "private"."transaction_completion_receipts"
    ADD CONSTRAINT "transaction_completion_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "private"."transaction_completion_receipts"
    ADD CONSTRAINT "transaction_completion_receipts_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "private"."transaction_reopen_receipts"
    ADD CONSTRAINT "transaction_reopen_receipts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "private"."transaction_reopen_receipts"
    ADD CONSTRAINT "transaction_reopen_receipts_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "public"."ai_action_audit"
    ADD CONSTRAINT "ai_action_audit_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_pending_actions"
    ADD CONSTRAINT "ai_pending_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_pending_actions"
    ADD CONSTRAINT "ai_pending_actions_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE "public"."ai_request_usage"
    ADD CONSTRAINT "ai_request_usage_monitoring_state_check" CHECK (((("request_status" = 'reserved'::"text") AND ("latency_ms" IS NULL) AND ("error_code" IS NULL)) OR (("request_status" = 'completed'::"text") AND ("error_code" IS NULL)) OR (("request_status" = 'failed'::"text") AND ((("latency_ms" IS NULL) AND ("error_code" IS NULL)) OR (("latency_ms" IS NOT NULL) AND ("error_code" IS NOT NULL)))))) NOT VALID;



ALTER TABLE ONLY "public"."ai_request_usage"
    ADD CONSTRAINT "ai_request_usage_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_request_usage"
    ADD CONSTRAINT "ai_request_usage_usage_id_key" UNIQUE ("usage_id");



ALTER TABLE ONLY "public"."ai_transaction_origins"
    ADD CONSTRAINT "ai_transaction_origins_pkey" PRIMARY KEY ("transaction_id");



ALTER TABLE ONLY "public"."billing_products"
    ADD CONSTRAINT "billing_products_pkey" PRIMARY KEY ("code");



ALTER TABLE ONLY "public"."billing_products"
    ADD CONSTRAINT "billing_products_plan_billing_cycle_key" UNIQUE ("plan", "billing_cycle");



ALTER TABLE ONLY "public"."billing_settings"
    ADD CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."caixinhas"
    ADD CONSTRAINT "caixinhas_meta_valor_finflow_money" CHECK ((("meta_valor" = "round"("meta_valor", 2)) AND ("abs"("meta_valor") <= 999999999999.99))) NOT VALID;



ALTER TABLE ONLY "public"."caixinhas"
    ADD CONSTRAINT "caixinhas_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."caixinhas"
    ADD CONSTRAINT "caixinhas_saldo_atual_finflow_money" CHECK ((("saldo_atual" = "round"("saldo_atual", 2)) AND ("abs"("saldo_atual") <= 999999999999.99))) NOT VALID;



ALTER TABLE "public"."cartoes"
    ADD CONSTRAINT "cartoes_limite_finflow_money" CHECK ((("limite" = "round"("limite", 2)) AND ("abs"("limite") <= 999999999999.99))) NOT VALID;



ALTER TABLE ONLY "public"."cartoes"
    ADD CONSTRAINT "cartoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categorias"
    ADD CONSTRAINT "categorias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."chat_historico"
    ADD CONSTRAINT "chat_historico_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contas_ocultas_usuario"
    ADD CONSTRAINT "contas_ocultas_usuario_pkey" PRIMARY KEY ("conta_id", "user_id");



ALTER TABLE ONLY "public"."contas"
    ADD CONSTRAINT "contas_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."contas"
    ADD CONSTRAINT "contas_saldo_inicial_finflow_money" CHECK ((("saldo_inicial" = "round"("saldo_inicial", 2)) AND ("abs"("saldo_inicial") <= 999999999999.99))) NOT VALID;



ALTER TABLE ONLY "public"."dispositivos_push"
    ADD CONSTRAINT "dispositivos_push_pkey" PRIMARY KEY ("token");



ALTER TABLE ONLY "public"."fatura_itens"
    ADD CONSTRAINT "fatura_itens_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."fatura_itens"
    ADD CONSTRAINT "fatura_itens_valor_finflow_money" CHECK ((("valor" = "round"("valor", 2)) AND ("abs"("valor") <= 999999999999.99))) NOT VALID;



ALTER TABLE ONLY "public"."feedbacks"
    ADD CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notificacoes_sistema"
    ADD CONSTRAINT "notificacoes_sistema_destinatario_id_tipo_referencia_id_key" UNIQUE ("destinatario_id", "tipo", "referencia_id");



ALTER TABLE ONLY "public"."notificacoes_sistema"
    ADD CONSTRAINT "notificacoes_sistema_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."paddle_customers"
    ADD CONSTRAINT "paddle_customers_pkey" PRIMARY KEY ("customer_id");



ALTER TABLE ONLY "public"."parceria_caixinha_decisoes"
    ADD CONSTRAINT "parceria_caixinha_decisoes_parceria_id_source_caixinha_id_u_key" UNIQUE ("parceria_id", "source_caixinha_id", "user_id");



ALTER TABLE ONLY "public"."parceria_caixinha_decisoes"
    ADD CONSTRAINT "parceria_caixinha_decisoes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parceria_dissolucao_itens"
    ADD CONSTRAINT "parceria_dissolucao_itens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parceria_dissolucao_itens"
    ADD CONSTRAINT "parceria_dissolucao_itens_resumo_id_tipo_source_id_key" UNIQUE ("resumo_id", "tipo", "source_id");



ALTER TABLE ONLY "public"."parceria_dissolucao_resumos"
    ADD CONSTRAINT "parceria_dissolucao_resumos_parceria_id_user_id_key" UNIQUE ("parceria_id", "user_id");



ALTER TABLE ONLY "public"."parceria_dissolucao_resumos"
    ADD CONSTRAINT "parceria_dissolucao_resumos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."parcerias"
    ADD CONSTRAINT "parcerias_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_events"
    ADD CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscription_events"
    ADD CONSTRAINT "subscription_events_provider_provider_event_id_key" UNIQUE ("provider", "provider_event_id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."transacoes"
    ADD CONSTRAINT "transacoes_pkey" PRIMARY KEY ("id");



ALTER TABLE "public"."transacoes"
    ADD CONSTRAINT "transacoes_valor_finflow_money" CHECK ((("valor" = "round"("valor", 2)) AND ("abs"("valor") <= 999999999999.99))) NOT VALID;



ALTER TABLE ONLY "public"."parcerias"
    ADD CONSTRAINT "unique_parceria" UNIQUE ("solicitante_id", "convidado_email");



CREATE INDEX "ai_invoice_payment_ledger_card_month_idx" ON "private"."ai_invoice_payment_ledger" USING "btree" ("card_id", "invoice_month", "created_at" DESC);



CREATE UNIQUE INDEX "ai_invoice_payment_ledger_user_request_uidx" ON "private"."ai_invoice_payment_ledger" USING "btree" ("user_id", "request_id") WHERE ("request_id" IS NOT NULL);



CREATE UNIQUE INDEX "ai_invoice_payment_ledger_user_reversal_request_uidx" ON "private"."ai_invoice_payment_ledger" USING "btree" ("user_id", "reversal_request_id") WHERE ("reversal_request_id" IS NOT NULL);



CREATE INDEX "edge_rate_limits_retention_idx" ON "private"."edge_rate_limits" USING "btree" ("last_attempt_at");



CREATE INDEX "offline_action_receipts_user_created_idx" ON "private"."offline_action_receipts" USING "btree" ("user_id", "created_at" DESC);



CREATE UNIQUE INDEX "transaction_completion_receipts_active_payment_idx" ON "private"."transaction_completion_receipts" USING "btree" ("payment_transaction_id") WHERE (("reopened_at" IS NULL) AND ("payment_transaction_id" IS NOT NULL));



CREATE INDEX "transaction_completion_receipts_created_idx" ON "private"."transaction_completion_receipts" USING "btree" ("created_at");



CREATE INDEX "transaction_completion_receipts_root_history_idx" ON "private"."transaction_completion_receipts" USING "btree" ("root_transaction_id", "payment_sequence", "created_at", "id");



CREATE UNIQUE INDEX "transaction_completion_receipts_root_sequence_idx" ON "private"."transaction_completion_receipts" USING "btree" ("root_transaction_id", "payment_sequence");



CREATE INDEX "transaction_completion_receipts_user_created_idx" ON "private"."transaction_completion_receipts" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "transaction_reopen_receipts_created_idx" ON "private"."transaction_reopen_receipts" USING "btree" ("created_at");



CREATE INDEX "transaction_reopen_receipts_user_created_idx" ON "private"."transaction_reopen_receipts" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "ai_action_audit_action_created_idx" ON "public"."ai_action_audit" USING "btree" ("action_id", "created_at");



CREATE UNIQUE INDEX "ai_action_audit_analytic_idempotency_uidx" ON "public"."ai_action_audit" USING "btree" ("user_id", "idempotency_key") WHERE (("action_id" IS NULL) AND ("event_type" = 'succeeded'::"text") AND ("idempotency_key" IS NOT NULL));



CREATE INDEX "ai_action_audit_created_at_idx" ON "public"."ai_action_audit" USING "btree" ("created_at");



CREATE INDEX "ai_action_audit_quota_idx" ON "public"."ai_action_audit" USING "btree" ("user_id", "created_at") WHERE ("event_type" = 'succeeded'::"text");



CREATE INDEX "ai_action_audit_user_created_idx" ON "public"."ai_action_audit" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "ai_conversations_updated_at_idx" ON "public"."ai_conversations" USING "btree" ("updated_at");



CREATE INDEX "ai_conversations_user_updated_idx" ON "public"."ai_conversations" USING "btree" ("user_id", "updated_at" DESC);



CREATE INDEX "ai_messages_conversation_created_idx" ON "public"."ai_messages" USING "btree" ("conversation_id", "created_at", "id");



CREATE INDEX "ai_messages_created_at_idx" ON "public"."ai_messages" USING "btree" ("created_at");



CREATE INDEX "ai_messages_user_created_idx" ON "public"."ai_messages" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "ai_pending_actions_pending_expiry_idx" ON "public"."ai_pending_actions" USING "btree" ("expires_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "ai_pending_actions_updated_at_idx" ON "public"."ai_pending_actions" USING "btree" ("updated_at");



CREATE INDEX "ai_pending_actions_user_status_created_idx" ON "public"."ai_pending_actions" USING "btree" ("user_id", "status", "created_at" DESC);



CREATE INDEX "ai_request_usage_created_at_idx" ON "public"."ai_request_usage" USING "btree" ("created_at");



CREATE INDEX "ai_request_usage_monitor_errors_idx" ON "public"."ai_request_usage" USING "btree" ("created_at" DESC, "error_code") WHERE ("request_status" = 'failed'::"text");



CREATE INDEX "ai_request_usage_monitor_status_idx" ON "public"."ai_request_usage" USING "btree" ("created_at" DESC, "request_status", "provider", "model");



CREATE INDEX "ai_request_usage_status_created_idx" ON "public"."ai_request_usage" USING "btree" ("request_status", "created_at" DESC);



CREATE INDEX "ai_request_usage_token_reserved_at_idx" ON "public"."ai_request_usage" USING "btree" ("token_reserved_at") WHERE ("token_reserved_at" IS NOT NULL);



CREATE INDEX "ai_request_usage_user_created_idx" ON "public"."ai_request_usage" USING "btree" ("user_id", "created_at" DESC);



CREATE INDEX "ai_transaction_origins_user_idx" ON "public"."ai_transaction_origins" USING "btree" ("user_id", "transaction_id");



CREATE INDEX "contas_ocultas_usuario_owner_idx" ON "public"."contas_ocultas_usuario" USING "btree" ("user_id", "conta_id");



CREATE INDEX "dispositivos_push_user_idx" ON "public"."dispositivos_push" USING "btree" ("user_id", "atualizado_em" DESC);



CREATE INDEX "fatura_itens_ai_context_card_month_paid_idx" ON "public"."fatura_itens" USING "btree" ("cartao_id", "mes_fatura", "pago", "id");



CREATE INDEX "idx_cartoes_user_id" ON "public"."cartoes" USING "btree" ("user_id");



CREATE INDEX "idx_fatura_itens_cartao_mes" ON "public"."fatura_itens" USING "btree" ("cartao_id", "mes_fatura");



CREATE INDEX "idx_fatura_itens_grupo" ON "public"."fatura_itens" USING "btree" ("grupo_parcela_id");



CREATE INDEX "idx_fatura_itens_user_id" ON "public"."fatura_itens" USING "btree" ("user_id");



CREATE INDEX "notificacoes_sistema_destinatario_pendentes_idx" ON "public"."notificacoes_sistema" USING "btree" ("destinatario_id", "criada_em", "id") WHERE ("lida_em" IS NULL);



CREATE INDEX "paddle_customers_email_idx" ON "public"."paddle_customers" USING "btree" ("lower"("email"));



CREATE UNIQUE INDEX "paddle_customers_user_environment_uidx" ON "public"."paddle_customers" USING "btree" ("user_id", "environment") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "parceria_dissolucao_itens_pendentes_idx" ON "public"."parceria_dissolucao_itens" USING "btree" ("resumo_id", "tipo", "estado", "id");



CREATE INDEX "parceria_dissolucao_resumos_pendentes_idx" ON "public"."parceria_dissolucao_resumos" USING "btree" ("user_id", "created_at", "id") WHERE ("visto_em" IS NULL);



CREATE INDEX "subscription_events_processed_retention_idx" ON "public"."subscription_events" USING "btree" ("processed_at") WHERE ("processed_at" IS NOT NULL);



CREATE INDEX "subscription_events_unprocessed_retention_idx" ON "public"."subscription_events" USING "btree" ("created_at") WHERE ("processed_at" IS NULL);



CREATE INDEX "subscription_events_unprocessed_retry_idx" ON "public"."subscription_events" USING "btree" ("provider", "created_at", "processing_locked_until") WHERE ("processed_at" IS NULL);



CREATE UNIQUE INDEX "subscriptions_checkout_idempotency_unique" ON "public"."subscriptions" USING "btree" ("user_id", "product_code", "checkout_idempotency_key") WHERE ("checkout_idempotency_key" IS NOT NULL);



CREATE UNIQUE INDEX "subscriptions_provider_id_unique" ON "public"."subscriptions" USING "btree" ("provider", "provider_subscription_id") WHERE ("provider_subscription_id" IS NOT NULL);



CREATE INDEX "subscriptions_user_status_idx" ON "public"."subscriptions" USING "btree" ("user_id", "status", "access_until" DESC);



CREATE INDEX "transacoes_ai_context_account_status_date_idx" ON "public"."transacoes" USING "btree" ("conta_id", "status", "data_vencimento", "data_realizacao", "id");



CREATE INDEX "transacoes_data_realizacao_idx" ON "public"."transacoes" USING "btree" ("data_realizacao");



CREATE INDEX "transacoes_transacao_pai_id_idx" ON "public"."transacoes" USING "btree" ("transacao_pai_id", "data_realizacao", "id") WHERE ("transacao_pai_id" IS NOT NULL);



CREATE OR REPLACE TRIGGER "assign_bank_reconciliation_payment" BEFORE INSERT OR UPDATE OF "transaction_id", "entry_date", "entry_amount" ON "private"."bank_reconciliation_receipts" FOR EACH ROW EXECUTE FUNCTION "private"."assign_bank_reconciliation_payment"();



CREATE OR REPLACE TRIGGER "assign_bank_reconciliation_transaction_payment" BEFORE INSERT OR UPDATE OF "transaction_id", "amount" ON "private"."bank_reconciliation_transactions" FOR EACH ROW EXECUTE FUNCTION "private"."assign_bank_reconciliation_transaction_payment"();



CREATE OR REPLACE TRIGGER "ai_cartoes_protect_active_invoice_ledger" BEFORE DELETE ON "public"."cartoes" FOR EACH ROW EXECUTE FUNCTION "private"."ai_protect_card_with_active_payment"();



CREATE OR REPLACE TRIGGER "ai_conversations_touch_updated_at" BEFORE UPDATE ON "public"."ai_conversations" FOR EACH ROW EXECUTE FUNCTION "private"."ai_touch_updated_at"();



CREATE OR REPLACE TRIGGER "ai_messages_validate_owner" BEFORE INSERT OR UPDATE ON "public"."ai_messages" FOR EACH ROW EXECUTE FUNCTION "private"."ai_validate_message_owner"();



CREATE OR REPLACE TRIGGER "ai_pending_actions_touch_updated_at" BEFORE UPDATE ON "public"."ai_pending_actions" FOR EACH ROW EXECUTE FUNCTION "private"."ai_touch_updated_at"();



CREATE OR REPLACE TRIGGER "caixinhas_touch_version" BEFORE INSERT OR UPDATE ON "public"."caixinhas" FOR EACH ROW EXECUTE FUNCTION "private"."finance_touch_version"();



CREATE OR REPLACE TRIGGER "cartoes_touch_version" BEFORE INSERT OR UPDATE ON "public"."cartoes" FOR EACH ROW EXECUTE FUNCTION "private"."finance_touch_version"();



CREATE OR REPLACE TRIGGER "categorias_touch_version" BEFORE INSERT OR UPDATE ON "public"."categorias" FOR EACH ROW EXECUTE FUNCTION "private"."finance_touch_version"();



CREATE OR REPLACE TRIGGER "contas_touch_version" BEFORE INSERT OR UPDATE ON "public"."contas" FOR EACH ROW EXECUTE FUNCTION "private"."finance_touch_version"();



CREATE OR REPLACE TRIGGER "enforce_finflow_financial_profile" BEFORE INSERT OR DELETE OR UPDATE ON "public"."caixinhas" FOR EACH STATEMENT EXECUTE FUNCTION "private"."enforce_finflow_financial_profile"();



CREATE OR REPLACE TRIGGER "enforce_finflow_financial_profile" BEFORE INSERT OR DELETE OR UPDATE ON "public"."cartoes" FOR EACH STATEMENT EXECUTE FUNCTION "private"."enforce_finflow_financial_profile"();



CREATE OR REPLACE TRIGGER "enforce_finflow_financial_profile" BEFORE INSERT OR DELETE OR UPDATE ON "public"."categorias" FOR EACH STATEMENT EXECUTE FUNCTION "private"."enforce_finflow_financial_profile"();



CREATE OR REPLACE TRIGGER "enforce_finflow_financial_profile" BEFORE INSERT OR DELETE OR UPDATE ON "public"."contas" FOR EACH STATEMENT EXECUTE FUNCTION "private"."enforce_finflow_financial_profile"();



CREATE OR REPLACE TRIGGER "enforce_finflow_financial_profile" BEFORE INSERT OR DELETE OR UPDATE ON "public"."fatura_itens" FOR EACH STATEMENT EXECUTE FUNCTION "private"."enforce_finflow_financial_profile"();



CREATE OR REPLACE TRIGGER "enforce_finflow_financial_profile" BEFORE INSERT OR DELETE OR UPDATE ON "public"."transacoes" FOR EACH STATEMENT EXECUTE FUNCTION "private"."enforce_finflow_financial_profile"();



CREATE OR REPLACE TRIGGER "enforce_plan_limit_before_write" BEFORE INSERT OR UPDATE ON "public"."caixinhas" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_finflow_plan_limit"();



CREATE OR REPLACE TRIGGER "enforce_plan_limit_before_write" BEFORE INSERT OR UPDATE ON "public"."cartoes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_finflow_plan_limit"();



CREATE OR REPLACE TRIGGER "enforce_plan_limit_before_write" BEFORE INSERT OR UPDATE ON "public"."categorias" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_finflow_plan_limit"();



CREATE OR REPLACE TRIGGER "enforce_plan_limit_before_write" BEFORE INSERT OR UPDATE ON "public"."contas" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_finflow_plan_limit"();



CREATE OR REPLACE TRIGGER "enforce_plan_limit_before_write" BEFORE INSERT OR UPDATE ON "public"."transacoes" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_finflow_plan_limit"();



CREATE OR REPLACE TRIGGER "enviar_push_notificacao_sistema" AFTER INSERT ON "public"."notificacoes_sistema" FOR EACH ROW EXECUTE FUNCTION "private"."enviar_push_notificacao_sistema"();



CREATE OR REPLACE TRIGGER "finance_guard_invoice_item_dml" BEFORE INSERT OR DELETE OR UPDATE ON "public"."fatura_itens" FOR EACH ROW EXECUTE FUNCTION "private"."finance_guard_invoice_item_dml"();



CREATE OR REPLACE TRIGGER "finance_guard_invoice_transaction_dml" BEFORE INSERT OR DELETE OR UPDATE ON "public"."transacoes" FOR EACH ROW EXECUTE FUNCTION "private"."finance_guard_invoice_transaction_dml"();



CREATE OR REPLACE TRIGGER "finflow_enforce_account_sharing" BEFORE INSERT OR UPDATE OF "compartilhado", "arquivado" ON "public"."contas" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_enforce_resource_sharing"();



CREATE OR REPLACE TRIGGER "finflow_enforce_card_purchase_limit" BEFORE INSERT OR UPDATE OF "mes_fatura", "categoria_id" ON "public"."fatura_itens" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_enforce_card_purchase_limit"();



CREATE OR REPLACE TRIGGER "finflow_enforce_goal_balance_write" BEFORE UPDATE OF "saldo_atual" ON "public"."caixinhas" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_enforce_goal_balance_write"();



CREATE OR REPLACE TRIGGER "finflow_enforce_goal_sharing" BEFORE INSERT OR UPDATE OF "compartilhado", "arquivado" ON "public"."caixinhas" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_enforce_resource_sharing"();



CREATE OR REPLACE TRIGGER "finflow_enforce_shared_account_capacity" BEFORE INSERT OR UPDATE OF "compartilhado", "arquivado" ON "public"."contas" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_enforce_shared_account_capacity"();



CREATE OR REPLACE TRIGGER "finflow_enforce_shared_link_limit" BEFORE INSERT OR UPDATE OF "compartilhado", "arquivado" ON "public"."caixinhas" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_enforce_shared_link_limit"();



CREATE OR REPLACE TRIGGER "finflow_enforce_shared_link_limit" BEFORE INSERT OR UPDATE OF "compartilhado", "arquivado" ON "public"."contas" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_enforce_shared_link_limit"();



CREATE OR REPLACE TRIGGER "finflow_enforce_single_accepted_partnership" BEFORE INSERT OR UPDATE OF "status", "solicitante_id", "convidado_id" ON "public"."parcerias" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_enforce_single_accepted_partnership"();



CREATE OR REPLACE TRIGGER "finflow_guard_direct_partnership_delete" BEFORE DELETE ON "public"."parcerias" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_guard_direct_partnership_delete"();



CREATE OR REPLACE TRIGGER "finflow_guard_transaction_payment_group" BEFORE INSERT OR DELETE OR UPDATE ON "public"."transacoes" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_guard_transaction_payment_group"();



CREATE OR REPLACE TRIGGER "finflow_lock_account_partnership_for_sharing" BEFORE UPDATE OF "compartilhado" ON "public"."contas" FOR EACH STATEMENT EXECUTE FUNCTION "private"."finflow_lock_callers_partnership_for_sharing"();



CREATE OR REPLACE TRIGGER "finflow_lock_goal_partnership_for_sharing" BEFORE UPDATE OF "compartilhado" ON "public"."caixinhas" FOR EACH STATEMENT EXECUTE FUNCTION "private"."finflow_lock_callers_partnership_for_sharing"();



CREATE OR REPLACE TRIGGER "finflow_validate_invoice_item_references" BEFORE INSERT OR UPDATE ON "public"."fatura_itens" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_validate_financial_references"();



CREATE OR REPLACE TRIGGER "finflow_validate_transaction_references" BEFORE INSERT OR UPDATE ON "public"."transacoes" FOR EACH ROW EXECUTE FUNCTION "private"."finflow_validate_financial_references"();



CREATE OR REPLACE TRIGGER "notificar_encerramento_parceria" AFTER DELETE ON "public"."parcerias" FOR EACH ROW EXECUTE FUNCTION "public"."notificar_encerramento_parceria"();



CREATE OR REPLACE TRIGGER "preserve_finflow_partnership_identity_before_update" BEFORE UPDATE ON "public"."parcerias" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "preserve_finflow_row_identity_before_update" BEFORE UPDATE ON "public"."caixinhas" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "preserve_finflow_row_identity_before_update" BEFORE UPDATE ON "public"."cartoes" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "preserve_finflow_row_identity_before_update" BEFORE UPDATE ON "public"."categorias" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "preserve_finflow_row_identity_before_update" BEFORE UPDATE ON "public"."chat_historico" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "preserve_finflow_row_identity_before_update" BEFORE UPDATE ON "public"."contas" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "preserve_finflow_row_identity_before_update" BEFORE UPDATE ON "public"."fatura_itens" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "preserve_finflow_row_identity_before_update" BEFORE UPDATE ON "public"."feedbacks" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "preserve_finflow_row_identity_before_update" BEFORE UPDATE ON "public"."transacoes" FOR EACH ROW EXECUTE FUNCTION "public"."preserve_finflow_row_identity"();



CREATE OR REPLACE TRIGGER "registrar_evento_obrigatorio_parceria" AFTER INSERT OR DELETE OR UPDATE ON "public"."parcerias" FOR EACH ROW EXECUTE FUNCTION "public"."registrar_evento_obrigatorio_parceria"();



CREATE OR REPLACE TRIGGER "release_bank_reconciliation_after_reopen" AFTER DELETE OR UPDATE OF "status" ON "public"."transacoes" FOR EACH ROW EXECUTE FUNCTION "private"."release_bank_reconciliation_after_reopen"();



CREATE OR REPLACE TRIGGER "transacoes_touch_version" BEFORE INSERT OR UPDATE ON "public"."transacoes" FOR EACH ROW EXECUTE FUNCTION "private"."finance_touch_version"();



ALTER TABLE ONLY "private"."ai_invoice_payment_ledger"
    ADD CONSTRAINT "ai_invoice_payment_ledger_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "public"."ai_pending_actions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."ai_invoice_payment_ledger"
    ADD CONSTRAINT "ai_invoice_payment_ledger_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "public"."cartoes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."ai_invoice_payment_ledger"
    ADD CONSTRAINT "ai_invoice_payment_ledger_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."bank_reconciliation_receipts"
    ADD CONSTRAINT "bank_reconciliation_receipts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "public"."contas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."bank_reconciliation_receipts"
    ADD CONSTRAINT "bank_reconciliation_receipts_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "private"."transaction_completion_receipts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."bank_reconciliation_receipts"
    ADD CONSTRAINT "bank_reconciliation_receipts_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transacoes"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."bank_reconciliation_receipts"
    ADD CONSTRAINT "bank_reconciliation_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."bank_reconciliation_transactions"
    ADD CONSTRAINT "bank_reconciliation_transactions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "private"."transaction_completion_receipts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."bank_reconciliation_transactions"
    ADD CONSTRAINT "bank_reconciliation_transactions_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "private"."bank_reconciliation_receipts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."bank_reconciliation_transactions"
    ADD CONSTRAINT "bank_reconciliation_transactions_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transacoes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "private"."offline_action_receipts"
    ADD CONSTRAINT "offline_action_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."phone_verification_reservations"
    ADD CONSTRAINT "phone_verification_reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "private"."transaction_completion_receipts"
    ADD CONSTRAINT "transaction_completion_receipts_reopened_by_fkey" FOREIGN KEY ("reopened_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."transaction_completion_receipts"
    ADD CONSTRAINT "transaction_completion_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."transaction_reopen_receipts"
    ADD CONSTRAINT "transaction_reopen_receipts_completion_receipt_id_fkey" FOREIGN KEY ("completion_receipt_id") REFERENCES "private"."transaction_completion_receipts"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "private"."transaction_reopen_receipts"
    ADD CONSTRAINT "transaction_reopen_receipts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_action_audit"
    ADD CONSTRAINT "ai_action_audit_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "public"."ai_pending_actions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."ai_action_audit"
    ADD CONSTRAINT "ai_action_audit_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_conversations"
    ADD CONSTRAINT "ai_conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_messages"
    ADD CONSTRAINT "ai_messages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_pending_actions"
    ADD CONSTRAINT "ai_pending_actions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_request_usage"
    ADD CONSTRAINT "ai_request_usage_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_transaction_origins"
    ADD CONSTRAINT "ai_transaction_origins_transaction_id_fkey" FOREIGN KEY ("transaction_id") REFERENCES "public"."transacoes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ai_transaction_origins"
    ADD CONSTRAINT "ai_transaction_origins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."caixinhas"
    ADD CONSTRAINT "caixinhas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."cartoes"
    ADD CONSTRAINT "cartoes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."categorias"
    ADD CONSTRAINT "categorias_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."chat_historico"
    ADD CONSTRAINT "chat_historico_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contas_ocultas_usuario"
    ADD CONSTRAINT "contas_ocultas_usuario_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "public"."contas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contas_ocultas_usuario"
    ADD CONSTRAINT "contas_ocultas_usuario_resumo_id_fkey" FOREIGN KEY ("resumo_id") REFERENCES "public"."parceria_dissolucao_resumos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contas_ocultas_usuario"
    ADD CONSTRAINT "contas_ocultas_usuario_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contas"
    ADD CONSTRAINT "contas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."dispositivos_push"
    ADD CONSTRAINT "dispositivos_push_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fatura_itens"
    ADD CONSTRAINT "fatura_itens_cartao_id_fkey" FOREIGN KEY ("cartao_id") REFERENCES "public"."cartoes"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."fatura_itens"
    ADD CONSTRAINT "fatura_itens_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fatura_itens"
    ADD CONSTRAINT "fatura_itens_grupo_parcela_id_fkey" FOREIGN KEY ("grupo_parcela_id") REFERENCES "public"."fatura_itens"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."fatura_itens"
    ADD CONSTRAINT "fatura_itens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."feedbacks"
    ADD CONSTRAINT "feedbacks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notificacoes_sistema"
    ADD CONSTRAINT "notificacoes_sistema_destinatario_id_fkey" FOREIGN KEY ("destinatario_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."paddle_customers"
    ADD CONSTRAINT "paddle_customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."parceria_caixinha_decisoes"
    ADD CONSTRAINT "parceria_caixinha_decisoes_source_owner_id_fkey" FOREIGN KEY ("source_owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parceria_caixinha_decisoes"
    ADD CONSTRAINT "parceria_caixinha_decisoes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parceria_dissolucao_itens"
    ADD CONSTRAINT "parceria_dissolucao_itens_resumo_id_fkey" FOREIGN KEY ("resumo_id") REFERENCES "public"."parceria_dissolucao_resumos"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parceria_dissolucao_resumos"
    ADD CONSTRAINT "parceria_dissolucao_resumos_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parcerias"
    ADD CONSTRAINT "parcerias_convidado_id_fkey" FOREIGN KEY ("convidado_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parcerias"
    ADD CONSTRAINT "parcerias_solicitante_id_fkey" FOREIGN KEY ("solicitante_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscription_events"
    ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_product_code_fkey" FOREIGN KEY ("product_code") REFERENCES "public"."billing_products"("code");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transacoes"
    ADD CONSTRAINT "transacoes_categoria_id_fkey" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."transacoes"
    ADD CONSTRAINT "transacoes_conta_id_fkey" FOREIGN KEY ("conta_id") REFERENCES "public"."contas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."transacoes"
    ADD CONSTRAINT "transacoes_transacao_pai_id_fkey" FOREIGN KEY ("transacao_pai_id") REFERENCES "public"."transacoes"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."transacoes"
    ADD CONSTRAINT "transacoes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE "private"."ai_invoice_payment_ledger" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "private"."offline_action_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "private"."transaction_completion_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "private"."transaction_reopen_receipts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_action_audit" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_action_audit_owner_select" ON "public"."ai_action_audit" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."ai_conversations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_pending_actions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_pending_actions_owner_select" ON "public"."ai_pending_actions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."ai_request_usage" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ai_transaction_origins" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_transaction_origins_owner_select" ON "public"."ai_transaction_origins" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."billing_products" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing_products_authenticated_read" ON "public"."billing_products" FOR SELECT TO "authenticated" USING ("active");



ALTER TABLE "public"."billing_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."caixinhas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "caixinhas_owner_all" ON "public"."caixinhas" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "caixinhas_partner_select" ON "public"."caixinhas" FOR SELECT TO "authenticated" USING (((NOT COALESCE("arquivado", false)) AND ("compartilhado" IS TRUE) AND "public"."is_parceiro"("user_id", ( SELECT "auth"."uid"() AS "uid"))));



CREATE POLICY "caixinhas_partner_update" ON "public"."caixinhas" FOR UPDATE TO "authenticated" USING (((NOT COALESCE("arquivado", false)) AND ("compartilhado" IS TRUE) AND "public"."is_parceiro"("user_id", ( SELECT "auth"."uid"() AS "uid")))) WITH CHECK (((NOT COALESCE("arquivado", false)) AND ("compartilhado" IS TRUE) AND "public"."is_parceiro"("user_id", ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."cartoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "cartoes_owner_all" ON "public"."cartoes" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."categorias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "categorias_owner_all" ON "public"."categorias" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."chat_historico" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "chat_historico_owner_all" ON "public"."chat_historico" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."contas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contas_not_hidden_select" ON "public"."contas" AS RESTRICTIVE FOR SELECT TO "authenticated" USING ("public"."conta_visivel_para_usuario"("id"));



ALTER TABLE "public"."contas_ocultas_usuario" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contas_owner_all" ON "public"."contas" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "contas_partner_select" ON "public"."contas" FOR SELECT TO "authenticated" USING (((NOT COALESCE("arquivado", false)) AND ("compartilhado" IS TRUE) AND "public"."is_parceiro"("user_id", ( SELECT "auth"."uid"() AS "uid"))));



ALTER TABLE "public"."dispositivos_push" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."fatura_itens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "fatura_itens_owner_all" ON "public"."fatura_itens" TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id")) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND ("categoria_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."cartoes" "card_row"
  WHERE (("card_row"."id" = "fatura_itens"."cartao_id") AND ("card_row"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))) AND (EXISTS ( SELECT 1
   FROM "public"."categorias" "category_row"
  WHERE (("category_row"."id" = "fatura_itens"."categoria_id") AND ("category_row"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("category_row"."tipo" = ANY (ARRAY['despesa'::"text", 'ambos'::"text"])))))));



ALTER TABLE "public"."feedbacks" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "feedbacks_owner_insert" ON "public"."feedbacks" FOR INSERT TO "authenticated" WITH CHECK ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



CREATE POLICY "feedbacks_owner_select" ON "public"."feedbacks" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."notificacoes_sistema" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notificacoes_sistema_owner_select" ON "public"."notificacoes_sistema" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "destinatario_id") AND ("expira_em" > "now"())));



ALTER TABLE "public"."paddle_customers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parceria_caixinha_decisoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "parceria_caixinha_decisoes_owner_select" ON "public"."parceria_caixinha_decisoes" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."parceria_dissolucao_itens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "parceria_dissolucao_itens_owner_select" ON "public"."parceria_dissolucao_itens" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."parceria_dissolucao_resumos" "r"
  WHERE (("r"."id" = "parceria_dissolucao_itens"."resumo_id") AND ("r"."user_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."parceria_dissolucao_resumos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "parceria_dissolucao_resumos_owner_select" ON "public"."parceria_dissolucao_resumos" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."parcerias" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "parcerias_invitee_accept" ON "public"."parcerias" FOR UPDATE TO "authenticated" USING ((("status" = 'pendente'::"text") AND ("convidado_id" IS NULL) AND ("lower"(( SELECT ("auth"."jwt"() ->> 'email'::"text"))) = "lower"("convidado_email")))) WITH CHECK ((("status" = 'aceito'::"text") AND ("convidado_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("solicitante_id" <> ( SELECT "auth"."uid"() AS "uid")) AND ("lower"(( SELECT ("auth"."jwt"() ->> 'email'::"text"))) = "lower"("convidado_email"))));



CREATE POLICY "parcerias_participant_delete" ON "public"."parcerias" FOR DELETE TO "authenticated" USING ((("status" = 'pendente'::"text") AND ((( SELECT "auth"."uid"() AS "uid") = "solicitante_id") OR (( SELECT "auth"."uid"() AS "uid") = "convidado_id") OR ("lower"(( SELECT ("auth"."jwt"() ->> 'email'::"text"))) = "lower"("convidado_email")))));



CREATE POLICY "parcerias_participant_select" ON "public"."parcerias" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "solicitante_id") OR (( SELECT "auth"."uid"() AS "uid") = "convidado_id") OR ("lower"(( SELECT ("auth"."jwt"() ->> 'email'::"text"))) = "lower"("convidado_email"))));



CREATE POLICY "parcerias_requester_insert" ON "public"."parcerias" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "solicitante_id") AND ("convidado_id" IS NULL) AND ("status" = 'pendente'::"text") AND ("lower"("convidado_email") <> "lower"(( SELECT ("auth"."jwt"() ->> 'email'::"text"))))));



ALTER TABLE "public"."subscription_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_owner_read" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING ((( SELECT "auth"."uid"() AS "uid") = "user_id"));



ALTER TABLE "public"."transacoes" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transacoes_accessible_delete" ON "public"."transacoes" FOR DELETE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."contas" "c"
  WHERE (("c"."id" = "transacoes"."conta_id") AND (("c"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("c"."compartilhado" IS TRUE) AND "public"."is_parceiro"("c"."user_id", ( SELECT "auth"."uid"() AS "uid")))))))));



CREATE POLICY "transacoes_accessible_insert" ON "public"."transacoes" FOR INSERT TO "authenticated" WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") AND (EXISTS ( SELECT 1
   FROM "public"."contas" "c"
  WHERE (("c"."id" = "transacoes"."conta_id") AND (("c"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("c"."compartilhado" IS TRUE) AND "public"."is_parceiro"("c"."user_id", ( SELECT "auth"."uid"() AS "uid")))))))));



CREATE POLICY "transacoes_accessible_select" ON "public"."transacoes" FOR SELECT TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."contas" "c"
  WHERE (("c"."id" = "transacoes"."conta_id") AND (("c"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("c"."compartilhado" IS TRUE) AND "public"."is_parceiro"("c"."user_id", ( SELECT "auth"."uid"() AS "uid")))))))));



CREATE POLICY "transacoes_accessible_update" ON "public"."transacoes" FOR UPDATE TO "authenticated" USING (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."contas" "c"
  WHERE (("c"."id" = "transacoes"."conta_id") AND (("c"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("c"."compartilhado" IS TRUE) AND "public"."is_parceiro"("c"."user_id", ( SELECT "auth"."uid"() AS "uid"))))))))) WITH CHECK (((( SELECT "auth"."uid"() AS "uid") = "user_id") OR (EXISTS ( SELECT 1
   FROM "public"."contas" "c"
  WHERE (("c"."id" = "transacoes"."conta_id") AND (("c"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("c"."compartilhado" IS TRUE) AND "public"."is_parceiro"("c"."user_id", ( SELECT "auth"."uid"() AS "uid")))))))));



CREATE POLICY "transacoes_payment_child_delete_guard" ON "public"."transacoes" AS RESTRICTIVE FOR DELETE TO "authenticated" USING (("transacao_pai_id" IS NULL));



CREATE POLICY "transacoes_payment_child_insert_guard" ON "public"."transacoes" AS RESTRICTIVE FOR INSERT TO "authenticated" WITH CHECK (("transacao_pai_id" IS NULL));



CREATE POLICY "transacoes_payment_child_update_guard" ON "public"."transacoes" AS RESTRICTIVE FOR UPDATE TO "authenticated" USING (("transacao_pai_id" IS NULL)) WITH CHECK (("transacao_pai_id" IS NULL));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";









GRANT USAGE ON SCHEMA "finflow_guard" TO "anon";
GRANT USAGE ON SCHEMA "finflow_guard" TO "authenticated";
GRANT USAGE ON SCHEMA "finflow_guard" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT USAGE ON SCHEMA "private" TO "service_role";











































































































































































REVOKE ALL ON FUNCTION "finflow_guard"."enforce_mfa"() FROM PUBLIC;
GRANT ALL ON FUNCTION "finflow_guard"."enforce_mfa"() TO "anon";
GRANT ALL ON FUNCTION "finflow_guard"."enforce_mfa"() TO "authenticated";
GRANT ALL ON FUNCTION "finflow_guard"."enforce_mfa"() TO "service_role";



REVOKE ALL ON FUNCTION "private"."ai_action_quota"("caller" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_action_state_fingerprint"("caller" "uuid", "action_name" "text", "payload" "jsonb", "p_lock" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_add_month"("invoice_month" "text", "offset_months" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_add_occurrence"("base_date" "date", "occurrence_index" integer, "frequency" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_adjust_goal_balance"("caller" "uuid", "goal_id" bigint, "operation_name" "text", "amount" numeric, "direction" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_adjust_goal_from_description"("caller" "uuid", "description" "text", "amount" numeric, "direction" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_account"("caller" "uuid", "account_id" bigint, "owner_only" boolean, "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_allowed_keys"("payload" "jsonb", "allowed_keys" "text"[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_authenticated"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_card"("caller" "uuid", "card_id" bigint, "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_card_item"("caller" "uuid", "item_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_category"("caller" "uuid", "category_id" bigint, "transaction_type" "text", "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_goal"("caller" "uuid", "goal_id" bigint, "owner_only" boolean, "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_reactivation_limit"("caller" "uuid", "resource_kind" "text", "resource_type" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_assert_transaction"("caller" "uuid", "transaction_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_can_access_account"("caller" "uuid", "account_id" bigint, "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_can_access_goal"("caller" "uuid", "goal_id" bigint, "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_card_used_limit"("caller" "uuid", "card_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_choice"("payload" "jsonb", "key_name" "text", "choices" "text"[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_color"("payload" "jsonb", "key_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_date"("payload" "jsonb", "key_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_description"("payload" "jsonb", "key_name" "text", "max_length" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_execute_card_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_execute_financial_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_execute_resource_action"("caller" "uuid", "action_name" "text", "payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_execute_transaction_action"("caller" "uuid", "action_name" "text", "payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_execute_transaction_action_v2"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_expire_actions"("caller" "uuid", "only_action" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_fail"("code" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_id"("payload" "jsonb", "key_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_integer"("payload" "jsonb", "key_name" "text", "min_value" integer, "max_value" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_invoice_is_closed"("invoice_month" "text", "closing_day" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_invoice_month"("purchase_date" "date", "closing_day" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_legacy_series_descriptor"("description" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_legacy_series_ids"("caller" "uuid", "target_transaction_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_lock_account"("caller" "uuid", "account_id" bigint, "owner_only" boolean, "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_lock_card"("caller" "uuid", "card_id" bigint, "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_lock_category"("caller" "uuid", "category_id" bigint, "transaction_type" "text", "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_lock_goal"("caller" "uuid", "goal_id" bigint, "owner_only" boolean, "require_active" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_lock_partnership_access"("caller" "uuid", "owner_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_number"("payload" "jsonb", "key_name" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_prepare_action"("caller" "uuid", "action_name" "text", "raw_payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_protect_card_with_active_payment"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_replace_transaction_base"("original_description" "text", "new_base" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_require_keys"("payload" "jsonb", "required_keys" "text"[]) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_resolve_legacy_goal_movement"("caller" "uuid", "description" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_series_marker"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_text"("payload" "jsonb", "key_name" "text", "max_length" integer, "allow_empty" boolean) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_touch_updated_at"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."ai_validate_message_owner"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."cleanup_transaction_completion_receipts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."cleanup_transaction_completion_receipts"() TO "service_role";



REVOKE ALL ON FUNCTION "private"."enforce_finflow_financial_profile"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."enviar_push_notificacao_sistema"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finance_execute_invoice_action"("caller" "uuid", "action_name" "text", "payload" "jsonb", "pending_action_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finance_guard_invoice_item_dml"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finance_guard_invoice_transaction_dml"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finance_touch_version"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finance_try_backfill_legacy_invoice_payment"("caller" "uuid", "payment_transaction_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_account_usage"("p_user_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_authorize_payment_child_write"("caller" "uuid", "p_root_transaction_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_enforce_card_purchase_limit"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_enforce_goal_balance_write"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_enforce_resource_sharing"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_enforce_shared_account_capacity"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_enforce_shared_link_limit"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_enforce_single_accepted_partnership"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_guard_direct_partnership_delete"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_guard_transaction_payment_group"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_lock_callers_partnership_for_sharing"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_lock_participants"("p_first" "uuid", "p_second" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_plan_for_user"("p_user_id" "uuid") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."finflow_profile_is_eligible"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "private"."finflow_profile_is_eligible"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "private"."finflow_validate_financial_references"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."offline_execute_optimistic_update"("caller" "uuid", "action_name" "text", "payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."offline_prepare_optimistic_update"("caller" "uuid", "action_name" "text", "raw_payload" "jsonb") FROM PUBLIC;



REVOKE ALL ON FUNCTION "private"."release_bank_reconciliation_for_transaction"("p_transaction_id" bigint) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."ai_adjust_model_request_v2"("p_usage_id" "uuid", "p_estimated_input_tokens" bigint, "p_max_output_tokens" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_adjust_model_request_v2"("p_usage_id" "uuid", "p_estimated_input_tokens" bigint, "p_max_output_tokens" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_cancel_pending_action"("p_action_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_cancel_pending_action"("p_action_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_cancel_pending_action"("p_action_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_consume_analytical_action"("p_intent" "text", "p_idempotency_key" "text") FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."ai_consume_pending_action"("p_action_id" "uuid", "p_confirmation_token" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_consume_pending_action"("p_action_id" "uuid", "p_confirmation_token" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_consume_pending_action"("p_action_id" "uuid", "p_confirmation_token" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_create_pending_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "text", "p_ttl_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_create_pending_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "text", "p_ttl_seconds" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_create_pending_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "text", "p_ttl_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_finalize_model_request"("p_usage_id" "uuid", "p_provider" "text", "p_model" "text", "p_input_tokens" bigint, "p_output_tokens" bigint, "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_finalize_model_request"("p_usage_id" "uuid", "p_provider" "text", "p_model" "text", "p_input_tokens" bigint, "p_output_tokens" bigint, "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_finalize_model_request_v2"("p_usage_id" "uuid", "p_provider" "text", "p_model" "text", "p_input_tokens" bigint, "p_output_tokens" bigint, "p_status" "text", "p_latency_ms" integer, "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_finalize_model_request_v2"("p_usage_id" "uuid", "p_provider" "text", "p_model" "text", "p_input_tokens" bigint, "p_output_tokens" bigint, "p_status" "text", "p_latency_ms" integer, "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_get_action_quota"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_get_action_quota"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_get_action_quota"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_get_pending_action"("p_action_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_get_pending_action"("p_action_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_get_pending_action"("p_action_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_list_pending_actions"("p_limit" integer, "p_include_terminal" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_list_pending_actions"("p_limit" integer, "p_include_terminal" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ai_list_pending_actions"("p_limit" integer, "p_include_terminal" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_monitor_health"("p_window_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_monitor_health"("p_window_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."ai_reserve_model_request"("p_limit" integer, "p_window_seconds" integer) FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."ai_reserve_model_request_v2"("p_user_id" "uuid", "p_user_limit" integer, "p_window_seconds" integer, "p_estimated_input_tokens" bigint, "p_max_output_tokens" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ai_reserve_model_request_v2"("p_user_id" "uuid", "p_user_limit" integer, "p_window_seconds" integer, "p_estimated_input_tokens" bigint, "p_max_output_tokens" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."bind_paddle_customer"("p_customer_id" "text", "p_email" "text", "p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bind_paddle_customer"("p_customer_id" "text", "p_email" "text", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."bind_paddle_customer_environment"("p_customer_id" "text", "p_email" "text", "p_user_id" "uuid", "p_environment" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."bind_paddle_customer_environment"("p_customer_id" "text", "p_email" "text", "p_user_id" "uuid", "p_environment" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_subscription_event"("p_provider" "text", "p_event_id" "text", "p_event_type" "text", "p_payload" "jsonb", "p_lease_seconds" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_subscription_event"("p_provider" "text", "p_event_id" "text", "p_event_type" "text", "p_payload" "jsonb", "p_lease_seconds" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_transaction_with_partial"("p_transaction_id" bigint, "p_expected_value" numeric, "p_adjustment_type" "text", "p_adjustment_value" numeric, "p_realized_value" numeric, "p_realization_date" "date", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_transaction_with_partial"("p_transaction_id" bigint, "p_expected_value" numeric, "p_adjustment_type" "text", "p_adjustment_value" numeric, "p_realized_value" numeric, "p_realization_date" "date", "p_idempotency_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."complete_transaction_with_partial"("p_transaction_id" bigint, "p_expected_value" numeric, "p_adjustment_type" "text", "p_adjustment_value" numeric, "p_realized_value" numeric, "p_realization_date" "date", "p_idempotency_key" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."confirmar_resumo_dissolucao"("p_resumo_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."confirmar_resumo_dissolucao"("p_resumo_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."confirmar_resumo_dissolucao"("p_resumo_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."conta_visivel_para_usuario"("p_conta_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."conta_visivel_para_usuario"("p_conta_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."conta_visivel_para_usuario"("p_conta_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."criar_categorias_padrao"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."criar_categorias_padrao"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."delete_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."delete_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_finflow_plan_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_finflow_plan_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."execute_manual_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."execute_manual_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."execute_manual_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."execute_offline_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."execute_offline_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."execute_offline_financial_action"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."execute_offline_optimistic_update"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."execute_offline_optimistic_update"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."execute_offline_optimistic_update"("p_action_type" "text", "p_payload" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_subscription_event"("p_event_id" "uuid", "p_processing_token" "uuid", "p_subscription_id" "uuid", "p_error_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_subscription_event"("p_event_id" "uuid", "p_processing_token" "uuid", "p_subscription_id" "uuid", "p_error_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finance_ai_context_snapshot"("p_current_date" "date", "p_focus_month" "text", "p_years" integer[], "p_scope_account_ids" bigint[], "p_analytics_allowed" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_ai_context_snapshot"("p_current_date" "date", "p_focus_month" "text", "p_years" integer[], "p_scope_account_ids" bigint[], "p_analytics_allowed" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finance_ai_context_snapshot"("p_current_date" "date", "p_focus_month" "text", "p_years" integer[], "p_scope_account_ids" bigint[], "p_analytics_allowed" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finance_is_invoice_item_protected"("p_item_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_is_invoice_item_protected"("p_item_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finance_is_invoice_item_protected"("p_item_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."finance_pay_invoice"("p_card_id" bigint, "p_invoice_month" "text", "p_account_id" bigint, "p_payment_amount" numeric, "p_remainder_mode" "text", "p_interest_value" numeric, "p_interest_percent" numeric, "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_pay_invoice"("p_card_id" bigint, "p_invoice_month" "text", "p_account_id" bigint, "p_payment_amount" numeric, "p_remainder_mode" "text", "p_interest_value" numeric, "p_interest_percent" numeric, "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finance_pay_invoice"("p_card_id" bigint, "p_invoice_month" "text", "p_account_id" bigint, "p_payment_amount" numeric, "p_remainder_mode" "text", "p_interest_value" numeric, "p_interest_percent" numeric, "p_request_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finance_reverse_invoice_payment"("p_transaction_id" bigint, "p_request_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finance_reverse_invoice_payment"("p_transaction_id" bigint, "p_request_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."finance_reverse_invoice_payment"("p_transaction_id" bigint, "p_request_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finflow_cleanup_ai_retention"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."finflow_cleanup_cron_job_run_details"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finflow_cleanup_cron_job_run_details"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finflow_cleanup_external_edge_retention"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."finflow_cleanup_stale_phone_changes"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finflow_cleanup_stale_phone_changes"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."finflow_transaction_has_payment_history"("p_transaction_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finflow_transaction_has_payment_history"("p_transaction_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."finflow_transaction_has_payment_history"("p_transaction_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_bank_reconciliation_adjustment"("p_transaction_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_bank_reconciliation_adjustment"("p_transaction_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_bank_reconciliation_adjustment"("p_transaction_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_meu_resumo_dissolucao"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_meu_resumo_dissolucao"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_meu_resumo_dissolucao"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_minhas_decisoes_caixinha"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_minhas_decisoes_caixinha"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_minhas_decisoes_caixinha"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_minhas_decisoes_conta_dissolucao"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_minhas_decisoes_conta_dissolucao"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_minhas_decisoes_conta_dissolucao"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_entitlement"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_entitlement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_entitlement"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_my_plan_usage"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_my_plan_usage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_plan_usage"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_transaction_payment_history"("p_transaction_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_transaction_payment_history"("p_transaction_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_transaction_payment_history"("p_transaction_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_name"("user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_name"("user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_name"("user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ignore_bank_statement_entries"("p_account_id" bigint, "p_entries" "jsonb", "p_expected_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ignore_bank_statement_entries"("p_account_id" bigint, "p_entries" "jsonb", "p_expected_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ignore_bank_statement_entries"("p_account_id" bigint, "p_entries" "jsonb", "p_expected_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."ignore_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ignore_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ignore_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."iniciar_dissolucao_parceria"("p_parceria_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."iniciar_dissolucao_parceria"("p_parceria_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."iniciar_dissolucao_parceria"("p_parceria_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."is_parceiro"("dono" "uuid", "visitante" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."is_parceiro"("dono" "uuid", "visitante" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_parceiro"("dono" "uuid", "visitante" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."limpar_minhas_notificacoes_sistema_expiradas"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."limpar_minhas_notificacoes_sistema_expiradas"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."limpar_minhas_notificacoes_sistema_expiradas"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."link_completed_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."link_completed_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."link_completed_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_bank_reconciled_transaction_ids"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_bank_reconciled_transaction_ids"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_bank_reconciled_transaction_ids"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_bank_reconciliation_fingerprints"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_bank_reconciliation_fingerprints"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_bank_reconciliation_fingerprints"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_bank_reconciliation_progress"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_bank_reconciliation_progress"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_bank_reconciliation_progress"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_pending_bank_transfer_counterparts"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_pending_bank_transfer_counterparts"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_pending_bank_transfer_counterparts"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_transaction_payment_summaries"("p_transaction_ids" bigint[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_transaction_payment_summaries"("p_transaction_ids" bigint[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_transaction_payment_summaries"("p_transaction_ids" bigint[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."marcar_notificacao_sistema_lida"("p_id" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."marcar_notificacao_sistema_lida"("p_id" bigint) TO "authenticated";
GRANT ALL ON FUNCTION "public"."marcar_notificacao_sistema_lida"("p_id" bigint) TO "service_role";



REVOKE ALL ON FUNCTION "public"."notificar_encerramento_parceria"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notificar_encerramento_parceria"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."preserve_finflow_row_identity"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preserve_finflow_row_identity"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_bank_goal_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bank_goal_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_bank_goal_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_bank_invoice_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_amount" numeric, "p_card_id" bigint, "p_invoice_month" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bank_invoice_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_amount" numeric, "p_card_id" bigint, "p_invoice_month" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_bank_invoice_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_amount" numeric, "p_card_id" bigint, "p_invoice_month" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_bank_statement_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_ids" bigint[], "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_ids" bigint[], "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_ids" bigint[], "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone, "p_excess_as_interest" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone, "p_excess_as_interest" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_mode" "text", "p_transaction_id" bigint, "p_category_id" bigint, "p_description" "text", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone, "p_excess_as_interest" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_bank_statement_excess_interest"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_excess_interest"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_excess_interest"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_bank_statement_new_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_entries" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_new_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_entries" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_bank_statement_new_entries"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_entries" "jsonb", "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_bank_transfer_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_bank_transfer_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_bank_transfer_entry"("p_account_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reconcile_reopened_bank_statement_entry"("p_receipt_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reconcile_reopened_bank_statement_entry"("p_receipt_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."reconcile_reopened_bank_statement_entry"("p_receipt_id" bigint, "p_entry_fingerprint" "text", "p_entry_date" "date", "p_entry_type" "text", "p_entry_amount" numeric, "p_transaction_id" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_my_recurring_schedules"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_my_recurring_schedules"() TO "anon";
GRANT ALL ON FUNCTION "public"."refresh_my_recurring_schedules"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_my_recurring_schedules"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_dispositivo_push"("p_token" "text", "p_plataforma" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_dispositivo_push"("p_token" "text", "p_plataforma" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."registrar_dispositivo_push"("p_token" "text", "p_plataforma" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."registrar_evento_obrigatorio_parceria"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."registrar_evento_obrigatorio_parceria"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."remover_dispositivo_push"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remover_dispositivo_push"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remover_dispositivo_push"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reopen_transaction_completion"("p_transaction_id" bigint, "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reopen_transaction_completion"("p_transaction_id" bigint, "p_idempotency_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reopen_transaction_completion"("p_transaction_id" bigint, "p_idempotency_key" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_edge_rate_limit"("p_scope" "text", "p_subject" "text", "p_cooldown_seconds" integer, "p_window_seconds" integer, "p_max_attempts" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_edge_rate_limit"("p_scope" "text", "p_subject" "text", "p_cooldown_seconds" integer, "p_window_seconds" integer, "p_max_attempts" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reserve_phone_verification"("p_user_id" "uuid", "p_phone" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reserve_phone_verification"("p_user_id" "uuid", "p_phone" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolver_decisao_caixinha"("p_decisao_id" bigint, "p_manter" boolean, "p_saldo" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolver_decisao_caixinha"("p_decisao_id" bigint, "p_manter" boolean, "p_saldo" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolver_decisao_caixinha"("p_decisao_id" bigint, "p_manter" boolean, "p_saldo" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolver_decisao_conta_dissolucao"("p_item_id" bigint, "p_manter_ativa" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolver_decisao_conta_dissolucao"("p_item_id" bigint, "p_manter_ativa" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolver_decisao_conta_dissolucao"("p_item_id" bigint, "p_manter_ativa" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reverse_selected_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reverse_selected_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reverse_selected_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."reverse_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reverse_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."reverse_transaction_payment"("p_transaction_id" bigint, "p_payment_id" "uuid", "p_idempotency_key" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_financial_resource_sharing"("p_resource_type" "text", "p_resource_id" bigint, "p_shared" boolean, "p_expected_version" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_financial_resource_sharing"("p_resource_type" "text", "p_resource_id" bigint, "p_shared" boolean, "p_expected_version" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."set_financial_resource_sharing"("p_resource_type" "text", "p_resource_id" bigint, "p_shared" boolean, "p_expected_version" bigint, "p_idempotency_key" "uuid", "p_expected_user_id" "uuid", "p_client_created_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_transfer_transaction_status"("p_transaction_id" bigint, "p_expected_status" "text", "p_new_status" "text", "p_realization_date" "date", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_transfer_transaction_status"("p_transaction_id" bigint, "p_expected_status" "text", "p_new_status" "text", "p_realization_date" "date", "p_idempotency_key" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."set_transfer_transaction_status"("p_transaction_id" bigint, "p_expected_status" "text", "p_new_status" "text", "p_realization_date" "date", "p_idempotency_key" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."upsert_paddle_subscription"("p_user_id" "uuid", "p_product_code" "text", "p_plan" "text", "p_billing_cycle" "text", "p_subscription_id" "text", "p_customer_id" "text", "p_status" "text", "p_price_id" "text", "p_product_id" "text", "p_started_at" timestamp with time zone, "p_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean, "p_cancelled_at" timestamp with time zone, "p_scheduled_action" "text", "p_scheduled_at" timestamp with time zone, "p_event_at" timestamp with time zone, "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."upsert_paddle_subscription"("p_user_id" "uuid", "p_product_code" "text", "p_plan" "text", "p_billing_cycle" "text", "p_subscription_id" "text", "p_customer_id" "text", "p_status" "text", "p_price_id" "text", "p_product_id" "text", "p_started_at" timestamp with time zone, "p_period_end" timestamp with time zone, "p_cancel_at_period_end" boolean, "p_cancelled_at" timestamp with time zone, "p_scheduled_action" "text", "p_scheduled_at" timestamp with time zone, "p_event_at" timestamp with time zone, "p_payload" "jsonb") TO "service_role";
























GRANT ALL ON TABLE "private"."ai_invoice_payment_ledger" TO "service_role";



GRANT ALL ON TABLE "private"."bank_reconciliation_transactions" TO "service_role";



GRANT ALL ON TABLE "private"."edge_rate_limits" TO "service_role";



GRANT ALL ON TABLE "private"."offline_action_receipts" TO "service_role";



GRANT ALL ON TABLE "private"."transaction_completion_receipts" TO "service_role";



GRANT ALL ON TABLE "private"."transaction_reopen_receipts" TO "service_role";



GRANT ALL ON TABLE "public"."ai_action_audit" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_action_audit_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_conversations" TO "service_role";



GRANT ALL ON TABLE "public"."ai_messages" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_messages_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_pending_actions" TO "service_role";



GRANT ALL ON TABLE "public"."ai_request_usage" TO "service_role";



GRANT ALL ON SEQUENCE "public"."ai_request_usage_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."ai_request_usage_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."ai_request_usage_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."ai_transaction_origins" TO "service_role";
GRANT SELECT ON TABLE "public"."ai_transaction_origins" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."billing_products" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."billing_products" TO "authenticated";
GRANT ALL ON TABLE "public"."billing_products" TO "service_role";



GRANT ALL ON TABLE "public"."billing_settings" TO "service_role";



GRANT ALL ON TABLE "public"."caixinhas" TO "authenticated";
GRANT ALL ON TABLE "public"."caixinhas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."caixinhas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."caixinhas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."caixinhas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."cartoes" TO "authenticated";
GRANT ALL ON TABLE "public"."cartoes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."cartoes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."cartoes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."cartoes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."categorias" TO "authenticated";
GRANT ALL ON TABLE "public"."categorias" TO "service_role";



GRANT ALL ON SEQUENCE "public"."categorias_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."categorias_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."categorias_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."chat_historico" TO "authenticated";
GRANT ALL ON TABLE "public"."chat_historico" TO "service_role";



GRANT ALL ON SEQUENCE "public"."chat_historico_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."chat_historico_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."chat_historico_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."contas" TO "authenticated";
GRANT ALL ON TABLE "public"."contas" TO "service_role";



GRANT ALL ON SEQUENCE "public"."contas_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."contas_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."contas_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."contas_ocultas_usuario" TO "service_role";



GRANT ALL ON TABLE "public"."dispositivos_push" TO "service_role";



GRANT ALL ON TABLE "public"."fatura_itens" TO "authenticated";
GRANT ALL ON TABLE "public"."fatura_itens" TO "service_role";



GRANT ALL ON SEQUENCE "public"."fatura_itens_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."fatura_itens_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."fatura_itens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."feedbacks" TO "authenticated";
GRANT ALL ON TABLE "public"."feedbacks" TO "service_role";



GRANT ALL ON TABLE "public"."notificacoes_sistema" TO "service_role";
GRANT SELECT ON TABLE "public"."notificacoes_sistema" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."notificacoes_sistema_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."paddle_customers" TO "service_role";



GRANT ALL ON TABLE "public"."parceria_caixinha_decisoes" TO "authenticated";
GRANT ALL ON TABLE "public"."parceria_caixinha_decisoes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."parceria_caixinha_decisoes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."parceria_caixinha_decisoes_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."parceria_dissolucao_itens" TO "service_role";
GRANT SELECT ON TABLE "public"."parceria_dissolucao_itens" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."parceria_dissolucao_itens_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."parceria_dissolucao_resumos" TO "service_role";
GRANT SELECT ON TABLE "public"."parceria_dissolucao_resumos" TO "authenticated";



GRANT ALL ON SEQUENCE "public"."parceria_dissolucao_resumos_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."parcerias" TO "authenticated";
GRANT ALL ON TABLE "public"."parcerias" TO "service_role";



GRANT ALL ON SEQUENCE "public"."parcerias_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."parcerias_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."parcerias_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."subscription_events" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subscriptions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."transacoes" TO "authenticated";
GRANT ALL ON TABLE "public"."transacoes" TO "service_role";



GRANT ALL ON SEQUENCE "public"."transacoes_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."transacoes_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."transacoes_id_seq" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


-- ---------------------------------------------------------------------------
-- Itens fora do schema, que o dump não inclui.
-- ---------------------------------------------------------------------------

-- Tarefas agendadas (pg_cron). cron.schedule atualiza a tarefa se o nome já existir.
SELECT cron.schedule('finflow-cleanup-ai-retention', '17 * * * *', $cron$select public.finflow_cleanup_ai_retention();$cron$);
SELECT cron.schedule('finflow-cleanup-cron-job-run-details', '30 3 * * *', $cron$select public.finflow_cleanup_cron_job_run_details();$cron$);
SELECT cron.schedule('finflow-cleanup-external-edge-retention', '41 3 * * *', $cron$select public.finflow_cleanup_external_edge_retention();$cron$);
SELECT cron.schedule('finflow-cleanup-stale-phone-changes', '*/10 * * * *', $cron$select public.finflow_cleanup_stale_phone_changes();$cron$);
SELECT cron.schedule('finflow-transaction-receipt-retention', '17 3 * * *', $cron$select private.cleanup_transaction_completion_receipts();$cron$);

-- Verificação em duas etapas: o PostgREST roda finflow_guard.enforce_mfa()
-- antes de cada requisição (ver docs/SEGURANCA.md).
ALTER ROLE "authenticator" SET "pgrst.db_pre_request" = 'finflow_guard.enforce_mfa';
NOTIFY pgrst, 'reload config';
