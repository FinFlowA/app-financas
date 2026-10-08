import type { FaturaItem } from "./types";

/**
 * Valores de um cartão como a tela Cartões mostra: o limite comprometido e o
 * que está em aberto em cada fatura. Usado pela tela Cartões e pelos
 * Relatórios, para os dois mostrarem os mesmos números.
 */
export function totaisDoCartao(cartaoId: number, itens: readonly FaturaItem[], mesAtual: string) {
  const emAberto = itens.filter((item) => item.cartao_id === cartaoId && !item.pago);
  // Tudo o que ainda não foi pago compromete o limite, inclusive o que sobrou
  // de faturas de meses anteriores (no cartão de verdade, essa dívida continua
  // ocupando o limite). Só os lançamentos fixos de meses futuros ainda não
  // comprometem.
  const limiteUsado = Math.max(0, emAberto
    .filter((item) => !item.descricao.endsWith("(Fixa)") || item.mes_fatura <= mesAtual)
    .reduce((total, item) => total + Number(item.valor), 0));
  const emAbertoNoMes = (mes: string) => Math.max(0, emAberto
    .filter((item) => item.mes_fatura === mes)
    .reduce((total, item) => total + Number(item.valor), 0));
  return { limiteUsado, emAbertoNoMes };
}
