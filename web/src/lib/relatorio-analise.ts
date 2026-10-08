// Números da parte de análise do relatório (aba Relatórios do site).
//
// Nenhuma regra nova: cada valor sai das mesmas funções das outras telas.
// - Saldo das contas: `calcularSaldosPorConta` e o escopo de contas do Início e
//   do Fluxo de caixa (`transacoesNoEscopo`).
// - Resultado: a regra da Visão do mês do Início. Receitas e despesas
//   concluídas; com todas as contas, cada compra do cartão entra no mês da
//   fatura (pelo vencimento) e o pagamento da fatura fica de fora, para o mesmo
//   gasto não contar duas vezes. Com contas escolhidas, o cartão fica de fora e
//   o pagamento da fatura é despesa da conta que pagou.
// - Transferências e objetivos nunca são receita nem despesa: o dinheiro só
//   muda de lugar.
// - Projeção: a mesma do Fluxo de caixa (`calcularSaldoProjetadoPorMes`) no
//   padrão de lá, com os atrasados incluídos (`dataNoFluxo`). O relatório traz
//   tudo: os atrasados também aparecem à parte nas pendências.
// Resultado e saldo são coisas diferentes: a evolução mensal mostra o que
// separa um do outro (objetivos, transferências e o cartão).
import { totaisDoCartao } from "./cartoes-resumo";
import { dataNoFluxo } from "./fluxo-atrasados";
import { filterInvoiceGroupItems, groupInvoiceItems, isSyntheticInvoiceItem, type InvoiceHistoryGroup } from "./invoices";
import {
  calcularSaldosPorConta,
  dataEfetivaTransacao,
  descricaoVisivel,
  getContaDestinoTransferencia,
  isMovimentoObjetivo,
  isPagamentoFatura,
  isTransferencia,
  transacoesNoEscopo,
} from "./transacoes";
import type { DadosRelatorio, OpcoesRelatorio, SituacaoFiltro, TipoFiltro } from "./relatorio-tipos";
import type { Cartao, FaturaItem } from "./types";

export type Lancamento = DadosRelatorio["transacoes"][number];
export type ContaRelatorio = DadosRelatorio["contas"][number];
/** O papel do lançamento no relatório. */
export type Classe = "receita" | "despesa" | "objetivo" | "transferencia" | "fatura_paga";

// "|| 0" troca o -0 (sobra de arredondamento) por 0, para não aparecer "-R$ 0,00".
export const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100 || 0;
export const numero = (valor: unknown) => {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
};

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const FIM_DOS_TEMPOS = "9999-12-31";

