-- Desempenho das regras de acesso (RLS) com muitos usuários.
--
-- O teste de carga de 02/10/2026 (scripts/carga/teste-carga.cjs, num projeto
-- de teste com 200 contas e ~120 mil lançamentos) mostrou que abrir o Início
-- lia a tabela transacoes INTEIRA a cada consulta: para devolver os 600
-- lançamentos de uma pessoa, o banco descartava 119 mil linhas dos outros.
-- O motivo eram regras no formato "dono = eu OU EXISTS(...)" e
-- "is_parceiro(dono, eu)" avaliadas linha a linha, que impedem o uso de índice.
-- O custo crescia com o total de usuários, não com os dados de cada um.
--
-- As regras abaixo são equivalentes às anteriores (mesmas linhas visíveis),
-- só escritas de um jeito que o Postgres consegue resolver pelos índices:
-- a lista de parceiros e a lista de contas visíveis são calculadas UMA vez
-- por consulta e comparadas com "= ANY(...)".
--
-- O mesmo teste mostrou o maior custo em public.refresh_my_recurring_schedules,
-- chamada a cada abertura do Início no app e a cada página do site: ~220 ms
-- mesmo sem nada a criar (~900 ms sob carga), porque a escolha das séries
-- comparava cada lançamento fixo com todos os outros. Só essa consulta foi
-- reescrita (13 ms); o resto da função é cópia literal da linha de base.
--
-- Também entram recomendações do advisor do Supabase com efeito real:
-- índices em parcerias (consultada a cada abertura do app), em
-- transacoes.categoria_id e fatura_itens.categoria_id (conferidos ao excluir
-- uma categoria) e auth.uid() calculado uma vez em ai_transaction_origins.
--
-- Reverter:
--   drop policy contas_partner_select, caixinhas_partner_select,
--   caixinhas_partner_update, transacoes_accessible_select e
--   ai_transaction_origins_owner_select, e recriá-las com as definições da
--   linha de base (supabase/migrations/20260929203600_linha_de_base_producao.sql,
--   blocos CREATE POLICY de mesmo nome); recriar
--   public.refresh_my_recurring_schedules com o corpo da linha de base; depois
--   drop function public.ids_parceiros_do_usuario();
--   drop index parcerias_solicitante_id_idx, parcerias_convidado_id_idx,
--   parcerias_convidado_email_lower_idx, transacoes_categoria_id_idx,
--   fatura_itens_categoria_id_idx.

-- ---------------------------------------------------------------------------
-- Parceiros de quem está logado, calculados uma vez por consulta.
-- Mesma regra de public.is_parceiro(dono, visitante): parceria aceita em que
-- a pessoa é quem convidou ou quem foi convidada.
-- ---------------------------------------------------------------------------
create or replace function public.ids_parceiros_do_usuario()
returns uuid[]
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(array_agg(parceiro), '{}'::uuid[])
  from (
    select p.convidado_id as parceiro
    from public.parcerias p
    where (select auth.uid()) is not null
      and p.status = 'aceito'
      and p.solicitante_id = (select auth.uid())
      and p.convidado_id is not null
    union
    select p.solicitante_id
    from public.parcerias p
    where (select auth.uid()) is not null
      and p.status = 'aceito'
      and p.convidado_id = (select auth.uid())
  ) parceiros;
$$;

revoke all on function public.ids_parceiros_do_usuario() from public;
revoke all on function public.ids_parceiros_do_usuario() from anon;
grant execute on function public.ids_parceiros_do_usuario() to authenticated;
grant execute on function public.ids_parceiros_do_usuario() to service_role;

-- ---------------------------------------------------------------------------
-- Índices
-- ---------------------------------------------------------------------------
create index if not exists parcerias_solicitante_id_idx on public.parcerias using btree (solicitante_id);
create index if not exists parcerias_convidado_id_idx on public.parcerias using btree (convidado_id);
create index if not exists parcerias_convidado_email_lower_idx on public.parcerias using btree (lower(convidado_email));
create index if not exists transacoes_categoria_id_idx on public.transacoes using btree (categoria_id);
create index if not exists fatura_itens_categoria_id_idx on public.fatura_itens using btree (categoria_id);

