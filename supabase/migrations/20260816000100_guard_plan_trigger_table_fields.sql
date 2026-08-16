-- Evita acessar campos exclusivos de transacoes quando o trigger de limite
-- compartilhado estiver executando em contas, categorias, caixinhas ou cartoes.
--
-- Em uma funcao de trigger com NEW/OLD do tipo record, uma expressao como
--   TG_TABLE_NAME = 'transacoes' AND NEW.transacao_pai_id IS NOT NULL
-- nao e uma guarda segura: o PostgreSQL pode resolver/avaliar o segundo operando
-- em uma linha de outra tabela e produzir SQLSTATE 42703. O isolamento em um
-- bloco PL/pgSQL externo garante que campos especificos so sejam acessados
-- depois de a tabela ter sido identificada.

begin;

create or replace function public.enforce_finflow_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
    where user_id = new.user_id
      and not coalesce(arquivado, false);
  elsif tg_table_name = 'cartoes' then
    allowed_count := case current_plan when 'smart' then 3 else 1 end;
    select count(*) into used_count
    from public.cartoes
    where user_id = new.user_id
      and coalesce(ativo, true);
  elsif tg_table_name = 'caixinhas' then
    allowed_count := case current_plan when 'smart' then 5 else 1 end;
    select count(*) into used_count
    from public.caixinhas
    where user_id = new.user_id
      and not coalesce(arquivado, false);
  elsif tg_table_name = 'categorias' then
    allowed_count := case current_plan when 'smart' then 14 else 7 end;
    select count(*) into used_count
    from public.categorias
    where user_id = new.user_id
      and tipo = new.tipo
      and coalesce(ativa::text, 'true') not in ('0', 'false', 'f');
  elsif tg_table_name = 'transacoes' then
    allowed_count := case current_plan when 'smart' then 300 else 40 end;
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
  else
    return new;
  end if;

  if used_count >= allowed_count then
    raise exception using errcode = 'P0001', message = 'plan limit reached';
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_finflow_plan_limit()
  from public, anon, authenticated;

commit;
