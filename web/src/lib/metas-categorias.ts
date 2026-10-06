// Meta (receitas) e limite (despesas) mensais por categoria.
//
// Usado pelo site (tela de Categorias) e pelo app (Gerenciar Categorias), por
// isso não importa nada do site além de ./transacoes, que também não importa
// nada. Segue as regras da Visão do mês:
//   * o mês de cada lançamento é a data efetiva (realização se concluído,
//     vencimento se pendente);
//   * concluído conta como realizado; pendente, como agendado;
//   * transferências, movimentos de objetivo e o pagamento bancário da fatura
//     ficam de fora;
//   * cada compra (ou parcela) do cartão conta como despesa realizada no mês
//     da fatura em que cai, sem os ajustes técnicos de pagamento parcial.
import { dataEfetivaTransacao, isMovimentoObjetivo, isPagamentoFatura, isTransferencia } from "./transacoes";

export type CategoriaComAlvo = {
  id: number;
  tipo: string;
  meta_mensal?: number | string | null;
  limite_mensal?: number | string | null;
};

export type TransacaoParaAlvo = {
  tipo: string;
  valor: number | string;
  status: string;
  data_vencimento: string | null;
  data_realizacao?: string | null;
  descricao: string | null;
  categoria_id: number | null;
};

export type ItemCartaoParaAlvo = {
  valor: number | string;
  mes_fatura: string;
  categoria_id: number | null;
  descricao: string | null;
};

export type TotaisDaCategoria = {
  receitaRealizada: number;
  receitaAgendada: number;
  despesaRealizada: number;
  despesaAgendada: number;
};

export type ProgressoDoAlvo = {
  tipo: "meta" | "limite";
  alvo: number;
  realizado: number;
  agendado: number;
  /** Realizado sobre o alvo, em %, sem teto (110 = passou 10%). */
  percentual: number;
  /** Realizado mais agendado sobre o alvo, em %, sem teto. */
  percentualComAgendado: number;
  /** Alvo menos realizado; negativo quando o limite estourou. */
  restante: number;
  /**
   * Limite: "ok" abaixo de 80%, "alerta" de 80% a 100%, "estourado" acima.
   * Meta: "andamento" abaixo de 100%, "atingida" a partir de 100%.
   */
  situacao: "ok" | "alerta" | "estourado" | "andamento" | "atingida";
};

const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;

/** Valor positivo da meta/limite, ou null quando não há. */
export function valorDoAlvo(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? centavos(numero) : null;
}

/** Linhas de controle de pagamento parcial da fatura não são compras novas. */
function ehAjusteDeFatura(descricao: string | null): boolean {
  const texto = (descricao ?? "").trim();
  return texto === "Pagamento parcial da fatura" || texto.startsWith("Saldo da fatura anterior");
}

