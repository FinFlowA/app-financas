-- Excluir uma fixa "esta e as próximas" (migration
-- 20261014120000_encerrar_fixa_a_partir_do_mes.sql): apaga o item e os
-- seguintes, mantém os anteriores e a renovação automática não recria os
-- meses apagados. Rodam no CI num banco vazio com todas as migrations
-- aplicadas e desfazem tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'f0000000-0000-4000-8000-0000000000f5',
  'encerrar-fixa@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

insert into public.billing_settings (id) select true where not exists (select 1 from public.billing_settings);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000f5","role":"authenticated","email":"encerrar-fixa@finflow.test"}', true);

insert into public.contas (nome, saldo_inicial, cor, user_id)
values ('Conta da fixa', 1000, '#2A9D8F', 'f0000000-0000-4000-8000-0000000000f5');
insert into public.categorias (nome, cor, icone, tipo, user_id)
values ('Academia', '#E76F51', 'label', 'despesa', 'f0000000-0000-4000-8000-0000000000f5');

-- Fixa mensal começando no mês que vem: 60 itens pendentes.
select public.execute_manual_financial_action('create_transaction', jsonb_build_object(
  'type', 'despesa', 'value', 99, 'description', 'Academia', 'status', 'pendente',
  'scheduled_date', (date_trunc('month', clock_timestamp() at time zone 'America/Sao_Paulo') + interval '1 month 9 days')::date::text,
  'account_id', (select id from public.contas where nome = 'Conta da fixa'),
  'category_id', (select id from public.categorias where nome = 'Academia'),
  'frequency', 'mensal'),
  gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f5', clock_timestamp());

select is(
  (select count(*)::integer from public.transacoes where descricao like 'Academia%' and status = 'pendente'),
  60,
  'A fixa mensal nasce com 60 itens'
);

-- Exclui do 3º item em diante.
select public.execute_manual_financial_action('delete_transaction', jsonb_build_object(
  'transaction_id', (select id from public.transacoes where descricao like 'Academia%' order by data_vencimento offset 2 limit 1),
  'series_scope', 'current_and_future'),
  gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f5', clock_timestamp());

select is(
  (select count(*)::integer from public.transacoes where descricao like 'Academia%' and status = 'pendente'),
  2,
  'Esta e as próximas apaga do 3º item em diante e mantém os dois primeiros'
);

select lives_ok(
  $$select public.refresh_my_recurring_schedules()$$,
  'A renovação automática roda'
);

select is(
  (select count(*)::integer from public.transacoes where descricao like 'Academia%' and status = 'pendente'),
  2,
  'A renovação não recria os meses apagados'
);

reset role;

select * from finish();

rollback;
