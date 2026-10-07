// Relatório exportável (PDF e Excel) da aba Relatórios do site.
//
// Monta tabelas simples — uma por seção, com a linha de títulos e as linhas
// de dados — a partir dos dados que o site já carrega. As regras seguem as
// telas: data efetiva (realização se concluído, vencimento se pendente),
// transferências e objetivos fora de Receitas/Despesas, compras do cartão pelo
// vencimento da fatura e, com todas as contas, o pagamento bancário da fatura
// fora de Despesas (a compra já entra pela fatura). Os valores aparecem sempre.
import { groupInvoiceItems, isSyntheticInvoiceItem } from "./invoices";
import {
  calcularSaldosPorConta,
  dataEfetivaTransacao,
  descricaoVisivel,
  getContaDestinoTransferencia,
  getOperacaoObjetivo,
  isMovimentoObjetivo,
  isPagamentoFatura,
  isTransferencia,
} from "./transacoes";
import type { Caixinha, Cartao, Categoria, Conta, FaturaItem, Transacao } from "./types";

export const SECOES_RELATORIO = [
  { id: "resumo", titulo: "Resumo" },
  { id: "contas", titulo: "Contas" },
  { id: "receitas", titulo: "Receitas" },
  { id: "despesas", titulo: "Despesas" },
  { id: "transferencias", titulo: "Transferências" },
  { id: "faturas", titulo: "Faturas" },
  { id: "compras_cartao", titulo: "Compras no cartão" },
  { id: "categorias", titulo: "Categorias" },
  { id: "pendencias", titulo: "Pendências" },
  { id: "objetivos", titulo: "Objetivos" },
] as const;

export type SecaoRelatorio = (typeof SECOES_RELATORIO)[number]["id"];
export type TipoColuna = "texto" | "data" | "moeda" | "numero" | "percentual";
export type ColunaRelatorio = { titulo: string; tipo: TipoColuna };
/** Data como "AAAA-MM-DD"; moeda, número e percentual como número (percentual: 0,75 = 75%). */
export type CelulaRelatorio = string | number | null;
export type TabelaRelatorio = { secao: SecaoRelatorio; titulo: string; colunas: ColunaRelatorio[]; linhas: CelulaRelatorio[][] };

export type DadosRelatorio = {
  contas: Pick<Conta, "id" | "nome" | "saldo_inicial" | "arquivado">[];
  categorias: Pick<Categoria, "id" | "nome" | "tipo" | "meta_mensal" | "limite_mensal">[];
  objetivos: Pick<Caixinha, "id" | "nome" | "meta_valor" | "saldo_atual" | "data_prazo" | "arquivado">[];
  cartoes: Cartao[];
  transacoes: Pick<Transacao, "id" | "conta_id" | "categoria_id" | "tipo" | "valor" | "descricao" | "data_vencimento" | "data_realizacao" | "status">[];
  itensFatura: FaturaItem[];
  /** Hoje em São Paulo, "AAAA-MM-DD". */
  hoje: string;
};

export type OpcoesRelatorio = {
  inicio: string;
  fim: string;
  /** Contas escolhidas; vazio = todas. */
  contaIds: number[];
  secoes: SecaoRelatorio[];
};

const TITULOS = Object.fromEntries(SECOES_RELATORIO.map((secao) => [secao.id, secao.titulo])) as Record<SecaoRelatorio, string>;
const centavos = (valor: number) => Math.round((valor + Number.EPSILON) * 100) / 100;
const numero = (valor: unknown) => {
  const convertido = Number(valor);
  return Number.isFinite(convertido) ? convertido : 0;
};
export const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

function situacao(transacao: { status: string; data_vencimento: string }, hoje: string): string {
  if (transacao.status === "paga") return "Concluído";
  return transacao.data_vencimento < hoje ? "Atrasado" : "A vencer";
}

