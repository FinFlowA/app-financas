/** Portado da mesma lógica de projeção usada em app/(tabs)/relatorios.tsx:
 * meses passados mostram o saldo realizado acumulado; o mês atual e os
 * futuros somam o impacto dos lançamentos pendentes agendados até o fim de
 * cada mês, projetando o saldo caso eles se confirmem como agendado. */

interface EventoSaldo {
  data: string;
  valor: number;
}

interface SerieAcumulada {
  datas: string[];
  acumulados: number[];
}

function ordenarEventosComAcumulado(eventos: EventoSaldo[]): SerieAcumulada {
  const ordenados = [...eventos].sort((a, b) => a.data.localeCompare(b.data));
  let total = 0;
  return {
    datas: ordenados.map((evento) => evento.data),
    acumulados: ordenados.map((evento) => {
      total += evento.valor;
      return total;
    }),
  };
}

function indiceAposData(datas: string[], dataLimite: string): number {
  let inicio = 0;
  let fim = datas.length;
  while (inicio < fim) {
    const meio = Math.floor((inicio + fim) / 2);
    const dataDoMeio = datas.at(meio);
    if (dataDoMeio !== undefined && dataDoMeio <= dataLimite) inicio = meio + 1;
    else fim = meio;
  }
  return inicio;
}

function totalAcumuladoAte(serie: SerieAcumulada, dataLimite: string): number {
  const indice = indiceAposData(serie.datas, dataLimite);
  return indice === 0 ? 0 : (serie.acumulados.at(indice - 1) ?? 0);
}

export interface TransacaoParaSaldo {
  tipo: "receita" | "despesa";
  valor: number;
  status: "pendente" | "paga";
  data_vencimento: string;
  data_realizacao: string | null;
}

export interface ProjecaoMensal {
  mesIdx: number;
  saldo: number;
  projetado: boolean;
}

/**
 * Calcula o saldo acumulado por mês de um ano, usando o mesmo modelo do app:
 * meses passados = realizado; mês atual sem pendências = saldo atual real;
 * mês atual com pendências e meses futuros = saldo atual + pendentes agendados.
 * `transacoes` já deve estar sem transferências entre contas próprias (elas
 * se anulam no total combinado) — movimentos de objetivo continuam contando,
 * pois reduzem o saldo real das contas.
 */
export function calcularSaldoProjetadoPorMes(
  saldoInicialTotal: number,
  transacoes: TransacaoParaSaldo[],
  ano: number,
  hoje: Date = new Date(),
): ProjecaoMensal[] {
  let receitasRealizadas = 0;
  let despesasRealizadas = 0;
  const eventosRealizados: EventoSaldo[] = [];
  const eventosPendentes: EventoSaldo[] = [];
  const datasPendentesValidas: string[] = [];

  for (const transacao of transacoes) {
    const valor = Number(transacao.valor);
    const realizada = transacao.status === "paga";
    const delta = transacao.tipo === "receita" ? valor : -valor;

    if (realizada) {
      if (transacao.tipo === "receita") receitasRealizadas += valor;
      else despesasRealizadas += valor;
      eventosRealizados.push({ data: transacao.data_realizacao ?? transacao.data_vencimento, valor: delta });
    } else {
      const vencimento = transacao.data_vencimento || "";
      eventosPendentes.push({ data: vencimento, valor: delta });
      if (vencimento) datasPendentesValidas.push(vencimento);
    }
  }

  const saldoAtual = saldoInicialTotal + receitasRealizadas - despesasRealizadas;
  const realizados = ordenarEventosComAcumulado(eventosRealizados);
  const pendentes = ordenarEventosComAcumulado(eventosPendentes);
  datasPendentesValidas.sort((a, b) => a.localeCompare(b));

  const anoAtual = hoje.getFullYear();
  const mesAtualIdx = hoje.getMonth();
  const isAnoAtual = ano === anoAtual;

  return Array.from({ length: 12 }, (_, mesIdx) => {
    const fimDoMes = `${ano}-${String(mesIdx + 1).padStart(2, "0")}-${String(new Date(ano, mesIdx + 1, 0).getDate()).padStart(2, "0")}`;
    const mesNoPassado = ano < anoAtual || (isAnoAtual && mesIdx < mesAtualIdx);
    const mesAtualSemPendencias = isAnoAtual && mesIdx === mesAtualIdx
      && indiceAposData(datasPendentesValidas, fimDoMes) === 0;

    if (mesNoPassado) {
      return { mesIdx, saldo: saldoInicialTotal + totalAcumuladoAte(realizados, fimDoMes), projetado: false };
    }
    if (mesAtualSemPendencias) {
      return { mesIdx, saldo: saldoAtual, projetado: false };
    }
    // Mês atual com pendências até o fim dele, ou mês futuro: o saldo soma
    // lançamentos ainda não confirmados, então é uma projeção.
    return { mesIdx, saldo: saldoAtual + totalAcumuladoAte(pendentes, fimDoMes), projetado: true };
  });
}
