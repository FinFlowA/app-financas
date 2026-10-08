-- Limite utilizado do cartão (migration
-- 20261008120000_limite_do_cartao_com_faturas_antigas.sql): conta tudo o que
-- não foi pago, inclusive o que sobrou de faturas antigas, e deixa de fora só
-- os fixos de meses futuros. Vale na checagem ao lançar compra e no resumo
-- que o Finn usa. Rodam no CI num banco vazio com todas as migrations
-- aplicadas e desfazem tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(5);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'f0000000-0000-4000-8000-0000000000f3',
  'limite-cartao@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

-- O resumo do Finn lê o plano, que depende da configuração de cobrança; num
-- banco vazio ela ainda não existe (com os limites de plano desligados).
insert into public.billing_settings (id) select true where not exists (select 1 from public.billing_settings);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-0000000000f3","role":"authenticated","email":"limite-cartao@finflow.test"}', true);

insert into public.categorias (nome, cor, icone, tipo, user_id)
values ('Compras do limite', '#E76F51', 'label', 'despesa', 'f0000000-0000-4000-8000-0000000000f3');

insert into public.cartoes (nome, limite, dia_vencimento, dia_fechamento, user_id)
values ('Cartão do limite', 1000, 10, 3, 'f0000000-0000-4000-8000-0000000000f3');

-- Meses contados a partir do mês atual em São Paulo. A fatura de dois meses
-- atrás ficou com 150 e um fixo de 30 sem pagar; no mês atual, 100 e o fixo;
-- no próximo, uma parcela de 50 e o fixo, que ainda não conta.
insert into public.fatura_itens (cartao_id, user_id, categoria_id, descricao, valor, data_compra, mes_fatura)
select c.id, c.user_id, cat.id, item.descricao, item.valor,
  (clock_timestamp() at time zone 'America/Sao_Paulo')::date,
  to_char(date_trunc('month', clock_timestamp() at time zone 'America/Sao_Paulo') + make_interval(months => item.meses), 'YYYY-MM')
from public.cartoes c
cross join public.categorias cat
cross join (values
  ('Compra antiga', 150, -2),
  ('Academia (Fixa)', 30, -2),
  ('Compra do mês', 100, 0),
  ('Academia (Fixa)', 30, 0),
  ('Parcela (2/2)', 50, 1),
  ('Academia (Fixa)', 30, 1)
) as item(descricao, valor, meses)
where c.nome = 'Cartão do limite' and cat.nome = 'Compras do limite';

reset role;

select is(
  private.ai_card_used_limit('f0000000-0000-4000-8000-0000000000f3', (select id from public.cartoes where nome = 'Cartão do limite')),
  360::numeric,
  'O limite usado conta a sobra da fatura antiga e deixa de fora só o fixo de mês futuro'
);

set local role authenticated;

-- Pela regra antiga (sem a fatura antiga) sobravam 820 e a compra passaria.
select throws_ok(
  $$select public.execute_manual_financial_action('create_card_purchase', jsonb_build_object(
    'card_id', (select id from public.cartoes where nome = 'Cartão do limite'),
    'category_id', (select id from public.categorias where nome = 'Compras do limite'),
    'description', 'Compra acima do disponível', 'value', 700,
    'purchase_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text,
    'frequency', 'unica'),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f3', clock_timestamp())$$,
  'P0001',
  'AI_CARD_LIMIT_EXCEEDED',
  'Compra acima do disponível (contando a fatura antiga) é recusada'
);

select is(
  public.execute_manual_financial_action('create_card_purchase', jsonb_build_object(
    'card_id', (select id from public.cartoes where nome = 'Cartão do limite'),
    'category_id', (select id from public.categorias where nome = 'Compras do limite'),
    'description', 'Compra dentro do disponível', 'value', 600,
    'purchase_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text,
    'frequency', 'unica'),
    gen_random_uuid(), 'f0000000-0000-4000-8000-0000000000f3', clock_timestamp())->>'ok',
  'true',
  'Compra dentro do disponível é aceita'
);

select is(
  (
    select (metrica->>'used_limit')::numeric
    from jsonb_array_elements(public.finance_ai_context_snapshot(
      (clock_timestamp() at time zone 'America/Sao_Paulo')::date,
      to_char(clock_timestamp() at time zone 'America/Sao_Paulo', 'YYYY-MM'),
      array[extract(year from clock_timestamp() at time zone 'America/Sao_Paulo')::integer]
    )->'card_metrics') as metrica
    where (metrica->>'card_id')::bigint = (select id from public.cartoes where nome = 'Cartão do limite')
  ),
  960::numeric,
  'O Finn vê o mesmo limite usado: 360 de antes mais a compra de 600'
);

select is(
  (
    select (metrica->>'available_limit')::numeric
    from jsonb_array_elements(public.finance_ai_context_snapshot(
      (clock_timestamp() at time zone 'America/Sao_Paulo')::date,
      to_char(clock_timestamp() at time zone 'America/Sao_Paulo', 'YYYY-MM'),
      array[extract(year from clock_timestamp() at time zone 'America/Sao_Paulo')::integer]
    )->'card_metrics') as metrica
    where (metrica->>'card_id')::bigint = (select id from public.cartoes where nome = 'Cartão do limite')
  ),
  40::numeric,
  'E o mesmo limite disponível'
);

reset role;

select * from finish();
rollback;