/** Objetivo citado num movimento de guardar/resgatar: pelo marcador ou pelo texto. */
function nomeDoObjetivo(descricao: string, objetivos: DadosRelatorio["objetivos"]): string {
  const marcador = /\[Objetivo:(\d+):(?:guardar|resgatar)\]/.exec(descricao);
  if (marcador) {
    const objetivo = objetivos.find((item) => item.id === Number(marcador[1]));
    if (objetivo) return objetivo.nome;
  }
  const visivel = descricaoVisivel(descricao).replace(/\s*\(\d+\/\d+\)$/, "").replace(/\s*\(Fixa[^)]*\)$/, "");
  const rotulo = /(?:Guardar em|Resgate de):/.exec(visivel);
  return (rotulo ? visivel.slice(rotulo.index + rotulo[0].length).trim() : "") || "objetivo";
}

export function montarRelatorio(dados: DadosRelatorio, opcoes: OpcoesRelatorio): TabelaRelatorio[] {
  const { inicio, fim } = opcoes;
  const { hoje } = dados;
  const todasAsContas = opcoes.contaIds.length === 0;
  const contasEscolhidas = new Set(todasAsContas ? dados.contas.map((conta) => conta.id) : opcoes.contaIds);
  const contaPorId = new Map(dados.contas.map((conta) => [conta.id, conta]));
  const categoriaPorId = new Map(dados.categorias.map((categoria) => [categoria.id, categoria]));
  const nomeConta = (id: number) => contaPorId.get(id)?.nome ?? "Conta";
  const nomeCategoria = (id: number | null) => (id == null ? "Sem categoria" : categoriaPorId.get(id)?.nome ?? "Categoria");
  const noPeriodo = (data: string) => Boolean(data) && data >= inicio && data <= fim;

  // Lançamentos das contas escolhidas (transferência: origem ou destino).
  const daConta = (transacao: DadosRelatorio["transacoes"][number]) => {
    if (todasAsContas) return true;
    if (contasEscolhidas.has(transacao.conta_id)) return true;
    const destino = getContaDestinoTransferencia(transacao.descricao);
    return destino !== null && contasEscolhidas.has(destino);
  };
  const transacoes = dados.transacoes.filter(daConta);
  const ehMovimentoInterno = (descricao: string) => isTransferencia(descricao) || isMovimentoObjetivo(descricao);
  // Com todas as contas, a fatura entra pelas compras e o pagamento bancário fica de fora.
  const ehPagamentoFaturaForaDoRelatorio = (descricao: string) => todasAsContas && isPagamentoFatura(descricao);
  const doPeriodo = transacoes
    .filter((transacao) => noPeriodo(dataEfetivaTransacao(transacao).slice(0, 10)))
    .sort((a, b) => dataEfetivaTransacao(a).localeCompare(dataEfetivaTransacao(b)) || a.id - b.id);
  const receitas = doPeriodo.filter((t) => t.tipo === "receita" && !ehMovimentoInterno(t.descricao));
  const despesas = doPeriodo.filter((t) => t.tipo === "despesa" && !ehMovimentoInterno(t.descricao) && !ehPagamentoFaturaForaDoRelatorio(t.descricao));
  const transferencias = doPeriodo.filter((t) => ehMovimentoInterno(t.descricao));

  // Faturas e compras do cartão não têm conta: entram só com todas as contas.
  const faturas = todasAsContas
    ? groupInvoiceItems(dados.itensFatura, dados.cartoes)
      .filter((fatura) => noPeriodo(fatura.dueDate))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.cardName.localeCompare(b.cardName, "pt-BR"))
    : [];
  const comprasCartao = faturas
    .flatMap((fatura) => fatura.items.filter((item) => !isSyntheticInvoiceItem(item)).map((item) => ({ item, fatura })))
    .sort((a, b) => a.item.data_compra.localeCompare(b.item.data_compra) || a.item.id - b.item.id);

  const soma = (lista: { valor: number }[]) => centavos(lista.reduce((total, item) => total + numero(item.valor), 0));
  const concluidas = <T extends { status: string }>(lista: T[]) => lista.filter((t) => t.status === "paga");
  const pendentes = <T extends { status: string }>(lista: T[]) => lista.filter((t) => t.status !== "paga");

  const tabelas: Partial<Record<SecaoRelatorio, TabelaRelatorio>> = {};
  const criar = (secao: SecaoRelatorio, colunas: ColunaRelatorio[], linhas: CelulaRelatorio[][]) => {
    tabelas[secao] = { secao, titulo: TITULOS[secao], colunas, linhas };
  };
  const quer = (secao: SecaoRelatorio) => opcoes.secoes.includes(secao);
  const lancamento: ColunaRelatorio[] = [
    { titulo: "Vencimento", tipo: "data" },
    { titulo: "Concluído em", tipo: "data" },
    { titulo: "Descrição", tipo: "texto" },
    { titulo: "Categoria", tipo: "texto" },
    { titulo: "Conta", tipo: "texto" },
    { titulo: "Situação", tipo: "texto" },
    { titulo: "Valor", tipo: "moeda" },
  ];
  const linhaLancamento = (t: DadosRelatorio["transacoes"][number]): CelulaRelatorio[] => [
    t.data_vencimento,
    t.status === "paga" ? (t.data_realizacao ?? t.data_vencimento) : null,
    descricaoVisivel(t.descricao) || "Lançamento",
    nomeCategoria(t.categoria_id),
    nomeConta(t.conta_id),
    situacao(t, hoje),
    centavos(numero(t.valor)),
  ];

  if (quer("resumo")) {
    const cartao = soma(comprasCartao.map(({ item }) => item));
    const receitasConcluidas = soma(concluidas(receitas));
    const despesasConcluidas = soma(concluidas(despesas));
    const linhas: CelulaRelatorio[][] = [
      ["Receitas concluídas", receitasConcluidas],
      ["Receitas pendentes", soma(pendentes(receitas))],
      ["Despesas concluídas", despesasConcluidas],
      ["Despesas pendentes", soma(pendentes(despesas))],
    ];
    if (todasAsContas) linhas.push(["Compras no cartão (faturas do período)", cartao]);
    linhas.push(["Resultado (receitas concluídas - despesas concluídas" + (todasAsContas ? " - cartão)" : ")"), centavos(receitasConcluidas - despesasConcluidas - (todasAsContas ? cartao : 0))]);
    criar("resumo", [{ titulo: "Item", tipo: "texto" }, { titulo: "Valor", tipo: "moeda" }], linhas);
  }

  if (quer("contas")) {
    const contas = dados.contas.filter((conta) => contasEscolhidas.has(conta.id));
    const atuais = calcularSaldosPorConta(contas, dados.transacoes);
    // Saldo no fim do período: só o que foi concluído até lá.
    const ateOFim = calcularSaldosPorConta(contas, dados.transacoes.filter((t) => t.status === "paga" && (t.data_realizacao ?? t.data_vencimento).slice(0, 10) <= fim));
    criar("contas", [
      { titulo: "Conta", tipo: "texto" },
      { titulo: "Saldo inicial", tipo: "moeda" },
      { titulo: `Saldo em ${dataBr(fim)}`, tipo: "moeda" },
      { titulo: "Saldo atual", tipo: "moeda" },
    ], contas
      .sort((a, b) => Number(a.arquivado) - Number(b.arquivado) || a.nome.localeCompare(b.nome, "pt-BR"))
      .map((conta) => [
        conta.arquivado ? `${conta.nome} (arquivada)` : conta.nome,
        centavos(numero(conta.saldo_inicial)),
        centavos(ateOFim.get(conta.id) ?? numero(conta.saldo_inicial)),
        centavos(atuais.get(conta.id) ?? numero(conta.saldo_inicial)),
      ]));
  }

  if (quer("receitas")) criar("receitas", lancamento, receitas.map(linhaLancamento));
  if (quer("despesas")) criar("despesas", lancamento, despesas.map(linhaLancamento));

  if (quer("transferencias")) {
    criar("transferencias", [
      { titulo: "Vencimento", tipo: "data" },
      { titulo: "Concluído em", tipo: "data" },
      { titulo: "Descrição", tipo: "texto" },
      { titulo: "Origem", tipo: "texto" },
      { titulo: "Destino", tipo: "texto" },
      { titulo: "Situação", tipo: "texto" },
      { titulo: "Valor", tipo: "moeda" },
    ], transferencias.map((t) => {
      const operacao = getOperacaoObjetivo(t.descricao);
      const objetivo = operacao ? `Objetivo: ${nomeDoObjetivo(t.descricao, dados.objetivos)}` : null;
      const destinoConta = getContaDestinoTransferencia(t.descricao);
      const origem = operacao === "resgatar" ? objetivo ?? "Objetivo" : nomeConta(t.conta_id);
      const destino = operacao === "resgatar"
        ? nomeConta(t.conta_id)
        : operacao === "guardar"
          ? objetivo ?? "Objetivo"
          : destinoConta !== null ? nomeConta(destinoConta) : "Outra conta";
      return [
        t.data_vencimento,
        t.status === "paga" ? (t.data_realizacao ?? t.data_vencimento) : null,
        descricaoVisivel(t.descricao) || "Transferência",
        origem,
        destino,
        situacao(t, hoje),
        centavos(numero(t.valor)),
      ];
    }));
  }

  if (quer("faturas")) {
    criar("faturas", [
      { titulo: "Cartão", tipo: "texto" },
      { titulo: "Fatura", tipo: "texto" },
      { titulo: "Vencimento", tipo: "data" },
      { titulo: "Situação", tipo: "texto" },
      { titulo: "Total", tipo: "moeda" },
    ], faturas.map((fatura) => [
      fatura.cardName,
      `${fatura.invoiceMonth.slice(5, 7)}/${fatura.invoiceMonth.slice(0, 4)}`,
      fatura.dueDate,
      fatura.paid ? "Paga" : fatura.dueDate < hoje ? "Vencida" : "Em aberto",
      centavos(fatura.total),
    ]));
  }

  if (quer("compras_cartao")) {
    criar("compras_cartao", [
      { titulo: "Data da compra", tipo: "data" },
      { titulo: "Descrição", tipo: "texto" },
      { titulo: "Cartão", tipo: "texto" },
      { titulo: "Categoria", tipo: "texto" },
      { titulo: "Parcela", tipo: "texto" },
      { titulo: "Fatura", tipo: "texto" },
      { titulo: "Valor", tipo: "moeda" },
    ], comprasCartao.map(({ item, fatura }) => [
      item.data_compra,
      item.descricao,
      fatura.cardName,
      nomeCategoria(item.categoria_id),
      item.total_parcelas > 1 ? `${item.parcela_atual}/${item.total_parcelas}` : "À vista",
      `${fatura.invoiceMonth.slice(5, 7)}/${fatura.invoiceMonth.slice(0, 4)}`,
      centavos(numero(item.valor)),
    ]));
  }

  if (quer("categorias")) {
    type Total = { concluido: number; pendente: number };
    const porCategoria = new Map<number, Total>();
    const somar = (id: number | null, valor: number, concluido: boolean) => {
      if (id == null) return;
      const total = porCategoria.get(id) ?? { concluido: 0, pendente: 0 };
      if (concluido) total.concluido += valor;
      else total.pendente += valor;
      porCategoria.set(id, total);
    };
    for (const t of [...receitas, ...despesas]) somar(t.categoria_id, numero(t.valor), t.status === "paga");
    for (const { item } of comprasCartao) somar(item.categoria_id, numero(item.valor), true);
    const linhas = [...porCategoria.entries()]
      .map(([id, total]) => ({ categoria: categoriaPorId.get(id), id, total }))
      .filter((linha) => linha.total.concluido + linha.total.pendente > 0.004)
      .sort((a, b) => (a.categoria?.tipo ?? "").localeCompare(b.categoria?.tipo ?? "") || (b.total.concluido + b.total.pendente) - (a.total.concluido + a.total.pendente));
    criar("categorias", [
      { titulo: "Categoria", tipo: "texto" },
      { titulo: "Tipo", tipo: "texto" },
      { titulo: "Concluído", tipo: "moeda" },
      { titulo: "Pendente", tipo: "moeda" },
      { titulo: "Total", tipo: "moeda" },
      { titulo: "Meta/limite mensal", tipo: "moeda" },
    ], linhas.map(({ categoria, id, total }) => {
      const tipo = categoria?.tipo === "receita" ? "Receita" : categoria?.tipo === "despesa" ? "Despesa" : "Receita e despesa";
      const alvo = categoria?.tipo === "receita" ? categoria.meta_mensal : categoria?.tipo === "despesa" ? categoria.limite_mensal : (categoria?.limite_mensal ?? categoria?.meta_mensal);
      return [
        nomeCategoria(id),
        tipo,
        centavos(total.concluido),
        centavos(total.pendente),
        centavos(total.concluido + total.pendente),
        alvo != null && numero(alvo) > 0 ? centavos(numero(alvo)) : null,
      ];
    }));
  }

  if (quer("pendencias")) {
    // Tudo o que está em aberto até o fim do período, inclusive atrasados de antes.
    const abertas = transacoes
      .filter((t) => t.status !== "paga" && t.data_vencimento <= fim && !ehPagamentoFaturaForaDoRelatorio(t.descricao))
      .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento) || a.id - b.id);
    const linhas: CelulaRelatorio[][] = abertas.map((t) => [
      t.data_vencimento,
      descricaoVisivel(t.descricao) || "Lançamento",
      ehMovimentoInterno(t.descricao) ? "Transferência" : t.tipo === "receita" ? "Receita" : "Despesa",
      ehMovimentoInterno(t.descricao) ? "-" : nomeCategoria(t.categoria_id),
      nomeConta(t.conta_id),
      t.data_vencimento < hoje ? "Atrasado" : "A vencer",
      centavos(numero(t.valor)),
    ]);
    if (todasAsContas) {
      for (const fatura of groupInvoiceItems(dados.itensFatura, dados.cartoes)) {
        if (fatura.paid || fatura.dueDate > fim || fatura.total <= 0.004) continue;
        linhas.push([fatura.dueDate, `Fatura ${fatura.invoiceMonth.slice(5, 7)}/${fatura.invoiceMonth.slice(0, 4)}`, "Fatura", "-", fatura.cardName, fatura.dueDate < hoje ? "Atrasado" : "A vencer", centavos(fatura.total)]);
      }
      linhas.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    }
    criar("pendencias", [
      { titulo: "Vencimento", tipo: "data" },
      { titulo: "Descrição", tipo: "texto" },
      { titulo: "Tipo", tipo: "texto" },
      { titulo: "Categoria", tipo: "texto" },
      { titulo: "Conta ou cartão", tipo: "texto" },
      { titulo: "Situação", tipo: "texto" },
      { titulo: "Valor", tipo: "moeda" },
    ], linhas);
  }

  if (quer("objetivos")) {
    criar("objetivos", [
      { titulo: "Objetivo", tipo: "texto" },
      { titulo: "Meta", tipo: "moeda" },
      { titulo: "Guardado", tipo: "moeda" },
      { titulo: "Da meta", tipo: "percentual" },
      { titulo: "Prazo", tipo: "data" },
    ], [...dados.objetivos]
      .sort((a, b) => Number(a.arquivado) - Number(b.arquivado) || a.nome.localeCompare(b.nome, "pt-BR"))
      .map((objetivo) => {
        const meta = numero(objetivo.meta_valor);
        const guardado = numero(objetivo.saldo_atual);
        return [
          objetivo.arquivado ? `${objetivo.nome} (arquivado)` : objetivo.nome,
          centavos(meta),
          centavos(guardado),
          meta > 0 ? Math.round((guardado / meta) * 10000) / 10000 : null,
          objetivo.data_prazo,
        ];
      }));
  }

  // Mesma ordem da lista de seções, só as escolhidas.
  return SECOES_RELATORIO.flatMap((secao) => (tabelas[secao.id] ? [tabelas[secao.id] as TabelaRelatorio] : []));
}