export function ultimoDiaDoMes(mes: string): string {
  const [ano, numeroDoMes] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(ano, numeroDoMes, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function adicionarDias(iso: string, dias: number): string {
  const data = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  data.setUTCDate(data.getUTCDate() + dias);
  return data.toISOString().slice(0, 10);
}

export function adicionarMeses(mes: string, delta: number): string {
  const [ano, numeroDoMes] = mes.split("-").map(Number);
  const data = new Date(Date.UTC(ano, numeroDoMes - 1 + delta, 1));
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const nomeDoMes = (mes: string) => `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}`;
export const mesCurto = (mes: string) => `${MESES_CURTOS[Number(mes.slice(5, 7)) - 1]}/${mes.slice(2, 4)}`;
const diaEMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

/** Um mês do período, cortado no início e no fim do período. */
export type Recorte = { mes: string; inicio: string; fim: string; rotulo: string; rotuloCurto: string };

export function recortesMensais(inicio: string, fim: string): Recorte[] {
  const recortes: Recorte[] = [];
  if (!inicio || !fim || inicio > fim) return recortes;
  for (let mes = inicio.slice(0, 7); mes <= fim.slice(0, 7); mes = adicionarMeses(mes, 1)) {
    const primeiroDia = `${mes}-01`;
    const ultimoDia = ultimoDiaDoMes(mes);
    const deInicio = inicio > primeiroDia ? inicio : primeiroDia;
    const ateFim = fim < ultimoDia ? fim : ultimoDia;
    const parcial = deInicio !== primeiroDia || ateFim !== ultimoDia;
    recortes.push({
      mes,
      inicio: deInicio,
      fim: ateFim,
      rotulo: parcial ? `${nomeDoMes(mes)} (${diaEMes(deInicio)} a ${diaEMes(ateFim)})` : nomeDoMes(mes),
      rotuloCurto: mesCurto(mes),
    });
  }
  return recortes;
}

/** Colunas das tabelas mês a mês: meses até 12; trimestres até 36 meses; anos acima disso. */
export type Agrupamento = { rotulo: string; inicio: string; fim: string };

export function agrupamentos(recortes: Recorte[]): Agrupamento[] {
  if (recortes.length <= 12) return recortes.map((recorte) => ({ rotulo: recorte.rotuloCurto, inicio: recorte.inicio, fim: recorte.fim }));
  const chave = recortes.length <= 36
    ? (recorte: Recorte) => `T${Math.floor((Number(recorte.mes.slice(5, 7)) - 1) / 3) + 1}/${recorte.mes.slice(2, 4)}`
    : (recorte: Recorte) => recorte.mes.slice(0, 4);
  const grupos: Agrupamento[] = [];
  for (const recorte of recortes) {
    const rotulo = chave(recorte);
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.rotulo === rotulo) ultimo.fim = recorte.fim;
    else grupos.push({ rotulo, inicio: recorte.inicio, fim: recorte.fim });
  }
  return grupos;
}

export function classeDoLancamento(transacao: Pick<Lancamento, "descricao" | "tipo">, todasAsContas: boolean): Classe {
  if (isMovimentoObjetivo(transacao.descricao)) return "objetivo";
  if (isTransferencia(transacao.descricao)) return "transferencia";
  if (isPagamentoFatura(transacao.descricao)) return todasAsContas ? "fatura_paga" : "despesa";
  return transacao.tipo === "receita" ? "receita" : "despesa";
}

export function situacaoDoLancamento(transacao: Pick<Lancamento, "status" | "data_vencimento">, hoje: string): SituacaoFiltro {
  if (transacao.status === "paga") return "concluido";
  return (transacao.data_vencimento ?? "").slice(0, 10) < hoje ? "atrasado" : "a_vencer";
}

/** Uma compra (ou parcela) do cartão, que entra no resultado no vencimento da fatura. */
export type CompraNoCartao = { item: FaturaItem; fatura: InvoiceHistoryGroup };

export type ContextoRelatorio = {
  dados: DadosRelatorio;
  inicio: string;
  fim: string;
  hoje: string;
  mesAtual: string;
  /** Todas as contas ativas escolhidas: só então o cartão entra no relatório. */
  todasAsContas: boolean;
  contas: ContaRelatorio[];
  idsContas: Set<number>;
  /** Lançamentos vistos pelas contas escolhidas, como no Fluxo de caixa (transferências internas saem). */
  escopo: Lancamento[];
  /**
   * O que mexeu no saldo de cada conta escolhida, conta por conta (como a tela
   * Contas): uma transferência interna aparece na saída e na entrada e se anula.
   * Diferente do escopo, não perde as transferências antigas (duas linhas)
   * quando só uma das contas está no relatório.
   */
  movimentos: Lancamento[];
  saldoInicialTotal: number;
  /**
   * Último dia do que já aconteceu: o fim do mês atual (ou do período, se
   * terminar antes). Depois dele, só projeção. Null se o período ainda não começou.
   */
  fimRealizado: string | null;
  /** Saldo das contas escolhidas ao fim de um dia: o saldo inicial mais tudo o que foi concluído até lá. */
  saldoEm: (data: string) => number;
  /** Faturas de todos os cartões (para saldo e projeção, que não seguem os filtros). */
  faturas: InvoiceHistoryGroup[];
  /** Faturas dos cartões escolhidos no filtro. */
  faturasFiltradas: InvoiceHistoryGroup[];
  tipo: TipoFiltro;
  categoriaIds: Set<number>;
  situacoes: Set<SituacaoFiltro>;
  cartaoIds: Set<number>;
  maiores: number;
  /** Algum filtro de categoria, tipo, situação ou cartão ligado. */
  filtrosAtivos: boolean;
};

export function criarContexto(dados: DadosRelatorio, opcoes: OpcoesRelatorio): ContextoRelatorio {
  const hoje = dados.hoje;
  const ativas = dados.contas.filter((conta) => !conta.arquivado);
  const escolhidas = new Set(opcoes.contaIds);
  const contas = opcoes.contaIds.length === 0 ? ativas : ativas.filter((conta) => escolhidas.has(conta.id));
  const idsContas = new Set(contas.map((conta) => conta.id));
  const todasAsContas = contas.length === ativas.length;
  const escopo = transacoesNoEscopo(dados.transacoes, idsContas, contas.length);
  const movimentos = contas.flatMap((conta) => transacoesNoEscopo(dados.transacoes, new Set([conta.id]), 1));
  const saldoInicialTotal = contas.reduce((total, conta) => total + numero(conta.saldo_inicial), 0);
  const fimDoMesAtual = ultimoDiaDoMes(hoje.slice(0, 7));
  const fimRealizado = opcoes.inicio > hoje ? null : opcoes.fim < fimDoMesAtual ? opcoes.fim : fimDoMesAtual;

  // Movimentos concluídos em ordem de data, com o acumulado: o saldo de
  // qualquer dia sai de uma busca, sem percorrer tudo de novo.
  const realizados = movimentos
    .filter((transacao) => transacao.status === "paga")
    .map((transacao) => ({
      data: dataEfetivaTransacao(transacao).slice(0, 10),
      valor: transacao.tipo === "receita" ? numero(transacao.valor) : -numero(transacao.valor),
    }))
    .sort((a, b) => a.data.localeCompare(b.data));
  const acumulados: number[] = [];
  let soma = 0;
  for (const evento of realizados) {
    soma += evento.valor;
    acumulados.push(soma);
  }
  const saldoEm = (data: string) => {
    let inicio = 0;
    let fim = realizados.length;
    while (inicio < fim) {
      const meio = Math.floor((inicio + fim) / 2);
      if ((realizados[meio]?.data ?? "") <= data) inicio = meio + 1;
      else fim = meio;
    }
    return centavos(saldoInicialTotal + (inicio === 0 ? 0 : acumulados[inicio - 1] ?? 0));
  };

  const cartaoIds = new Set(opcoes.cartaoIds ?? []);
  const faturas = todasAsContas ? groupInvoiceItems(dados.itensFatura, dados.cartoes) : [];
  const faturasFiltradas = cartaoIds.size ? faturas.filter((fatura) => cartaoIds.has(fatura.cardId)) : faturas;
  const categoriaIds = new Set(opcoes.categoriaIds ?? []);
  const situacoes = new Set(opcoes.situacoes ?? []);
  const tipo = opcoes.tipo ?? "todos";

  return {
    dados,
    inicio: opcoes.inicio,
    fim: opcoes.fim,
    hoje,
    mesAtual: hoje.slice(0, 7),
    todasAsContas,
    contas,
    idsContas,
    escopo,
    movimentos,
    saldoInicialTotal,
    fimRealizado,
    saldoEm,
    faturas,
    faturasFiltradas,
    tipo,
    categoriaIds,
    situacoes,
    cartaoIds,
    maiores: Math.max(1, Math.trunc(opcoes.maiores ?? 10)),
    filtrosAtivos: tipo !== "todos" || categoriaIds.size > 0 || situacoes.size > 0 || cartaoIds.size > 0,
  };
}

/** Receita ou despesa que passa nos filtros de tipo, categoria e situação. */
export function passaNosFiltros(
  contexto: ContextoRelatorio,
  item: { classe: "receita" | "despesa"; categoria_id: number | null; situacao: SituacaoFiltro },
): boolean {
  if (contexto.tipo !== "todos" && contexto.tipo !== item.classe) return false;
  if (contexto.categoriaIds.size > 0 && (item.categoria_id == null || !contexto.categoriaIds.has(item.categoria_id))) return false;
  return contexto.situacoes.size === 0 || contexto.situacoes.has(item.situacao);
}

const noIntervalo = (data: string, inicio: string, fim: string) => Boolean(data) && data >= inicio && data <= fim;

/** Compras (e parcelas) do cartão cuja fatura vence no intervalo. Sem os ajustes de pagamento parcial. */
export function comprasNoIntervalo(contexto: ContextoRelatorio, inicio: string, fim: string, comFiltros: boolean): CompraNoCartao[] {
  const faturas = comFiltros ? contexto.faturasFiltradas : contexto.faturas;
  return faturas
    .filter((fatura) => noIntervalo(fatura.dueDate, inicio, fim))
    .flatMap((fatura) => fatura.items.filter((item) => !isSyntheticInvoiceItem(item)).map((item) => ({ item, fatura })))
    .filter(({ item }) => !comFiltros || passaNosFiltros(contexto, { classe: "despesa", categoria_id: item.categoria_id, situacao: "concluido" }));
}

export type TotaisDoIntervalo = {
  receitas: number;
  despesas: number;
  resultado: number;
  /** Compras do cartão (já incluídas em despesas). */
  compras: number;
  /** Resgates menos o que foi guardado em objetivos. */
  objetivos: number;
  /** Transferências que entram menos as que saem das contas escolhidas. */
  transferencias: number;
  faturasPagas: number;
};

/**
 * O que foi concluído no intervalo. Sem filtros, fecha com a variação do saldo.
 * `fimDoCartao` permite cortar as faturas em outra data (a comparação usa o
 * mês da fatura, como o Início).
 */
export function totaisNoIntervalo(contexto: ContextoRelatorio, inicio: string, fim: string, comFiltros: boolean, fimDoCartao = fim): TotaisDoIntervalo {
  let receitas = 0;
  let despesas = 0;
  let objetivos = 0;
  let transferencias = 0;
  let faturasPagas = 0;
  for (const transacao of contexto.movimentos) {
    if (transacao.status !== "paga") continue;
    if (!noIntervalo(dataEfetivaTransacao(transacao).slice(0, 10), inicio, fim)) continue;
    const valor = numero(transacao.valor);
    const sinal = transacao.tipo === "receita" ? 1 : -1;
    const classe = classeDoLancamento(transacao, contexto.todasAsContas);
    if (classe === "objetivo") objetivos += sinal * valor;
    else if (classe === "transferencia") transferencias += sinal * valor;
    else if (classe === "fatura_paga") faturasPagas += valor;
    else if (!comFiltros || passaNosFiltros(contexto, { classe, categoria_id: transacao.categoria_id, situacao: "concluido" })) {
      if (classe === "receita") receitas += valor;
      else despesas += valor;
    }
  }
  const compras = comprasNoIntervalo(contexto, inicio, fimDoCartao, comFiltros).reduce((total, { item }) => total + numero(item.valor), 0);
  despesas += compras;
  return {
    receitas: centavos(receitas),
    despesas: centavos(despesas),
    resultado: centavos(receitas - despesas),
    compras: centavos(compras),
    objetivos: centavos(objetivos),
    transferencias: centavos(transferencias),
    faturasPagas: centavos(faturasPagas),
  };
}

export type LinhaEvolucao = {
  recorte: Recorte;
  saldoInicio: number;
  receitas: number;
  despesas: number;
  resultado: number;
  /** Objetivos e transferências com contas fora do relatório. */
  objetivosETransferencias: number;
  /** Compras do cartão do mês (já nas despesas) menos as faturas pagas no mês. */
  ajusteCartao: number;
  saldoFim: number;
  emAndamento: boolean;
};

/** Mês a mês, até hoje: o saldo no fim de um mês é o saldo no início do seguinte. */
export function evolucaoMensal(contexto: ContextoRelatorio): LinhaEvolucao[] {
  return recortesMensais(contexto.inicio, contexto.fim)
    .filter((recorte) => recorte.inicio <= contexto.hoje)
    .map((recorte) => {
      const reais = totaisNoIntervalo(contexto, recorte.inicio, recorte.fim, false);
      const exibidos = contexto.filtrosAtivos ? totaisNoIntervalo(contexto, recorte.inicio, recorte.fim, true) : reais;
      return {
        recorte,
        saldoInicio: contexto.saldoEm(adicionarDias(recorte.inicio, -1)),
        receitas: exibidos.receitas,
        despesas: exibidos.despesas,
        resultado: exibidos.resultado,
        objetivosETransferencias: centavos(reais.objetivos + reais.transferencias),
        ajusteCartao: centavos(reais.compras - reais.faturasPagas),
        saldoFim: contexto.saldoEm(recorte.fim),
        emAndamento: recorte.fim >= contexto.hoje,
      };
    });
}

type Previsto = { data: string; valor: number };

/**
 * Pendentes que entram na projeção, na data em que o Fluxo de caixa os
 * considera: os atrasados de meses anteriores entram no dia de hoje.
 */
function previstos(contexto: ContextoRelatorio): Previsto[] {
  return contexto.escopo
    .filter((transacao) => transacao.status !== "paga")
    .map((transacao) => ({
      data: dataNoFluxo(transacao, dataEfetivaTransacao(transacao).slice(0, 10), contexto.hoje),
      valor: transacao.tipo === "receita" ? numero(transacao.valor) : -numero(transacao.valor),
    }))
    .filter((previsto) => previsto.data !== "" && previsto.data <= contexto.fim);
}

/** O que falta pagar de uma fatura (as linhas ainda não pagas), como na tela Cartões. */
export function emAbertoNaFatura(fatura: InvoiceHistoryGroup): number {
  return centavos(Math.max(0, fatura.items.filter((item) => !item.pago).reduce((total, item) => total + numero(item.valor), 0)));
}

/** Faturas em aberto que vencem até o fim do período (vencida em mês anterior entra hoje, como os atrasados). */
function faturasPrevistas(contexto: ContextoRelatorio): Previsto[] {
  const inicioDoMesAtual = `${contexto.mesAtual}-01`;
  return contexto.faturas.flatMap((fatura) => {
    const aberto = emAbertoNaFatura(fatura);
    if (aberto <= 0.004) return [];
    const data = fatura.dueDate < inicioDoMesAtual ? contexto.hoje : fatura.dueDate;
    return data <= contexto.fim ? [{ data, valor: aberto }] : [];
  });
}

export type LinhaProjecao = {
  recorte: Recorte;
  /** Primeira linha que parte de hoje (o saldo no início é o saldo atual, não o do dia 1º). */
  desdeHoje: boolean;
  saldoInicio: number;
  entradas: number;
  saidas: number;
  saldoFim: number;
  faturas: number;
  saldoComFaturas: number;
};

export type ProjecaoDoSaldo = {
  saldoAtual: number;
  entradas: number;
  saidas: number;
  saldoProjetado: number;
  /** Faturas do cartão em aberto (só com todas as contas). */
  faturas: number;
  saldoComFaturas: number;
  linhas: LinhaProjecao[];
};

/**
 * Se tudo o que está previsto acontecer: o saldo de hoje mais o que falta
 * entrar, menos o que falta sair (inclusive objetivos e transferências com
 * contas fora do relatório). É o mesmo saldo projetado do Fluxo de caixa; as
 * faturas em aberto vêm à parte, porque as outras telas ainda não as contam.
 */
export function projecaoDoSaldo(contexto: ContextoRelatorio): ProjecaoDoSaldo | null {
  if (contexto.fim < contexto.hoje) return null;
  const saldoAtual = contexto.saldoEm(FIM_DOS_TEMPOS);
  const lancamentos = previstos(contexto);
  const faturas = faturasPrevistas(contexto);
  const somar = (lista: Previsto[], de: string, ate: string, sinal: 1 | -1 | 0) => lista
    .filter((previsto) => previsto.data >= de && previsto.data <= ate && (sinal === 0 || Math.sign(previsto.valor) === sinal))
    .reduce((total, previsto) => total + Math.abs(previsto.valor), 0);

  const linhas: LinhaProjecao[] = [];
  let saldo = saldoAtual;
  let faturasAcumuladas = 0;
  const recortes = recortesMensais(contexto.inicio, contexto.fim).filter((recorte) => recorte.fim >= contexto.hoje);
  recortes.forEach((recorte, indice) => {
    // O primeiro mês parte de hoje: o que já venceu e segue pendente entra nele.
    const de = indice === 0 && recorte.inicio <= contexto.hoje ? "" : recorte.inicio;
    if (indice === 0 && de !== "") {
      saldo += lancamentos.filter((previsto) => previsto.data < de).reduce((total, previsto) => total + previsto.valor, 0);
      faturasAcumuladas += somar(faturas.filter((previsto) => previsto.data < de), "", FIM_DOS_TEMPOS, 0);
    }
    const entradas = somar(lancamentos, de, recorte.fim, 1);
    const saidas = somar(lancamentos, de, recorte.fim, -1);
    const faturasDoMes = somar(faturas, de, recorte.fim, 0);
    const saldoInicio = saldo;
    saldo = saldoInicio + entradas - saidas;
    faturasAcumuladas += faturasDoMes;
    linhas.push({
      recorte,
      desdeHoje: indice === 0 && de === "",
      saldoInicio: centavos(saldoInicio),
      entradas: centavos(entradas),
      saidas: centavos(saidas),
      saldoFim: centavos(saldo),
      faturas: centavos(faturasDoMes),
      saldoComFaturas: centavos(saldo - faturasAcumuladas),
    });
  });

  const entradas = somar(lancamentos, "", contexto.fim, 1);
  const saidas = somar(lancamentos, "", contexto.fim, -1);
  const totalFaturas = somar(faturas, "", contexto.fim, 0);
  const saldoProjetado = centavos(saldoAtual + entradas - saidas);
  return {
    saldoAtual,
    entradas: centavos(entradas),
    saidas: centavos(saidas),
    saldoProjetado,
    faturas: centavos(totalFaturas),
    saldoComFaturas: centavos(saldoProjetado - totalFaturas),
    linhas,
  };
}

export type GrupoPendente = { quantidade: number; valor: number };
export type PendenciasDoPeriodo = {
  receber: { aVencer: GrupoPendente; atrasados: GrupoPendente };
  pagar: { aVencer: GrupoPendente; atrasados: GrupoPendente };
  transferencias: { aVencer: GrupoPendente; atrasados: GrupoPendente };
  faturas: { aVencer: GrupoPendente; atrasados: GrupoPendente };
};

export type ItemPendente = {
  vencimento: string;
  descricao: string;
  tipo: "Receita" | "Despesa" | "Transferência" | "Fatura";
  categoria_id: number | null;
  categoria: string;
  contaOuCartao: string;
  situacao: "a_vencer" | "atrasado";
  valor: number;
};

/**
 * Tudo o que está em aberto até o fim do período, inclusive os atrasados de
 * antes dele: receitas, despesas, transferências e objetivos das contas
 * escolhidas (origem ou destino) e o que falta pagar das faturas. A mesma
 * lista alimenta o resumo (a receber e a pagar) e o detalhamento, para os dois
 * nunca mostrarem números diferentes.
 */
export function itensPendentes(contexto: ContextoRelatorio): ItemPendente[] {
  const { dados, hoje, fim } = contexto;
  const contaPorId = new Map(dados.contas.map((conta) => [conta.id, conta.nome]));
  const daConta = (transacao: Lancamento) => {
    if (contexto.idsContas.has(transacao.conta_id)) return true;
    const destino = getContaDestinoTransferencia(transacao.descricao);
    return destino !== null && contexto.idsContas.has(destino);
  };
  // Transferências e objetivos não são receita nem despesa e não têm
  // categoria: com filtro de tipo ou categoria, ficam de fora.
  const semFiltroDeLista = contexto.tipo === "todos" && contexto.categoriaIds.size === 0;
  const lancamentos: ItemPendente[] = [];
  // O banco aceita vencimento vazio: a ordenação não pode quebrar por isso.
  for (const transacao of [...dados.transacoes].sort((a, b) => (a.data_vencimento ?? "").localeCompare(b.data_vencimento ?? "") || a.id - b.id)) {
    if (transacao.status === "paga" || !daConta(transacao)) continue;
    const vencimento = (transacao.data_vencimento ?? "").slice(0, 10);
    if (!vencimento || vencimento > fim) continue;
    const situacao = vencimento < hoje ? "atrasado" : "a_vencer";
    const classe = classeDoLancamento(transacao, contexto.todasAsContas);
    const interno = classe === "objetivo" || classe === "transferencia";
    if (classe === "receita" || classe === "despesa") {
      if (!passaNosFiltros(contexto, { classe, categoria_id: transacao.categoria_id, situacao })) continue;
    } else if (!semFiltroDeLista || (contexto.situacoes.size > 0 && !contexto.situacoes.has(situacao))) {
      continue;
    }
    lancamentos.push({
      vencimento,
      descricao: descricaoVisivel(transacao.descricao) || "Lançamento",
      tipo: interno ? "Transferência" : classe === "receita" ? "Receita" : "Despesa",
      categoria_id: interno ? null : transacao.categoria_id,
      categoria: interno ? "-" : nomeDaCategoria(contexto, transacao.categoria_id),
      contaOuCartao: contaPorId.get(transacao.conta_id) ?? "Conta",
      situacao,
      valor: centavos(numero(transacao.valor)),
    });
  }
  const faturas: ItemPendente[] = [];
  if (contexto.tipo !== "receita") {
    const categorias = [...contexto.categoriaIds];
    const nomes = new Map(dados.categorias.map((categoria) => [categoria.id, categoria.nome]));
    for (const bruta of contexto.faturasFiltradas) {
      // Com filtro de categoria, a fatura entra só com as compras dessas categorias.
      const fatura = categorias.length ? filterInvoiceGroupItems(bruta, "", categorias, nomes) : bruta;
      if (!fatura || fatura.dueDate > fim) continue;
      const aberto = emAbertoNaFatura(fatura);
      const situacao = fatura.dueDate < hoje ? "atrasado" : "a_vencer";
      if (aberto <= 0.004 || (contexto.situacoes.size > 0 && !contexto.situacoes.has(situacao))) continue;
      faturas.push({
        vencimento: fatura.dueDate,
        descricao: `Fatura ${fatura.invoiceMonth.slice(5, 7)}/${fatura.invoiceMonth.slice(0, 4)}`,
        tipo: "Fatura",
        categoria_id: null,
        categoria: "-",
        contaOuCartao: fatura.cardName,
        situacao,
        valor: aberto,
      });
    }
  }
  // Ordenação estável: no mesmo dia, lançamentos antes das faturas.
  return [...lancamentos, ...faturas].sort((a, b) => a.vencimento.localeCompare(b.vencimento));
}

/** A receber, a pagar, transferências e faturas em aberto, cada um em a vencer e atrasados. */
export function pendenciasDoPeriodo(contexto: ContextoRelatorio, itens = itensPendentes(contexto)): PendenciasDoPeriodo {
  const vazio = () => ({ aVencer: { quantidade: 0, valor: 0 }, atrasados: { quantidade: 0, valor: 0 } });
  const resultado: PendenciasDoPeriodo = { receber: vazio(), pagar: vazio(), transferencias: vazio(), faturas: vazio() };
  const grupoDo = { Receita: resultado.receber, Despesa: resultado.pagar, "Transferência": resultado.transferencias, Fatura: resultado.faturas };
  for (const item of itens) {
    const grupo = grupoDo[item.tipo][item.situacao === "atrasado" ? "atrasados" : "aVencer"];
    grupo.quantidade += 1;
    grupo.valor = centavos(grupo.valor + item.valor);
  }
  return resultado;
}

/**
 * Porcentagens (0 a 1) com uma casa decimal (0,1%) que somam exatamente 100%:
 * cada uma é arredondada para baixo e os décimos que faltam vão para as que
 * tinham a maior sobra. Com valores negativos (estornos), arredonda cada uma.
 */
export function porcentagensQueFecham(valores: number[]): (number | null)[] {
  const total = valores.reduce((soma, valor) => soma + valor, 0);
  if (!(total > 0.004)) return valores.map(() => null);
  if (valores.some((valor) => valor < 0)) return valores.map((valor) => Math.round((valor / total) * 1000) / 1000);
  const emDecimos = valores.map((valor) => (valor / total) * 1000);
  const base = emDecimos.map((valor) => Math.floor(valor));
  let faltam = 1000 - base.reduce((soma, valor) => soma + valor, 0);
  const porSobra = emDecimos.map((valor, indice) => ({ indice, sobra: valor - Math.floor(valor) })).sort((a, b) => b.sobra - a.sobra || a.indice - b.indice);
  for (const { indice } of porSobra) {
    if (faltam <= 0) break;
    base[indice] += 1;
    faltam -= 1;
  }
  return base.map((valor) => valor / 1000);
}

export type LinhaCategoria = {
  id: number | null;
  nome: string;
  lancamentos: number;
  realizado: number;
  percentual: number | null;
  pendente: number;
  /** Meta mensal (receitas) ou limite mensal (despesas). */
  alvo: number | null;
};

function nomeDaCategoria(contexto: ContextoRelatorio, id: number | null): string {
  if (id == null) return "Sem categoria";
  return contexto.dados.categorias.find((categoria) => categoria.id === id)?.nome ?? "Categoria";
}

/** Itens concluídos no período (lançamentos e, nas despesas, compras do cartão), com os filtros. */
export type ItemRealizado = {
  data: string;
  descricao: string;
  categoria_id: number | null;
  origem: string;
  valor: number;
};

export function realizadosNoPeriodo(contexto: ContextoRelatorio, classe: "receita" | "despesa", inicio = contexto.inicio, fim = contexto.fimRealizado): ItemRealizado[] {
  // Meses futuros ainda não aconteceram: nada depois do fim do mês atual.
  if (!fim || !contexto.fimRealizado) return [];
  if (fim > contexto.fimRealizado) fim = contexto.fimRealizado;
  const contaPorId = new Map(contexto.dados.contas.map((conta) => [conta.id, conta.nome]));
  const itens: ItemRealizado[] = [];
  for (const transacao of contexto.movimentos) {
    if (transacao.status !== "paga") continue;
    const data = dataEfetivaTransacao(transacao).slice(0, 10);
    if (!noIntervalo(data, inicio, fim)) continue;
    if (classeDoLancamento(transacao, contexto.todasAsContas) !== classe) continue;
    if (!passaNosFiltros(contexto, { classe, categoria_id: transacao.categoria_id, situacao: "concluido" })) continue;
    itens.push({ data, descricao: descricaoVisivel(transacao.descricao) || "Lançamento", categoria_id: transacao.categoria_id, origem: contaPorId.get(transacao.conta_id) ?? "Conta", valor: numero(transacao.valor) });
  }
  if (classe === "despesa") {
    for (const { item, fatura } of comprasNoIntervalo(contexto, inicio, fim, true)) {
      const parcela = item.total_parcelas > 1 ? ` (parcela ${item.parcela_atual}/${item.total_parcelas})` : "";
      itens.push({ data: item.data_compra, descricao: `${item.descricao.replace(/\s*\(\d+\/\d+\)$/, "")}${parcela}`, categoria_id: item.categoria_id, origem: `Cartão ${fatura.cardName}`, valor: numero(item.valor) });
    }
  }
  return itens;
}

export function categoriasDoPeriodo(contexto: ContextoRelatorio, classe: "receita" | "despesa", pendentes = itensPendentes(contexto)): LinhaCategoria[] {
  const porCategoria = new Map<number | null, { lancamentos: number; realizado: number; pendente: number }>();
  const total = (id: number | null) => {
    const atual = porCategoria.get(id) ?? { lancamentos: 0, realizado: 0, pendente: 0 };
    porCategoria.set(id, atual);
    return atual;
  };
  for (const item of realizadosNoPeriodo(contexto, classe)) {
    const linha = total(item.categoria_id);
    linha.lancamentos += 1;
    linha.realizado += item.valor;
  }
  // O pendente é o mesmo de "A receber" e "A pagar": tudo o que vence até o
  // fim do período e segue em aberto, inclusive os atrasados de antes dele.
  for (const item of pendentes) {
    if (item.tipo !== (classe === "receita" ? "Receita" : "Despesa")) continue;
    total(item.categoria_id).pendente += item.valor;
  }
  const linhas = [...porCategoria.entries()].filter(([, linha]) => linha.realizado > 0.004 || linha.pendente > 0.004);
  const porcentagens = porcentagensQueFecham(linhas.map(([, linha]) => centavos(linha.realizado)));
  return linhas
    .map(([id, linha], posicao) => {
      const categoria = id == null ? undefined : contexto.dados.categorias.find((item) => item.id === id);
      const alvoBruto = classe === "receita" ? categoria?.meta_mensal : categoria?.limite_mensal;
      const alvo = alvoBruto != null && numero(alvoBruto) > 0 ? centavos(numero(alvoBruto)) : null;
      return {
        id,
        nome: nomeDaCategoria(contexto, id),
        lancamentos: linha.lancamentos,
        realizado: centavos(linha.realizado),
        percentual: porcentagens[posicao] ?? null,
        pendente: centavos(linha.pendente),
        alvo,
      };
    })
    .sort((a, b) => b.realizado - a.realizado || b.pendente - a.pendente || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Despesas concluídas por categoria em cada mês (ou trimestre/ano) do período. */
export function despesasPorCategoriaNoTempo(contexto: ContextoRelatorio, colunas: Agrupamento[]): { nome: string; valores: number[]; total: number }[] {
  const porCategoria = new Map<number | null, number[]>();
  colunas.forEach((coluna, indice) => {
    for (const item of realizadosNoPeriodo(contexto, "despesa", coluna.inicio, coluna.fim)) {
      const valores = porCategoria.get(item.categoria_id) ?? colunas.map(() => 0);
      valores[indice] += item.valor;
      porCategoria.set(item.categoria_id, valores);
    }
  });
  return [...porCategoria.entries()]
    .map(([id, valores]) => ({ nome: nomeDaCategoria(contexto, id), valores: valores.map(centavos), total: centavos(valores.reduce((soma, valor) => soma + valor, 0)) }))
    .filter((linha) => linha.total > 0.004)
    .sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, "pt-BR"));
}

export function maioresDoPeriodo(contexto: ContextoRelatorio, classe: "receita" | "despesa"): (ItemRealizado & { categoria: string })[] {
  // Estornos do cartão (valores negativos) não são despesas.
  return realizadosNoPeriodo(contexto, classe)
    .filter((item) => item.valor > 0.004)
    .sort((a, b) => b.valor - a.valor || a.data.localeCompare(b.data))
    .slice(0, contexto.maiores)
    .map((item) => ({ ...item, categoria: nomeDaCategoria(contexto, item.categoria_id) }));
}

export type LinhaConta = {
  conta: ContaRelatorio;
  saldoInicio: number;
  receitas: number;
  despesas: number;
  /** Transferências, objetivos e, com todas as contas, as faturas pagas. */
  outros: number;
  saldoFim: number;
  saldoAtual: number;
};

/** Saldo de uma conta só, pela mesma regra do escopo (transferências viram entrada ou saída dela). */
function saldoDaContaEm(conta: ContaRelatorio, escopoDaConta: Lancamento[], data: string): number {
  return centavos(escopoDaConta.reduce((saldo, transacao) => (
    transacao.status === "paga" && dataEfetivaTransacao(transacao).slice(0, 10) <= data
      ? saldo + (transacao.tipo === "receita" ? numero(transacao.valor) : -numero(transacao.valor))
      : saldo
  ), numero(conta.saldo_inicial)));
}

export function contasDoPeriodo(contexto: ContextoRelatorio): LinhaConta[] {
  const atuais = calcularSaldosPorConta(contexto.contas, contexto.dados.transacoes);
  return [...contexto.contas]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((conta) => {
      const escopoDaConta = transacoesNoEscopo(contexto.dados.transacoes, new Set([conta.id]), 1);
      let receitas = 0;
      let despesas = 0;
      // Transferências, objetivos e (com todas as contas) faturas pagas, item a item.
      let outros = 0;
      for (const transacao of escopoDaConta) {
        if (transacao.status !== "paga" || !noIntervalo(dataEfetivaTransacao(transacao).slice(0, 10), contexto.inicio, contexto.fim)) continue;
        const classe = classeDoLancamento(transacao, contexto.todasAsContas);
        const valor = numero(transacao.valor);
        if (classe === "receita") receitas += valor;
        else if (classe === "despesa") despesas += valor;
        else outros += transacao.tipo === "receita" ? valor : -valor;
      }
      const saldoInicio = saldoDaContaEm(conta, escopoDaConta, adicionarDias(contexto.inicio, -1));
      const saldoFim = saldoDaContaEm(conta, escopoDaConta, contexto.fim);
      return {
        conta,
        saldoInicio,
        receitas: centavos(receitas),
        despesas: centavos(despesas),
        outros: centavos(outros),
        saldoFim,
        saldoAtual: centavos(atuais.get(conta.id) ?? numero(conta.saldo_inicial)),
      };
    });
}

/** Saldo de cada conta no fim de cada mês (ou trimestre/ano) já começado. */
export function saldosDasContasNoTempo(contexto: ContextoRelatorio, colunas: Agrupamento[]): { nome: string; valores: number[] }[] {
  const ateHoje = colunas.filter((coluna) => coluna.inicio <= contexto.hoje);
  return [...contexto.contas]
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
    .map((conta) => {
      const escopoDaConta = transacoesNoEscopo(contexto.dados.transacoes, new Set([conta.id]), 1);
      return { nome: conta.nome, valores: ateHoje.map((coluna) => saldoDaContaEm(conta, escopoDaConta, coluna.fim)) };
    });
}

export type LinhaCartao = {
  cartao: Cartao;
  limite: number;
  limiteUsado: number;
  limiteDisponivel: number;
  gastoNoPeriodo: number;
  faturaAtual: number;
  proximaFatura: number;
  proximoVencimento: string | null;
  parcelasFuturas: number;
  valorParcelasFuturas: number;
};

/** Os cartões como na tela Cartões, mais o que foi gasto no período e as parcelas que faltam. */
export function cartoesDoPeriodo(contexto: ContextoRelatorio): LinhaCartao[] {
  if (!contexto.todasAsContas) return [];
  const itens = contexto.dados.itensFatura;
  const proximoMes = adicionarMeses(contexto.mesAtual, 1);
  return contexto.dados.cartoes
    .filter((cartao) => contexto.cartaoIds.size === 0 || contexto.cartaoIds.has(cartao.id))
    .filter((cartao) => cartao.ativo || itens.some((item) => item.cartao_id === cartao.id))
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"))
    .map((cartao) => {
      const { limiteUsado, emAbertoNoMes } = totaisDoCartao(cartao.id, itens, contexto.mesAtual);
      const faturasDoCartao = contexto.faturas.filter((fatura) => fatura.cardId === cartao.id);
      // Só as faturas que já chegaram (até o mês atual); as seguintes estão em parcelas futuras.
      const gasto = faturasDoCartao
        .filter((fatura) => contexto.fimRealizado !== null && noIntervalo(fatura.dueDate, contexto.inicio, contexto.fimRealizado))
        .flatMap((fatura) => fatura.items.filter((item) => !isSyntheticInvoiceItem(item)))
        .reduce((total, item) => total + numero(item.valor), 0);
      const proximoVencimento = faturasDoCartao
        .filter((fatura) => fatura.dueDate >= contexto.hoje && emAbertoNaFatura(fatura) > 0.004)
        .map((fatura) => fatura.dueDate)
        .sort()[0] ?? null;
      const futuras = itens.filter((item) => item.cartao_id === cartao.id && !item.pago && item.total_parcelas > 1 && item.mes_fatura > contexto.mesAtual);
      const limite = numero(cartao.limite);
      return {
        cartao,
        limite: centavos(limite),
        limiteUsado: centavos(limiteUsado),
        limiteDisponivel: centavos(limite - limiteUsado),
        gastoNoPeriodo: centavos(gasto),
        faturaAtual: centavos(emAbertoNoMes(contexto.mesAtual)),
        proximaFatura: centavos(emAbertoNoMes(proximoMes)),
        proximoVencimento,
        parcelasFuturas: futuras.length,
        valorParcelasFuturas: centavos(futuras.reduce((total, item) => total + numero(item.valor), 0)),
      };
    });
}

export type LinhaParcelamento = {
  descricao: string;
  cartao: string;
  parcela: string;
  valorParcela: number;
  restantes: number;
  valorRestante: number;
  ultimaFatura: string;
};

/** Compras parceladas com parcelas ainda não pagas. */
export function parcelamentosEmAberto(contexto: ContextoRelatorio): LinhaParcelamento[] {
  if (!contexto.todasAsContas) return [];
  const nomeDoCartao = new Map(contexto.dados.cartoes.map((cartao) => [cartao.id, cartao.nome]));
  const grupos = new Map<string, FaturaItem[]>();
  for (const item of contexto.dados.itensFatura) {
    if (item.total_parcelas <= 1 || isSyntheticInvoiceItem(item) || !nomeDoCartao.has(item.cartao_id)) continue;
    if (contexto.cartaoIds.size > 0 && !contexto.cartaoIds.has(item.cartao_id)) continue;
    const base = item.descricao.replace(/\s*\(\d+\/\d+\)$/, "");
    const chave = item.grupo_parcela_id != null ? `g${item.grupo_parcela_id}` : `${item.cartao_id}:${base}:${item.total_parcelas}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), item]);
  }
  return [...grupos.values()]
    .map((parcelas) => {
      const ordenadas = [...parcelas].sort((a, b) => a.mes_fatura.localeCompare(b.mes_fatura) || a.parcela_atual - b.parcela_atual);
      const abertas = ordenadas.filter((item) => !item.pago);
      const doMes = ordenadas.find((item) => item.mes_fatura === contexto.mesAtual) ?? abertas[0] ?? ordenadas[0];
      const ultima = ordenadas.at(-1) ?? doMes;
      return {
        descricao: doMes.descricao.replace(/\s*\(\d+\/\d+\)$/, ""),
        cartao: nomeDoCartao.get(doMes.cartao_id) ?? "Cartão",
        parcela: `${doMes.parcela_atual}/${doMes.total_parcelas}`,
        valorParcela: centavos(numero(doMes.valor)),
        restantes: abertas.length,
        valorRestante: centavos(abertas.reduce((total, item) => total + numero(item.valor), 0)),
        ultimaFatura: `${ultima.mes_fatura.slice(5, 7)}/${ultima.mes_fatura.slice(0, 4)}`,
      };
    })
    .filter((linha) => linha.restantes > 0)
    .sort((a, b) => b.valorRestante - a.valorRestante || a.descricao.localeCompare(b.descricao, "pt-BR"));
}

/** Período imediatamente anterior, com a mesma duração (em meses inteiros quando o período é de meses inteiros). */
export function periodoAnterior(inicio: string, fim: string): { inicio: string; fim: string } {
  const mesesInteiros = inicio.endsWith("-01") && fim === ultimoDiaDoMes(fim.slice(0, 7));
  if (mesesInteiros) {
    const meses = recortesMensais(inicio, fim).length;
    return { inicio: `${adicionarMeses(inicio.slice(0, 7), -meses)}-01`, fim: ultimoDiaDoMes(adicionarMeses(fim.slice(0, 7), -meses)) };
  }
  const dias = Math.round((Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${inicio}T12:00:00Z`)) / 86_400_000) + 1;
  const fimAnterior = adicionarDias(inicio, -1);
  return { inicio: adicionarDias(fimAnterior, -(dias - 1)), fim: fimAnterior };
}

