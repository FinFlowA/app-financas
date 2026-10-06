-- Meta (receitas) e limite (despesas) mensais por categoria.
--
-- Pedido do responsável em 06/10/2026: ao criar ou editar uma categoria, a
-- pessoa pode definir uma meta mensal (categorias de receita) ou um limite
-- mensal (categorias de despesa). O app e o site mostram o progresso do mês
-- na tela de Categorias.
--
--   * Colunas opcionais categorias.meta_mensal e categorias.limite_mensal,
--     positivas, cada uma só no tipo certo (receita/ambos e despesa/ambos).
--   * create_category aceita monthly_goal e monthly_limit.
--   * update_category aceita os campos monthly_goal e monthly_limit, com
--     'clear' (ou null na edição otimista) para tirar o valor.
--
-- Cada função abaixo é cópia literal da definição anterior (linha de base ou
-- 20261005120000), alterada só nos trechos acima. CREATE OR REPLACE mantém
-- dono e permissões.
--
-- Reverter: recriar private.ai_prepare_action com o corpo de
--   20261005120000_periodicidade_das_parcelas.sql, e
--   private.ai_execute_resource_action e
--   private.offline_prepare_optimistic_update com os da linha de base
--   (20260929203600_linha_de_base_producao.sql); depois
--   alter table public.categorias
--     drop constraint categorias_meta_mensal_valida,
--     drop constraint categorias_limite_mensal_valido,
--     drop column meta_mensal, drop column limite_mensal;

alter table public.categorias
  add column if not exists meta_mensal numeric(14,2),
  add column if not exists limite_mensal numeric(14,2);

alter table public.categorias
  add constraint categorias_meta_mensal_valida
    check (meta_mensal is null or (meta_mensal > 0 and tipo in ('receita','ambos'))),
  add constraint categorias_limite_mensal_valido
    check (limite_mensal is null or (limite_mensal > 0 and tipo in ('despesa','ambos')));

comment on column public.categorias.meta_mensal is 'Meta mensal de receitas da categoria (opcional).';
comment on column public.categorias.limite_mensal is 'Limite mensal de despesas da categoria (opcional).';


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
      allowed:=array['name','type','color','icon','monthly_goal','monthly_limit']; required:=array['name','type'];
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
      allowed:=array['type','value','description','status','scheduled_date','realization_date','account_id','category_id','frequency','installments','installment_value','installment_frequency','recurrence_count'];
      required:=array['type','value','description','status','scheduled_date','account_id','category_id','frequency'];
    when 'transfer_between_accounts' then
      allowed:=array['account_id','destination_account_id','value','description','status','scheduled_date','realization_date','frequency','installments','installment_value','installment_frequency','recurrence_count'];
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
  foreach key_name in array array['initial_balance','target_amount','value','expected_value','realized_value','payment_amount','installment_value','monthly_goal','monthly_limit'] loop
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
  -- Meta mensal só em categoria de receita; limite mensal só em despesa.
  if action_name='create_category' and (
    (normalized?'monthly_goal' and normalized->>'type'<>'receita')
    or (normalized?'monthly_limit' and normalized->>'type'<>'despesa')
  ) then perform private.ai_fail('AI_CATEGORY_TARGET_NOT_ALLOWED'); end if;
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
      -- Intervalo entre as parcelas; sem o campo, continuam mensais.
      if raw_payload?'installment_frequency' then
        normalized:=jsonb_set(normalized,'{installment_frequency}',
          to_jsonb(private.ai_choice(raw_payload,'installment_frequency',array['semanal','mensal','anual'])),true);
      end if;
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
  if raw_payload?'installment_frequency' and coalesce(normalized->>'frequency','')<>'parcelada' then
    perform private.ai_fail('AI_INSTALLMENT_FREQUENCY_NOT_ALLOWED');
  end if;
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
      or (action_name='update_category' and field_name not in ('name','color','icon','monthly_goal','monthly_limit'))
      or (action_name='update_goal' and field_name not in ('name','target_amount','color','icon','target_date'))
      or (action_name='update_transaction' and field_name not in ('description','value','scheduled_date','account_id','category_id'))
      or (action_name='update_card' and field_name not in ('name','value','color','due_day','closing_day'))
      or (action_name='update_card_purchase' and field_name not in ('description','category_id')) then
      perform private.ai_fail('AI_INVALID_FIELD');
    end if;
    normalized:=jsonb_set(normalized,'{field}',to_jsonb(field_name),true);
    if field_name in ('monthly_goal','monthly_limit') then
      -- Valor positivo, ou 'clear' para tirar a meta/o limite da categoria.
      if jsonb_typeof(raw_payload->'new_value')='string'
         and lower(raw_payload->>'new_value') in ('clear','null') then
        normalized:=jsonb_set(normalized,'{new_value}',to_jsonb('clear'::text),true);
      else
        numeric_value:=round(private.ai_number(raw_payload,'new_value'),2);
        if numeric_value<=0 or numeric_value>999999999999.99 then perform private.ai_fail('AI_INVALID_NEW_VALUE'); end if;
        normalized:=jsonb_set(normalized,'{new_value}',to_jsonb(numeric_value),true);
      end if;
    elsif field_name in ('initial_balance','target_amount','value') then
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
  if action_name='update_category' and field_name in ('monthly_goal','monthly_limit')
     and not exists(select 1 from public.categorias c
       where c.id=(normalized->>'category_id')::bigint
         and c.tipo in (case when field_name='monthly_goal' then 'receita' else 'despesa' end,'ambos')) then
    perform private.ai_fail('AI_CATEGORY_TARGET_NOT_ALLOWED');
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
    insert into public.categorias(user_id,nome,tipo,cor,icone,ativa,meta_mensal,limite_mensal)
    values(caller,payload->>'name',payload->>'type',payload->>'color',payload->>'icon',1,
      (payload->>'monthly_goal')::numeric,(payload->>'monthly_limit')::numeric)
    returning id into resource_id;
    return jsonb_build_object('resource','category','id',resource_id,'created',true);
  elsif action_name='update_category' then
    resource_id:=(payload->>'category_id')::bigint;
    perform 1 from public.categorias where id=resource_id and user_id=caller for update;
    if not found then perform private.ai_fail('AI_CATEGORY_NOT_FOUND'); end if;
    update public.categorias set
      nome=case when field_name='name' then payload->>'new_value' else nome end,
      cor=case when field_name='color' then payload->>'new_value' else cor end,
      icone=case when field_name='icon' then payload->>'new_value' else icone end,
      meta_mensal=case when field_name='monthly_goal'
        then nullif(payload->>'new_value','clear')::numeric else meta_mensal end,
      limite_mensal=case when field_name='monthly_limit'
        then nullif(payload->>'new_value','clear')::numeric else limite_mensal end
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
      resource_key:='category_id'; allowed_fields:=array['name','color','icon','monthly_goal','monthly_limit'];
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
      if (action_name='update_goal' and field_name='target_date')
         or (action_name='update_category' and field_name in ('monthly_goal','monthly_limit')) then
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
