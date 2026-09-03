"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import FinancialIcon from "@/components/ui/financial-icon";
import DisplayControls from "@/components/layout/display-controls";
import { formatarReais } from "@/lib/format";
import { listUpcomingTransactions } from "@/lib/home-agenda";
import { invoicePurchasesInMonth } from "@/lib/invoices";
import { homeTransactionCreationHref, type HomeTransactionKind } from "@/lib/transaction-entry";
import { calcularSaldoProjetadoPorMes } from "@/lib/saldo-projetado";
import {
  calcularSaldosPorConta,
  dataEfetivaTransacao,
  descricaoVisivel,
  isMovimentoObjetivo,
  isPagamentoFatura,
  isTransferencia,
  resumirFluxoMensal,
  transacoesNoEscopo,
} from "@/lib/transacoes";
import type { Caixinha, Categoria, Conta, FaturaItem, Transacao } from "@/lib/types";
import { NewTransactionDialog } from "./transacoes/transaction-manager";
import styles from "./home-dashboard.module.css";

type Props = {
  userId: string;
  displayName: string;
  greeting: string;
  month: string;
  today: string;
  accounts: Conta[];
  goals: Caixinha[];
  transactions: Transacao[];
  categories: Categoria[];
  invoiceItems: FaturaItem[];
};

type IconName = "arrow-left-right" | "bell" | "calendar" | "category" | "chevron" | "income" | "plus" | "receipt" | "sparkles" | "wallet";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "bell") return <svg {...common}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></svg>;
  if (name === "calendar") return <svg {...common}><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>;
  if (name === "arrow-left-right") return <svg {...common}><path d="m7 7-4 4 4 4M3 11h14M17 3l4 4-4 4M21 7H7"/></svg>;
  if (name === "income") return <svg {...common}><path d="M12 3v14M7 12l5 5 5-5M5 21h14"/></svg>;
  if (name === "receipt") return <svg {...common}><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/></svg>;
  if (name === "plus") return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
  if (name === "category") return <svg {...common}><path d="M11 3a9 9 0 1 0 9 9h-9V3Z"/><path d="M15 3.8A9 9 0 0 1 20.2 9H15V3.8Z"/></svg>;
  if (name === "sparkles") return <svg {...common}><path d="m12 3 1.2 3.8L17 8l-3.8 1.2L12 13l-1.2-3.8L7 8l3.8-1.2L12 3ZM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3ZM5 13l.8 2.5 2.5.8-2.5.8L5 19.5l-.8-2.4-2.5-.8 2.5-.8L5 13Z"/></svg>;
  if (name === "wallet") return <svg {...common}><path d="M4 6.5h14a2 2 0 0 1 2 2V19H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12"/><path d="M15 11h6v5h-6a2.5 2.5 0 0 1 0-5Z"/></svg>;
  if (name === "chevron") return <svg {...common}><path d="m9 18 6-6-6-6"/></svg>;
  return <svg {...common}><path d="M12 5v14M5 12h14"/></svg>;
}

function monthTitle(month: string, compact = false, includeYear = true) {
  const [year, number] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", {
    month: compact ? "short" : "long",
    ...(includeYear ? { year: "numeric" as const } : {}),
    timeZone: "America/Sao_Paulo",
  })
    .format(new Date(Date.UTC(year, number - 1, 10)));
  return label.charAt(0).toUpperCase() + label.slice(1).replace(".", "");
}

function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shortDate(iso: string) {
  const date = new Date(`${iso}T12:00:00-03:00`);
  return {
    day: new Intl.DateTimeFormat("pt-BR", { day: "2-digit", timeZone: "America/Sao_Paulo" }).format(date),
    month: new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "America/Sao_Paulo" }).format(date).replace(".", "").toUpperCase(),
  };
}