export type MetricasDoPeriodo = { receitas: number; despesas: number; resultado: number; taxaDePoupanca: number | null; saldoNoFim: number };

export const taxaDePoupanca = (receitas: number, resultado: number) => (receitas > 0.004 ? Math.round((resultado / receitas) * 10000) / 10000 : null);

/** Mesmo dia, alguns meses antes ou depois: 31/03 menos um mês vira 28 (ou 29) de fevereiro. */
export function deslocarData(iso: string, meses: number): string {
  const mes = adicionarMeses(iso.slice(0, 7), meses);
  const dia = `${mes}-${iso.slice(8, 10)}`;
  const ultimo = ultimoDiaDoMes(mes);
  return dia > ultimo ? ultimo : dia;
}

/** Trecho comparado: lançamentos até `fim`, compras do cartão pelas faturas que vencem até `fimDoCartao`. */
export type JanelaDeComparacao = { inicio: string; fim: string; fimDoCartao: string };

/**
 * Os dois trechos da comparação. Período encerrado: ele inteiro e o anterior
 * inteiro. Período em andamento: só até hoje nos dois (o cartão pelo mês da
 * fatura, como no resumo), para comparar partes iguais. Período que ainda não
 * começou: nada a comparar.
 */
export function janelasDaComparacao(contexto: ContextoRelatorio): { atual: JanelaDeComparacao; anterior: JanelaDeComparacao; emAndamento: boolean } | null {
  const { inicio, fim, hoje } = contexto;
  if (inicio > hoje || !contexto.fimRealizado) return null;
  const anterior = periodoAnterior(inicio, fim);
  if (fim < hoje) return { atual: { inicio, fim, fimDoCartao: fim }, anterior: { ...anterior, fimDoCartao: anterior.fim }, emAndamento: false };
  const atual = { inicio, fim: hoje, fimDoCartao: contexto.fimRealizado };
  const mesesInteiros = inicio.endsWith("-01") && fim === ultimoDiaDoMes(fim.slice(0, 7));
  if (mesesInteiros) {
    const corte = deslocarData(hoje, -recortesMensais(inicio, fim).length);
    return { atual, anterior: { inicio: anterior.inicio, fim: corte, fimDoCartao: ultimoDiaDoMes(corte.slice(0, 7)) }, emAndamento: true };
  }
  const dias = Math.round((Date.parse(`${fim}T12:00:00Z`) - Date.parse(`${inicio}T12:00:00Z`)) / 86_400_000) + 1;
  return { atual, anterior: { inicio: anterior.inicio, fim: adicionarDias(hoje, -dias), fimDoCartao: adicionarDias(contexto.fimRealizado, -dias) }, emAndamento: true };
}

