"use client";

import { useMemo, useState } from "react";
import { dataBr, montarRelatorio, SECOES_RELATORIO, type DadosRelatorio, type SecaoRelatorio } from "@/lib/relatorio";
import { PeriodNavigator, rangeLabel, type HistoryRange } from "../transacoes/month-picker";
import { addIsoDays, monthTitle, shiftMonth } from "../transacoes/transaction-model";

function ultimoDia(mes: string): string {
  const [ano, numero] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(ano, numero, 0)).getUTCDate()).padStart(2, "0")}`;
}

const diasEntre = (inicio: string, fim: string) => (Date.parse(`${fim}T00:00:00Z`) - Date.parse(`${inicio}T00:00:00Z`)) / 86_400_000 + 1;

const chip = (ativo: boolean) => `ff-focus shrink-0 rounded-full border px-4 py-2 text-xs font-extrabold transition ${ativo ? "border-primary bg-primary text-white shadow-[0_8px_18px_rgba(22,150,110,0.2)]" : "border-border bg-surface text-foreground-muted hover:border-primary/35 hover:text-foreground"}`;

export default function ReportBuilder({ dados, mesAtual }: { dados: DadosRelatorio; mesAtual: string }) {
  const [mes, setMes] = useState(mesAtual);
  const [periodo, setPeriodo] = useState<HistoryRange | null>(null);
  const [contaIds, setContaIds] = useState<number[]>([]);
  const [secoes, setSecoes] = useState<SecaoRelatorio[]>(SECOES_RELATORIO.map((secao) => secao.id));
  const [gerando, setGerando] = useState<"pdf" | "excel" | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const inicio = periodo?.start ?? `${mes}-01`;
  const fim = periodo?.end ?? ultimoDia(mes);
  const dias = diasEntre(inicio, fim);
  // Contagem de linhas com todas as seções, para mostrar ao lado de cada uma.
  const todas = useMemo(
    () => montarRelatorio(dados, { inicio, fim, contaIds, secoes: SECOES_RELATORIO.map((secao) => secao.id) }),
    [contaIds, dados, fim, inicio],
  );
  const linhasPorSecao = new Map(todas.map((tabela) => [tabela.secao, tabela.linhas.length]));
  const contasAtivas = dados.contas.filter((conta) => !conta.arquivado);
  const resumoContas = contaIds.length === 0
    ? "Todas as contas"
    : dados.contas.filter((conta) => contaIds.includes(conta.id)).map((conta) => conta.nome).join(", ");

  function andar(delta: number) {
    if (!periodo) {
      setMes(shiftMonth(mes, delta));
      return;
    }
    // Com período de/até, as setas andam o mesmo número de dias do período.
    setPeriodo({ start: addIsoDays(periodo.start, delta * dias), end: addIsoDays(periodo.end, delta * dias) });
  }

  function alternarConta(id: number) {
    setContaIds((atuais) => (atuais.includes(id) ? atuais.filter((item) => item !== id) : [...atuais, id]));
  }

  function alternarSecao(id: SecaoRelatorio) {
    setSecoes((atuais) => (atuais.includes(id) ? atuais.filter((item) => item !== id) : [...atuais, id]));
  }

  async function gerar(formato: "pdf" | "excel") {
    if (gerando || secoes.length === 0) return;
    setGerando(formato);
    setErro(null);
    try {
      const tabelas = montarRelatorio(dados, { inicio, fim, contaIds, secoes });
      const cabecalho = {
        periodo: `${dataBr(inicio)} a ${dataBr(fim)}`,
        contas: resumoContas,
        geradoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }),
      };
      const nome = `finflow-relatorio_${inicio}_a_${fim}`;
      const arquivos = await import("@/lib/relatorio-arquivos");
      if (formato === "pdf") await arquivos.baixarPdf(tabelas, cabecalho, `${nome}.pdf`);
      else await arquivos.baixarExcel(tabelas, cabecalho, `${nome}.xlsx`);
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
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/72">Escolha o período, as contas e o que entra no relatório. Cada parte vira uma tabela: na primeira linha, o que é cada coluna; embaixo, os dados.</p>
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
      <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[.14em] text-foreground-muted">Contas</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Contas do relatório">
        <button type="button" aria-pressed={contaIds.length === 0} onClick={() => setContaIds([])} className={chip(contaIds.length === 0)}>Todas</button>
        {contasAtivas.map((conta) => <button key={conta.id} type="button" aria-pressed={contaIds.includes(conta.id)} onClick={() => alternarConta(conta.id)} className={chip(contaIds.includes(conta.id))}>{conta.nome}</button>)}
      </div>
      {contaIds.length > 0 && <p className="mt-2 text-xs text-foreground-muted">Com contas escolhidas, faturas e compras do cartão ficam de fora (não pertencem a uma conta), e o pagamento da fatura conta como despesa da conta que pagou.</p>}
    </section>

    <section className="ff-card mb-4 p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-foreground-muted">O que entra no relatório</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => setSecoes(SECOES_RELATORIO.map((secao) => secao.id))} className="ff-focus rounded-full border border-border px-3 py-1.5 text-xs font-extrabold text-primary transition hover:bg-primary-soft">Marcar tudo</button>
          <button type="button" onClick={() => setSecoes([])} className="ff-focus rounded-full border border-border px-3 py-1.5 text-xs font-extrabold text-foreground-muted transition hover:bg-surface-muted">Desmarcar tudo</button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {SECOES_RELATORIO.map((secao) => {
          const marcada = secoes.includes(secao.id);
          const linhas = linhasPorSecao.get(secao.id) ?? 0;
          return <label key={secao.id} className={`ff-focus flex cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-3 text-sm font-bold transition ${marcada ? "border-primary bg-primary-soft text-primary-dark" : "border-border bg-surface-muted text-foreground hover:border-primary/45"}`}>
            <input type="checkbox" checked={marcada} onChange={() => alternarSecao(secao.id)} className="h-5 w-5 shrink-0 accent-primary" />
            <span className="flex-1">{secao.titulo}</span>
            <span className="text-xs font-semibold text-foreground-muted">{linhas} {linhas === 1 ? "linha" : "linhas"}</span>
          </label>;
        })}
      </div>
    </section>

    <section className="ff-card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="text-sm text-foreground-muted">
        <p><strong className="text-foreground">{periodo ? rangeLabel(periodo) : monthTitle(mes)}</strong> · {resumoContas}</p>
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