function safeColor(value?: string | null) {
  return value && /^(#[0-9a-f]{3,8}|rgb\([\d\s,.%]+\)|hsl\([\d\s,.%]+\))$/i.test(value) ? value : "#34a164";
}

function SummaryValue({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "income" | "expense" | "neutral" }) {
  return <div className={styles.summaryValue}>
    <p className={`${styles.summaryLabel} ${tone === "income" ? styles.incomeText : tone === "expense" ? styles.expenseText : ""}`}>{label}</p>
    <p data-private-value="true" className={`${styles.summaryAmount} ${tone === "expense" ? styles.expenseText : ""}`}>{formatarReais(value)}</p>
  </div>;
}

export default function HomeDashboard({ userId, displayName, greeting, month, today, accounts, goals, transactions, categories, invoiceItems }: Props) {
  const router = useRouter();
  const [monthPending, startMonthTransition] = useTransition();
  const [newTransactionKind, setNewTransactionKind] = useState<HomeTransactionKind | null>(null);
  const activeAccounts = useMemo(() => accounts.filter((account) => !account.arquivado), [accounts]);
  const activeIds = useMemo(() => new Set(activeAccounts.map((account) => account.id)), [activeAccounts]);
  const [selectedIds, setSelectedIds] = useState<number[]>(() => activeAccounts.map((account) => account.id));
  const [draftIds, setDraftIds] = useState<number[]>(() => activeAccounts.map((account) => account.id));
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [monthMenuOpen, setMonthMenuOpen] = useState(false);
  const [overdueOpen, setOverdueOpen] = useState(false);
  const [flowCategoryKey, setFlowCategoryKey] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<"todos" | "concluidos" | "pendentes">("todos");
  const [pickerYear, setPickerYear] = useState(() => Number(month.slice(0, 4)));
  const accountSelectorRef = useRef<HTMLDivElement>(null);
  const accountSelectorButtonRef = useRef<HTMLButtonElement>(null);
  const accountSelectorPanelRef = useRef<HTMLElement>(null);

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

  useEffect(() => {
    if (!selectorOpen && !monthMenuOpen) return;
    const closeMenus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        const shouldRestoreAccountFocus = selectorOpen;
        setSelectorOpen(false);
        setMonthMenuOpen(false);
        if (shouldRestoreAccountFocus) accountSelectorButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", closeMenus);
    return () => window.removeEventListener("keydown", closeMenus);
  }, [monthMenuOpen, selectorOpen]);

  useEffect(() => {
    if (!selectorOpen) return;
    const frame = window.requestAnimationFrame(() => accountSelectorPanelRef.current?.focus());
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountSelectorRef.current?.contains(event.target)) {
        setSelectorOpen(false);
      }
    };
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = Array.from(accountSelectorPanelRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (document.activeElement === accountSelectorPanelRef.current || !accountSelectorPanelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    window.addEventListener("keydown", trapFocus);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", closeOutside);
      window.removeEventListener("keydown", trapFocus);
    };
  }, [selectorOpen]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedAccounts = useMemo(() => activeAccounts.filter((account) => selectedSet.has(account.id)), [activeAccounts, selectedSet]);
  const scoped = useMemo(() => transacoesNoEscopo(transactions, selectedSet, selectedAccounts.length), [selectedAccounts.length, selectedSet, transactions]);
  const allActiveSelected = selectedIds.length === activeAccounts.length && activeAccounts.every((account) => selectedSet.has(account.id));

  const calculations = useMemo(() => {
    const balances = calcularSaldosPorConta(activeAccounts, transactions);
    const currentBalance = selectedAccounts.reduce((sum, account) => sum + (balances.get(account.id) ?? Number(account.saldo_inicial)), 0);
    const initialBalance = selectedAccounts.reduce((sum, account) => sum + Number(account.saldo_inicial), 0);
    const projectionYear = Number(month.slice(0, 4));
    const projectionMonthIndex = Number(month.slice(5, 7)) - 1;
    const projection = calcularSaldoProjetadoPorMes(
      initialBalance,
      scoped,
      projectionYear,
      new Date(`${today}T12:00:00-03:00`),
    );
    const predictedBalance = projection[projectionMonthIndex]?.saldo ?? currentBalance;
    const byCategory = new Map<number | null, { realized: number; expected: number }>();
    const monthFinancialTransactions: Transacao[] = [];
    let realizedIncome = 0;
    let realizedExpense = 0;

    for (const transaction of scoped) {
      const value = Number(transaction.valor);
      if (!Number.isFinite(value)) continue;
      const effectiveDate = dataEfetivaTransacao(transaction).slice(0, 10);
      if (!effectiveDate.startsWith(month)) continue;
      if (isMovimentoObjetivo(transaction.descricao)) continue;
      if (allActiveSelected && isPagamentoFatura(transaction.descricao)) continue;
      monthFinancialTransactions.push(transaction);
      if (transaction.status === "paga") {
        if (transaction.tipo === "receita") realizedIncome += value;
        else realizedExpense += value;
      }
      const aggregate = byCategory.get(transaction.categoria_id) ?? { realized: 0, expected: 0 };
      aggregate.expected += transaction.tipo === "despesa" ? value : 0;
      if (transaction.tipo === "despesa" && transaction.status === "paga") aggregate.realized += value;
      byCategory.set(transaction.categoria_id, aggregate);
    }

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
      realizedIncome,
      realizedExpense,
      byCategory,
      balances,
    };
  }, [activeAccounts, allActiveSelected, invoiceItems, month, scoped, selectedAccounts, today, transactions]);

  const nextDate = useMemo(() => {
    const date = new Date(`${today}T12:00:00-03:00`);
    date.setDate(date.getDate() + 7);
    return date.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  }, [today]);

  const alerts = useMemo(() => {
    const result = { overdue: 0, today: 0, next: 0 };
    for (const transaction of scoped) {
      if (transaction.status !== "pendente") continue;
      if (transaction.data_vencimento < today) result.overdue += 1;
      else if (transaction.data_vencimento === today) result.today += 1;
      else if (transaction.data_vencimento <= nextDate) result.next += 1;
    }
    return result;
  }, [nextDate, scoped, today]);

  const overdueTransactions = useMemo(() => scoped
    .filter((transaction) => transaction.status === "pendente" && transaction.data_vencimento < today)
    .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento)), [scoped, today]);
  const overdueSignature = overdueTransactions.map((transaction) => transaction.id).join(",");

  useEffect(() => {
    if (!overdueSignature) return;
    const key = `finflow:web:overdue-popup:${userId}:${overdueSignature}`;
    if (sessionStorage.getItem(key)) return;
    // A abertura representa estado externo da sessão, carregado após a hidratação.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOverdueOpen(true);
  }, [overdueSignature, userId]);

  useEffect(() => {
    if (!overdueOpen && flowCategoryKey === null) return;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyOverscroll = document.body.style.overscrollBehavior;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "none";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.overscrollBehavior = previousBodyOverscroll;
      document.documentElement.style.overflow = previousHtmlOverflow;
    };
  }, [flowCategoryKey, overdueOpen]);

  const categoriesById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const flowCategoryRows = useMemo(() => {
    const rows = new Map<string, { name: string; income: number; expense: number; details: { id: string; description: string; value: number; date: string; type: "receita" | "despesa" }[] }>();
    const categoryGroup = (categoryId: number | null) => {
      const name = categoryId ? categoriesById.get(categoryId)?.nome.trim() || "Sem categoria" : "Sem categoria";
      return { key: name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").replace(/\s+/g, " "), name };
    };
    for (const transaction of scoped) {
      const date = dataEfetivaTransacao(transaction).slice(0, 10);
      const value = Number(transaction.valor);
      if (!date.startsWith(month) || !Number.isFinite(value) || isMovimentoObjetivo(transaction.descricao) || isTransferencia(transaction.descricao) || (allActiveSelected && isPagamentoFatura(transaction.descricao))) continue;
      if (flowStatus === "concluidos" && transaction.status !== "paga") continue;
      if (flowStatus === "pendentes" && transaction.status !== "pendente") continue;
      const group = categoryGroup(transaction.categoria_id);
      const row = rows.get(group.key) ?? { name: group.name, income: 0, expense: 0, details: [] };
      if (transaction.tipo === "receita") row.income += value; else row.expense += value;
      row.details.push({ id: `transaction-${transaction.id}`, description: descricaoVisivel(transaction.descricao), value, date, type: transaction.tipo });
      rows.set(group.key, row);
    }
    if (allActiveSelected && flowStatus !== "pendentes") for (const item of invoicePurchasesInMonth(invoiceItems, month)) {
      const value = Number(item.valor); if (!Number.isFinite(value)) continue;
      const group = categoryGroup(item.categoria_id);
      const row = rows.get(group.key) ?? { name: group.name, income: 0, expense: 0, details: [] };
      row.expense += value;
      row.details.push({ id: `invoice-${item.id}`, description: descricaoVisivel(item.descricao), value, date: item.data_compra, type: "despesa" });
      rows.set(group.key, row);
    }
    return [...rows.entries()].filter(([, row]) => row.income + row.expense > 0).sort((a, b) => b[1].income + b[1].expense - a[1].income - a[1].expense).slice(0, 7);
  }, [allActiveSelected, categoriesById, flowStatus, invoiceItems, month, scoped]);
  const flowChartMax = Math.max(1, ...flowCategoryRows.flatMap(([, row]) => [row.income, row.expense]));
  const selectedFlowCategory = flowCategoryKey === null ? null : flowCategoryRows.find(([key]) => key === flowCategoryKey) ?? null;
  const selectedFlowDetails = selectedFlowCategory
    ? [...selectedFlowCategory[1].details].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    : [];
  const selectedFlowExpenses = selectedFlowDetails.filter((detail) => detail.type === "despesa");
  const selectedFlowIncome = selectedFlowDetails.filter((detail) => detail.type === "receita");
  const selectedFlowExpenseTotal = selectedFlowExpenses.reduce((sum, detail) => sum + detail.value, 0);
  const selectedFlowIncomeTotal = selectedFlowIncome.reduce((sum, detail) => sum + detail.value, 0);
  const selectedFlowBalance = selectedFlowIncomeTotal - selectedFlowExpenseTotal;
  const categoryRows = useMemo(() => [...calculations.byCategory.entries()]
    .filter(([, values]) => values.expected > 0)
    .sort((a, b) => b[1].expected - a[1].expected)
    .slice(0, 5), [calculations.byCategory]);
  const categoryTotal = categoryRows.reduce((sum, [, values]) => sum + values.expected, 0);
  const upcoming = useMemo(() => listUpcomingTransactions(scoped, today, nextDate), [nextDate, scoped, today]);

  const expectedExpenseProgress = calculations.expense > 0 ? Math.min(100, Math.max(0, (calculations.realizedExpense / calculations.expense) * 100)) : 0;
  const flowTotal = calculations.income + calculations.expense;
  const incomeShare = flowTotal > 0 ? Math.max(0, Math.min(100, (calculations.income / flowTotal) * 100)) : 0;
  const topCategory = categoryRows[0];

  function applySelection() {
    if (!draftIds.length) return;
    setSelectedIds(draftIds);
    localStorage.setItem(`finflow:web:home-accounts:${userId}`, JSON.stringify(draftIds));
    setSelectorOpen(false);
  }

  function navigateMonth(nextMonth: string) {
    setMonthMenuOpen(false);
    startMonthTransition(() => router.push(`/?month=${nextMonth}`));
  }

  function closeOverduePopup() {
    sessionStorage.setItem(`finflow:web:overdue-popup:${userId}:${overdueSignature}`, "seen");
    setOverdueOpen(false);
  }

  return <div className={`${styles.root} ${monthPending ? styles.monthPending : ""}`} aria-busy={monthPending}>
    {overdueOpen && createPortal(<div className="fixed inset-0 z-[9999] grid h-[100dvh] w-screen place-items-center overflow-hidden bg-[#02090c]/80 p-4 backdrop-blur-[5px]" role="presentation" onMouseDown={closeOverduePopup}>
      <section role="dialog" aria-modal="true" aria-labelledby="overdue-title" onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-xl flex-col overflow-hidden rounded-[25px] border border-red/25 bg-surface p-5 shadow-[0_32px_100px_rgba(0,0,0,.52)] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[.15em] text-red">Atenção financeira</p><h2 id="overdue-title" className="mt-1 text-xl font-black text-foreground">Transações atrasadas</h2><p className="mt-1 text-sm text-foreground-muted">Confira os lançamentos que já passaram da data de vencimento.</p></div><button type="button" onClick={closeOverduePopup} aria-label="Fechar" className="ff-focus grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-muted text-xl text-foreground-muted">×</button></div>
        <div className="mt-5 min-h-0 space-y-2 overflow-y-auto overscroll-contain pr-1">{overdueTransactions.map((transaction) => { const category = transaction.categoria_id ? categoriesById.get(transaction.categoria_id) : undefined; return <Link href={`/transacoes?quick=overdue&focus=${transaction.id}`} onClick={closeOverduePopup} key={transaction.id} className="ff-focus grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-xl border border-border bg-surface-muted p-3 transition hover:border-red/35">
          <span className="grid h-10 w-10 place-items-center rounded-lg bg-red/10 text-red"><Icon name={transaction.tipo === "receita" ? "income" : "receipt"} size={19}/></span>
          <span className="min-w-0"><strong className="block truncate text-sm text-foreground">{descricaoVisivel(transaction.descricao) || "Lançamento"}</strong><small className="text-xs text-foreground-muted">Venceu em {new Intl.DateTimeFormat("pt-BR").format(new Date(`${transaction.data_vencimento}T12:00:00-03:00`))} · {category?.nome ?? "Sem categoria"}</small></span>
          <strong data-private-value="true" className={transaction.tipo === "receita" ? "text-sm text-primary" : "text-sm text-red"}>{transaction.tipo === "receita" ? "+" : "−"}{formatarReais(Number(transaction.valor))}</strong>
        </Link>; })}</div>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" onClick={closeOverduePopup} className="ff-focus rounded-full border border-border px-4 py-2.5 text-sm font-bold text-foreground-muted">Ver depois</button><Link href="/transacoes?quick=overdue" onClick={closeOverduePopup} className="ff-focus rounded-full bg-red px-5 py-2.5 text-sm font-extrabold text-white">Revisar atrasos</Link></div>
      </section>
    </div>, document.body)}
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>Seu painel financeiro</p>
        <h1>{greeting}, <span>{displayName.split(/\s+/)[0]}</span></h1>
      </div>
      <div className={styles.headerControls}>
        <DisplayControls />
        <div className={styles.monthNavigator}>
          <button type="button" onClick={() => navigateMonth(shiftMonth(month, -1))} aria-label="Mês anterior">‹</button>
          <button
            type="button"
            className={styles.monthPickerButton}
            onClick={() => { setSelectorOpen(false); setPickerYear(Number(month.slice(0, 4))); setMonthMenuOpen((open) => !open); }}
            aria-expanded={monthMenuOpen}
            aria-controls="home-month-menu"
          >
            <Icon name="calendar" size={18} /> {monthTitle(month)}
          </button>
          <button type="button" onClick={() => navigateMonth(shiftMonth(month, 1))} aria-label="Próximo mês">›</button>
          {monthMenuOpen && <div id="home-month-menu" className={styles.monthMenu}>
            <div className={styles.yearNavigator}>
              <button type="button" onClick={() => setPickerYear((year) => year - 1)} aria-label="Ano anterior">‹</button>
              <strong>{pickerYear}</strong>
              <button type="button" onClick={() => setPickerYear((year) => year + 1)} aria-label="Próximo ano">›</button>
            </div>
            <div className={styles.monthGrid}>
              {Array.from({ length: 12 }, (_, index) => {
                const value = `${pickerYear}-${String(index + 1).padStart(2, "0")}`;
                return <button type="button" key={value} data-active={value === month || undefined} onClick={() => navigateMonth(value)}>{monthTitle(value, true, false)}</button>;
              })}
            </div>
          </div>}
        </div>
      </div>
    </header>

    <section className={styles.hero}>
      <svg className={styles.heroWaves} viewBox="0 0 1200 280" preserveAspectRatio="none" aria-hidden="true">
        <defs><linearGradient id="home-wave-a" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#6fcb84" stopOpacity=".58"/><stop offset="1" stopColor="#2a8552" stopOpacity=".08"/></linearGradient><linearGradient id="home-wave-b" x1="0" y1="0" x2="1" y2="0"><stop stopColor="#34a164" stopOpacity=".42"/><stop offset="1" stopColor="#123a24" stopOpacity="0"/></linearGradient></defs>
        <path className={styles.heroWavePrimary} d="M-70 55C130 12 283-38 409 39c107 65 91 151 237 142 136-9 227-135 406-126 88 4 152 38 220 91v161H-70Z" fill="url(#home-wave-a)"/>
        <path className={styles.heroWaveSecondary} d="M-30 125C165 85 258 15 405 96c113 62 177 147 333 104 137-38 227-124 484-71v178H-30Z" fill="url(#home-wave-b)"/>
        <path className={styles.heroWaveLine} d="M34 44c207-38 339 6 425 81 93 82 202 109 341 45 114-53 211-96 383-51" fill="none" stroke="#96dea4" strokeOpacity=".22"/>
      </svg>
      <div className={styles.heroBalance}>
        <div className={styles.balanceLabelRow}>
          <span>Saldo geral</span>
        </div>
        <p data-private-value="true" className={styles.balanceValue}>{formatarReais(calculations.currentBalance)}</p>
        <div className={styles.heroMeta}>
          <span data-private-value="true" className={calculations.monthBalance < 0 ? styles.negativeChip : styles.positiveChip}>
            {calculations.monthBalance >= 0 ? "↗" : "↘"} {formatarReais(Math.abs(calculations.monthBalance))} realizado no mês
          </span>
          <div ref={accountSelectorRef} className={styles.accountSelectorWrap}>
            <button ref={accountSelectorButtonRef} type="button" onClick={() => { setMonthMenuOpen(false); setDraftIds(selectedIds); setSelectorOpen((value) => !value); }} className={styles.accountSelectorButton} aria-haspopup="dialog" aria-expanded={selectorOpen} aria-controls="home-account-selector">
              <Icon name="wallet" size={17} /> {selectedAccounts.length} {selectedAccounts.length === 1 ? "conta" : "contas"} <span aria-hidden="true">⌄</span>
            </button>
            {selectorOpen && <>
              <button type="button" tabIndex={-1} className={styles.selectorBackdrop} onClick={() => setSelectorOpen(false)} aria-label="Fechar seleção de contas" />
              <section ref={accountSelectorPanelRef} id="home-account-selector" role="dialog" tabIndex={-1} className={styles.selectorPanel} aria-label="Selecionar contas desta visão">
                <div className={styles.selectorHeader}><div><p>Visão da página inicial</p><h2>Quais contas exibir?</h2></div><button type="button" onClick={() => { setSelectorOpen(false); accountSelectorButtonRef.current?.focus(); }} aria-label="Fechar seleção">×</button></div>
                <p className={styles.selectorDescription}>Esta escolha altera apenas os indicadores da tela inicial.</p>
                <div className={styles.selectorActions}><button type="button" onClick={() => setDraftIds(activeAccounts.map((account) => account.id))}>Selecionar todas</button><button type="button" onClick={() => setDraftIds([])}>Limpar</button></div>
                <div className={styles.selectorList}>{activeAccounts.map((account) => <label key={account.id}>
                  <input type="checkbox" checked={draftIds.includes(account.id)} onChange={() => setDraftIds((ids) => ids.includes(account.id) ? ids.filter((id) => id !== account.id) : [...ids, account.id])} />
                  <span className={styles.accountDot} style={{ backgroundColor: safeColor(account.cor) }} />
                  <span>{account.nome}</span>
                  <strong data-private-value="true">{formatarReais(calculations.balances.get(account.id) ?? Number(account.saldo_inicial))}</strong>
                </label>)}</div>
                {!activeAccounts.length && <Link href="/contas" className={styles.emptySelector}>Crie sua primeira conta para começar</Link>}
                <div className={styles.selectorFooter}><Link href="/contas">Gerenciar contas</Link><button type="button" disabled={!draftIds.length} onClick={applySelection}>Aplicar seleção</button></div>
              </section>
            </>}
          </div>
        </div>
      </div>

      <div className={styles.heroActions}>
        <button type="button" onClick={() => setNewTransactionKind("transferencia")} className={styles.actionLink}><span><Icon name="arrow-left-right" size={27}/></span><strong>Transferir</strong></button>
        <button type="button" onClick={() => setNewTransactionKind("despesa")} className={styles.actionLink}><span><Icon name="receipt" size={27}/></span><strong>Pagar</strong></button>
        <button type="button" onClick={() => setNewTransactionKind("receita")} className={styles.actionLink}><span><Icon name="plus" size={29}/></span><strong>Receber</strong></button>
      </div>
    </section>

    <div className={styles.dashboardGrid}>
      <div className={styles.primaryColumn}>
        <section className={`${styles.panel} ${styles.monthPanel}`}>
          <div className={styles.panelHeader}>
            <div><p className={styles.sectionKicker}>Resumo financeiro</p><h2>Visão do mês</h2></div>
            <span>{monthTitle(month)}</span>
          </div>
          <div className={styles.summaryGrid}>
            <SummaryValue label="Entradas" value={calculations.income} tone="income" />
            <SummaryValue label="Balanço atual" value={calculations.monthBalance} />
            <SummaryValue label="Saídas" value={calculations.expense} tone="expense" />
          </div>
          <div className={styles.flowBar} aria-label={flowTotal > 0 ? `${incomeShare.toFixed(0)}% do fluxo é entrada` : "Ainda não há movimentações no mês"}>
            {flowTotal > 0 ? <><span className={styles.flowIncome} style={{ width: `${incomeShare}%` }} /><span className={styles.flowExpense} style={{ width: `${100 - incomeShare}%` }} /></> : <span className={styles.flowEmpty} />}
          </div>
          <div className={styles.progressLegend}>
            <span><i className={styles.realizedLegend}/><span data-private-value="true">Realizado: {formatarReais(calculations.monthBalance)}</span></span>
            <span><i className={styles.expectedLegend}/><span data-private-value="true">Saldo previsto no fim do mês: {formatarReais(calculations.predictedBalance)}</span></span>
            <strong>{expectedExpenseProgress.toFixed(0)}% das saídas previstas realizado</strong>
          </div>
          <div className={styles.accountsHeader}><h3>Contas desta visão</h3></div>
          <div className={styles.accountsRail}>
            {selectedAccounts.map((account) => <article key={account.id} className={styles.accountCard} style={{ "--account-color": safeColor(account.cor) } as CSSProperties}>
              <span className={styles.accountIcon}><Icon name="wallet"/></span>
              <span className={styles.accountName}>{account.nome}</span>
              <small>{account.compartilhado ? "Conta compartilhada" : "Conta individual"}</small>
              <strong data-private-value="true">{formatarReais(calculations.balances.get(account.id) ?? Number(account.saldo_inicial))}</strong>
            </article>)}
            {!selectedAccounts.length && <div className={styles.emptyState}><Icon name="wallet"/><p>Nenhuma conta selecionada.</p><button type="button" onClick={() => setSelectorOpen(true)}>Selecionar contas</button></div>}
          </div>
        </section>

        <section className={`${styles.panel} ${styles.categoryPanel}`}>
          <div className={styles.panelHeader}>
            <div><p className={styles.sectionKicker}>Distribuição mensal</p><h2>Movimentações por categoria</h2></div>
            <Link href="/relatorios">Ver relatório <Icon name="chevron" size={15}/></Link>
          </div>
          <div className={styles.flowCategoryToolbar}>
            <div className={styles.flowCategoryFilters} role="group" aria-label="Filtrar lançamentos do gráfico por status">
              {([['todos', 'Todos'], ['concluidos', 'Concluídos'], ['pendentes', 'Pendentes']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={flowStatus === value} onClick={() => { setFlowStatus(value); setFlowCategoryKey(null); }} className={flowStatus === value ? styles.flowCategoryFilterActive : ""}>{label}</button>)}
            </div>
            <div className={styles.flowCategoryLegend}><span><i className={styles.incomeDot}/>Receitas</span><span><i className={styles.expenseDot}/>Despesas</span></div>
          </div>
          {flowCategoryRows.length ? <div className={styles.flowCategoryChart}><div className={styles.verticalChart}>{flowCategoryRows.map(([key, values]) => <button type="button" key={key} onClick={() => setFlowCategoryKey(key)} className={styles.verticalGroup} aria-label={`Ver lançamentos de ${values.name}`}><span className={styles.verticalBars}><i className={styles.incomeBar} style={{ height: `${values.income ? Math.max(4, values.income / flowChartMax * 100) : 0}%` }}/><i className={styles.expenseBar} style={{ height: `${values.expense ? Math.max(4, values.expense / flowChartMax * 100) : 0}%` }}/></span><span className={styles.verticalLabel}>{values.name}</span><strong data-private-value="true"><b>{values.income ? formatarReais(values.income) : ""}</b><em>{values.expense ? formatarReais(values.expense) : ""}</em></strong></button>)}</div></div> : <div className={styles.emptyChart}><Icon name="category" size={28}/><p>Nenhuma movimentação {flowStatus === "concluidos" ? "concluída" : flowStatus === "pendentes" ? "pendente" : "registrada"} neste mês.</p><Link href={homeTransactionCreationHref("despesa")}>Adicionar lançamento</Link></div>}
        </section>
      </div>

      <aside className={styles.secondaryColumn}>
        <section className={`${styles.panel} ${styles.upcomingPanel}`}>
          <div className={styles.panelHeader}>
            <div><p className={styles.sectionKicker}>Agenda financeira</p><h2>Próximos 7 dias</h2></div>
            <Link href="/transacoes?quick=next7">Ver todos</Link>
          </div>
          <div className={styles.upcomingList}>{upcoming.map((transaction) => {
            const date = shortDate(transaction.data_vencimento);
            const category = transaction.categoria_id ? categoriesById.get(transaction.categoria_id) : undefined;
            return <Link href={`/transacoes?quick=next7&focus=${transaction.id}`} key={transaction.id} className={styles.upcomingItem}>
              <span className={styles.dateTile}><strong>{date.day}</strong><small>{date.month}</small></span>
              <span className={styles.upcomingIcon} style={{ "--item-color": safeColor(category?.cor ?? (transaction.tipo === "receita" ? "#56d39b" : "#ee6b63")) } as CSSProperties}>{category?.icone ? <FinancialIcon name={category.icone} /> : transaction.tipo === "receita" ? <Icon name="income"/> : <Icon name="receipt"/>}</span>
              <span className={styles.upcomingInfo}><strong>{descricaoVisivel(transaction.descricao) || "Lançamento"}</strong><small>{category?.nome ?? (transaction.tipo === "receita" ? "Receita" : "Despesa")}</small></span>
              <strong data-private-value="true" className={transaction.tipo === "receita" ? styles.incomeText : styles.expenseText}>{transaction.tipo === "receita" ? "+" : "−"}{formatarReais(Number(transaction.valor))}</strong>
            </Link>;
          })}{!upcoming.length && <div className={styles.emptyUpcoming}><span>✓</span><div><strong>Nenhum compromisso próximo</strong><p>Seus próximos sete dias estão livres.</p></div></div>}</div>
        </section>

        <Link href={alerts.overdue ? "/transacoes?quick=overdue" : alerts.today ? "/transacoes?quick=today" : "/transacoes?quick=next7"} className={`${styles.panel} ${styles.alertCard}`}>
          <span className={alerts.overdue ? styles.alertDanger : styles.alertOkay}><Icon name="bell"/></span>
          <div><h2>{alerts.overdue ? `${alerts.overdue} ${alerts.overdue === 1 ? "lançamento atrasado" : "lançamentos atrasados"}` : alerts.today ? `${alerts.today} vencendo hoje` : "Agenda sob controle"}</h2><p>{alerts.overdue ? "Revise agora para manter seu planejamento atualizado." : alerts.today ? "Acompanhe os compromissos de hoje." : "Nenhum agendamento vencido nas contas selecionadas."}</p></div>
          <Icon name="chevron"/>
        </Link>

        <section className={`${styles.panel} ${styles.insightCard}`}>
          <div className={styles.insightTitle}><div><span><Icon name="sparkles"/></span><div><p className={styles.sectionKicker}>Leitura dos seus dados</p><h2>Insight financeiro</h2></div></div><small>IA</small></div>
          {topCategory ? <p>O maior gasto previsto do mês é <strong>{topCategory[0] ? categoriesById.get(topCategory[0])?.nome ?? "Sem categoria" : "Sem categoria"}</strong>, com <span data-private-value="true">{formatarReais(topCategory[1].expected)}</span> ({categoryTotal ? ((topCategory[1].expected / categoryTotal) * 100).toFixed(0) : 0}% do total).</p> : <p>Registre suas movimentações para receber uma leitura mais completa da sua rotina financeira.</p>}
          <Link href="/assistente?prompt=insight-financeiro">Pedir análise à IA <Icon name="chevron" size={16}/></Link>
        </section>
      </aside>
    </div>
    {selectedFlowCategory && createPortal(<div className="fixed inset-0 z-[9999] grid h-[100dvh] w-screen place-items-center overflow-hidden bg-[#02090c]/80 p-4 backdrop-blur-[5px]" role="presentation" onMouseDown={() => setFlowCategoryKey(null)}>
      <section role="dialog" aria-modal="true" aria-label="Detalhes da categoria" onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[calc(100dvh-2rem)] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-primary/20 bg-surface p-5 shadow-[0_32px_100px_rgba(0,0,0,.52)] sm:p-6">
        <div className="flex shrink-0 items-center justify-between gap-4"><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-primary">Movimentações do mês</p><h2 className="mt-1 text-xl font-black text-foreground">{selectedFlowCategory[1].name}</h2></div><button type="button" onClick={() => setFlowCategoryKey(null)} aria-label="Fechar detalhes" className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-muted text-xl text-foreground-muted">×</button></div>
        <div className="mt-5 min-h-0 overflow-y-auto overscroll-contain pr-1">
          <div className="grid gap-4 md:grid-cols-2">
            {selectedFlowExpenses.length > 0 && <section className={selectedFlowIncome.length === 0 ? "md:col-span-2" : ""}><h3 className="mb-2 text-sm font-extrabold text-red">Despesas</h3><div className="space-y-2">{selectedFlowExpenses.map((detail) => <div key={detail.id} className="flex items-center justify-between gap-3 rounded-xl border border-red/15 bg-surface-muted p-3"><span className="min-w-0"><strong className="block truncate text-sm text-foreground">{detail.description}</strong><small className="text-xs text-foreground-muted">{new Intl.DateTimeFormat("pt-BR").format(new Date(`${detail.date}T12:00:00-03:00`))}</small></span><strong data-private-value="true" className="shrink-0 text-red">−{formatarReais(detail.value)}</strong></div>)}</div></section>}
            {selectedFlowIncome.length > 0 && <section className={selectedFlowExpenses.length === 0 ? "md:col-span-2" : ""}><h3 className="mb-2 text-sm font-extrabold text-primary">Receitas</h3><div className="space-y-2">{selectedFlowIncome.map((detail) => <div key={detail.id} className="flex items-center justify-between gap-3 rounded-xl border border-primary/15 bg-surface-muted p-3"><span className="min-w-0"><strong className="block truncate text-sm text-foreground">{detail.description}</strong><small className="text-xs text-foreground-muted">{new Intl.DateTimeFormat("pt-BR").format(new Date(`${detail.date}T12:00:00-03:00`))}</small></span><strong data-private-value="true" className="shrink-0 text-primary">+{formatarReais(detail.value)}</strong></div>)}</div></section>}
          </div>
          {selectedFlowExpenses.length > 0 && selectedFlowIncome.length > 0 && <footer className="mt-5 grid gap-2 border-t border-border pt-4 sm:grid-cols-3">
            <div className="rounded-xl border border-red/20 bg-red/10 p-3"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-red">Total de despesas</p><strong data-private-value="true" className="mt-1 block text-lg font-black text-red">−{formatarReais(selectedFlowExpenseTotal)}</strong></div>
            <div className="rounded-xl border border-white bg-white p-3 shadow-sm"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-slate-600">Balanço</p><strong data-private-value="true" className={`mt-1 block text-lg font-black ${selectedFlowBalance >= 0 ? "text-primary" : "text-red"}`}>{selectedFlowBalance >= 0 ? "+" : "−"}{formatarReais(Math.abs(selectedFlowBalance))}</strong></div>
            <div className="rounded-xl border border-primary/20 bg-primary/10 p-3"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-primary">Total de receitas</p><strong data-private-value="true" className="mt-1 block text-lg font-black text-primary">+{formatarReais(selectedFlowIncomeTotal)}</strong></div>
          </footer>}
          {selectedFlowExpenses.length > 0 && selectedFlowIncome.length === 0 && <footer className="mt-5 border-t border-border pt-4"><div className="w-full rounded-xl border border-red/20 bg-red/10 p-3"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-red">Total de despesas</p><strong data-private-value="true" className="mt-1 block text-lg font-black text-red">−{formatarReais(selectedFlowExpenseTotal)}</strong></div></footer>}
          {selectedFlowIncome.length > 0 && selectedFlowExpenses.length === 0 && <footer className="mt-5 border-t border-border pt-4"><div className="w-full rounded-xl border border-primary/20 bg-primary/10 p-3"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-primary">Total de receitas</p><strong data-private-value="true" className="mt-1 block text-lg font-black text-primary">+{formatarReais(selectedFlowIncomeTotal)}</strong></div></footer>}
        </div>
      </section>
    </div>, document.body)}
    {newTransactionKind && <NewTransactionDialog accounts={accounts} goals={goals} categories={categories} today={today} initialKind={newTransactionKind} onClose={() => setNewTransactionKind(null)} onChanged={() => { setNewTransactionKind(null); router.refresh(); }} />}
  </div>;
}