export function metricasDaJanela(contexto: ContextoRelatorio, janela: JanelaDeComparacao): MetricasDoPeriodo {
  const totais = totaisNoIntervalo(contexto, janela.inicio, janela.fim, true, janela.fimDoCartao);
  return {
    receitas: totais.receitas,
    despesas: totais.despesas,
    resultado: totais.resultado,
    taxaDePoupanca: taxaDePoupanca(totais.receitas, totais.resultado),
    saldoNoFim: contexto.saldoEm(janela.fim),
  };
}

export type TendenciaDoSaldo = { rotulo: "Crescendo" | "Diminuindo" | "Estável"; variacao: number; percentual: number | null };

/** Crescendo, diminuindo ou estável: compara o saldo do início do período com o de agora (ou do fim). */
export function tendenciaDoSaldo(inicial: number, final: number): TendenciaDoSaldo {
  const variacao = centavos(final - inicial);
  const percentual = Math.abs(inicial) > 0.004 ? Math.round((variacao / Math.abs(inicial)) * 10000) / 10000 : null;
  // Até 1% (ou R$ 1) para cima ou para baixo conta como estável.
  const estavel = Math.abs(variacao) <= Math.max(1, Math.abs(inicial) * 0.01);
  return { rotulo: estavel ? "Estável" : variacao > 0 ? "Crescendo" : "Diminuindo", variacao, percentual };
}

