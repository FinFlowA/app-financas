-- Preserva a data agendada e registra separadamente a data efetiva.
ALTER TABLE public.transacoes
  ADD COLUMN IF NOT EXISTS data_realizacao DATE;

-- Movimentações antigas concluídas usam a data que anteriormente representava
-- tanto o agendamento quanto a realização.
UPDATE public.transacoes
SET data_realizacao = data_vencimento
WHERE status = 'paga'
  AND data_realizacao IS NULL;

CREATE INDEX IF NOT EXISTS transacoes_data_realizacao_idx
  ON public.transacoes (data_realizacao);

COMMENT ON COLUMN public.transacoes.data_realizacao IS
  'Data em que a movimentação foi efetivamente paga ou recebida. data_vencimento permanece como data agendada.';
