/**
 * Filtro "Considerar incertos" do fluxo de caixa (site e app).
 *
 * Um lançamento incerto é uma receita ou despesa única, ainda pendente, que a
 * pessoa marcou como "não tenho certeza" (coluna `incerta`; o banco só aceita
 * a marcação nesses casos e a tira ao concluir). Com o filtro desligado, os
 * incertos saem do cálculo do fluxo: saldo previsto, gráfico e valores
 * previstos. Os concluídos nunca são afetados.
 */
type LancamentoComIncerteza = { status: string; incerta?: boolean | null };

export function estaIncerto(lancamento: LancamentoComIncerteza): boolean {
  return lancamento.incerta === true && lancamento.status !== "paga";
}

export function lancamentosSemIncertos<T extends LancamentoComIncerteza>(
  lancamentos: readonly T[],
  considerarIncertos: boolean,
): T[] {
  return considerarIncertos
    ? [...lancamentos]
    : lancamentos.filter((lancamento) => !estaIncerto(lancamento));
}