const SALDO_LEVADO = /^Saldo da fatura anterior \((\d{4}-\d{2})\)$/;

/**
 * Juros cobrados ao levar o saldo da fatura para a próxima, nas faturas do
 * período até o mês atual. A linha "Saldo da fatura anterior" tem o que faltou
 * pagar mais os juros; o que faltou pagar é o total da fatura anterior menos o
 * pagamento que levou o saldo (e menos algum pagamento total da mesma fatura,
 * de compras lançadas antes ou depois). Pagamentos parciais já estão na fatura
 * como linha negativa. Num caso que não fecha, os juros ficam de fora em vez
 * de aparecer errados. Pela regra do FinFlow, os juros não entram nas
 * despesas: estão dentro dos pagamentos de fatura.
 */
export function jurosDeFatura(contexto: ContextoRelatorio): { cartao: string; valor: number }[] {
  if (!contexto.todasAsContas || !contexto.fimRealizado) return [];
  const fimRealizado = contexto.fimRealizado;
  const porCartao = new Map<string, number>();
  for (const fatura of contexto.faturasFiltradas) {
    if (!noIntervalo(fatura.dueDate, contexto.inicio, fimRealizado)) continue;
    for (const item of fatura.items) {
      const origem = SALDO_LEVADO.exec(item.descricao.trim());
      if (!origem) continue;
      const mesAnterior = origem[1];
      const marcador = `[PagFatura:${item.cartao_id}:${mesAnterior}:saldo_transferido:${item.id}]`;
      const pagamento = contexto.dados.transacoes.find((transacao) => transacao.status === "paga" && transacao.descricao.includes(marcador));
      if (!pagamento) continue;
      const totalAnterior = contexto.dados.itensFatura
        .filter((anterior) => anterior.cartao_id === item.cartao_id && anterior.mes_fatura === mesAnterior)
        .reduce((total, anterior) => total + numero(anterior.valor), 0);
      const pagamentosTotais = contexto.dados.transacoes
        .filter((transacao) => transacao.status === "paga" && transacao.descricao.includes(`[PagFatura:${item.cartao_id}:${mesAnterior}:total`))
        .reduce((total, transacao) => total + numero(transacao.valor), 0);
      const juros = centavos(numero(item.valor) - (totalAnterior - pagamentosTotais - numero(pagamento.valor)));
      if (juros > 0.004 && juros <= numero(item.valor)) porCartao.set(fatura.cardName, (porCartao.get(fatura.cardName) ?? 0) + juros);
    }
  }
  return [...porCartao.entries()].map(([cartao, valor]) => ({ cartao, valor: centavos(valor) }));
}

