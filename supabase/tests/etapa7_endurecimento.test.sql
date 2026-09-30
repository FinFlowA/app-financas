-- Testes de comportamento da Etapa 7 da auditoria de segurança
-- (migration 20260930121216_endurece_banco_etapa7.sql). Rodam no CI num banco
-- Supabase vazio com todas as migrations aplicadas (`supabase test db`) e
-- desfazem tudo no fim (rollback).
begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

-- Três usuários com cadastro completo (termos e data de nascimento), exigido
-- pelas tabelas financeiras.
insert into auth.users (id, email, raw_user_meta_data, created_at)
select id::uuid, email, '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb, now()
from (values
  ('aaaaaaaa-0000-4000-8000-00000000000a', 'teto-a@finflow.test'),
  ('bbbbbbbb-0000-4000-8000-00000000000b', 'teto-b@finflow.test'),
  ('cccccccc-0000-4000-8000-00000000000c', 'teto-c@finflow.test')
) as usuarios (id, email);

-- ---------------------------------------------------------------------------
-- V08: tetos aprovados e estrutura
-- ---------------------------------------------------------------------------

select is(
  (select jsonb_object_agg(recurso, jsonb_build_array(teto_total, teto_diario)) from private.tetos_antiabuso),
  '{
    "lancamentos": [50000, 5000],
    "compras_cartao": [20000, 3000],
    "contas": [100, null],
    "objetivos": [100, null],
    "cartoes": [50, null],
    "categorias": [300, null],
    "convites_parceria": [null, 10],
    "feedbacks": [null, 10],
    "historico_finn": [2000, 300]
  }'::jsonb,
  'Os tetos por usuário são os aprovados em 30/09/2026'
);

select is(
  (select count(*)::integer from pg_trigger where tgname = 'finflow_teto_antiabuso' and not tgisinternal),
  9,
  'As nove tabelas graváveis pela API têm o gatilho do teto'
);

select ok(
  exists (select 1 from cron.job where jobname = 'finflow-cleanup-anti-abuse-counters'),
  'A limpeza diária dos contadores está agendada'
);

select ok(
  not has_table_privilege('authenticated', 'private.criacoes_diarias', 'select')
    and not has_table_privilege('authenticated', 'private.tetos_antiabuso', 'update'),
  'Usuários não leem nem alteram tetos e contadores'
);

-- Tetos pequenos só dentro deste teste, para não criar milhares de linhas.
update private.tetos_antiabuso set teto_total = 3 where recurso = 'contas';
update private.tetos_antiabuso set teto_diario = 2 where recurso = 'feedbacks';
update private.tetos_antiabuso set teto_diario = 4 where recurso = 'lancamentos';
update private.tetos_antiabuso set teto_diario = 1 where recurso = 'convites_parceria';

-- ---------------------------------------------------------------------------
-- V08: teto total (contas), por usuário
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","email":"teto-a@finflow.test"}', true);

select lives_ok(
  $$insert into public.contas (nome, user_id) values
      ('Conta A1', 'aaaaaaaa-0000-4000-8000-00000000000a'),
      ('Conta A2', 'aaaaaaaa-0000-4000-8000-00000000000a')$$,
  'Um lote abaixo do teto total é aceito'
);

select lives_ok(
  $$insert into public.contas (nome, user_id) values ('Conta A3', 'aaaaaaaa-0000-4000-8000-00000000000a')$$,
  'Chegar exatamente no teto total é aceito'
);

select throws_ok(
  $$insert into public.contas (nome, user_id) values ('Conta A4', 'aaaaaaaa-0000-4000-8000-00000000000a')$$,
  'P0001',
  'FINFLOW_TETO_SEGURANCA:contas:total:3',
  'Passar do teto total é recusado com o código que o app e o site traduzem'
);

reset role;
update public.contas set arquivado = true where nome = 'Conta A3';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","email":"teto-a@finflow.test"}', true);

select throws_ok(
  $$insert into public.contas (nome, user_id) values ('Conta A5', 'aaaaaaaa-0000-4000-8000-00000000000a')$$,
  'P0001',
  'FINFLOW_TETO_SEGURANCA:contas:total:3',
  'Contas arquivadas continuam contando no teto total'
);

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated","email":"teto-b@finflow.test"}', true);

select lives_ok(
  $$insert into public.contas (nome, user_id) values ('Conta B1', 'bbbbbbbb-0000-4000-8000-00000000000b')$$,
  'O teto é por usuário: o uso de A não afeta B'
);

-- ---------------------------------------------------------------------------
-- V08: teto diário (feedbacks)
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","email":"teto-a@finflow.test"}', true);

