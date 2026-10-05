-- Periodicidade das parcelas e datas de séries semanais.
--
-- Pedido do responsável em 05/10/2026:
--   * Parcelas semanais, mensais ou anuais: campo opcional
--     installment_frequency ('semanal','mensal','anual') em create_transaction
--     e transfer_between_accounts, só junto com frequency='parcelada'. Sem o
--     campo, as parcelas continuam mensais, então versões antigas do app e do
--     site seguem funcionando.
--   * Editar a data de uma série semanal (fixa ou parcelada) com "esta e as
--     próximas" desloca todos os itens pelo mesmo número de dias, em vez de
--     pôr todos no mesmo dia de cada mês. O intervalo das parcelas é medido
--     pela distância entre os itens da série.
--
-- Cada função abaixo é cópia literal da definição anterior (linha de base ou
-- 20261001112938), alterada só nos trechos acima. CREATE OR REPLACE mantém
-- dono e permissões.
--
-- Reverter: recriar as duas funções com os corpos anteriores:
--   private.ai_prepare_action da linha de base
--   (20260929203600_linha_de_base_producao.sql) e
--   private.ai_execute_transaction_action de
--   20261001112938_corrige_transferencia_entre_contas.sql.
--   Parcelas semanais ou anuais já criadas continuam válidas como lançamentos
--   comuns.

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
  installment_frequency text;
  offset_mode boolean := false;
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
    installment_frequency:=coalesce(payload->>'installment_frequency','mensal');
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
        when 'parcelada' then private.ai_add_occurrence(base_date,occurrence_index,
          case installment_frequency when 'semanal' then 'weekly'
            when 'anual' then 'annual' else 'monthly' end)
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

    -- Séries semanais (fixas ou parceladas) mudam de data deslocando todos os
    -- itens pelo mesmo número de dias; as mensais e anuais mantêm cada item no
    -- seu mês. As parcelas não dizem o intervalo na descrição, então ele é
    -- medido pela distância entre os itens.
    if field_name='scheduled_date' then
      offset_mode:=transaction_row.descricao like '%(Fixa semanal)%'
        or (series_match is not null and exists(
          select 1 from public.transacoes s
          where s.user_id=transaction_row.user_id
            and position('[Serie:'||series_match[1]||']' in s.descricao)>0
            and s.id<>transaction_row.id
            and abs(s.data_vencimento-transaction_row.data_vencimento) between 1 and 27));
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
        if offset_mode then
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
