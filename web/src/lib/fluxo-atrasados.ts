/**
 * Filtro "Considerar atrasados" do fluxo de caixa (site e app).
 *
 * Um lançamento está em atraso quando ainda não foi concluído e o vencimento
 * já passou. Com o filtro desligado, esses lançamentos saem do cálculo do
 * fluxo: do saldo previsto, do gráfico e dos valores previstos de cada mês.
 * Os já concluídos nunca são afetados.
 */
type LancamentoDoFluxo = { status: string; data_vencimento: string | null };

export function estaEmAtraso(lancamento: LancamentoDoFluxo, hojeIso: string): boolean {
  const vencimento = (lancamento.data_vencimento ?? "").slice(0, 10);
  return lancamento.status !== "paga" && vencimento !== "" && vencimento < hojeIso;
}

export function lancamentosDoFluxo<T extends LancamentoDoFluxo>(
  lancamentos: readonly T[],
  considerarAtrasados: boolean,
  hojeIso: string,
): T[] {
  return considerarAtrasados
    ? [...lancamentos]
    : lancamentos.filter((lancamento) => !estaEmAtraso(lancamento, hojeIso));
}