select lives_ok(
  $$insert into public.feedbacks (user_id, tipo, mensagem) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'sugestao', 'Primeiro feedback do dia')$$,
  'Primeiro feedback do dia'
);

select lives_ok(
  $$insert into public.feedbacks (user_id, tipo, mensagem) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'sugestao', 'Segundo feedback do dia')$$,
  'Segundo feedback do dia (no teto)'
);

select throws_ok(
  $$insert into public.feedbacks (user_id, tipo, mensagem) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'sugestao', 'Terceiro feedback do dia')$$,
  'P0001',
  'FINFLOW_TETO_SEGURANCA:feedbacks:diario:2',
  'Passar do teto diário é recusado'
);

reset role;

select is(
  (select total from private.criacoes_diarias
    where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a' and recurso = 'feedbacks'),
  2,
  'A tentativa recusada não consome o teto do dia'
);

-- ---------------------------------------------------------------------------
-- V08: lote de lançamentos conta todas as linhas do comando
-- ---------------------------------------------------------------------------

insert into public.categorias (nome, cor, icone, tipo, ativa, user_id)
values ('Mercado', '#E53935', 'cart', 'despesa', 1, 'aaaaaaaa-0000-4000-8000-00000000000a');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","email":"teto-a@finflow.test"}', true);

select lives_ok(
  $$insert into public.transacoes (tipo, valor, data_vencimento, descricao, status, categoria_id, conta_id, user_id)
    select 'despesa', 10, current_date, 'Compra ' || g, 'pendente',
           (select id from public.categorias where nome = 'Mercado' and user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
           (select id from public.contas where nome = 'Conta A1'),
           'aaaaaaaa-0000-4000-8000-00000000000a'
    from generate_series(1, 3) g$$,
  'Uma série de 3 lançamentos cabe no teto diário de 4'
);

select throws_ok(
  $$insert into public.transacoes (tipo, valor, data_vencimento, descricao, status, categoria_id, conta_id, user_id)
    select 'despesa', 10, current_date, 'Excedente ' || g, 'pendente',
           (select id from public.categorias where nome = 'Mercado' and user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
           (select id from public.contas where nome = 'Conta A1'),
           'aaaaaaaa-0000-4000-8000-00000000000a'
    from generate_series(1, 2) g$$,
  'P0001',
  'FINFLOW_TETO_SEGURANCA:lancamentos:diario:4',
  'Um lote que passaria do teto diário é recusado inteiro'
);

select is(
  (select count(*)::integer from public.transacoes where user_id = 'aaaaaaaa-0000-4000-8000-00000000000a'),
  3,
  'Nenhuma linha do lote recusado foi gravada'
);

-- ---------------------------------------------------------------------------
-- V08: convites de parceria contam para quem convida (solicitante_id)
-- ---------------------------------------------------------------------------

select lives_ok(
  $$insert into public.parcerias (solicitante_id, convidado_email, convidado_id, status)
    values ('aaaaaaaa-0000-4000-8000-00000000000a', 'teto-b@finflow.test', null, 'pendente')$$,
  'Primeiro convite do dia'
);

select throws_ok(
  $$insert into public.parcerias (solicitante_id, convidado_email, convidado_id, status)
    values ('aaaaaaaa-0000-4000-8000-00000000000a', 'teto-c@finflow.test', null, 'pendente')$$,
  'P0001',
  'FINFLOW_TETO_SEGURANCA:convites_parceria:diario:1',
  'Convites acima do teto diário são recusados antes de notificar alguém'
);

-- ---------------------------------------------------------------------------
-- V08: backends e manutenção não são barrados
-- ---------------------------------------------------------------------------

reset role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);

select lives_ok(
  $$insert into public.feedbacks (user_id, tipo, mensagem) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'sugestao', 'Gravado por um backend')$$,
  'service_role (Edge Functions) não passa pelo teto'
);

select set_config('request.jwt.claims', '', true);

select lives_ok(
  $$insert into public.feedbacks (user_id, tipo, mensagem) values ('aaaaaaaa-0000-4000-8000-00000000000a', 'sugestao', 'Manutenção sem JWT')$$,
  'Manutenção sem JWT (migrations, restauração) não passa pelo teto'
);

-- ---------------------------------------------------------------------------
-- V08: tamanho dos campos de texto
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated","email":"teto-b@finflow.test"}', true);

select throws_like(
  $$insert into public.contas (nome, user_id) values (repeat('x', 151), 'bbbbbbbb-0000-4000-8000-00000000000b')$$,
  '%contas_nome_tamanho%',
  'Nome de conta com mais de 150 caracteres é recusado'
);

select throws_like(
  $$insert into public.feedbacks (user_id, tipo, mensagem) values ('bbbbbbbb-0000-4000-8000-00000000000b', 'sugestao', repeat('x', 5001))$$,
  '%feedbacks_mensagem_tamanho%',
  'Feedback com mais de 5.000 caracteres é recusado'
);

select lives_ok(
  $$insert into public.contas (nome, user_id) values (repeat('x', 150), 'bbbbbbbb-0000-4000-8000-00000000000b')$$,
  'Nome no limite de 150 caracteres é aceito'
);

-- O lançamento é de A: como A, as validações de dono passam e sobra só a
-- regra de tamanho.
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","email":"teto-a@finflow.test"}', true);

select throws_like(
  $$insert into public.transacoes (tipo, valor, data_vencimento, descricao, status, categoria_id, conta_id, user_id)
    values ('despesa', 10, current_date, repeat('x', 501), 'pendente',
            (select id from public.categorias where nome = 'Mercado'),
            (select id from public.contas where nome = 'Conta A1'),
            'aaaaaaaa-0000-4000-8000-00000000000a')$$,
  '%transacoes_descricao_tamanho%',
  'Descrição de lançamento com mais de 500 caracteres é recusada'
);

reset role;

-- ---------------------------------------------------------------------------
-- V09 e V12
-- ---------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'public.refresh_my_recurring_schedules()', 'execute'),
  'V09: visitante sem login não executa refresh_my_recurring_schedules'
);

