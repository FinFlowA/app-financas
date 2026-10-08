"use client";

import { useMemo, useState } from "react";
import {
  dataBr,
  linhasPorSecao,
  montarRelatorio,
  SECOES_RELATORIO,
  type DadosRelatorio,
  type OpcoesRelatorio,
  type SecaoRelatorio,
  type SituacaoFiltro,
  type TipoFiltro,
} from "@/lib/relatorio";
import { PeriodNavigator, rangeLabel, type HistoryRange } from "../transacoes/month-picker";
import { addIsoDays, monthTitle, shiftMonth } from "../transacoes/transaction-model";

function ultimoDia(mes: string): string {
  const [ano, numero] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(ano, numero, 0)).getUTCDate()).padStart(2, "0")}`;
}

const diasEntre = (inicio: string, fim: string) => (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000 + 1;

const chip = (ativo: boolean) => `ff-focus shrink-0 rounded-full border px-4 py-2 text-xs font-extrabold transition ${ativo ? "border-primary bg-primary text-white shadow-[0_8px_18px_rgba(22,150,110,0.2)]" : "border-border bg-surface text-foreground-muted hover:border-primary/35 hover:text-foreground"}`;
const rotulo = "mb-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-foreground-muted";

const TIPOS: { valor: TipoFiltro; texto: string }[] = [
  { valor: "todos", texto: "Todos" },
  { valor: "receita", texto: "Receitas" },
  { valor: "despesa", texto: "Despesas" },
];
const SITUACOES: { valor: SituacaoFiltro; texto: string }[] = [
  { valor: "concluido", texto: "Concluído" },
  { valor: "a_vencer", texto: "A vencer" },
  { valor: "atrasado", texto: "Atrasado" },
];
const GRUPOS_DE_SECOES = [
  { grupo: "analise", titulo: "Análise", dica: "Saldos, resultado, evolução e projeção" },
  { grupo: "detalhe", titulo: "Detalhamento", dica: "As listas de lançamentos" },
] as const;

const alternar = <T,>(lista: T[], valor: T) => (lista.includes(valor) ? lista.filter((item) => item !== valor) : [...lista, valor]);

export default function ReportBuilder({ dados, mesAtual }: { dados: DadosRelatorio; mesAtual: string }) {
  const [mes, setMes] = useState(mesAtual);
  const [periodo, setPeriodo] = useState<HistoryRange | null>(null);
  const [contaIds, setContaIds] = useState<number[]>([]);
  const [secoes, setSecoes] = useState<SecaoRelatorio[]>(SECOES_RELATORIO.map((secao) => secao.id));
  const [tipo, setTipo] = useState<TipoFiltro>("todos");
  const [situacoes, setSituacoes] = useState<SituacaoFiltro[]>([]);
  const [categoriaIds, setCategoriaIds] = useState<number[]>([]);
  const [cartaoIds, setCartaoIds] = useState<number[]>([]);
  const [maiores, setMaiores] = useState(10);
  const [gerando, setGerando] = useState<"pdf" | "excel" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const inicio = periodo?.start ?? `${mes}-01`;
  const fim = periodo?.end ?? ultimoDia(mes);
  const dias = diasEntre(inicio, fim);
  const opcoes = useMemo<Omit<OpcoesRelatorio, "secoes">>(
    () => ({ inicio, fim, contaIds, tipo, situacoes, categoriaIds, cartaoIds, maiores }),
    [cartaoIds, categoriaIds, contaIds, fim, inicio, maiores, situacoes, tipo],
  );
  // Contagem de linhas com todas as seções, para mostrar ao lado de cada uma.
  const contagem = useMemo(
    () => linhasPorSecao(montarRelatorio(dados, { ...opcoes, secoes: SECOES_RELATORIO.map((secao) => secao.id) })),
    [dados, opcoes],
  );
  const contasAtivas = dados.contas.filter((conta) => !conta.arquivado);
  const cartoes = dados.cartoes.filter((cartao) => cartao.ativo || dados.itensFatura.some((item) => item.cartao_id === cartao.id));
  const categorias = [...dados.categorias].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  const filtrosAtivos = tipo !== "todos" || situacoes.length > 0 || categoriaIds.length > 0 || cartaoIds.length > 0;
  const resumoContas = contaIds.length === 0
    ? "Todas as contas"
    : dados.contas.filter((conta) => contaIds.includes(conta.id)).map((conta) => conta.nome).join(", ");

  function textoDosFiltros(): string {
    const partes: string[] = [];
    if (tipo !== "todos") partes.push(`Tipo: ${TIPOS.find((item) => item.valor === tipo)?.texto}`);
    if (situacoes.length) partes.push(`Situação: ${SITUACOES.filter((item) => situacoes.includes(item.valor)).map((item) => item.texto).join(", ")}`);
    if (categoriaIds.length) {
      const nomes = categorias.filter((categoria) => categoriaIds.includes(categoria.id)).map((categoria) => categoria.nome);
      partes.push(`Categorias: ${nomes.slice(0, 4).join(", ")}${nomes.length > 4 ? ` e mais ${nomes.length - 4}` : ""}`);
    }
    if (cartaoIds.length) partes.push(`Cartões: ${cartoes.filter((cartao) => cartaoIds.includes(cartao.id)).map((cartao) => cartao.nome).join(", ")}`);
    return partes.length ? partes.join(" · ") : "nenhum";
  }

  function andar(delta: number) {
    if (!periodo) {
      setMes(shiftMonth(mes, delta));
      return;
    }
    // Com período de/até, as setas andam o mesmo número de dias do período.
    setPeriodo({ start: addIsoDays(periodo.start, delta * dias), end: addIsoDays(periodo.end, delta * dias) });
  }

  function limparFiltros() {
    setTipo("todos");
    setSituacoes([]);
    setCategoriaIds([]);
    setCartaoIds([]);
  }

  async function gerar(formato: "pdf" | "excel") {
    if (gerando || secoes.length === 0) return;
    setGerando(formato);
    setErro(null);
    try {
      const blocos = montarRelatorio(dados, { ...opcoes, secoes });
      const cabecalho = {
        periodo: `${dataBr(inicio)} a ${dataBr(fim)}`,
        contas: resumoContas,
        filtros: textoDosFiltros(),
        geradoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }),
      };
      const nome = `finflow-relatorio_${inicio}_a_${fim}`;
      const [arquivos, desenho] = await Promise.all([import("@/lib/relatorio-arquivos"), import("@/lib/relatorio-graficos")]);
      const graficos = await desenho.desenharGraficos(blocos);
      if (formato === "pdf") await arquivos.baixarPdf(blocos, cabecalho, `${nome}.pdf`, graficos);
      else await arquivos.baixarExcel(blocos, cabecalho, `${nome}.xlsx`, graficos);
    } catch {
      setErro("Não foi possível gerar o arquivo agora. Tente novamente.");
    } finally {
      setGerando(null);
    }
  }

  return <div className="w-full">
    <header className="ff-page-hero mb-5 px-5 py-6 sm:px-7 sm:py-7">
      <div aria-hidden="true" className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10" />
      <div className="relative">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mint">Exportação</p>
        <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Relatórios</h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/72">Escolha o período, as contas e o que entra no relatório. O PDF e o Excel trazem a análise (saldo, resultado, evolução mês a mês, projeção, categorias e cartões) e o detalhamento dos lançamentos.</p>
      </div>
    </header>

    {/* O período é a primeira escolha: fica em destaque, com as datas exatas à vista. */}
    <section aria-labelledby="relatorio-periodo" className="ff-card mb-4 p-4 sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <h2 id="relatorio-periodo" className="text-[11px] font-extrabold uppercase tracking-[.14em] text-primary-dark">Período do relatório</h2>
          <p className="mt-1 text-xl font-black tracking-tight text-foreground sm:text-2xl">{dataBr(inicio)} a {dataBr(fim)}</p>
          <p className="mt-1 text-xs text-foreground-muted">{dias} {dias === 1 ? "dia" : "dias"}. Clique no seletor para escolher outro mês ou um período de/até.</p>
        </div>
        <PeriodNavigator
          size="lg"
          month={mes}
          currentMonth={mesAtual}
          label={periodo ? "Personalizado" : monthTitle(mes)}
          onChange={(proximo) => { setMes(proximo); setPeriodo(null); }}
          range={periodo}
          onRangeChange={setPeriodo}
          onStep={andar}
        />
      </div>
    </section>

    <section className="ff-card mb-4 p-4 sm:p-5">
      <p className={rotulo}>Contas</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Contas do relatório">
        <button type="button" aria-pressed={contaIds.length === 0} onClick={() => setContaIds([])} className={chip(contaIds.length === 0)}>Todas</button>
        {contasAtivas.map((conta) => <button key={conta.id} type="button" aria-pressed={contaIds.includes(conta.id)} onClick={() => setContaIds((atuais) => alternar(atuais, conta.id))} className={chip(contaIds.includes(conta.id))}>{conta.nome}</button>)}
      </div>
      {contaIds.length > 0 && <p className="mt-2 text-xs text-foreground-muted">Com contas escolhidas, faturas e compras do cartão ficam de fora (não pertencem a uma conta), e o pagamento da fatura conta como despesa da conta que pagou.</p>}
    </section>

    <section aria-labelledby="relatorio-filtros" className="ff-card mb-4 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="relatorio-filtros" className="text-[10px] font-extrabold uppercase tracking-[.14em] text-foreground-muted">Filtros</h2>
        {filtrosAtivos && <button type="button" onClick={limparFiltros} className="ff-focus rounded-full border border-border px-3 py-1.5 text-xs font-extrabold text-primary transition hover:bg-primary-soft">Limpar filtros</button>}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <p className={rotulo}>Tipo</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tipo de lançamento">
            {TIPOS.map((item) => <button key={item.valor} type="button" aria-pressed={tipo === item.valor} onClick={() => setTipo(item.valor)} className={chip(tipo === item.valor)}>{item.texto}</button>)}
          </div>
        </div>
        <div>
          <p className={rotulo}>Situação <span className="font-semibold normal-case tracking-normal">(nenhuma marcada = todas)</span></p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Situação dos lançamentos">
            {SITUACOES.map((item) => <button key={item.valor} type="button" aria-pressed={situacoes.includes(item.valor)} onClick={() => setSituacoes((atuais) => alternar(atuais, item.valor))} className={chip(situacoes.includes(item.valor))}>{item.texto}</button>)}
          </div>
        </div>
        {cartoes.length > 0 && <div>
          <p className={rotulo}>Cartões</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Cartões do relatório">
            <button type="button" aria-pressed={cartaoIds.length === 0} onClick={() => setCartaoIds([])} className={chip(cartaoIds.length === 0)}>Todos</button>
            {cartoes.map((cartao) => <button key={cartao.id} type="button" aria-pressed={cartaoIds.includes(cartao.id)} onClick={() => setCartaoIds((atuais) => alternar(atuais, cartao.id))} className={chip(cartaoIds.includes(cartao.id))}>{cartao.nome}</button>)}
          </div>
        </div>}
        <div>
          <p className={rotulo}>Maiores despesas e receitas</p>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quantos itens no ranking">
            {[5, 10].map((quantidade) => <button key={quantidade} type="button" aria-pressed={maiores === quantidade} onClick={() => setMaiores(quantidade)} className={chip(maiores === quantidade)}>Top {quantidade}</button>)}
          </div>
        </div>
        <details className="group rounded-xl border border-border bg-surface-muted/60 lg:col-span-2">
          <summary className="ff-focus flex cursor-pointer list-none items-center justify-between gap-3 rounded-xl px-3.5 py-3 text-sm font-bold text-foreground">
            <span>Categorias: <span className="text-primary-dark">{categoriaIds.length === 0 ? "todas" : `${categoriaIds.length} ${categoriaIds.length === 1 ? "escolhida" : "escolhidas"}`}</span></span>
            <span aria-hidden="true" className="text-xs text-primary transition group-open:rotate-180">⌄</span>
          </summary>
          <div className="grid gap-3 border-t border-border p-3.5 sm:grid-cols-3">
            {(["receita", "despesa", "ambos"] as const).map((grupo) => {
              const doGrupo = categorias.filter((categoria) => categoria.tipo === grupo);
              if (doGrupo.length === 0) return null;
              return <fieldset key={grupo} className="min-w-0">
                <legend className={rotulo}>{grupo === "receita" ? "Receitas" : grupo === "despesa" ? "Despesas" : "Receitas e despesas"}</legend>
                <div className="grid gap-1.5">
                  {doGrupo.map((categoria) => <label key={categoria.id} className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input type="checkbox" checked={categoriaIds.includes(categoria.id)} onChange={() => setCategoriaIds((atuais) => alternar(atuais, categoria.id))} className="h-4 w-4 shrink-0 accent-primary" />
                    <span className="truncate">{categoria.nome}</span>
                  </label>)}
                </div>
              </fieldset>;
            })}
            {categoriaIds.length > 0 && <button type="button" onClick={() => setCategoriaIds([])} className="ff-focus justify-self-start rounded-full border border-border px-3 py-1.5 text-xs font-extrabold text-primary transition hover:bg-primary-soft sm:col-span-3">Todas as categorias</button>}
          </div>
        </details>
      </div>
      {filtrosAtivos && <p className="mt-3 text-xs text-foreground-muted">Os filtros mudam receitas, despesas e listas. Saldos e projeção continuam mostrando o dinheiro real das contas.</p>}
    </section>

    <section className="ff-card mb-4 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-foreground-muted">O que entra no relatório</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setSecoes(SECOES_RELATORIO.map((secao) => secao.id))} className="ff-focus rounded-full border border-border px-3 py-1.5 text-xs font-extrabold text-primary transition hover:bg-primary-soft">Marcar tudo</button>
          <button type="button" onClick={() => setSecoes([])} className="ff-focus rounded-full border border-border px-3 py-1.5 text-xs font-extrabold text-foreground-muted transition hover:bg-surface-muted">Desmarcar tudo</button>
        </div>
      </div>
      <div className="grid gap-4">
        {GRUPOS_DE_SECOES.map(({ grupo, titulo, dica }) => <fieldset key={grupo}>
          <legend className="mb-2 text-sm font-black text-foreground">{titulo} <span className="text-xs font-semibold text-foreground-muted">· {dica}</span></legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {SECOES_RELATORIO.filter((secao) => secao.grupo === grupo).map((secao) => {
              const marcada = secoes.includes(secao.id);
              const linhas = contagem.get(secao.id) ?? 0;
              return <label key={secao.id} className={`ff-focus flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-bold transition ${marcada ? "border-primary bg-primary-soft text-primary-dark" : "border-border bg-surface-muted text-foreground hover:border-primary/45"}`}>
                <input type="checkbox" checked={marcada} onChange={() => setSecoes((atuais) => alternar(atuais, secao.id))} className="h-5 w-5 shrink-0 accent-primary" />
                <span className="flex-1">{secao.titulo}</span>
                <span className="text-xs font-semibold text-foreground-muted">{linhas} {linhas === 1 ? "linha" : "linhas"}</span>
              </label>;
            })}
          </div>
        </fieldset>)}
      </div>
    </section>

    <section className="ff-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="text-sm text-foreground-muted">
        <p><strong className="text-foreground">{periodo ? rangeLabel(periodo) : monthTitle(mes)}</strong> · {resumoContas}{filtrosAtivos ? " · com filtros" : ""}</p>
        <p className="mt-0.5 text-xs">{secoes.length === 0 ? "Marque ao menos uma parte do relatório." : `${secoes.length} ${secoes.length === 1 ? "parte" : "partes"} no relatório. O arquivo é gerado no seu navegador.`}</p>
        {erro && <p role="alert" className="mt-1 text-xs font-semibold text-red">{erro}</p>}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        <button type="button" disabled={secoes.length === 0 || gerando !== null} onClick={() => void gerar("pdf")} className="ff-focus rounded-full border border-primary px-5 py-3 text-sm font-extrabold text-primary transition hover:bg-primary-soft disabled:opacity-50">{gerando === "pdf" ? "Gerando..." : "Gerar PDF"}</button>
        <button type="button" disabled={secoes.length === 0 || gerando !== null} onClick={() => void gerar("excel")} className="ff-focus rounded-full bg-primary px-5 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.2)] transition hover:bg-primary-dark disabled:opacity-50">{gerando === "excel" ? "Gerando..." : "Gerar Excel"}</button>
      </div>
    </section>
  </div>;
}
