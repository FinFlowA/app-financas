-- Transferências entre contas e conciliação bancária de transferências e de
-- movimentos de objetivo (migration
-- 20261001112938_corrige_transferencia_entre_contas.sql). Antes da correção,
-- toda transferência entre contas falhava com 42883 (text ->> unknown) ao
-- montar a descrição com o destino. Rodam no CI num banco vazio com todas as
-- migrations aplicadas (`supabase test db`) e desfazem tudo no fim.
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

insert into auth.users (id, email, raw_user_meta_data, created_at)
values (
  'eeeeeeee-0000-4000-8000-00000000000e',
  'transferencia-e@finflow.test',
  '{"termos_versao":"2026-08-08-offline-seguranca-ia","data_nascimento":"1990-01-01","termos_aceitos_em":"2026-09-01T00:00:00Z"}'::jsonb,
  now()
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"eeeeeeee-0000-4000-8000-00000000000e","role":"authenticated","email":"transferencia-e@finflow.test"}', true);

insert into public.contas (nome, saldo_inicial, user_id) values
  ('Origem', 1000, 'eeeeeeee-0000-4000-8000-00000000000e'),
  ('Destino', 0, 'eeeeeeee-0000-4000-8000-00000000000e');

-- ---------------------------------------------------------------------------
-- Transferência agendada entre contas e conciliação dos dois lados
-- ---------------------------------------------------------------------------