select ok(
  has_function_privilege('authenticated', 'public.refresh_my_recurring_schedules()', 'execute'),
  'V09: usuário logado continua executando refresh_my_recurring_schedules'
);

select is(
  (select extnamespace::regnamespace::text from pg_extension where extname = 'pg_net'),
  'extensions',
  'V12: pg_net fica no schema extensions'
);

select ok(
  to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null,
  'V12: net.http_post, usado pelo push, continua disponível'
);

-- ---------------------------------------------------------------------------
-- V13: token de push só muda de conta na mesma instalação do app
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","email":"teto-a@finflow.test"}', true);

select is(
  public.registrar_dispositivo_push('ExponentPushToken[teste-v13-um]', 'android', 'instalacao-a-0123456789abcdef0123456789abcdef'),
  true,
  'V13: A registra o token do próprio aparelho'
);

select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated","email":"teto-b@finflow.test"}', true);

select is(
  public.registrar_dispositivo_push('ExponentPushToken[teste-v13-um]', 'android', 'outra-instalacao-0123456789abcdef0123456789'),
  false,
  'V13: B não toma o token de A a partir de outra instalação'
);

select is(
  public.registrar_dispositivo_push('ExponentPushToken[teste-v13-um]', 'android'),
  false,
  'V13: B não toma o token de A sem o segredo (versão antiga do app)'
);

reset role;

select is(
  (select user_id from public.dispositivos_push where token = 'ExponentPushToken[teste-v13-um]'),
  'aaaaaaaa-0000-4000-8000-00000000000a'::uuid,
  'V13: o token continua com A depois das tentativas recusadas'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"bbbbbbbb-0000-4000-8000-00000000000b","role":"authenticated","email":"teto-b@finflow.test"}', true);

select is(
  public.registrar_dispositivo_push('ExponentPushToken[teste-v13-um]', 'android', 'instalacao-a-0123456789abcdef0123456789abcdef'),
  true,
  'V13: troca de login no mesmo aparelho (mesmo segredo) passa o token para B'
);

reset role;

select is(
  (select user_id from public.dispositivos_push where token = 'ExponentPushToken[teste-v13-um]'),
  'bbbbbbbb-0000-4000-8000-00000000000b'::uuid,
  'V13: o token passou para B'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"aaaaaaaa-0000-4000-8000-00000000000a","role":"authenticated","email":"teto-a@finflow.test"}', true);

select is(
  public.registrar_dispositivo_push('ExponentPushToken[teste-v13-dois]', 'ios'),
  true,
  'V13: versão antiga do app (sem segredo) continua registrando um token novo'
);

select throws_ok(
  $$select public.registrar_dispositivo_push('ExponentPushToken[teste-v13-tres]', 'android', 'curto')$$,
  '22023',
  'invalid installation id',
  'V13: segredo de instalação fora do formato é recusado'
);

reset role;

select ok(
  not has_function_privilege('anon', 'public.registrar_dispositivo_push(text,text,text)', 'execute')
    and has_function_privilege('authenticated', 'public.registrar_dispositivo_push(text,text,text)', 'execute'),
  'V13: só usuários logados registram aparelhos'
);

select * from finish();
rollback;