-- ---------------------------------------------------------------------------
-- Contas e objetivos compartilhados por parceiros
-- (antes: public.is_parceiro(user_id, auth.uid()) linha a linha)
-- ---------------------------------------------------------------------------
drop policy if exists contas_partner_select on public.contas;
create policy contas_partner_select on public.contas
  for select to authenticated
  using (
    not coalesce(arquivado, false)
    and compartilhado is true
    and user_id = any ((select public.ids_parceiros_do_usuario())::uuid[])
  );

drop policy if exists caixinhas_partner_select on public.caixinhas;
create policy caixinhas_partner_select on public.caixinhas
  for select to authenticated
  using (
    not coalesce(arquivado, false)
    and compartilhado is true
    and user_id = any ((select public.ids_parceiros_do_usuario())::uuid[])
  );

drop policy if exists caixinhas_partner_update on public.caixinhas;
create policy caixinhas_partner_update on public.caixinhas
  for update to authenticated
  using (
    not coalesce(arquivado, false)
    and compartilhado is true
    and user_id = any ((select public.ids_parceiros_do_usuario())::uuid[])
  )
  with check (
    not coalesce(arquivado, false)
    and compartilhado is true
    and user_id = any ((select public.ids_parceiros_do_usuario())::uuid[])
  );

-- ---------------------------------------------------------------------------
-- Lançamentos: os próprios ou os de uma conta visível (própria ou de
-- parceiro e compartilhada). Antes: EXISTS(...) correlacionado por linha.
-- A subconsulta em contas continua sujeita às regras de contas (inclusive
-- contas ocultas e arquivadas de parceiros), como antes.
-- ---------------------------------------------------------------------------
drop policy if exists transacoes_accessible_select on public.transacoes;
create policy transacoes_accessible_select on public.transacoes
  for select to authenticated
  using (
    (select auth.uid()) = user_id
    or conta_id = any (array(
      select c.id
      from public.contas c
      where c.user_id = (select auth.uid())
         or (c.compartilhado is true and c.user_id = any ((select public.ids_parceiros_do_usuario())::uuid[]))
    ))
  );

-- ---------------------------------------------------------------------------
-- Advisor: auth.uid() uma vez por consulta, não por linha.
-- ---------------------------------------------------------------------------
drop policy if exists ai_transaction_origins_owner_select on public.ai_transaction_origins;
create policy ai_transaction_origins_owner_select on public.ai_transaction_origins
  for select to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Renovação das séries fixas: só a consulta que escolhe as séries mudou.
-- CREATE OR REPLACE mantém dono e permissões.
-- ---------------------------------------------------------------------------
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

  -- Séries fixas com pelo menos uma ocorrência pendente a partir de hoje.
  -- Antes, um EXISTS com LIKE era repetido para CADA lançamento fixo contra
  -- todos os lançamentos da pessoa (custo quadrático: ~220 ms por abertura
  -- do Início com 5 séries de 60 meses, ~900 ms sob carga). Agora as séries
  -- pendentes são calculadas uma vez e cruzadas pelo identificador.
  for recurring in
    with fixas as (
      select (regexp_match(t.descricao, '\[Serie:([^]]+)\]'))[1] as series_id,
        case when t.descricao like '%(Fixa semanal)%' then 'semanal'
             when t.descricao like '%(Fixa anual)%' then 'anual' else 'mensal' end as frequency
      from public.transacoes t
      where t.user_id = caller and t.descricao ~ '\[Serie:[^]]+\]' and t.descricao like '%(Fixa%'
    ),
    series_pendentes as (
      select distinct (regexp_match(pending.descricao, '\[Serie:([^]]+)\]'))[1] as series_id
      from public.transacoes pending
      where pending.user_id = caller
        and pending.status = 'pendente' and pending.data_vencimento >= current_date
        and pending.descricao ~ '\[Serie:[^]]+\]'
    )
    select distinct fixas.series_id, fixas.frequency
    from fixas
    join series_pendentes using (series_id)
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
