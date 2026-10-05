-- Periodicidade das parcelas (migration
-- 20261005120000_periodicidade_das_parcelas.sql): parcelas semanais, mensais
-- ou anuais; editar a data de uma série semanal desloca todos os itens, sem
-- juntá-los num mesmo dia; repetição diária não existe.
-- Rodam no CI num banco vazio com todas as migrations aplicadas e desfazem
-- tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'f0000000-0000-4000-8000-0000000000f1',
  'parcelas@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000f1","role":"authenticated","email":"parcelas@finflow.test"}', true);

insert into public.contas (nome, saldo_inicial, user_id) values ('Parcelas', 1000, 'f0000000-0000-4000-8000-0000000000f1');
insert into public.categorias (nome, cor, icone, tipo, ativa, user_id)
values ('Estudos', '#E76F51', 'school', 'despesa', 1, 'f0000000-0000-4000-8000-0000000000f1');

-- ---------------------------------------------------------------------------
-- Parcelas por periodicidade
-- ---------------------------------------------------------------------------

select is(
  public.execute_manual_financial_action('create_transaction', jsonb_build_object(
    'type','despesa','value',40,'description','Aula','status','pendente','scheduled_date','2031-01-01',
    'account_id',(select id from public.contas where nome='Parcelas'),
    'category_id',(select id from public.categorias where nome='Estudos'),
    'frequency','parcelada','installments',4,'installment_frequency','semanal'),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())->>'ok',
  'true',
  'Parcelas semanais são criadas'
);

select is(
  (select array_agg(data_vencimento order by data_vencimento) from public.transacoes where descricao like 'Aula (%/4)%'),
  array['2031-01-01','2031-01-08','2031-01-15','2031-01-22']::date[],
  'As parcelas semanais têm 7 dias entre si'
);

select is(
  (select sum(valor) from public.transacoes where descricao like 'Aula (%/4)%'),
  40::numeric,
  'A soma das parcelas semanais é o valor total'
);

select is(
  public.execute_manual_financial_action('create_transaction', jsonb_build_object(
    'type','despesa','value',300,'description','Seguro','status','pendente','scheduled_date','2032-02-29',
    'account_id',(select id from public.contas where nome='Parcelas'),
    'category_id',(select id from public.categorias where nome='Estudos'),
    'frequency','parcelada','installments',3,'installment_frequency','anual'),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())->>'ok',
  'true',
  'Parcelas anuais são criadas'
);

select is(
  (select array_agg(data_vencimento order by data_vencimento) from public.transacoes where descricao like 'Seguro (%/3)%'),
  array['2032-02-29','2033-02-28','2034-02-28']::date[],
  'As parcelas anuais ajustam o 29/02 para o fim de fevereiro'
);

select is(
  public.execute_manual_financial_action('create_transaction', jsonb_build_object(
    'type','despesa','value',90,'description','Geladeira','status','pendente','scheduled_date','2031-01-31',
    'account_id',(select id from public.contas where nome='Parcelas'),
    'category_id',(select id from public.categorias where nome='Estudos'),
    'frequency','parcelada','installments',3),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())->>'ok',
  'true',
  'Sem a periodicidade, a parcelada continua sendo criada'
);

select is(
  (select array_agg(data_vencimento order by data_vencimento) from public.transacoes where descricao like 'Geladeira (%/3)%'),
  array['2031-01-31','2031-02-28','2031-03-31']::date[],
  'Sem a periodicidade, as parcelas continuam mensais'
);

select throws_ok(
  $$select public.execute_manual_financial_action('create_transaction', jsonb_build_object(
    'type','despesa','value',12,'description','Erro','status','pendente','scheduled_date','2030-01-01',
    'account_id',(select id from public.contas where nome='Parcelas'),
    'category_id',(select id from public.categorias where nome='Estudos'),
    'frequency','mensal','installment_frequency','semanal'), gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())$$,
  'P0001',
  'AI_INSTALLMENT_FREQUENCY_NOT_ALLOWED',
  'A periodicidade das parcelas só vale para a parcelada'
);

select throws_ok(
  $$select public.execute_manual_financial_action('create_transaction', jsonb_build_object(
    'type','despesa','value',12,'description','Erro','status','pendente','scheduled_date','2030-01-01',
    'account_id',(select id from public.contas where nome='Parcelas'),
    'category_id',(select id from public.categorias where nome='Estudos'),
    'frequency','parcelada','installments',2,'installment_frequency','diaria'), gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())$$,
  'P0001',
  'AI_INVALID_INSTALLMENT_FREQUENCY',
  'Parcelas diárias são recusadas'
);

select throws_ok(
  $$select public.execute_manual_financial_action('create_transaction', jsonb_build_object(
    'type','despesa','value',12,'description','Erro','status','pendente','scheduled_date','2030-01-01',
    'account_id',(select id from public.contas where nome='Parcelas'),
    'category_id',(select id from public.categorias where nome='Estudos'),
    'frequency','parcelada','installments',2,'installment_frequency','quinzenal'), gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())$$,
  'P0001',
  'AI_INVALID_INSTALLMENT_FREQUENCY',
  'Periodicidade desconhecida é recusada'
);

select throws_ok(
  $$select public.execute_manual_financial_action('create_transaction', jsonb_build_object(
    'type','despesa','value',12,'description','Erro','status','pendente','scheduled_date','2030-01-01',
    'account_id',(select id from public.contas where nome='Parcelas'),
    'category_id',(select id from public.categorias where nome='Estudos'),
    'frequency','diaria'), gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())$$,
  'P0001',
  'AI_INVALID_FREQUENCY',
  'Não existe fixa diária'
);

-- ---------------------------------------------------------------------------
-- Editar a data da série
-- ---------------------------------------------------------------------------

-- Parcela 2/4 (08/01) passa para 10/01: todas andam 2 dias, sem se juntar.
select is(
  public.execute_manual_financial_action('update_transaction', jsonb_build_object(
    'transaction_id',(select id from public.transacoes where descricao like 'Aula (2/4)%'),
    'series_scope','open_series','field','scheduled_date','new_value','2031-01-10'),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())->>'ok',
  'true',
  'A data da série semanal é editada'
);

select is(
  (select array_agg(data_vencimento order by data_vencimento) from public.transacoes where descricao like 'Aula (%/4)%'),
  array['2031-01-03','2031-01-10','2031-01-17','2031-01-24']::date[],
  'Na série semanal, todas as parcelas andam os mesmos 2 dias'
);

-- Parcela 2/3 (28/02) passa para o dia 10: cada parcela fica no seu mês, no dia 10.
select is(
  public.execute_manual_financial_action('update_transaction', jsonb_build_object(
    'transaction_id',(select id from public.transacoes where descricao like 'Geladeira (2/3)%'),
    'series_scope','open_series','field','scheduled_date','new_value','2031-02-10'),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f1', clock_timestamp())->>'ok',
  'true',
  'A data da série mensal é editada'
);

select is(
  (select array_agg(data_vencimento order by data_vencimento) from public.transacoes where descricao like 'Geladeira (%/3)%'),
  array['2031-01-10','2031-02-10','2031-03-10']::date[],
  'Na série mensal, cada parcela continua no seu mês, no novo dia'
);

reset role;

select * from finish();
rollback;
