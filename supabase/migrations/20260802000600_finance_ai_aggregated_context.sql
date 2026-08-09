-- FinFlow AI: contexto financeiro agregado no banco.
--
-- A função é SECURITY INVOKER de propósito: todas as leituras continuam
-- passando pelas políticas RLS da sessão autenticada. A Edge recebe apenas
-- agregados e busca detalhes separadamente, com limites pequenos.

create index if not exists transacoes_ai_context_account_status_date_idx
  on public.transacoes (conta_id, status, data_vencimento, data_realizacao, id);

create index if not exists fatura_itens_ai_context_card_month_paid_idx
  on public.fatura_itens (cartao_id, mes_fatura, pago, id);

create or replace function public.finance_ai_context_snapshot(
  p_current_date date,
  p_focus_month text,
  p_years integer[],
  p_scope_account_ids bigint[] default null,
  p_analytics_allowed boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
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
$$;

comment on function public.finance_ai_context_snapshot(date, text, integer[], bigint[], boolean) is
  'Agrega o contexto financeiro da IA sob a sessão e as políticas RLS do usuário; não retorna descrições nem linhas brutas.';

revoke all on function public.finance_ai_context_snapshot(date, text, integer[], bigint[], boolean)
  from public, anon;
grant execute on function public.finance_ai_context_snapshot(date, text, integer[], bigint[], boolean)
  to authenticated;
