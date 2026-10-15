-- Lançamento incerto (migration 20261015120000_lancamento_incerto.sql): a
-- marcação vale em receita ou despesa única pendente, some ao concluir e não
-- vale em parcela, fixa ou transferência. Rodam no CI num banco vazio com
-- todas as migrations aplicadas e desfazem tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'f0000000-0000-4000-8000-0000000000f6',
  'lancamento-incerto@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

insert into public.billing_settings (id) select true where not exists (select 1 from public.billing_settings);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000f6","role":"authenticated","email":"lancamento-incerto@finflow.test"}', true);

insert into public.contas (nome, saldo_inicial, cor, user_id)
values ('Conta incerta', 1000, '#2A9D8F', 'f0000000-0000-4000-8000-0000000000f6');
insert into public.categorias (nome, cor, icone, tipo, user_id)
values ('Freelas', '#2A9D8F', 'label', 'receita', 'f0000000-0000-4000-8000-0000000000f6');

insert into public.transacoes (user_id, tipo, valor, descricao, data_vencimento, status, conta_id, categoria_id, incerta)
select 'f0000000-0000-4000-8000-0000000000f6', 'receita', item.valor, item.descricao, date '2027-01-10', 'pendente', c.id, cat.id, true
from public.contas c
cross join public.categorias cat
cross join (values (500, 'Freela talvez'), (200, 'Venda (Fixa)'), (100, 'Projeto (1/3)')) as item(valor, descricao)
where c.nome = 'Conta incerta' and cat.nome = 'Freelas';

select is(
  (select incerta from public.transacoes where descricao = 'Freela talvez'),
  true,
  'Receita única pendente aceita a marcação de incerta'
);

select is(
  (select incerta from public.transacoes where descricao = 'Venda (Fixa)'),
  false,
  'Fixa não fica incerta'
);

select is(
  (select incerta from public.transacoes where descricao = 'Projeto (1/3)'),
  false,
  'Parcela não fica incerta'
);

update public.transacoes set incerta = false where descricao = 'Freela talvez';
update public.transacoes set incerta = true where descricao = 'Freela talvez';

select is(
  (select incerta from public.transacoes where descricao = 'Freela talvez'),
  true,
  'A marcação pode ser tirada e posta de novo'
);

select public.execute_manual_financial_action('complete_transaction', jsonb_build_object(
  'transaction_id', (select id from public.transacoes where descricao = 'Freela talvez'),
  'expected_value', 500, 'realized_value', 500,
  'realization_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text),
  gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f6', clock_timestamp());

select is(
  (select incerta from public.transacoes where descricao = 'Freela talvez'),
  false,
  'Ao concluir, deixa de ser incerta'
);

reset role;

select * from finish();

rollback;