select is(
  public.execute_manual_financial_action(
    'transfer_between_accounts',
    jsonb_build_object(
      'value', 40, 'description', 'Reserva mensal', 'status', 'pendente',
      'scheduled_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text,
      'account_id', (select id from public.contas where nome = 'Origem'),
      'frequency', 'unica',
      'destination_account_id', (select id from public.contas where nome = 'Destino')
    ),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'Transferência agendada entre contas é criada (antes falhava com 42883)'
);

select ok(
  (select descricao from public.transacoes where descricao like '[Transf.] Reserva mensal%')
    ~ ('\[Destino:' || (select id from public.contas where nome = 'Destino') || '\]$'),
  'A descrição guarda a conta de destino'
);

select is(
  public.reconcile_bank_transfer_entry(
    (select id from public.contas where nome = 'Origem'), repeat('a', 64),
    (clock_timestamp() at time zone 'America/Sao_Paulo')::date, 'despesa', 40,
    (select id from public.transacoes where descricao like '[Transf.] Reserva mensal%'),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'A saída da transferência é conciliada na conta de origem'
);

select is(
  (select status from public.transacoes where descricao like '[Transf.] Reserva mensal%'),
  'paga',
  'A transferência conciliada fica paga'
);

select is(
  public.reconcile_bank_transfer_entry(
    (select id from public.contas where nome = 'Destino'), repeat('b', 64),
    (clock_timestamp() at time zone 'America/Sao_Paulo')::date, 'receita', 40,
    (select id from public.transacoes where descricao like '[Transf.] Reserva mensal%'),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'A entrada da mesma transferência é conciliada na conta de destino'
);

select is(
  public.execute_manual_financial_action(
    'transfer_between_accounts',
    jsonb_build_object(
      'value', 25, 'description', 'Outra transferencia', 'status', 'pendente',
      'scheduled_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text,
      'account_id', (select id from public.contas where nome = 'Origem'),
      'frequency', 'unica',
      'destination_account_id', (select id from public.contas where nome = 'Destino')
    ),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'Uma segunda transferência agendada é criada'
);

select throws_ok(
  $$select public.reconcile_bank_transfer_entry(
      (select id from public.contas where nome = 'Origem'), repeat('c', 64),
      (clock_timestamp() at time zone 'America/Sao_Paulo')::date, 'despesa', 30,
      (select id from public.transacoes where descricao like '[Transf.] Outra transferencia%'),
      gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp())$$,
  '22023',
  'RECONCILIATION_TRANSFER_REQUIRES_EXACT_VALUE',
  'Transferência só concilia pelo valor exato agendado'
);

-- ---------------------------------------------------------------------------
-- Transferência imediata entre contas
-- ---------------------------------------------------------------------------

select is(
  public.execute_manual_financial_action(
    'transfer_between_accounts',
    jsonb_build_object(
      'value', 15, 'description', 'Imediata', 'status', 'paga',
      'scheduled_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text,
      'realization_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text,
      'account_id', (select id from public.contas where nome = 'Origem'),
      'frequency', 'unica',
      'destination_account_id', (select id from public.contas where nome = 'Destino')
    ),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'Transferência imediata entre contas é criada'
);

select is(
  (select status from public.transacoes where descricao like '[Transf.] Imediata%'),
  'paga',
  'A transferência imediata já nasce paga'
);

-- ---------------------------------------------------------------------------
-- Resgate agendado de objetivo para conta e conciliação
-- ---------------------------------------------------------------------------

select is(
  public.execute_manual_financial_action(
    'create_goal',
    jsonb_build_object('name', 'Reserva teste', 'target_amount', 500, 'initial_balance', 0, 'color', '#2A9D8F', 'icon', 'savings'),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'Objetivo criado'
);

select is(
  public.execute_manual_financial_action(
    'move_goal',
    jsonb_build_object(
      'operation', 'guardar', 'goal_id', (select id from public.caixinhas where nome = 'Reserva teste'),
      'account_id', (select id from public.contas where nome = 'Origem'), 'value', 200,
      'description', 'Aporte', 'frequency', 'unica',
      'realization_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text
    ),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'Aporte imediato no objetivo'
);

select is(
  public.execute_manual_financial_action(
    'move_goal',
    jsonb_build_object(
      'operation', 'resgatar', 'goal_id', (select id from public.caixinhas where nome = 'Reserva teste'),
      'account_id', (select id from public.contas where nome = 'Destino'), 'value', 30,
      'description', 'Resgate agendado', 'frequency', 'mensal', 'recurrence_count', 2,
      'scheduled_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text
    ),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'Resgate agendado do objetivo para a conta'
);

select is(
  (select public.reconcile_bank_goal_entry(
      t.conta_id, repeat('d', 64), (clock_timestamp() at time zone 'America/Sao_Paulo')::date,
      t.tipo, t.valor, t.id, gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
    )->>'ok'
   from public.transacoes t
   where t.descricao ~ '\[Objetivo:[0-9]+:resgatar\]' and t.status = 'pendente'
   order by t.data_vencimento, t.id limit 1),
  'true',
  'O resgate agendado do objetivo é conciliado na conta de destino'
);

select is(
  (select saldo_atual from public.caixinhas where nome = 'Reserva teste'),
  170::numeric,
  'O resgate conciliado sai do saldo do objetivo'
);

select is(
  public.execute_manual_financial_action(
    'move_goal',
    jsonb_build_object(
      'operation', 'resgatar', 'goal_id', (select id from public.caixinhas where nome = 'Reserva teste'),
      'account_id', (select id from public.contas where nome = 'Destino'), 'value', 400,
      'description', 'Resgate grande', 'frequency', 'mensal', 'recurrence_count', 2,
      'scheduled_date', (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text
    ),
    gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp()
  )->>'ok',
  'true',
  'Resgate agendado maior que o saldo atual do objetivo'
);

select throws_like(
  $$select public.reconcile_bank_goal_entry(
      t.conta_id, repeat('e', 64), (clock_timestamp() at time zone 'America/Sao_Paulo')::date,
      t.tipo, t.valor, t.id, gen_random_uuid(), 'eeeeeeee-0000-4000-8000-00000000000e', clock_timestamp())
    from public.transacoes t
    where t.descricao like '%Resgate grande%' and t.status = 'pendente'
    order by t.data_vencimento, t.id limit 1$$,
  '%AI_INSUFFICIENT_GOAL_BALANCE%',
  'Conciliar um resgate maior que o saldo do objetivo é recusado com o código que o site traduz'
);

reset role;

select * from finish();
rollback;
