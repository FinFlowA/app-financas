// Relatório exportável (PDF e Excel) da aba Relatórios do site.
//
// Monta o documento em blocos (indicadores, tabelas, gráficos e notas), uma
// seção por vez, a partir dos dados que o site já carrega. Os números da
// análise vêm de `relatorio-analise.ts`, que usa as mesmas regras das outras
// telas; as listas de detalhamento seguem as mesmas regras: data efetiva
// (realização se concluído, vencimento se pendente), transferências e
// objetivos fora de Receitas/Despesas, compras do cartão pelo vencimento da
// fatura e, com todas as contas, o pagamento da fatura fora de Despesas. Os
// valores aparecem sempre.
import {
  adicionarDias,
  agrupamentos,
  cartoesDoPeriodo,
  categoriasDoPeriodo,
  centavos,
  classeDoLancamento,
  comprasNoIntervalo,
  contasDoPeriodo,
  criarContexto,
  despesasPorCategoriaNoTempo,
  evolucaoMensal,
  itensPendentes,
  janelasDaComparacao,
  jurosDeFatura,
  maioresDoPeriodo,
  metricasDaJanela,
  nomeDoMes,
  numero,
  parcelamentosEmAberto,
  passaNosFiltros,
  pendenciasDoPeriodo,
  possiveisPagamentosDeFaturaManuais,
  projecaoDoSaldo,
  recortesMensais,
  saldosDasContasNoTempo,
  situacaoDoLancamento,
  taxaDePoupanca,
  tendenciaDoSaldo,
  totaisNoIntervalo,
  ultimoDiaDoMes,
  type ContextoRelatorio,
  type Lancamento,
  type LinhaCategoria,
} from "./relatorio-analise";
import { filterInvoiceGroupItems, type InvoiceHistoryGroup } from "./invoices";
import {
  calcularSaldosPorConta,
  dataEfetivaTransacao,
  descricaoVisivel,
  getContaDestinoTransferencia,
  getOperacaoObjetivo,
  isMovimentoObjetivo,
  isTransferencia,
} from "./transacoes";
import {
  SECOES_RELATORIO,
  type BlocoRelatorio,
  type CelulaRelatorio,
  type ColunaRelatorio,
  type DadosRelatorio,
  type IndicadorRelatorio,
  type OpcoesRelatorio,
  type SecaoRelatorio,
  type TabelaRelatorio,
} from "./relatorio-tipos";

export * from "./relatorio-tipos";

