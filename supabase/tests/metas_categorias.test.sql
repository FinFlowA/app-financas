-- Meta (receitas) e limite (despesas) mensais por categoria (migration
-- 20261006120000_metas_e_limites_das_categorias.sql): criar e editar pelo
-- site e pelo app (inclusive edição otimista do modo offline), tirar o valor,
-- e as travas da tabela para o tipo errado ou valor inválido.
-- Rodam no CI num banco vazio com todas as migrations aplicadas e desfazem
-- tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'f0000000-0000-4000-8000-0000000000f2',
  'metas@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000f2","role":"authenticated","email":"metas@finflow.test"}', true);

-- ---------------------------------------------------------------------------
-- Criar
-- ---------------------------------------------------------------------------

select is(
  public.execute_manual_financial_action('create_category', jsonb_build_object(
    'name','Salário teste','type','receita','color','#2A9D8F','icon','payments','monthly_goal',5000),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())->>'ok',
  'true',
  'Categoria de receita é criada com meta mensal'
);

select is(
  (select array[meta_mensal, limite_mensal] from public.categorias where nome='Salário teste'),
  array[5000::numeric, null],
  'A meta fica gravada e o limite fica vazio'
);

select is(
  public.execute_manual_financial_action('create_category', jsonb_build_object(
    'name','Mercado teste','type','despesa','color','#E76F51','icon','local-grocery-store','monthly_limit',800.505),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())->>'ok',
  'true',
  'Categoria de despesa é criada com limite mensal'
);

select is(
  (select limite_mensal from public.categorias where nome='Mercado teste'),
  800.51::numeric,
  'O limite é arredondado para centavos'
);

select is(
  public.execute_manual_financial_action('create_category', jsonb_build_object(
    'name','Sem meta teste','type','despesa','color','#E76F51','icon','label'),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())->>'ok',
  'true',
  'Meta e limite são opcionais'
);

select throws_ok(
  $$select public.execute_manual_financial_action('create_category', jsonb_build_object(
    'name','Erro','type','despesa','color','#E76F51','icon','label','monthly_goal',100),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())$$,
  'P0001',
  'AI_CATEGORY_TARGET_NOT_ALLOWED',
  'Despesa não aceita meta (só limite)'
);

select throws_ok(
  $$select public.execute_manual_financial_action('create_category', jsonb_build_object(
    'name','Erro','type','despesa','color','#E76F51','icon','label','monthly_limit',0),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())$$,
  'P0001',
  'AI_INVALID_MONTHLY_LIMIT',
  'Limite precisa ser maior que zero'
);

-- ---------------------------------------------------------------------------
-- Editar (edição otimista, usada pelo site e pelo app, inclusive offline)
-- ---------------------------------------------------------------------------

select is(
  public.execute_offline_optimistic_update('update_category', jsonb_build_object(
    'category_id',(select id from public.categorias where nome='Mercado teste'),
    'expected_version',(select version from public.categorias where nome='Mercado teste'),
    'changes',jsonb_build_object('monthly_limit',1200,'name','Mercado do mês')),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())->>'ok',
  'true',
  'O limite é editado junto com o nome'
);

select is(
  (select limite_mensal from public.categorias where nome='Mercado do mês'),
  1200::numeric,
  'O novo limite fica gravado'
);

select is(
  public.execute_offline_optimistic_update('update_category', jsonb_build_object(
    'category_id',(select id from public.categorias where nome='Mercado do mês'),
    'expected_version',(select version from public.categorias where nome='Mercado do mês'),
    'changes',jsonb_build_object('monthly_limit',null)),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())->>'ok',
  'true',
  'Enviar null tira o limite'
);

select is(
  (select limite_mensal from public.categorias where nome='Mercado do mês'),
  null::numeric,
  'Sem limite depois de tirar'
);

select throws_ok(
  $$select public.execute_offline_optimistic_update('update_category', jsonb_build_object(
    'category_id',(select id from public.categorias where nome='Mercado do mês'),
    'expected_version',(select version from public.categorias where nome='Mercado do mês'),
    'changes',jsonb_build_object('monthly_goal',300)),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())$$,
  'P0001',
  'AI_CATEGORY_TARGET_NOT_ALLOWED',
  'Categoria de despesa não recebe meta na edição'
);

select is(
  public.execute_manual_financial_action('update_category', jsonb_build_object(
    'category_id',(select id from public.categorias where nome='Salário teste'),
    'field','monthly_goal','new_value',6500),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f2', clock_timestamp())->>'ok',
  'true',
  'A meta também é editada pela ação de campo único'
);

select is(
  (select meta_mensal from public.categorias where nome='Salário teste'),
  6500::numeric,
  'A nova meta fica gravada'
);

-- ---------------------------------------------------------------------------
-- Travas da tabela (gravação direta)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$update public.categorias set meta_mensal=100 where nome='Mercado do mês'$$,
  '23514',
  null,
  'A tabela recusa meta em categoria de despesa'
);

select throws_ok(
  $$update public.categorias set limite_mensal=-5 where nome='Mercado do mês'$$,
  '23514',
  null,
  'A tabela recusa limite negativo'
);

reset role;

select * from finish();
rollback;
