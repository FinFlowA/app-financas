-- FinFlow: preserva a data agendada e registra separadamente a data efetiva.
-- Esta migração é pré-requisito das migrações da IA financeira.

begin;

do $$
begin
  if to_regclass('public.transacoes') is null then
    raise exception 'FINFLOW_SCHEMA_MISSING_TRANSACOES';
  end if;
end;
$$;

alter table public.transacoes
  add column if not exists data_realizacao date;

-- Movimentações antigas concluídas usam a data que anteriormente representava
-- tanto o agendamento quanto a realização.
update public.transacoes
set data_realizacao = data_vencimento
where status = 'paga'
  and data_realizacao is null;

create index if not exists transacoes_data_realizacao_idx
  on public.transacoes (data_realizacao);

comment on column public.transacoes.data_realizacao is
  'Data em que a movimentação foi efetivamente paga ou recebida. data_vencimento permanece como data agendada.';

commit;