export type PossivelPagamentoManual = { data: string; descricao: string; valor: number; cartao: string; fatura: string };

const semAcento = (texto: string) => texto.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Despesas concluídas que parecem o pagamento de uma fatura lançado como
 * despesa comum (em vez de "Pagar fatura"): falam em "fatura" e têm o mesmo
 * valor de uma fatura do cartão que vence a até 31 dias. Nesse caso o gasto
 * contaria duas vezes (as compras já entram nas despesas no mês da fatura).
 * O relatório só avisa; não muda nenhum valor.
 */
export function possiveisPagamentosDeFaturaManuais(contexto: ContextoRelatorio): PossivelPagamentoManual[] {
  if (!contexto.todasAsContas || !contexto.fimRealizado) return [];
  const fimRealizado = contexto.fimRealizado;
  const achados: PossivelPagamentoManual[] = [];
  for (const transacao of contexto.movimentos) {
    if (transacao.status !== "paga" || classeDoLancamento(transacao, true) !== "despesa") continue;
    const data = dataEfetivaTransacao(transacao).slice(0, 10);
    if (!noIntervalo(data, contexto.inicio, fimRealizado) || !semAcento(transacao.descricao).includes("fatura")) continue;
    const valor = numero(transacao.valor);
    const fatura = contexto.faturas.find((grupo) => (
      numero(grupo.total) > 0.004
      && Math.abs(numero(grupo.total) - valor) <= 0.01
      && Math.abs(Date.parse(`${grupo.dueDate}T12:00:00Z`) - Date.parse(`${data}T12:00:00Z`)) <= 31 * 86_400_000
    ));
    if (!fatura) continue;
    achados.push({
      data,
      descricao: descricaoVisivel(transacao.descricao) || "Lançamento",
      valor: centavos(valor),
      cartao: fatura.cardName,
      fatura: `${fatura.invoiceMonth.slice(5, 7)}/${fatura.invoiceMonth.slice(0, 4)}`,
    });
  }
  return achados;
}
