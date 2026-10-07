import { getContaDestinoTransferencia, isMovimentoObjetivo, isTransferencia } from "./transacoes";

/**
 * Transferências entre as contas escolhidas no fluxo de caixa (site e app).
 *
 * O dinheiro só troca de conta, então elas não mudam o saldo do conjunto e
 * ficam fora de receitas e despesas (e do gráfico). Mesmo assim aparecem nas
 * informações do mês como "Transferências" e "Transferências a fazer", como
 * no Histórico, inclusive as atrasadas (que seguem o filtro "Considerar
 * atrasados"). As que cruzam a fronteira da seleção continuam contando como
 * entrada ou saída.
 */
type TransferenciaDoFluxo = { conta_id: number; descricao: string | null; tipo: string };

export function transferenciasEntreContas<T extends TransferenciaDoFluxo>(
  transacoes: readonly T[],
  contaIds: ReadonlySet<number>,
): T[] {
  return transacoes.filter((transacao) => {
    if (isMovimentoObjetivo(transacao.descricao)) return false;
    const destinoId = getContaDestinoTransferencia(transacao.descricao);
    if (destinoId !== null) return contaIds.has(transacao.conta_id) && contaIds.has(destinoId);
    // Transferências antigas têm duas linhas (saída e entrada): conta só a
    // saída, para não dobrar o valor. Com uma conta só, já entram no fluxo.
    return isTransferencia(transacao.descricao)
      && transacao.tipo === "despesa"
      && contaIds.size > 1
      && contaIds.has(transacao.conta_id);
  });
}
