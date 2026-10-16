// Lançamento incerto ("não tenho certeza deste lançamento"): o filtro
// "Considerar incertos" do Fluxo de caixa (site e app) e a marcação no
// Histórico, na criação e na edição.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { estaIncerto, lancamentosSemIncertos } from "../fluxo-incertos";
import { montarRelatorio, SECOES_RELATORIO, tabelasDoRelatorio, type BlocoRelatorio, type OpcoesRelatorio } from "../relatorio";
import { cenario } from "./fixtures/cenario-relatorio";

const raiz = join(__dirname, "..", "..", "..", "..");

describe("filtro Considerar incertos", () => {
  const lancamentos = [
    { id: 1, status: "pendente", incerta: true },
    { id: 2, status: "pendente", incerta: false },
    { id: 3, status: "paga", incerta: true },
    { id: 4, status: "pendente" },
  ];

  it("só o pendente marcado é incerto; o concluído nunca é", () => {
    expect(lancamentos.filter(estaIncerto).map((item) => item.id)).toEqual([1]);
  });

  it("ligado mantém tudo; desligado tira só os incertos", () => {
    expect(lancamentosSemIncertos(lancamentos, true).map((item) => item.id)).toEqual([1, 2, 3, 4]);
    expect(lancamentosSemIncertos(lancamentos, false).map((item) => item.id)).toEqual([2, 3, 4]);
  });
});

describe("lançamento incerto no relatório", () => {
  const opcoes: OpcoesRelatorio = { inicio: "2026-01-01", fim: "2026-12-31", contaIds: [], secoes: SECOES_RELATORIO.map((secao) => secao.id) };
  // A "Freela" pendente do cenário (id 8) marcada como incerta.
  const comIncerto = montarRelatorio({ ...cenario, transacoes: cenario.transacoes.map((t) => (t.id === 8 ? { ...t, incerta: true } : t)) }, opcoes);
  const semIncerto = montarRelatorio(cenario, opcoes);
  const situacoes = (blocos: BlocoRelatorio[], titulo: string) => {
    const tabela = tabelasDoRelatorio(blocos).find((t) => t.titulo.startsWith(titulo));
    const indice = tabela?.colunas.findIndex((c) => c.titulo === "Situação") ?? -1;
    return (tabela?.linhas ?? []).map((linha) => [linha[1], linha[indice]]);
  };

  it("mostra \"· incerto\" na situação só do lançamento marcado, nas receitas e nas pendências", () => {
    const pendencias = situacoes(comIncerto, "Pendências");
    expect(pendencias.filter(([, situacao]) => String(situacao).endsWith("· incerto"))).toEqual([["Freela", "Atrasado · incerto"]]);
    const receitas = tabelasDoRelatorio(comIncerto).find((t) => t.titulo === "Receitas");
    expect(receitas?.linhas.some((linha) => linha.includes("Atrasado · incerto"))).toBe(true);
    expect(comIncerto.some((bloco) => bloco.tipo === "nota" && bloco.texto.startsWith("“Incerto” marca o lançamento"))).toBe(true);
    expect(semIncerto.some((bloco) => bloco.tipo === "nota" && bloco.texto.startsWith("“Incerto” marca o lançamento"))).toBe(false);
  });

  it("não muda nenhum número do relatório", () => {
    const numeros = (blocos: BlocoRelatorio[]) => JSON.stringify([
      tabelasDoRelatorio(blocos).map((tabela) => tabela.linhas.map((linha) => linha.filter((celula) => typeof celula === "number"))),
      blocos.flatMap((bloco) => (bloco.tipo === "indicadores" ? bloco.itens.map((item) => item.valor) : [])),
    ]);
    expect(numeros(comIncerto)).toBe(numeros(semIncerto));
  });
});

describe("lançamento incerto nas telas", () => {
  it("site: Fluxo com o filtro e Histórico com etiqueta, filtro, criação e edição", () => {
    const filtros = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/report-filters.tsx"), "utf8");
    expect(filtros).toContain("<strong>Considerar incertos</strong>");
    // Roxo, como a opção no lançamento (mais específico que o laranja dos atrasados).
    const estilos = readFileSync(join(raiz, "web/src/app/(dashboard)/relatorios/relatorios.module.css"), "utf8");
    expect(estilos).toMatch(/\.overdueToggle\.uncertainToggle \{\s*--overdue: var\(--color-purple\);/);
    const historico = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/transaction-manager.tsx"), "utf8");
    expect(historico).toContain('{ value: "uncertain", label: "Incertos" }');
    expect(historico).toContain("{!recurring && kind !== \"transferencia\" && status === \"pendente\" && <UncertainToggle");
    expect(historico).toContain("{canBeUncertain && <UncertainToggle");
    const acoes = readFileSync(join(raiz, "web/src/app/(dashboard)/transacoes/actions.ts"), "utf8");
    expect(acoes).toContain('supabase.from("transacoes").update({ incerta: uncertain })');
  });

  it("relatório: sem filtro, só a marcação \"incerto\" na situação (receitas, despesas e pendências)", () => {
    const relatorio = readFileSync(join(raiz, "web/src/lib/relatorio.ts"), "utf8");
    expect(relatorio).toContain('situacaoTexto[situacaoDoLancamento(t, hoje)] + (estaIncerto(t) ? MARCA_INCERTO : "")');
    expect(relatorio).toContain('situacaoTexto[item.situacao] + (item.incerto ? MARCA_INCERTO : "")');
    const analise = readFileSync(join(raiz, "web/src/lib/relatorio-analise.ts"), "utf8");
    expect(analise).toContain("incerto: estaIncerto(transacao),");
    const pagina = readFileSync(join(raiz, "web/src/app/(dashboard)/exportar/page.tsx"), "utf8");
    expect(pagina).toContain("data_realizacao, status, incerta");
  });

  it("app: Fluxo com o filtro e Histórico com etiqueta, filtro, criação e edição", () => {
    const fluxo = readFileSync(join(raiz, "app/(tabs)/relatorios.tsx"), "utf8");
    expect(fluxo).toContain("lancamentosSemIncertos(lancamentosDoFluxo(transacoesFiltradas, considerarAtrasados, hojeIso), considerarIncertos)");
    const historico = readFileSync(join(raiz, "app/(tabs)/transacoes.tsx"), "utf8");
    expect(historico).toContain('{ key: "incertos", label: "Incertos" }');
    expect(historico).toContain("{podeSerIncerta(transacaoEditando) && !pago && (");
    const inicio = readFileSync(join(raiz, "app/(tabs)/index.tsx"), "utf8");
    expect(inicio).toContain("idDoLancamentoCriado(resultado.result)");
  });
});
