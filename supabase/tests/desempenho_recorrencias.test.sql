-- Renovação das séries fixas (public.refresh_my_recurring_schedules),
-- reescrita por desempenho na migration
-- 20261002160000_desempenho_regras_de_acesso.sql. O resultado precisa ser o
-- mesmo de antes: completar as séries fixas que ainda têm ocorrência pendente
-- a partir de hoje (60 meses, 260 semanas ou 5 anos à frente), sem tocar em
-- séries encerradas nem em parcelamentos, e sem criar nada numa segunda
-- chamada. Rodam no CI num banco vazio com todas as migrations aplicadas e
-- desfazem tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'c0000000-0000-4000-8000-0000000000c1',
  'recorrencias@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

insert into public.contas (nome, saldo_inicial, user_id) values ('Conta fixa', 0, 'c0000000-0000-4000-8000-0000000000c1');
insert into public.categorias (nome, cor, icone, tipo, ativa, user_id)
values ('Moradia', '#457B9D', 'home', 'despesa', 1, 'c0000000-0000-4000-8000-0000000000c1');

-- Montado como manutenção (sem JWT).
insert into public.transacoes (tipo, valor, data_vencimento, data_realizacao, descricao, status, categoria_id, conta_id, user_id)
select 'despesa', 100, l.vencimento, l.realizacao, l.descricao, l.status,
       (select id from public.categorias where user_id = 'c0000000-0000-4000-8000-0000000000c1'),
       (select id from public.contas where user_id = 'c0000000-0000-4000-8000-0000000000c1'),
       'c0000000-0000-4000-8000-0000000000c1'
from (values
  -- Mensal com 3 ocorrências futuras (e 2 já pagas): completa até 60.
  (current_date - 50, current_date - 50, 'Aluguel (Fixa) [Serie:mensal-1]', 'paga'),
  (current_date - 20, current_date - 20, 'Aluguel (Fixa) [Serie:mensal-1]', 'paga'),
  (current_date + 10, null::date, 'Aluguel (Fixa) [Serie:mensal-1]', 'pendente'),
  (current_date + 40, null::date, 'Aluguel (Fixa) [Serie:mensal-1]', 'pendente'),
  (current_date + 70, null::date, 'Aluguel (Fixa) [Serie:mensal-1]', 'pendente'),
  -- Semanal com 2 ocorrências futuras: completa até 260.
  (current_date + 3, null::date, 'Feira (Fixa semanal) [Serie:semanal-1]', 'pendente'),
  (current_date + 10, null::date, 'Feira (Fixa semanal) [Serie:semanal-1]', 'pendente'),
  -- Série encerrada: só ocorrências antigas, nenhuma a partir de hoje.
  (current_date - 40, null::date, 'Academia (Fixa) [Serie:encerrada-1]', 'pendente'),
  (current_date - 10, null::date, 'Academia (Fixa) [Serie:encerrada-1]', 'pendente'),
  -- Parcelamento (não é fixa): nunca é completado.
  (current_date + 5, null::date, 'Notebook (1/2) [Serie:parcelas-1]', 'pendente'),
  (current_date + 35, null::date, 'Notebook (2/2) [Serie:parcelas-1]', 'pendente')
) as l (vencimento, realizacao, descricao, status);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"c0000000-0000-4000-8000-0000000000c1","role":"authenticated","email":"recorrencias@finflow.test"}', true);

select is(
  (public.refresh_my_recurring_schedules()->>'transactions_created')::integer,
  57 + 258,
  'A primeira renovação completa a série mensal (57) e a semanal (258)'
);

select is(
  (select count(*)::integer from public.transacoes
   where descricao like '%[Serie:mensal-1]%' and status = 'pendente' and data_vencimento >= current_date),
  60,
  'A série mensal fica com 60 ocorrências pendentes a partir de hoje'
);

select is(
  (select count(*)::integer from public.transacoes
   where descricao like '%[Serie:semanal-1]%' and status = 'pendente' and data_vencimento >= current_date),
  260,
  'A série semanal fica com 260 ocorrências pendentes a partir de hoje'
);

select is(
  (select count(distinct data_vencimento)::integer from public.transacoes where descricao like '%[Serie:mensal-1]%'),
  (select count(*)::integer from public.transacoes where descricao like '%[Serie:mensal-1]%'),
  'A série mensal não ganha duas ocorrências na mesma data'
);

select is(
  (select max(data_vencimento) from public.transacoes where descricao like '%[Serie:semanal-1]%'),
  current_date + 10 + 7 * 258,
  'A série semanal continua de 7 em 7 dias depois da última ocorrência'
);

select is(
  (select count(*)::integer from public.transacoes where descricao like '%[Serie:encerrada-1]%'),
  2,
  'A série encerrada não é renovada'
);

select is(
  (select count(*)::integer from public.transacoes where descricao like '%[Serie:parcelas-1]%'),
  2,
  'O parcelamento não é tratado como série fixa'
);

select is(
  (public.refresh_my_recurring_schedules()->>'transactions_created')::integer,
  0,
  'Uma segunda renovação não cria nada'
);

reset role;

select * from finish();
rollback;
