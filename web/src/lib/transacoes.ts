export interface TransacaoComDatas {
  id?: number;
  conta_id: number;
  tipo: string;
  valor: number;
  descricao: string;
  status?: string | null;
  data_vencimento?: string | null;
  data_realizacao?: string | null;
}

const DESTINO_TRANSFERENCIA_REGEX = /\s*\[Destino:(\d+)\]\s*$/;
const OBJETIVO_TRANSFERENCIA_REGEX = /\s*\[Objetivo:(\d+):(guardar|resgatar)\]\s*$/;
const SERIE_REGEX = /\s*\[Serie:([A-Za-z0-9_-]+)\]/;
const SALDO_PARCIAL_REGEX = /\s*\[SaldoParcial:(\d+)\]/;
const PAGAMENTO_FATURA_REGEX = /\s*\[PagFatura:(\d+):(\d{4}-\d{2}):[^\]]+\]\s*$/;
const MARCADORES_OBJETIVO = ["[Objetivo:", "Guardar em:", "Resgate de:"] as const;

export function dataEfetivaTransacao(transacao: Pick<TransacaoComDatas, "status" | "data_vencimento" | "data_realizacao">): string {
  return transacao.status === "paga"
    ? transacao.data_realizacao || transacao.data_vencimento || ""
    : transacao.data_vencimento || "";
}

export function isTransferencia(descricao?: string | null): boolean {
  return (descricao ?? "").includes("[Transf.]");
}

export function isPagamentoFatura(descricao?: string | null): boolean {
  return (descricao ?? "").includes("[PagFatura:");
}

export function getReferenciaPagamentoFatura(descricao?: string | null): { cartaoId: number; mes: string } | null {
  const match = (descricao ?? "").match(PAGAMENTO_FATURA_REGEX);
  if (!match) return null;
  return { cartaoId: Number(match[1]), mes: match[2] };
}

export function getContaDestinoTransferencia(descricao?: string | null): number | null {
  const match = (descricao ?? "").match(DESTINO_TRANSFERENCIA_REGEX);
  return match ? Number(match[1]) : null;
}

export function getIdSerie(descricao?: string | null): string | null {
  return (descricao ?? "").match(SERIE_REGEX)?.[1] ?? null;
}

export function descricaoVisivel(descricao: string): string {
  return descricao
    .replace(PAGAMENTO_FATURA_REGEX, "")
    .replace(DESTINO_TRANSFERENCIA_REGEX, "")
    .replace(OBJETIVO_TRANSFERENCIA_REGEX, "")
    .replace(SERIE_REGEX, "")
    .replace(SALDO_PARCIAL_REGEX, "")
    .replace(/^\[Transf\.\]\s*/, "")
    .trim();
}

export function isMovimentoObjetivo(descricao?: string | null): boolean {
  const texto = descricao ?? "";
  if (!MARCADORES_OBJETIVO.some((marcador) => texto.includes(marcador))) return false;
  if (OBJETIVO_TRANSFERENCIA_REGEX.test(texto)) return true;
  const visivel = descricaoVisivel(texto)
    .replace(/\s*\(\d+\/\d+\)$/, "")
    .replace(/\s*\(Fixa(?: semanal| anual)?\)$/, "")
    .trim();
  return /^(Guardar em|Resgate de):/.test(visivel) || visivel.includes("· Guardar em:") || visivel.includes("· Resgate de:");
}

/**
 * Calcula o saldo bancário real. Uma transferência possui uma única linha:
 * debita a origem e credita o destino indicado no marcador interno.
 */
export function calcularSaldosPorConta<TConta extends { id: number; saldo_inicial: number }>(
  contas: TConta[],
  transacoes: TransacaoComDatas[],
): Map<number, number> {
  const saldos = new Map(contas.map((conta) => [conta.id, Number(conta.saldo_inicial)]));
  for (const transacao of transacoes) {
    if (transacao.status !== "paga") continue;
    const valor = Number(transacao.valor);
    if (!Number.isFinite(valor)) continue;

    if (saldos.has(transacao.conta_id)) {
      const atual = saldos.get(transacao.conta_id) ?? 0;
      saldos.set(transacao.conta_id, atual + (transacao.tipo === "receita" ? valor : -valor));
    }

    const destinoId = getContaDestinoTransferencia(transacao.descricao);
    if (destinoId !== null && saldos.has(destinoId)) {
      saldos.set(destinoId, (saldos.get(destinoId) ?? 0) + valor);
    }
  }
  return saldos;
}

/**
 * Converte transferências em entradas/saídas somente quando cruzam a fronteira
 * das contas selecionadas. Entre duas contas selecionadas, o efeito é zero.
 */
export function transacoesNoEscopo<T extends TransacaoComDatas>(
  transacoes: T[],
  contaIds: ReadonlySet<number>,
  quantidadeContas: number,
): T[] {
  return transacoes.flatMap((transacao) => {
    const destinoId = getContaDestinoTransferencia(transacao.descricao);
    if (destinoId !== null) {
      const origemSelecionada = contaIds.has(transacao.conta_id);
      const destinoSelecionado = contaIds.has(destinoId);
      if (origemSelecionada === destinoSelecionado) return [];
      if (origemSelecionada) return [transacao];
      return [{ ...transacao, tipo: "receita", conta_id: destinoId } as T];
    }
    if (isMovimentoObjetivo(transacao.descricao)) {
      return contaIds.has(transacao.conta_id) ? [transacao] : [];
    }
    if (isTransferencia(transacao.descricao)) {
      return quantidadeContas === 1 && contaIds.has(transacao.conta_id) ? [transacao] : [];
    }
    return contaIds.has(transacao.conta_id) ? [transacao] : [];
  });
}

export function ehMovimentoInternoParaBalanco(descricao?: string | null): boolean {
  return isTransferencia(descricao) || isMovimentoObjetivo(descricao);
}

export function resumirFluxoMensal(transacoes: TransacaoComDatas[]): {
  receitas: number;
  despesas: number;
  balancoRealizado: number;
} {
  let receitas = 0;
  let despesas = 0;
  let balancoRealizado = 0;
  for (const transacao of transacoes) {
    const valor = Number(transacao.valor);
    if (!Number.isFinite(valor)) continue;
    if (transacao.tipo === "receita") receitas += valor;
    else despesas += valor;
    if (transacao.status === "paga") {
      balancoRealizado += transacao.tipo === "receita" ? valor : -valor;
    }
  }
  return { receitas, despesas, balancoRealizado };
}
