-- Regras de acesso reescritas para desempenho (migration
-- 20261002160000_desempenho_regras_de_acesso.sql). As regras novas precisam
-- mostrar exatamente as mesmas linhas que as antigas: o dono vê tudo o que é
-- dele; o parceiro vê só o que está compartilhado e não arquivado, e os
-- lançamentos dessas contas; quem não é parceiro não vê nada. Rodam no CI num
-- banco vazio com todas as migrations aplicadas e desfazem tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(13);

insert into auth.users (id, email, raw_user_meta_data, created_at)
select id::uuid, email, '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb, now()
from (values
  ('d0000000-0000-4000-8000-0000000000d1', 'dono@finflow.test'),
  ('d0000000-0000-4000-8000-0000000000d2', 'parceiro@finflow.test'),
  ('d0000000-0000-4000-8000-0000000000d3', 'estranho@finflow.test')
) as usuarios (id, email);

-- Dados montados como manutenção (sem JWT): parceria aceita entre dono e
-- parceiro, contas, objetivos e lançamentos.
insert into public.parcerias (solicitante_id, convidado_email, convidado_id, status)
values ('d0000000-0000-4000-8000-0000000000d1', 'parceiro@finflow.test', 'd0000000-0000-4000-8000-0000000000d2', 'aceito');

insert into public.contas (nome, saldo_inicial, user_id, compartilhado, arquivado) values
  ('Dono compartilhada', 0, 'd0000000-0000-4000-8000-0000000000d1', true, false),
  ('Dono privada', 0, 'd0000000-0000-4000-8000-0000000000d1', false, false),
  ('Parceiro própria', 0, 'd0000000-0000-4000-8000-0000000000d2', false, false),
  ('Estranho própria', 0, 'd0000000-0000-4000-8000-0000000000d3', false, false);

insert into public.caixinhas (nome, meta_valor, cor, icone, user_id, compartilhado) values
  ('Objetivo compartilhado', 1000, '#2A9D8F', 'savings', 'd0000000-0000-4000-8000-0000000000d1', true),
  ('Objetivo privado', 1000, '#2A9D8F', 'savings', 'd0000000-0000-4000-8000-0000000000d1', false);

insert into public.categorias (nome, cor, icone, tipo, ativa, user_id) values
  ('Mercado', '#E53935', 'cart', 'despesa', 1, 'd0000000-0000-4000-8000-0000000000d1'),
  ('Mercado', '#E53935', 'cart', 'despesa', 1, 'd0000000-0000-4000-8000-0000000000d2'),
  ('Mercado', '#E53935', 'cart', 'despesa', 1, 'd0000000-0000-4000-8000-0000000000d3');

insert into public.transacoes (tipo, valor, data_vencimento, descricao, status, categoria_id, conta_id, user_id)
select 'despesa', 10, current_date, l.descricao, 'pendente',
       (select id from public.categorias where user_id = l.user_id::uuid),
       (select id from public.contas where nome = l.conta),
       l.user_id::uuid
from (values
  ('Dono na compartilhada', 'Dono compartilhada', 'd0000000-0000-4000-8000-0000000000d1'),
  ('Dono na privada', 'Dono privada', 'd0000000-0000-4000-8000-0000000000d1'),
  ('Parceiro na própria', 'Parceiro própria', 'd0000000-0000-4000-8000-0000000000d2'),
  ('Estranho na própria', 'Estranho própria', 'd0000000-0000-4000-8000-0000000000d3')
) as l (descricao, conta, user_id);

-- ---------------------------------------------------------------------------
-- Parceiro
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-0000000000d2","role":"authenticated","email":"parceiro@finflow.test"}', true);

select is(
  public.ids_parceiros_do_usuario(),
  array['d0000000-0000-4000-8000-0000000000d1']::uuid[],
  'O parceiro tem o dono como único parceiro'
);

select is(
  (select array_agg(nome order by nome) from public.contas),
  array['Dono compartilhada', 'Parceiro própria'],
  'O parceiro vê a própria conta e a compartilhada do dono, não a privada'
);

select is(
  (select array_agg(descricao order by descricao) from public.transacoes),
  array['Dono na compartilhada', 'Parceiro na própria'],
  'O parceiro vê os próprios lançamentos e os da conta compartilhada'
);

select is(
  (select array_agg(nome order by nome) from public.caixinhas),
  array['Objetivo compartilhado'],
  'O parceiro vê só o objetivo compartilhado'
);


-- ---------------------------------------------------------------------------
-- Dono
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-0000000000d1","role":"authenticated","email":"dono@finflow.test"}', true);

select is(
  public.ids_parceiros_do_usuario(),
  array['d0000000-0000-4000-8000-0000000000d2']::uuid[],
  'O dono tem o parceiro como único parceiro'
);

select is(
  (select array_agg(nome order by nome) from public.contas),
  array['Dono compartilhada', 'Dono privada'],
  'O dono vê as próprias contas; a do parceiro não está compartilhada'
);

select is(
  (select array_agg(descricao order by descricao) from public.transacoes),
  array['Dono na compartilhada', 'Dono na privada'],
  'O dono vê só os próprios lançamentos'
);


-- ---------------------------------------------------------------------------
-- Estranho e visitante sem login
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"d0000000-0000-4000-8000-0000000000d3","role":"authenticated","email":"estranho@finflow.test"}', true);

select is(
  public.ids_parceiros_do_usuario(),
  '{}'::uuid[],
  'Quem não tem parceria não tem parceiros'
);

select is(
  (select array_agg(nome order by nome) from public.contas),
  array['Estranho própria'],
  'O estranho vê só a própria conta'
);

select is(
  (select array_agg(descricao order by descricao) from public.transacoes),
  array['Estranho na própria'],
  'O estranho vê só os próprios lançamentos'
);

select is(
  (select count(*)::integer from public.caixinhas),
  0,
  'O estranho não vê objetivos de outras pessoas'
);

reset role;

select ok(
  not has_function_privilege('anon', 'public.ids_parceiros_do_usuario()', 'execute'),
  'Visitante sem login não executa ids_parceiros_do_usuario'
);

select ok(
  (select count(*) = 5 from pg_indexes where schemaname = 'public' and indexname in (
    'parcerias_solicitante_id_idx', 'parcerias_convidado_id_idx', 'parcerias_convidado_email_lower_idx',
    'transacoes_categoria_id_idx', 'fatura_itens_categoria_id_idx')),
  'Os índices de desempenho existem'
);

select * from finish();
rollback;
