"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatarReais } from "@/lib/format";
import { invoicePurchasesInMonth } from "@/lib/invoices";
import {
  calcularSaldosPorConta,
  dataEfetivaTransacao,
  isMovimentoObjetivo,
  isPagamentoFatura,
  resumirFluxoMensal,
  transacoesNoEscopo,
} from "@/lib/transacoes";
import type { Categoria, Conta, FaturaItem, Transacao } from "@/lib/types";

type Props = {
  userId: string;
  month: string;
  today: string;
  accounts: Conta[];
  transactions: Transacao[];
  categories: Categoria[];
  invoiceItems: FaturaItem[];
};

function monthTitle(month: string) {
  const [year, number] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" })
    .format(new Date(Date.UTC(year, number - 1, 10)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function endOfMonth(month: string) {
  const [year, number] = month.split("-").map(Number);
  return `${month}-${String(new Date(Date.UTC(year, number, 0)).getUTCDate()).padStart(2, "0")}`;
}

function SummaryValue({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "income" | "expense" | "neutral" }) {
  return <div><p className="text-[11px] font-bold uppercase tracking-wide text-foreground-muted">{label}</p><p data-private-value="true" className={`mt-1 text-lg font-extrabold ${tone === "income" ? "text-primary" : tone === "expense" ? "text-red" : "text-foreground"}`}>{formatarReais(value)}</p></div>;
}

export default function HomeDashboard({ userId, month, today, accounts, transactions, categories, invoiceItems }: Props) {
  const activeAccounts = useMemo(() => accounts.filter((account) => !account.arquivado), [accounts]);
  const activeIds = useMemo(() => new Set(activeAccounts.map((account) => account.id)), [activeAccounts]);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => activeAccounts.map((account) => account.id));
  const [draftIds, setDraftIds] = useState<number[]>(() => activeAccounts.map((account) => account.id));
  const [selectorOpen, setSelectorOpen] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`finflow:web:home-accounts:${userId}`);
      const saved = raw ? JSON.parse(raw) : null;
      if (!Array.isArray(saved)) return;
      const valid = saved.map(Number).filter((id) => activeIds.has(id));
      if (valid.length) {
        // Sincronização intencional com a preferência persistida fora do React.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setSelectedIds(valid);
        setDraftIds(valid);
      }
    } catch { /* Preferência inválida: mantém todas as contas. */ }
  }, [activeIds, userId]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedAccounts = useMemo(() => activeAccounts.filter((account) => selectedSet.has(account.id)), [activeAccounts, selectedSet]);
  const scoped = useMemo(() => transacoesNoEscopo(transactions, selectedSet, selectedAccounts.length), [selectedAccounts.length, selectedSet, transactions]);
  const allActiveSelected = selectedIds.length === activeAccounts.length && activeAccounts.every((account) => selectedSet.has(account.id));

  const calculations = useMemo(() => {
    const balances = calcularSaldosPorConta(activeAccounts, transactions);
    const currentBalance = selectedAccounts.reduce((sum, account) => sum + (balances.get(account.id) ?? Number(account.saldo_inicial)), 0);
    const monthEnd = endOfMonth(month);
    let predictedBalance = selectedAccounts.reduce((sum, account) => sum + Number(account.saldo_inicial), 0);
    const byCategory = new Map<number | null, { realized: number; expected: number }>();
    const monthFinancialTransactions: Transacao[] = [];

    for (const transaction of scoped) {
      const value = Number(transaction.valor);
      if (!Number.isFinite(value)) continue;
      const effectiveDate = dataEfetivaTransacao(transaction).slice(0, 10);
      if ((transaction.status === "paga" || transaction.status === "pendente") && effectiveDate && effectiveDate <= monthEnd) {
        predictedBalance += transaction.tipo === "receita" ? value : -value;
      }
      if (!effectiveDate.startsWith(month)) continue;
      // Transferências internas já foram anuladas por transacoesNoEscopo.
      // Quando cruzam a seleção, representam entrada/saída nesta visão.
      if (isMovimentoObjetivo(transaction.descricao)) continue;
      if (allActiveSelected && isPagamentoFatura(transaction.descricao)) continue;
      monthFinancialTransactions.push(transaction);
      const aggregate = byCategory.get(transaction.categoria_id) ?? { realized: 0, expected: 0 };
      aggregate.expected += transaction.tipo === "despesa" ? value : 0;
      if (transaction.tipo === "despesa" && transaction.status === "paga") aggregate.realized += value;
      byCategory.set(transaction.categoria_id, aggregate);
    }

    // Compras no cartão não possuem conta bancária vinculada. Elas entram
    // apenas quando a Home representa todas as contas ativas; numa seleção
    // parcial, o pagamento da fatura continua sendo a saída atribuível à conta.
    // Na visão consolidada, o pagamento é ignorado acima e a compra é
    // contabilizada uma única vez, na data em que ocorreu e em sua categoria.
    if (allActiveSelected) {
      for (const item of invoicePurchasesInMonth(invoiceItems, month)) {
        const value = Number(item.valor);
        if (!Number.isFinite(value)) continue;
        const aggregate = byCategory.get(item.categoria_id) ?? { realized: 0, expected: 0 };
        aggregate.realized += value;
        aggregate.expected += value;
        byCategory.set(item.categoria_id, aggregate);
      }
    }
    const monthSummary = resumirFluxoMensal(monthFinancialTransactions);
    return {
      currentBalance,
      income: monthSummary.receitas,
      expense: monthSummary.despesas,
      monthBalance: monthSummary.balancoRealizado,
      predictedBalance,
      byCategory,
      balances,
    };
  }, [activeAccounts, allActiveSelected, invoiceItems, month, scoped, selectedAccounts, transactions]);

  const alerts = useMemo(() => {
    const result = { overdue: 0, today: 0, next: 0 };
    const nextDate = new Date(`${today}T12:00:00-03:00`);
    nextDate.setDate(nextDate.getDate() + 7);
    const nextIso = nextDate.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    for (const transaction of scoped) {
      if (transaction.status !== "pendente") continue;
      if (transaction.data_vencimento < today) result.overdue += 1;
      else if (transaction.data_vencimento === today) result.today += 1;
      else if (transaction.data_vencimento <= nextIso) result.next += 1;
    }
    return result;
  }, [scoped, today]);

  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const categoryRows = [...calculations.byCategory.entries()]
    .filter(([, values]) => values.expected > 0)
    .sort((a, b) => b[1].expected - a[1].expected)
    .slice(0, 5);

  function applySelection() {
    if (!draftIds.length) return;
    setSelectedIds(draftIds);
    localStorage.setItem(`finflow:web:home-accounts:${userId}`, JSON.stringify(draftIds));
    setSelectorOpen(false);
  }

  return <div className="mx-auto max-w-6xl">
    <section className="relative overflow-hidden rounded-ff-lg bg-gradient-to-br from-primary-dark via-primary to-mint p-5 text-white shadow-lg sm:p-7">
      <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full border-[46px] border-white/8" /><div className="absolute -bottom-32 left-1/3 h-64 w-96 rounded-[50%] bg-white/8" />
      <div className="relative flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-bold text-white/75">Saldo geral das contas selecionadas</p><p data-private-value="true" className="mt-1 text-4xl font-black sm:text-5xl">{formatarReais(calculations.currentBalance)}</p><p data-private-value="true" className={`mt-2 text-sm font-bold ${calculations.predictedBalance < 0 ? "text-red-200" : "text-white/75"}`}>Saldo previsto no fim do mês: {formatarReais(calculations.predictedBalance)}</p></div>
        <button type="button" onClick={() => { setDraftIds(selectedIds); setSelectorOpen((value) => !value); }} className="ff-focus rounded-full border border-white/30 bg-black/10 px-4 py-2 text-sm font-bold backdrop-blur">{selectedAccounts.length} {selectedAccounts.length === 1 ? "conta" : "contas"}</button></div>
      {selectorOpen && <div className="relative mt-5 rounded-ff-md bg-surface p-4 text-foreground shadow-xl"><div className="flex items-center justify-between"><h2 className="font-extrabold">Contas desta visão</h2><Link href="/contas" className="text-xs font-bold text-primary">Gerenciar contas</Link></div><div className="mt-3 grid gap-2 sm:grid-cols-2">{activeAccounts.map((account) => <label key={account.id} className="flex items-center gap-3 rounded-ff-sm border border-border p-3"><input type="checkbox" checked={draftIds.includes(account.id)} onChange={() => setDraftIds((ids) => ids.includes(account.id) ? ids.filter((id) => id !== account.id) : [...ids, account.id])} /><span className="h-3 w-3 rounded-full" style={{ background: account.cor }} /><span className="font-semibold">{account.nome}</span></label>)}</div><button type="button" disabled={!draftIds.length} onClick={applySelection} className="mt-4 w-full rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Aplicar seleção</button></div>}
    </section>

    <section className="relative z-10 -mt-2 grid grid-cols-2 gap-3 rounded-ff-lg border border-border bg-surface p-4 shadow-md sm:-mt-5 sm:grid-cols-4">
      <Link href="/transacoes?new=1" className="ff-focus rounded-ff-md bg-primary-soft p-4 text-center font-extrabold text-primary-dark">↔<span className="mt-1 block text-xs">Transação</span></Link>
      <Link href="/categorias" className="ff-focus rounded-ff-md bg-blue/10 p-4 text-center font-extrabold text-blue">◕<span className="mt-1 block text-xs">Categorias</span></Link>
      <Link href="/cartoes" className="ff-focus rounded-ff-md bg-red/10 p-4 text-center font-extrabold text-red">▣<span className="mt-1 block text-xs">Cartões</span></Link>
      <Link href="/assistente" className="ff-focus rounded-ff-md bg-purple/10 p-4 text-center font-extrabold text-purple">✦<span className="mt-1 block text-xs">IA</span></Link>
    </section>

    <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_1fr]">
      <div className="grid gap-5">
        <section className="ff-card p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-extrabold">Visão do mês</h2><div className="flex items-center gap-2"><Link href={`/?month=${shiftMonth(month, -1)}`} aria-label="Mês anterior" className="ff-focus rounded-full border border-border px-3 py-1.5 font-bold">‹</Link><span className="min-w-32 text-center text-sm font-bold">{monthTitle(month)}</span><Link href={`/?month=${shiftMonth(month, 1)}`} aria-label="Próximo mês" className="ff-focus rounded-full border border-border px-3 py-1.5 font-bold">›</Link></div></div><div className="mt-5 grid grid-cols-3 gap-3"><SummaryValue label="Entradas" value={calculations.income} tone="income" /><SummaryValue label="Balanço atual" value={calculations.monthBalance} /><SummaryValue label="Saídas" value={calculations.expense} tone="expense" /></div></section>
        <section className="ff-card p-5"><div className="flex items-center justify-between"><h2 className="font-extrabold">Gastos por categoria</h2><Link href="/relatorios" className="text-xs font-bold text-primary">Ver detalhes</Link></div><div className="mt-4 grid gap-4">{categoryRows.map(([categoryId, values]) => { const category = categoryId ? categoriesById.get(categoryId) : undefined; const maximum = Math.max(...categoryRows.map(([, row]) => row.expected), 1); return <div key={categoryId ?? "none"}><div className="flex justify-between gap-3 text-sm"><span className="font-semibold">{category?.nome ?? "Sem categoria"}</span><span data-private-value="true" className="font-bold">{formatarReais(values.realized)} <span className="font-normal text-foreground-muted">de {formatarReais(values.expected)}</span></span></div><div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-muted"><div className="h-full rounded-full" style={{ width: `${Math.max(3, (values.realized / maximum) * 100)}%`, background: category?.cor ?? "#6C7D77" }} /></div></div>; })}{!categoryRows.length && <p className="text-sm text-foreground-muted">Nenhuma despesa neste mês.</p>}</div></section>
      </div>

      <div className="grid content-start gap-5">
        <section className="ff-card p-5"><div className="flex items-center justify-between"><h2 className="font-extrabold">Avisos</h2><span className={`h-2.5 w-2.5 rounded-full ${alerts.overdue + alerts.today + alerts.next > 0 ? "bg-red" : "bg-primary"}`} /></div><div className="mt-4 grid gap-2"><Link href="/transacoes?quick=overdue" className="flex justify-between rounded-ff-sm bg-surface-muted p-3 text-sm"><span>Atrasados</span><strong className={alerts.overdue ? "text-red" : "text-foreground-muted"}>{alerts.overdue}</strong></Link><Link href="/transacoes?quick=today" className="flex justify-between rounded-ff-sm bg-surface-muted p-3 text-sm"><span>Vencendo hoje</span><strong>{alerts.today}</strong></Link><Link href="/transacoes?quick=next7" className="flex justify-between rounded-ff-sm bg-surface-muted p-3 text-sm"><span>Próximos 7 dias</span><strong>{alerts.next}</strong></Link></div></section>
        <section className="ff-card p-5"><div className="flex items-center justify-between"><h2 className="font-extrabold">Contas selecionadas</h2><Link href="/contas" className="text-xs font-bold text-primary">Gerenciar</Link></div><div className="mt-4 grid gap-3">{selectedAccounts.map((account) => <div key={account.id} className="rounded-ff-md p-4 text-white" style={{ background: account.cor }}><p className="text-sm font-semibold text-white/85">{account.nome}</p><p data-private-value="true" className="mt-1 text-xl font-extrabold">{formatarReais(calculations.balances.get(account.id) ?? Number(account.saldo_inicial))}</p></div>)}{!selectedAccounts.length && <p className="text-sm text-foreground-muted">Selecione ao menos uma conta.</p>}</div></section>
      </div>
    </div>
  </div>;
}
