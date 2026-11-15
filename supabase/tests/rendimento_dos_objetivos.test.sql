-- Rendimento dos objetivos (migration 20261115120000_rendimento_dos_objetivos.sql):
-- o saldo real informado soma a diferença como rendimento, nunca diminui o
-- saldo e não aceita data futura. Rodam no CI num banco vazio com todas as
-- migrations aplicadas e desfazem tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(7);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'f0000000-0000-4000-8000-0000000000f7',
  'rendimento-objetivo@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

insert into public.billing_settings (id) select true where not exists (select 1 from public.billing_settings);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000f7","role":"authenticated","email":"rendimento-objetivo@finflow.test"}', true);

insert into public.caixinhas (user_id, nome, meta_valor, saldo_atual, cor, icone)
values ('f0000000-0000-4000-8000-0000000000f7', 'Reserva rende', 10000, 1000, '#2A9D8F', 'savings');

select lives_ok(
  $$ select public.registrar_rendimento_objetivo(
       (select id from public.caixinhas where nome = 'Reserva rende'), 1035.50,
       (now() at time zone 'America/Sao_Paulo')::date) $$,
  'Saldo real maior registra o rendimento'
);

select is(
  (select saldo_atual from public.caixinhas where nome = 'Reserva rende'),
  1035.50::numeric,
  'O saldo do objetivo passa a ser o saldo real'
);

select is(
  (select valor from public.caixinha_rendimentos r join public.caixinhas c on c.id = r.caixinha_id where c.nome = 'Reserva rende'),
  35.50::numeric,
  'A diferença fica gravada como rendimento'
);

select throws_like(
  $$ select public.registrar_rendimento_objetivo(
       (select id from public.caixinhas where nome = 'Reserva rende'), 900,
       (now() at time zone 'America/Sao_Paulo')::date) $$,
  '%FINFLOW_YIELD_BELOW_BALANCE%',
  'Saldo real menor que o guardado é recusado'
);

select throws_like(
  $$ select public.registrar_rendimento_objetivo(
       (select id from public.caixinhas where nome = 'Reserva rende'), 1035.50,
       (now() at time zone 'America/Sao_Paulo')::date) $$,
  '%FINFLOW_YIELD_NO_CHANGE%',
  'Saldo igual ao guardado é recusado'
);

select throws_like(
  $$ select public.registrar_rendimento_objetivo(
       (select id from public.caixinhas where nome = 'Reserva rende'), 2000,
       (now() at time zone 'America/Sao_Paulo')::date + 1) $$,
  '%FINFLOW_YIELD_FUTURE_DATE%',
  'Data futura é recusada'
);

select throws_ok(
  $$ insert into public.caixinha_rendimentos (caixinha_id, saldo_anterior, saldo_informado, valor, data)
     select id, 0, 10, 10, current_date from public.caixinhas where nome = 'Reserva rende' $$,
  '42501',
  null,
  'Não dá para gravar rendimento direto na tabela'
);

reset role;

select * from finish();

rollback;
