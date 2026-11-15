-- Rendimento dividido entre objetivos (migration
-- 20261115130000_rendimento_dividido_entre_objetivos.sql): a diferença entre o
-- saldo real e a soma dos objetivos é dividida proporcionalmente, a soma bate
-- no centavo e saldo menor é recusado. Rodam no CI num banco vazio com todas
-- as migrations aplicadas e desfazem tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(6);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'f0000000-0000-4000-8000-0000000000f8',
  'rendimento-dividido@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

insert into public.billing_settings (id) select true where not exists (select 1 from public.billing_settings);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000f8","role":"authenticated","email":"rendimento-dividido@finflow.test"}', true);

insert into public.caixinhas (user_id, nome, meta_valor, saldo_atual, cor, icone)
values ('f0000000-0000-4000-8000-0000000000f8', 'Dividido A', 10000, 4718.38, '#2A9D8F', 'savings'),
       ('f0000000-0000-4000-8000-0000000000f8', 'Dividido B', 30000, 2150.00, '#2A9D8F', 'home');

select throws_like(
  $$ select public.registrar_rendimento_objetivos(
       array(select id from public.caixinhas where nome like 'Dividido %'), 6000,
       (now() at time zone 'America/Sao_Paulo')::date) $$,
  '%FINFLOW_YIELD_BELOW_BALANCE%',
  'Saldo real menor que a soma é recusado'
);

select lives_ok(
  $$ select public.registrar_rendimento_objetivos(
       array(select id from public.caixinhas where nome like 'Dividido %'), 7132.51,
       (now() at time zone 'America/Sao_Paulo')::date) $$,
  'Saldo real maior divide o rendimento'
);

select is(
  (select saldo_atual from public.caixinhas where nome = 'Dividido A'),
  4899.83::numeric,
  'O objetivo maior recebe a parte proporcional mais os centavos do arredondamento'
);

select is(
  (select saldo_atual from public.caixinhas where nome = 'Dividido B'),
  2232.68::numeric,
  'O objetivo menor recebe a parte proporcional'
);

select is(
  (select sum(saldo_atual) from public.caixinhas where nome like 'Dividido %'),
  7132.51::numeric,
  'A soma dos objetivos fica igual ao saldo real'
);

select is(
  (select count(*)::int from public.caixinha_rendimentos r join public.caixinhas c on c.id = r.caixinha_id where c.nome like 'Dividido %'),
  2,
  'Cada objetivo ganha seu registro de rendimento'
);

reset role;

select * from finish();

rollback;