const TITULOS = Object.fromEntries(SECOES_RELATORIO.map((secao) => [secao.id, secao.titulo])) as Record<SecaoRelatorio, string>;
export const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
const moedaTexto = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const reais = (valor: number) => moedaTexto.format(valor).replace(/ /g, " ");
const comSinal = (valor: number) => `${valor > 0 ? "+" : valor < 0 ? "-" : ""}${reais(Math.abs(valor))}`;
const porcento = (valor: number) => `${(valor * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
const tomDe = (valor: number) => (valor > 0.004 ? "positivo" : valor < -0.004 ? "negativo" : "neutro") as IndicadorRelatorio["tom"];

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

const situacaoTexto = { concluido: "Concluído", a_vencer: "A vencer", atrasado: "Atrasado" } as const;

export function montarRelatorio(dados: DadosRelatorio, opcoes: OpcoesRelatorio): BlocoRelatorio[] {
  const contexto = criarContexto(dados, opcoes);
  const { inicio, fim, hoje, todasAsContas } = contexto;
  const blocos: Partial<Record<SecaoRelatorio, BlocoRelatorio[]>> = {};
  const quer = (secao: SecaoRelatorio) => opcoes.secoes.includes(secao);
  const adicionar = (secao: SecaoRelatorio, ...novos: BlocoRelatorio[]) => {
    blocos[secao] = [...(blocos[secao] ?? []), ...novos];
  };
  const tabela = (secao: SecaoRelatorio, titulo: string, colunas: ColunaRelatorio[], linhas: CelulaRelatorio[][], extra: Partial<TabelaRelatorio> = {}): BlocoRelatorio => ({
    tipo: "tabela",
    secao,
    tabela: { secao, titulo, colunas, linhas, ...extra },
  });
  const nota = (secao: SecaoRelatorio, texto: string): BlocoRelatorio => ({ tipo: "nota", secao, texto });
  const contaPorId = new Map(dados.contas.map((conta) => [conta.id, conta]));
  const categoriaPorId = new Map(dados.categorias.map((categoria) => [categoria.id, categoria]));
  const nomeConta = (id: number) => contaPorId.get(id)?.nome ?? "Conta";
  const nomeCategoria = (id: number | null) => (id == null ? "Sem categoria" : categoriaPorId.get(id)?.nome ?? "Categoria");
  const noPeriodo = (data: string) => Boolean(data) && data >= inicio && data <= fim;
  const avisoDosFiltros = "Filtros de categoria, tipo, situação ou cartão mudam receitas, despesas e listas. Os saldos e a projeção continuam mostrando o dinheiro real das contas.";
  const avisoDoCartao = "Com contas escolhidas, o cartão fica de fora (ele não pertence a uma conta) e o pagamento da fatura conta como despesa da conta que pagou.";

  // Realizado: até o fim do mês atual (o mesmo trecho da evolução mês a mês).
  // Meses futuros ainda não aconteceram, mesmo que já tenham parcelas agendadas.
  const totais = contexto.fimRealizado
    ? totaisNoIntervalo(contexto, inicio, contexto.fimRealizado, true)
    : { receitas: 0, despesas: 0, resultado: 0, compras: 0, objetivos: 0, transferencias: 0, faturasPagas: 0 };
  const evolucao = evolucaoMensal(contexto);
  const projecao = projecaoDoSaldo(contexto);
  // Uma lista de pendências só, para o resumo, as categorias e o detalhamento.
  const pendentes = itensPendentes(contexto);

  if (quer("resumo")) {
    // Período que ainda não começou: o saldo inicial é o previsto para o primeiro dia dele.
    const saldoInicialPrevisto = inicio > hoje ? projecao?.linhas[0]?.saldoInicio : undefined;
    const saldoInicial = saldoInicialPrevisto ?? contexto.saldoEm(adicionarDias(inicio, -1));
    const saldoAtual = centavos([...calcularSaldosPorConta(contexto.contas, dados.transacoes).values()].reduce((soma, valor) => soma + valor, 0));
    const pendencias = pendenciasDoPeriodo(contexto, pendentes);
    const receber = centavos(pendencias.receber.aVencer.valor + pendencias.receber.atrasados.valor);
    const pagar = centavos(pendencias.pagar.aVencer.valor + pendencias.pagar.atrasados.valor);
    const taxa = taxaDePoupanca(totais.receitas, totais.resultado);
    const itens: IndicadorRelatorio[] = [
      { rotulo: "Saldo inicial do período", valor: saldoInicial, formato: "moeda", detalhe: saldoInicialPrevisto !== undefined ? `previsto para ${dataBr(inicio)}` : `em ${dataBr(adicionarDias(inicio, -1))}` },
      { rotulo: "Saldo atual", valor: saldoAtual, formato: "moeda", detalhe: "hoje, nas contas do relatório", tom: saldoAtual < 0 ? "negativo" : "neutro" },
    ];
    if (fim < hoje) itens.push({ rotulo: "Saldo no fim do período", valor: contexto.saldoEm(fim), formato: "moeda", detalhe: `em ${dataBr(fim)}` });
    itens.push(
      { rotulo: "Receitas realizadas", valor: totais.receitas, formato: "moeda", tom: "positivo", detalhe: fim > (contexto.fimRealizado ?? fim) ? "concluídas até hoje" : "concluídas no período" },
      { rotulo: "Despesas realizadas", valor: totais.despesas, formato: "moeda", tom: "negativo", detalhe: totais.compras > 0.004 ? `inclui ${reais(totais.compras)} do cartão` : fim > (contexto.fimRealizado ?? fim) ? "concluídas até hoje" : "concluídas no período" },
      { rotulo: "Resultado realizado", valor: totais.resultado, formato: "moeda", tom: tomDe(totais.resultado), detalhe: "receitas menos despesas" },
    );
    if (taxa !== null) itens.push({ rotulo: "Taxa de poupança", valor: taxa, formato: "percentual", tom: tomDe(taxa), detalhe: "resultado sobre as receitas" });
    itens.push(
      { rotulo: "A receber", valor: receber, formato: "moeda", detalhe: `a vencer ${reais(pendencias.receber.aVencer.valor)} · atrasados ${reais(pendencias.receber.atrasados.valor)}` },
      { rotulo: "A pagar", valor: pagar, formato: "moeda", detalhe: `a vencer ${reais(pendencias.pagar.aVencer.valor)} · atrasados ${reais(pendencias.pagar.atrasados.valor)}` },
    );
    if (projecao) {
      // A data no nome deixa claro que é uma previsão (o período ainda não terminou).
      itens.push({ rotulo: `Saldo projetado para ${dataBr(fim)}`, valor: projecao.saldoProjetado, formato: "moeda", tom: projecao.saldoProjetado < 0 ? "negativo" : "neutro", detalhe: "previsão, com os atrasados" });
      if (projecao.faturas > 0.004) {
        itens.push(
          { rotulo: "Faturas do cartão em aberto", valor: projecao.faturas, formato: "moeda", tom: "negativo", detalhe: `vencem até ${dataBr(fim)}` },
          { rotulo: "Saldo projetado com as faturas", valor: projecao.saldoComFaturas, formato: "moeda", tom: projecao.saldoComFaturas < 0 ? "negativo" : "neutro", detalhe: `para ${dataBr(fim)}, se as faturas forem pagas` },
        );
      }
    }
    if (todasAsContas) {
      const guardado = centavos(dados.objetivos.filter((objetivo) => !objetivo.arquivado).reduce((soma, objetivo) => soma + numero(objetivo.saldo_atual), 0));
      if (guardado > 0.004) itens.push({ rotulo: "Guardado em objetivos", valor: guardado, formato: "moeda", detalhe: "fora do saldo das contas" });
    }
    adicionar("resumo", { tipo: "indicadores", secao: "resumo", titulo: "Indicadores do período", itens });

    adicionar("resumo", tabela("resumo", "Valores pendentes", [
      { titulo: "", tipo: "texto" },
      { titulo: "A vencer (lançamentos)", tipo: "numero" },
      { titulo: "A vencer (valor)", tipo: "moeda" },
      { titulo: "Atrasados (lançamentos)", tipo: "numero" },
      { titulo: "Atrasados (valor)", tipo: "moeda" },
      { titulo: "Total", tipo: "moeda" },
    ], [
      ["A receber", pendencias.receber.aVencer.quantidade, pendencias.receber.aVencer.valor, pendencias.receber.atrasados.quantidade, pendencias.receber.atrasados.valor, receber],
      ["A pagar", pendencias.pagar.aVencer.quantidade, pendencias.pagar.aVencer.valor, pendencias.pagar.atrasados.quantidade, pendencias.pagar.atrasados.valor, pagar],
      // Transferências, objetivos e faturas também estão na lista de pendências; aqui aparecem à parte.
      ...([["Transferências e objetivos", pendencias.transferencias], ["Faturas do cartão", pendencias.faturas]] as const)
        .filter(([, grupo]) => grupo.aVencer.quantidade + grupo.atrasados.quantidade > 0)
        .map(([rotulo, grupo]): CelulaRelatorio[] => [rotulo, grupo.aVencer.quantidade, grupo.aVencer.valor, grupo.atrasados.quantidade, grupo.atrasados.valor, centavos(grupo.aVencer.valor + grupo.atrasados.valor)]),
    ]));
    if (pendencias.transferencias.aVencer.quantidade + pendencias.transferencias.atrasados.quantidade > 0) {
      adicionar("resumo", nota("resumo", "Transferências e objetivos: as transferências entre as contas do relatório estão nas pendências, mas não mudam o saldo total nem a projeção (o dinheiro só troca de conta). Objetivos e transferências para contas fora do relatório entram nas entradas e saídas previstas."));
    }

    if (evolucao.length > 0) {
      const ultimo = evolucao[evolucao.length - 1];
      const tendencia = tendenciaDoSaldo(evolucao[0].saldoInicio, ultimo.saldoFim);
      const completos = evolucao.filter((linha) => !linha.emAndamento);
      const comMovimento = completos.filter((linha) => Math.abs(linha.receitas) > 0.004 || Math.abs(linha.despesas) > 0.004);
      const melhor = [...comMovimento].sort((a, b) => b.resultado - a.resultado)[0];
      const pior = [...comMovimento].sort((a, b) => a.resultado - b.resultado)[0];
      const destaques: CelulaRelatorio[][] = [
        ["Seu saldo está", `${tendencia.rotulo} (${comSinal(tendencia.variacao)}${tendencia.percentual !== null ? `, ${tendencia.percentual > 0 ? "+" : ""}${porcento(tendencia.percentual)}` : ""} desde o início do período)`],
      ];
      if (melhor) destaques.push(["Melhor mês", `${melhor.recorte.rotulo}: ${comSinal(melhor.resultado)}`]);
      if (pior && pior !== melhor) destaques.push(["Pior mês", `${pior.recorte.rotulo}: ${comSinal(pior.resultado)}`]);
      destaques.push(
        ["Meses positivos", String(completos.filter((linha) => linha.resultado > 0.004).length)],
        ["Meses negativos", String(completos.filter((linha) => linha.resultado < -0.004).length)],
        // Mesma regra que deixa o mês fora do melhor e do pior: sem receitas nem despesas.
        ["Meses sem movimentação", String(completos.length - comMovimento.length)],
      );
      // Teve receitas e despesas, mas o resultado deu exatamente zero: não é positivo, negativo nem sem movimentação.
      const zerados = comMovimento.filter((linha) => Math.abs(linha.resultado) <= 0.004).length;
      if (zerados > 0) destaques.push(["Meses com resultado zero", String(zerados)]);
      if (ultimo.emAndamento) destaques.push(["Mês em andamento", `${ultimo.recorte.rotulo}: ${comSinal(ultimo.resultado)} até agora (fora do melhor e do pior mês)`]);
      adicionar("resumo", tabela("resumo", "Destaques", [{ titulo: "Destaque", tipo: "texto" }, { titulo: "Valor", tipo: "texto" }], destaques));
    }
    if (contexto.filtrosAtivos) adicionar("resumo", nota("resumo", avisoDosFiltros));
    if (!todasAsContas) adicionar("resumo", nota("resumo", avisoDoCartao));
    const temAntesDoPeriodo = contexto.movimentos.some((transacao) => transacao.status === "paga" && dataEfetivaTransacao(transacao).slice(0, 10) < inicio);
    if (saldoInicialPrevisto === undefined && !temAntesDoPeriodo) {
      adicionar("resumo", nota("resumo", "Não há lançamentos concluídos antes deste período: o saldo inicial do período é o saldo de cadastro das contas."));
    }
    const manuais = possiveisPagamentosDeFaturaManuais(contexto);
    if (manuais.length > 0) {
      const lista = manuais.slice(0, 3).map((item) => `"${item.descricao}" (${reais(item.valor)} em ${dataBr(item.data)}, mesmo valor da fatura ${item.cartao} ${item.fatura})`).join("; ");
      adicionar("resumo", nota("resumo", `Atenção: ${lista}${manuais.length > 3 ? ` e mais ${manuais.length - 3}` : ""}. Se for o pagamento da fatura, use "Pagar fatura" na tela Cartões: lançado como despesa comum, o gasto conta duas vezes (as compras já entram nas despesas no mês da fatura).`));
    }
  }

  if (quer("evolucao")) {
    if (evolucao.length === 0) {
      adicionar("evolucao", nota("evolucao", "O período ainda não começou: a evolução mostra só meses que já começaram. Veja a projeção do saldo."));
    } else {
      const comObjetivos = !contexto.filtrosAtivos && evolucao.some((linha) => Math.abs(linha.objetivosETransferencias) > 0.004);
      const comCartao = !contexto.filtrosAtivos && todasAsContas && evolucao.some((linha) => Math.abs(linha.ajusteCartao) > 0.004);
      const colunas: ColunaRelatorio[] = [
        { titulo: "Mês", tipo: "texto" },
        { titulo: "Saldo no início do mês", tipo: "moeda" },
        { titulo: "Receitas", tipo: "moeda" },
        { titulo: "Despesas", tipo: "moeda" },
        { titulo: "Resultado", tipo: "moeda" },
      ];
      if (comObjetivos) colunas.push({ titulo: "Objetivos e transferências", tipo: "moeda" });
      if (comCartao) colunas.push({ titulo: "Cartão: compras menos faturas pagas", tipo: "moeda" });
      colunas.push({ titulo: "Saldo no fim do mês", tipo: "moeda" });
      const linha = (rotulo: string, valores: { saldoInicio: number; receitas: number; despesas: number; resultado: number; objetivosETransferencias: number; ajusteCartao: number; saldoFim: number }): CelulaRelatorio[] => [
        rotulo,
        valores.saldoInicio,
        valores.receitas,
        valores.despesas,
        valores.resultado,
        ...(comObjetivos ? [valores.objetivosETransferencias] : []),
        ...(comCartao ? [valores.ajusteCartao] : []),
        valores.saldoFim,
      ];
      const somar = (campo: "receitas" | "despesas" | "resultado" | "objetivosETransferencias" | "ajusteCartao") => centavos(evolucao.reduce((soma, item) => soma + item[campo], 0));
      adicionar("evolucao", tabela("evolucao", "Evolução mensal", colunas,
        evolucao.map((item) => linha(item.emAndamento ? `${item.recorte.rotulo} (em andamento)` : item.recorte.rotulo, item)),
        {
          negativosEmVermelho: true,
          total: linha("Período", {
            saldoInicio: evolucao[0].saldoInicio,
            receitas: somar("receitas"),
            despesas: somar("despesas"),
            resultado: somar("resultado"),
            objetivosETransferencias: somar("objetivosETransferencias"),
            ajusteCartao: somar("ajusteCartao"),
            saldoFim: evolucao[evolucao.length - 1].saldoFim,
          }),
        }));
      adicionar("evolucao", nota("evolucao", contexto.filtrosAtivos
        ? `Resultado = receitas - despesas. ${avisoDosFiltros}`
        : `Resultado = receitas - despesas. O saldo no fim do mês é o dinheiro nas contas e serve de saldo inicial do mês seguinte. Além do resultado, ele muda com objetivos e transferências para contas fora do relatório${todasAsContas ? " e com o cartão: a compra entra nas despesas no mês da fatura, mas o dinheiro só sai da conta quando a fatura é paga" : ""}.${comCartao ? " No Fluxo de caixa, a despesa do cartão aparece quando a fatura é paga; aqui, como no Início, no mês da fatura. A coluna Cartão mostra essa diferença." : ""}`));

      // Gráfico do saldo: o realizado até hoje e, depois, a projeção (tracejada).
      const futuros = (projecao?.linhas ?? []).filter((item) => item.recorte.mes > contexto.mesAtual);
      const rotulos = ["Início", ...evolucao.map((item) => item.recorte.rotuloCurto), ...futuros.map((item) => item.recorte.rotuloCurto)];
      const valores = [evolucao[0].saldoInicio, ...evolucao.map((item) => item.saldoFim), ...futuros.map((item) => item.saldoFim)];
      adicionar("evolucao", {
        tipo: "grafico",
        secao: "evolucao",
        grafico: { tipo: "linha", id: "saldo", titulo: "Evolução do saldo (saldo no fim de cada mês)", rotulos, valores, projetadoDesde: futuros.length ? evolucao.length + 1 : undefined },
      });
      adicionar("evolucao", {
        tipo: "grafico",
        secao: "evolucao",
        grafico: {
          tipo: "barras",
          id: "receitas-despesas",
          titulo: "Receitas x despesas por mês",
          rotulos: evolucao.map((item) => item.recorte.rotuloCurto),
          series: [
            { nome: "Receitas", tom: "receita", valores: evolucao.map((item) => item.receitas) },
            { nome: "Despesas", tom: "despesa", valores: evolucao.map((item) => item.despesas) },
          ],
        },
      });
    }
  }

  if (quer("projecao")) {
    if (!projecao) {
      adicionar("projecao", nota("projecao", "O período já terminou: não há o que projetar. Escolha um período que chegue até hoje ou depois."));
    } else {
      const comFaturas = todasAsContas && (projecao.faturas > 0.004 || projecao.linhas.some((item) => item.faturas > 0.004));
      const itens: IndicadorRelatorio[] = [
        { rotulo: "Saldo atual", valor: projecao.saldoAtual, formato: "moeda", detalhe: "hoje" },
        { rotulo: "Entradas previstas", valor: projecao.entradas, formato: "moeda", tom: "positivo", detalhe: `até ${dataBr(fim)}` },
        { rotulo: "Saídas previstas", valor: projecao.saidas, formato: "moeda", tom: "negativo", detalhe: `até ${dataBr(fim)}` },
        { rotulo: `Saldo projetado para ${dataBr(fim)}`, valor: projecao.saldoProjetado, formato: "moeda", tom: projecao.saldoProjetado < 0 ? "negativo" : "neutro", detalhe: "previsão: saldo atual + entradas - saídas" },
      ];
      if (comFaturas) {
        itens.push(
          { rotulo: "Faturas do cartão em aberto", valor: projecao.faturas, formato: "moeda", tom: "negativo", detalhe: `vencem até ${dataBr(fim)}` },
          { rotulo: "Saldo projetado com as faturas", valor: projecao.saldoComFaturas, formato: "moeda", tom: projecao.saldoComFaturas < 0 ? "negativo" : "neutro", detalhe: `para ${dataBr(fim)}, se as faturas forem pagas` },
        );
      }
      adicionar("projecao", { tipo: "indicadores", secao: "projecao", titulo: "Se tudo o que está previsto acontecer", itens });
      const colunas: ColunaRelatorio[] = [
        { titulo: "Mês", tipo: "texto" },
        { titulo: "Saldo no início", tipo: "moeda" },
        { titulo: "Entradas previstas", tipo: "moeda" },
        { titulo: "Saídas previstas", tipo: "moeda" },
        { titulo: "Saldo projetado no fim do mês", tipo: "moeda" },
      ];
      if (comFaturas) colunas.push({ titulo: "Faturas em aberto", tipo: "moeda" }, { titulo: "Saldo com as faturas", tipo: "moeda" });
      adicionar("projecao", tabela("projecao", "Projeção mês a mês", colunas, projecao.linhas.map((item) => [
        // A primeira linha parte do saldo de hoje, não do dia 1º.
        item.desdeHoje
          ? `${nomeDoMes(item.recorte.mes)} (${item.recorte.fim < ultimoDiaDoMes(item.recorte.mes) ? `de hoje, ${dataBr(hoje).slice(0, 5)}, a ${dataBr(item.recorte.fim).slice(0, 5)}` : `a partir de hoje, ${dataBr(hoje).slice(0, 5)}`})`
          : item.recorte.rotulo,
        item.saldoInicio,
        item.entradas,
        item.saidas,
        item.saldoFim,
        ...(comFaturas ? [item.faturas, item.saldoComFaturas] : []),
      ]), { negativosEmVermelho: true }));
      adicionar("projecao", nota("projecao", `É o mesmo saldo projetado do Fluxo de caixa: o saldo de hoje mais o que está previsto entrar, menos o que está previsto sair (inclusive objetivos e transferências com contas fora do relatório). Os atrasados entram no mês atual, como se fossem acontecer agora (o padrão do Fluxo de caixa); eles também aparecem à parte em Valores pendentes.${comFaturas ? " As faturas do cartão em aberto ainda não entram no saldo projetado das outras telas; por isso aparecem à parte." : ""}`));
    }
  }

  if (quer("contas")) {
    const linhas = contasDoPeriodo(contexto);
    const tituloOutros = todasAsContas ? "Transferências, objetivos e faturas" : "Transferências e objetivos";
    const somar = (campo: "saldoInicio" | "receitas" | "despesas" | "outros" | "saldoFim" | "saldoAtual") => centavos(linhas.reduce((soma, item) => soma + item[campo], 0));
    adicionar("contas", tabela("contas", "Saldo por conta", [
      { titulo: "Conta", tipo: "texto" },
      { titulo: "Saldo inicial (cadastro)", tipo: "moeda" },
      { titulo: "Saldo no início do período", tipo: "moeda" },
      { titulo: "Receitas", tipo: "moeda" },
      { titulo: "Despesas", tipo: "moeda" },
      { titulo: tituloOutros, tipo: "moeda" },
      { titulo: fim < hoje ? `Saldo em ${dataBr(fim)}` : "Saldo hoje", tipo: "moeda" },
      { titulo: "Saldo atual", tipo: "moeda" },
    ], linhas.map((item) => [
      item.conta.nome,
      centavos(numero(item.conta.saldo_inicial)),
      item.saldoInicio,
      item.receitas,
      item.despesas,
      item.outros,
      item.saldoFim,
      item.saldoAtual,
    ]), {
      negativosEmVermelho: true,
      total: linhas.length > 1
        ? ["Total", centavos(linhas.reduce((soma, item) => soma + numero(item.conta.saldo_inicial), 0)), somar("saldoInicio"), somar("receitas"), somar("despesas"), somar("outros"), somar("saldoFim"), somar("saldoAtual")]
        : undefined,
    }));
    adicionar("contas", nota("contas", `Receitas e despesas de cada conta são o dinheiro que entrou e saiu dela${contexto.filtrosAtivos ? ", sem os filtros de categoria, tipo e situação" : ""}.${todasAsContas ? " O cartão aparece aqui quando a fatura é paga (é quando o dinheiro sai da conta); no resumo, as compras entram nas despesas no mês da fatura." : ""}${inicio > hoje ? " O período ainda não começou: os saldos são os de hoje; o previsto está na projeção." : ""}`));
    const colunasNoTempo = agrupamentos(recortesMensais(inicio, fim)).filter((coluna) => coluna.inicio <= hoje);
    if (colunasNoTempo.length > 0 && linhas.length > 0) {
      const noTempo = saldosDasContasNoTempo(contexto, colunasNoTempo);
      adicionar("contas", tabela("contas", "Saldo de cada conta no fim do mês", [
        { titulo: "Conta", tipo: "texto" },
        ...colunasNoTempo.map((coluna) => ({ titulo: coluna.rotulo, tipo: "moeda" as const })),
      ], noTempo.map((item) => [item.nome, ...item.valores]), {
        negativosEmVermelho: true,
        total: noTempo.length > 1 ? ["Total", ...colunasNoTempo.map((_, indice) => centavos(noTempo.reduce((soma, item) => soma + (item.valores[indice] ?? 0), 0)))] : undefined,
      }));
    }
  }

  if (quer("categorias")) {
    const despesas = categoriasDoPeriodo(contexto, "despesa", pendentes);
    const receitas = categoriasDoPeriodo(contexto, "receita", pendentes);
    const tabelaDeCategorias = (titulo: string, linhas: LinhaCategoria[], percentual: string, alvo: string) => tabela("categorias", titulo, [
      { titulo: "Categoria", tipo: "texto" },
      { titulo: "Lançamentos", tipo: "numero" },
      { titulo: "Realizado", tipo: "moeda" },
      { titulo: percentual, tipo: "percentual" },
      { titulo: "Pendente", tipo: "moeda" },
      { titulo: alvo, tipo: "moeda" },
    ], linhas.map((item) => [item.nome, item.lancamentos, item.realizado, item.percentual, item.pendente, item.alvo]), {
      total: linhas.length > 1
        ? ["Total", linhas.reduce((soma, item) => soma + item.lancamentos, 0), centavos(linhas.reduce((soma, item) => soma + item.realizado, 0)), linhas.some((item) => item.realizado > 0.004) ? 1 : null, centavos(linhas.reduce((soma, item) => soma + item.pendente, 0)), null]
        : undefined,
    });
    adicionar("categorias", tabelaDeCategorias("Despesas por categoria", despesas, "% das despesas", "Limite mensal"));
    const comValor = despesas.filter((item) => item.realizado > 0.004);
    if (comValor.length > 0) {
      const principais = comValor.slice(0, 8);
      const resto = comValor.slice(8);
      const rotulos = [...principais.map((item) => item.nome), ...(resto.length ? ["Outras"] : [])];
      const valores = [...principais.map((item) => item.realizado), ...(resto.length ? [centavos(resto.reduce((soma, item) => soma + item.realizado, 0))] : [])];
      const percentuais = [
        ...principais.map((item) => item.percentual ?? 0),
        ...(resto.length ? [Math.round(resto.reduce((soma, item) => soma + (item.percentual ?? 0), 0) * 1000) / 1000] : []),
      ];
      adicionar("categorias", {
        tipo: "grafico",
        secao: "categorias",
        grafico: { tipo: "barras_horizontais", id: "categorias", titulo: "Para onde foi o dinheiro (despesas realizadas)", rotulos, valores, percentuais },
      });
    }
    adicionar("categorias", tabelaDeCategorias("Receitas por categoria", receitas, "% das receitas", "Meta mensal"));
    const colunas = agrupamentos(recortesMensais(inicio, fim)).filter((coluna) => coluna.inicio <= hoje);
    if (colunas.length > 1) {
      const noTempo = despesasPorCategoriaNoTempo(contexto, colunas);
      adicionar("categorias", tabela("categorias", "Despesas por categoria mês a mês", [
        { titulo: "Categoria", tipo: "texto" },
        ...colunas.map((coluna) => ({ titulo: coluna.rotulo, tipo: "moeda" as const })),
        { titulo: "Total", tipo: "moeda" },
      ], noTempo.map((item) => [item.nome, ...item.valores, item.total]), {
        total: noTempo.length > 1 ? ["Total", ...colunas.map((_, indice) => centavos(noTempo.reduce((soma, item) => soma + (item.valores[indice] ?? 0), 0))), centavos(noTempo.reduce((soma, item) => soma + item.total, 0))] : undefined,
      }));
    }
    const mesesRealizados = evolucao.length;
    const temAlvo = [...despesas, ...receitas].some((item) => item.alvo !== null);
    adicionar("categorias", nota("categorias", `Realizado: o que foi concluído no período, até o mês atual${todasAsContas ? " (as compras do cartão entram no mês da fatura)" : ""}. Pendente: o que está em aberto até o fim do período, inclusive atrasados de antes dele (o mesmo de A receber e A pagar).${temAlvo && mesesRealizados > 1 ? ` Meta e limite são valores por mês; este relatório soma ${mesesRealizados} meses. Compare com a tabela mês a mês ou com a média por mês (realizado dividido por ${mesesRealizados}).` : ""}`));
  }

  if (quer("maiores")) {
    const colunas: ColunaRelatorio[] = [
      { titulo: "#", tipo: "numero" },
      { titulo: "Data", tipo: "data" },
      { titulo: "Descrição", tipo: "texto" },
      { titulo: "Categoria", tipo: "texto" },
      { titulo: "Conta ou cartão", tipo: "texto" },
      { titulo: "Valor", tipo: "moeda" },
    ];
    for (const [classe, titulo] of [["despesa", "Maiores despesas"], ["receita", "Maiores receitas"]] as const) {
      const lista = maioresDoPeriodo(contexto, classe);
      adicionar("maiores", tabela("maiores", `${titulo} (top ${contexto.maiores})`, colunas, lista.map((item, indice) => [indice + 1, item.data, item.descricao, item.categoria, item.origem, centavos(item.valor)])));
    }
  }

  if (quer("cartoes")) {
    if (!todasAsContas) {
      adicionar("cartoes", nota("cartoes", "Com contas escolhidas, os cartões ficam de fora (eles não pertencem a uma conta). Escolha todas as contas para ver esta parte."));
    } else {
      const cartoes = cartoesDoPeriodo(contexto);
      const somar = (campo: "limite" | "limiteUsado" | "limiteDisponivel" | "gastoNoPeriodo" | "faturaAtual" | "proximaFatura" | "parcelasFuturas" | "valorParcelasFuturas") => centavos(cartoes.reduce((soma, item) => soma + item[campo], 0));
      adicionar("cartoes", tabela("cartoes", "Cartões", [
        { titulo: "Cartão", tipo: "texto" },
        { titulo: "Limite", tipo: "moeda" },
        { titulo: "Limite utilizado", tipo: "moeda" },
        { titulo: "Limite disponível", tipo: "moeda" },
        { titulo: "Gasto no período", tipo: "moeda" },
        { titulo: "Fatura atual", tipo: "moeda" },
        { titulo: "Próxima fatura", tipo: "moeda" },
        { titulo: "Próximo vencimento", tipo: "data" },
        { titulo: "Parcelas futuras", tipo: "numero" },
        { titulo: "Valor das parcelas futuras", tipo: "moeda" },
      ], cartoes.map((item) => [
        item.cartao.ativo ? item.cartao.nome : `${item.cartao.nome} (inativo)`,
        item.limite,
        item.limiteUsado,
        item.limiteDisponivel,
        item.gastoNoPeriodo,
        item.faturaAtual,
        item.proximaFatura,
        item.proximoVencimento,
        item.parcelasFuturas,
        item.valorParcelasFuturas,
      ]), {
        negativosEmVermelho: true,
        total: cartoes.length > 1
          ? ["Total", somar("limite"), somar("limiteUsado"), somar("limiteDisponivel"), somar("gastoNoPeriodo"), somar("faturaAtual"), somar("proximaFatura"), null, somar("parcelasFuturas"), somar("valorParcelasFuturas")]
          : undefined,
      }));
      const parcelados = parcelamentosEmAberto(contexto);
      adicionar("cartoes", tabela("cartoes", "Compras parceladas em aberto", [
        { titulo: "Descrição", tipo: "texto" },
        { titulo: "Cartão", tipo: "texto" },
        { titulo: "Parcela", tipo: "texto" },
        { titulo: "Valor da parcela", tipo: "moeda" },
        { titulo: "Parcelas restantes", tipo: "numero" },
        { titulo: "Valor restante", tipo: "moeda" },
        { titulo: "Última fatura", tipo: "texto" },
      ], parcelados.map((item) => [item.descricao, item.cartao, item.parcela, item.valorParcela, item.restantes, item.valorRestante, item.ultimaFatura]), {
        total: parcelados.length > 1
          ? ["Total", null, null, null, parcelados.reduce((soma, item) => soma + item.restantes, 0), centavos(parcelados.reduce((soma, item) => soma + item.valorRestante, 0)), null]
          : undefined,
      }));
      adicionar("cartoes", nota("cartoes", `Como o cartão entra nas contas do FinFlow: cada compra (ou parcela) entra nas despesas no mês da fatura. O pagamento da fatura não entra de novo nas despesas; é ele que tira o dinheiro da conta e aparece na evolução do saldo. Limite utilizado e faturas seguem a tela Cartões. O gasto no período vai até a fatura do mês atual; as faturas seguintes estão em parcelas futuras. O limite utilizado conta tudo o que não foi pago, inclusive o que sobrou de faturas antigas. Pague a fatura sempre por "Pagar fatura": lançado como despesa comum, o gasto conta duas vezes.${contexto.filtrosAtivos ? " Esta tabela segue só o filtro de cartão." : ""}`));
      const juros = jurosDeFatura(contexto);
      if (juros.length > 0) {
        adicionar("cartoes", nota("cartoes", `Juros de fatura levada para a próxima, nas faturas do período até o mês atual: ${juros.map((item) => `${item.cartao} ${reais(item.valor)}`).join("; ")}. Eles estão dentro dos pagamentos de fatura e, pela regra do FinFlow, não entram nas despesas.`));
      }
    }
  }

  if (quer("comparacao")) {
    const janelas = janelasDaComparacao(contexto);
    if (!janelas) {
      adicionar("comparacao", nota("comparacao", "O período ainda não começou: não há o que comparar."));
    } else {
      const { atual: janelaAtual, anterior: janelaAnterior, emAndamento } = janelas;
      const atual = metricasDaJanela(contexto, janelaAtual);
      const passado = metricasDaJanela(contexto, janelaAnterior);
      // Sem nenhuma receita nem despesa no trecho anterior não há base para
      // comparar: diante de R$ 0,00, qualquer diferença pareceria crescimento.
      if (Math.abs(passado.receitas) <= 0.004 && Math.abs(passado.despesas) <= 0.004) {
        adicionar("comparacao", nota("comparacao", `Comparação com o período anterior: sem dados suficientes no período anterior (${dataBr(janelaAnterior.inicio)} a ${dataBr(janelaAnterior.fim)}) para comparação.`));
      } else {
        // Com algum dado, a comparação vale; só a porcentagem sobre uma base R$ 0,00 fica em branco.
        const variacao = (agora: number, antes: number) => (Math.abs(antes) > 0.004 ? Math.round(((agora - antes) / Math.abs(antes)) * 10000) / 10000 : null);
        const linha = (rotulo: string, agora: number, antes: number): CelulaRelatorio[] => [rotulo, agora, antes, centavos(agora - antes), variacao(agora, antes)];
        const titulo = emAndamento
          ? `Comparação: ${dataBr(janelaAtual.inicio)} a ${dataBr(janelaAtual.fim)} com ${dataBr(janelaAnterior.inicio)} a ${dataBr(janelaAnterior.fim)}`
          : `Comparação com ${dataBr(janelaAnterior.inicio)} a ${dataBr(janelaAnterior.fim)}`;
        adicionar("comparacao", tabela("comparacao", titulo, [
          { titulo: "Indicador", tipo: "texto" },
          { titulo: "Período atual", tipo: "moeda" },
          { titulo: "Período anterior", tipo: "moeda" },
          { titulo: "Diferença", tipo: "moeda" },
          { titulo: "Variação", tipo: "percentual" },
        ], [
          linha("Receitas realizadas", atual.receitas, passado.receitas),
          linha("Despesas realizadas", atual.despesas, passado.despesas),
          linha("Resultado", atual.resultado, passado.resultado),
          linha(emAndamento ? "Saldo (hoje e na mesma data do período anterior)" : "Saldo no fim do período", atual.saldoNoFim, passado.saldoNoFim),
        ], { negativosEmVermelho: true }));
        if (atual.taxaDePoupanca !== null || passado.taxaDePoupanca !== null) {
          adicionar("comparacao", tabela("comparacao", "Taxa de poupança", [
            { titulo: "Indicador", tipo: "texto" },
            { titulo: "Período atual", tipo: "percentual" },
            { titulo: "Período anterior", tipo: "percentual" },
            { titulo: "Diferença (pontos)", tipo: "percentual" },
          ], [[
            "Resultado sobre as receitas",
            atual.taxaDePoupanca,
            passado.taxaDePoupanca,
            atual.taxaDePoupanca !== null && passado.taxaDePoupanca !== null ? Math.round((atual.taxaDePoupanca - passado.taxaDePoupanca) * 10000) / 10000 : null,
          ]], { negativosEmVermelho: true }));
        }
        if (emAndamento) adicionar("comparacao", nota("comparacao", "O período atual ainda não terminou: a comparação usa o mesmo trecho dos dois períodos, até a data de hoje (as compras do cartão pelo mês da fatura, como no resumo)."));
      }
    }
  }

  // Detalhamento: as listas de lançamentos.
  const lancamento: ColunaRelatorio[] = [
    { titulo: "Vencimento", tipo: "data" },
    { titulo: "Concluído em", tipo: "data" },
    { titulo: "Descrição", tipo: "texto" },
    { titulo: "Categoria", tipo: "texto" },
    { titulo: "Conta", tipo: "texto" },
    { titulo: "Situação", tipo: "texto" },
    { titulo: "Valor", tipo: "moeda" },
  ];
  const linhaLancamento = (t: Lancamento): CelulaRelatorio[] => [
    t.data_vencimento,
    t.status === "paga" ? (t.data_realizacao ?? t.data_vencimento) : null,
    descricaoVisivel(t.descricao) || "Lançamento",
    nomeCategoria(t.categoria_id),
    nomeConta(t.conta_id),
    situacaoTexto[situacaoDoLancamento(t, hoje)],
    centavos(numero(t.valor)),
  ];
  const doPeriodoNaClasse = (classe: "receita" | "despesa") => contexto.escopo
    .filter((t) => noPeriodo(dataEfetivaTransacao(t).slice(0, 10)))
    .filter((t) => classeDoLancamento(t, todasAsContas) === classe)
    .filter((t) => passaNosFiltros(contexto, { classe, categoria_id: t.categoria_id, situacao: situacaoDoLancamento(t, hoje) }))
    .sort((a, b) => dataEfetivaTransacao(a).localeCompare(dataEfetivaTransacao(b)) || a.id - b.id);
  if (quer("receitas")) adicionar("receitas", tabela("receitas", TITULOS.receitas, lancamento, doPeriodoNaClasse("receita").map(linhaLancamento)));
  if (quer("despesas")) {
    adicionar("despesas", tabela("despesas", TITULOS.despesas, lancamento, doPeriodoNaClasse("despesa").map(linhaLancamento)));
    if (todasAsContas) adicionar("despesas", nota("despesas", "As compras do cartão estão em Compras no cartão e entram nas despesas do resumo no mês da fatura. O pagamento da fatura não aparece aqui, para o mesmo gasto não contar duas vezes."));
  }

  // Lançamentos das contas escolhidas (transferência: origem ou destino), como na tela.
  const daConta = (transacao: Lancamento) => {
    if (contexto.idsContas.has(transacao.conta_id)) return true;
    const destino = getContaDestinoTransferencia(transacao.descricao);
    return destino !== null && contexto.idsContas.has(destino);
  };
  const ehMovimentoInterno = (descricao: string) => isTransferencia(descricao) || isMovimentoObjetivo(descricao);

  if (quer("transferencias")) {
    const transferencias = dados.transacoes
      .filter(daConta)
      .filter((t) => ehMovimentoInterno(t.descricao) && noPeriodo(dataEfetivaTransacao(t).slice(0, 10)))
      .filter((t) => contexto.situacoes.size === 0 || contexto.situacoes.has(situacaoDoLancamento(t, hoje)))
      // Transferências e objetivos não são receita nem despesa e não têm categoria.
      .filter(() => contexto.tipo === "todos" && contexto.categoriaIds.size === 0)
      .sort((a, b) => dataEfetivaTransacao(a).localeCompare(dataEfetivaTransacao(b)) || a.id - b.id);
    adicionar("transferencias", tabela("transferencias", TITULOS.transferencias, [
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
        situacaoTexto[situacaoDoLancamento(t, hoje)],
        centavos(numero(t.valor)),
      ];
    })));
  }

  // Faturas e compras do cartão não têm conta: entram só com todas as contas.
  const categoriasDoFiltro = [...contexto.categoriaIds];
  const nomesDasCategorias = new Map(dados.categorias.map((categoria) => [categoria.id, categoria.nome]));
  // Com filtro de categoria, a fatura mostra só as compras dessas categorias.
  const comFiltroDeCategoria = (fatura: InvoiceHistoryGroup): InvoiceHistoryGroup | null => (
    categoriasDoFiltro.length ? filterInvoiceGroupItems(fatura, "", categoriasDoFiltro, nomesDasCategorias) : fatura
  );
  const situacaoDaFatura = (fatura: InvoiceHistoryGroup) => (fatura.paid ? "concluido" : fatura.dueDate < hoje ? "atrasado" : "a_vencer");
  const tipoAceitaDespesa = contexto.tipo !== "receita";

  if (quer("faturas")) {
    const faturas = contexto.faturasFiltradas
      .filter((fatura) => noPeriodo(fatura.dueDate) && tipoAceitaDespesa)
      .filter((fatura) => contexto.situacoes.size === 0 || contexto.situacoes.has(situacaoDaFatura(fatura)))
      .map(comFiltroDeCategoria)
      .filter((fatura): fatura is InvoiceHistoryGroup => fatura !== null)
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.cardName.localeCompare(b.cardName, "pt-BR"));
    adicionar("faturas", tabela("faturas", TITULOS.faturas, [
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
    ])));
  }

  if (quer("compras_cartao")) {
    const compras = comprasNoIntervalo(contexto, inicio, fim, true)
      .sort((a, b) => a.item.data_compra.localeCompare(b.item.data_compra) || a.item.id - b.item.id);
    adicionar("compras_cartao", tabela("compras_cartao", TITULOS.compras_cartao, [
      { titulo: "Data da compra", tipo: "data" },
      { titulo: "Descrição", tipo: "texto" },
      { titulo: "Cartão", tipo: "texto" },
      { titulo: "Categoria", tipo: "texto" },
      { titulo: "Parcela", tipo: "texto" },
      { titulo: "Fatura", tipo: "texto" },
      { titulo: "Valor", tipo: "moeda" },
    ], compras.map(({ item, fatura }) => [
      item.data_compra,
      item.descricao,
      fatura.cardName,
      nomeCategoria(item.categoria_id),
      item.total_parcelas > 1 ? `${item.parcela_atual}/${item.total_parcelas}` : "À vista",
      `${fatura.invoiceMonth.slice(5, 7)}/${fatura.invoiceMonth.slice(0, 4)}`,
      centavos(numero(item.valor)),
    ])));
    const ultimaRealizada = contexto.fimRealizado;
    if (ultimaRealizada && compras.some(({ fatura }) => fatura.dueDate > ultimaRealizada)) {
      adicionar("compras_cartao", nota("compras_cartao", `Compras de faturas que vencem depois de ${dataBr(ultimaRealizada)} são parcelas futuras: entram nas despesas quando chegar o mês da fatura.`));
    }
  }

  if (quer("pendencias")) {
    // Tudo o que está em aberto até o fim do período, inclusive atrasados de antes (a mesma lista do resumo).
    adicionar("pendencias", tabela("pendencias", TITULOS.pendencias, [
      { titulo: "Vencimento", tipo: "data" },
      { titulo: "Descrição", tipo: "texto" },
      { titulo: "Tipo", tipo: "texto" },
      { titulo: "Categoria", tipo: "texto" },
      { titulo: "Conta ou cartão", tipo: "texto" },
      { titulo: "Situação", tipo: "texto" },
      { titulo: "Valor", tipo: "moeda" },
    ], pendentes.map((item) => [item.vencimento, item.descricao, item.tipo, item.categoria, item.contaOuCartao, situacaoTexto[item.situacao], item.valor])));
  }

  if (quer("objetivos")) {
    adicionar("objetivos", tabela("objetivos", TITULOS.objetivos, [
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
      })));
  }

  // Mesma ordem da lista de seções, só as escolhidas.
  return SECOES_RELATORIO.flatMap((secao) => blocos[secao.id] ?? []);
}

/** Linhas de tabela de cada seção (para mostrar ao lado de cada uma na tela). */
export function linhasPorSecao(blocos: BlocoRelatorio[]): Map<SecaoRelatorio, number> {
  const contagem = new Map<SecaoRelatorio, number>();
  for (const bloco of blocos) {
    if (bloco.tipo !== "tabela") continue;
    contagem.set(bloco.secao, (contagem.get(bloco.secao) ?? 0) + bloco.tabela.linhas.length);
  }
  return contagem;
}

/** As tabelas do documento, na ordem (útil para testes e para quem só quer os dados). */
export function tabelasDoRelatorio(blocos: BlocoRelatorio[]): TabelaRelatorio[] {
  return blocos.flatMap((bloco) => (bloco.tipo === "tabela" ? [bloco.tabela] : []));
}

export type { ContextoRelatorio };
