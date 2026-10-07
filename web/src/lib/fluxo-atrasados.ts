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

/**
 * Data em que o lançamento entra nas informações do fluxo (barras, quadro do
 * mês e do dia). Pendentes vencidos em meses anteriores entram no mês atual,
 * no dia de hoje: é onde o saldo projetado já os soma, então a conta do mês
 * fecha. Só chegam aqui com o filtro "Considerar atrasados" ligado; desligado,
 * `lancamentosDoFluxo` já os tirou.
 */
export function dataNoFluxo(lancamento: LancamentoDoFluxo, dataEfetiva: string, hojeIso: string): string {
  const vencimento = (lancamento.data_vencimento ?? "").slice(0, 10);
  return lancamento.status !== "paga" && vencimento !== "" && vencimento < `${hojeIso.slice(0, 7)}-01` ? hojeIso : dataEfetiva;
}
