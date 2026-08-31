-- Mantém recorrências fixas com uma janela móvel de cinco anos. Parcelamentos
-- continuam finitos e, por isso, não participam desta reposição automática.

create or replace function private.finflow_add_months_clamped(base_date date, month_count integer)
returns date language sql immutable set search_path = '' as $$
  select (date_trunc('month', base_date) + make_interval(
    months => month_count,
    days => least(extract(day from base_date)::integer,
      extract(day from (date_trunc('month', base_date) + make_interval(months => month_count + 1) - interval '1 day'))::integer) - 1
  ))::date;
$$;

create or replace function public.refresh_my_recurring_schedules()
returns jsonb language plpgsql security definer set search_path = '' as $$
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

revoke all on function public.refresh_my_recurring_schedules() from public;
grant execute on function public.refresh_my_recurring_schedules() to authenticated;
