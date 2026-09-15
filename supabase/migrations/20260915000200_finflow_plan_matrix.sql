-- Matriz comercial FinFlow: Gratuito (free), Pro (smart) e Plus (premium).
-- A cobranca e a aplicacao dos limites continuam controladas exclusivamente
-- por billing_settings; esta migration nao ativa nenhuma das duas chaves.

begin;

do $$
declare
  function_sql text;
begin
  select pg_catalog.pg_get_functiondef('public.enforce_finflow_plan_limit()'::regprocedure)
    into function_sql;
  function_sql := pg_catalog.replace(function_sql,
    $needle$allowed_count := case current_plan when 'smart' then 5 else 1 end;$needle$,
    $needle$allowed_count := case current_plan when 'smart' then 3 else 1 end;$needle$);
  function_sql := pg_catalog.replace(function_sql,
    $needle$allowed_count := case current_plan when 'smart' then 300 else 40 end;$needle$,
    $needle$allowed_count := case current_plan when 'smart' then 150 else 40 end;$needle$);
  function_sql := pg_catalog.replace(function_sql,
    $needle$where user_id = new.user_id
      and not coalesce(arquivado, false);$needle$,
    $needle$where not coalesce(arquivado, false)
      and (
        user_id = new.user_id
        or (coalesce(compartilhado, false) and public.is_parceiro(user_id, new.user_id))
      );$needle$);
  function_sql := pg_catalog.replace(function_sql,
    $needle$if new.transacao_pai_id is not null then
      return new;
    end if;$needle$,
    $needle$if new.transacao_pai_id is not null then
      return new;
    end if;
    if coalesce(new.descricao, '') like '%[PagFatura:%' then
      return new;
    end if;$needle$);
  function_sql := pg_catalog.replace(function_sql,
    $needle$    end if;
  else
    return new;
  end if;$needle$,
    $needle$    end if;
    select used_count + pg_catalog.count(*) into used_count
    from public.fatura_itens
    where user_id = new.user_id
      and mes_fatura = pg_catalog.to_char(new.data_vencimento::date, 'YYYY-MM')
      and categoria_id is not null;
  else
    return new;
  end if;$needle$);
  execute function_sql;
end;
$$;

create or replace function private.finflow_plan_for_user(p_user_id uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce((select s.plan from public.subscriptions s
    where s.user_id = p_user_id and (s.status in ('active','grace_period') or (s.status = 'cancelled' and s.access_until > pg_catalog.now()))
    order by case s.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc limit 1), 'free');
$$;
revoke all on function private.finflow_plan_for_user(uuid) from public, anon, authenticated;

create or replace function private.finflow_account_usage(p_user_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select pg_catalog.count(*)::integer from public.contas c
  where not coalesce(c.arquivado, false) and (
    c.user_id = p_user_id or (coalesce(c.compartilhado, false) and public.is_parceiro(c.user_id, p_user_id))
  );
$$;
revoke all on function private.finflow_account_usage(uuid) from public, anon, authenticated;

create or replace function private.finflow_enforce_shared_account_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
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
revoke all on function private.finflow_enforce_shared_account_capacity() from public, anon, authenticated;
drop trigger if exists finflow_enforce_shared_account_capacity on public.contas;
create trigger finflow_enforce_shared_account_capacity before insert or update of compartilhado, arquivado on public.contas
for each row execute function private.finflow_enforce_shared_account_capacity();

create or replace function private.finflow_enforce_card_purchase_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
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
revoke all on function private.finflow_enforce_card_purchase_limit() from public, anon, authenticated;
drop trigger if exists finflow_enforce_card_purchase_limit on public.fatura_itens;
create trigger finflow_enforce_card_purchase_limit before insert or update of mes_fatura, categoria_id on public.fatura_itens
for each row execute function private.finflow_enforce_card_purchase_limit();

create or replace function public.get_my_plan_usage()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
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
revoke all on function public.get_my_plan_usage() from public, anon;
grant execute on function public.get_my_plan_usage() to authenticated;

commit;