/** Soma, por categoria, o que já aconteceu e o que está agendado no mês ("AAAA-MM"). */
export function totaisDasCategoriasNoMes(
  transacoes: readonly TransacaoParaAlvo[],
  itensCartao: readonly ItemCartaoParaAlvo[],
  mes: string,
): Map<number, TotaisDaCategoria> {
  const totais = new Map<number, TotaisDaCategoria>();
  const da = (categoriaId: number) => {
    let total = totais.get(categoriaId);
    if (!total) {
      total = { receitaRealizada: 0, receitaAgendada: 0, despesaRealizada: 0, despesaAgendada: 0 };
      totais.set(categoriaId, total);
    }
    return total;
  };

  for (const transacao of transacoes) {
    if (transacao.categoria_id == null) continue;
    if (transacao.status !== "paga" && transacao.status !== "pendente") continue;
    if (isTransferencia(transacao.descricao) || isMovimentoObjetivo(transacao.descricao) || isPagamentoFatura(transacao.descricao)) continue;
    if (dataEfetivaTransacao(transacao).slice(0, 7) !== mes) continue;
    const valor = Number(transacao.valor);
    if (!Number.isFinite(valor)) continue;
    const total = da(transacao.categoria_id);
    const concluida = transacao.status === "paga";
    if (transacao.tipo === "receita") {
      if (concluida) total.receitaRealizada += valor;
      else total.receitaAgendada += valor;
    } else if (transacao.tipo === "despesa") {
      if (concluida) total.despesaRealizada += valor;
      else total.despesaAgendada += valor;
    }
  }

  for (const item of itensCartao) {
    if (item.categoria_id == null || item.mes_fatura !== mes || ehAjusteDeFatura(item.descricao)) continue;
    const valor = Number(item.valor);
    if (!Number.isFinite(valor)) continue;
    da(item.categoria_id).despesaRealizada += valor;
  }

  for (const total of totais.values()) {
    total.receitaRealizada = centavos(total.receitaRealizada);
    total.receitaAgendada = centavos(total.receitaAgendada);
    total.despesaRealizada = centavos(total.despesaRealizada);
    total.despesaAgendada = centavos(total.despesaAgendada);
  }
  return totais;
}

export function progressoDoAlvo(tipo: "meta" | "limite", alvo: number, realizado: number, agendado: number): ProgressoDoAlvo {
  const percentual = alvo > 0 ? (realizado / alvo) * 100 : 0;
  const percentualComAgendado = alvo > 0 ? ((realizado + agendado) / alvo) * 100 : 0;
  const situacao = tipo === "meta"
    ? percentual >= 100 ? "atingida" : "andamento"
    : realizado > alvo + 0.004 ? "estourado" : percentual >= 80 ? "alerta" : "ok";
  return {
    tipo,
    alvo,
    realizado: centavos(realizado),
    agendado: centavos(agendado),
    percentual,
    percentualComAgendado,
    restante: centavos(alvo - realizado),
    situacao,
  };
}

/**
 * Progresso do mês para cada categoria que tem meta ou limite. Categorias
 * "ambos" podem ter os dois: a meta usa as receitas e o limite, as despesas.
 */
export function progressoDasCategorias(
  categorias: readonly CategoriaComAlvo[],
  transacoes: readonly TransacaoParaAlvo[],
  itensCartao: readonly ItemCartaoParaAlvo[],
  mes: string,
): Map<number, { meta?: ProgressoDoAlvo; limite?: ProgressoDoAlvo }> {
  const totais = totaisDasCategoriasNoMes(transacoes, itensCartao, mes);
  const resultado = new Map<number, { meta?: ProgressoDoAlvo; limite?: ProgressoDoAlvo }>();
  for (const categoria of categorias) {
    const meta = categoria.tipo === "despesa" ? null : valorDoAlvo(categoria.meta_mensal);
    const limite = categoria.tipo === "receita" ? null : valorDoAlvo(categoria.limite_mensal);
    if (meta === null && limite === null) continue;
    const total = totais.get(categoria.id) ?? { receitaRealizada: 0, receitaAgendada: 0, despesaRealizada: 0, despesaAgendada: 0 };
    resultado.set(categoria.id, {
      ...(meta !== null ? { meta: progressoDoAlvo("meta", meta, total.receitaRealizada, total.receitaAgendada) } : {}),
      ...(limite !== null ? { limite: progressoDoAlvo("limite", limite, total.despesaRealizada, total.despesaAgendada) } : {}),
    });
  }
  return resultado;
}

/** Larguras (em %, 0 a 100) da parte realizada e da parte agendada da barra. */
export function largurasDaBarra(progresso: Pick<ProgressoDoAlvo, "percentual" | "percentualComAgendado">): { realizado: number; agendado: number } {
  const realizado = Math.max(0, Math.min(100, progresso.percentual));
  const total = Math.max(realizado, Math.min(100, progresso.percentualComAgendado));
  return { realizado, agendado: total - realizado };
}
