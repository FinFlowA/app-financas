"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import FinancialIcon from "@/components/ui/financial-icon";
import { formatarReais } from "@/lib/format";
import { descricaoVisivel, isMovimentoObjetivo, isPagamentoFatura } from "@/lib/transacoes";
import type { Caixinha, Categoria, Conta, Transacao } from "@/lib/types";
import { NewTransactionDialog } from "../transacoes/transaction-manager";

function shiftMonth(month: string, delta: number) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, number - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(month: string) {
  const [year, number] = month.split("-").map(Number);
  const value = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, number - 1, 10)));
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function CalendarManager({ today, accounts, goals, categories, transactions }: { today: string; accounts: Conta[]; goals: Caixinha[]; categories: Categoria[]; transactions: Transacao[] }) {
  const router = useRouter();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selectedDate, setSelectedDate] = useState(today);
  const [creating, setCreating] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "completed">("all");
  const categoryById = useMemo(() => new Map(categories.map((category) => [category.id, category])), [categories]);
  const visibleTransactions = useMemo(() => transactions.filter((transaction) => !isMovimentoObjetivo(transaction.descricao) && !isPagamentoFatura(transaction.descricao) && (statusFilter === "all" || (statusFilter === "pending" ? transaction.status === "pendente" : transaction.status === "paga"))), [transactions, statusFilter]);
  const byDate = useMemo(() => {
    const result = new Map<string, Transacao[]>();
    for (const transaction of visibleTransactions) result.set(transaction.data_vencimento, [...(result.get(transaction.data_vencimento) ?? []), transaction]);
    return result;
  }, [visibleTransactions]);
  const [year, monthNumber] = month.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1);
  const selected = byDate.get(selectedDate) ?? [];

  function selectMonth(delta: number) {
    const next = shiftMonth(month, delta);
    setMonth(next);
    setSelectedDate(`${next}-01`);
  }

  return <div className="w-full pb-10">
    <header className="ff-page-hero mb-5 px-5 py-6 sm:px-7 sm:py-7"><p className="text-xs font-extrabold uppercase tracking-[.18em] text-mint">Planejamento diário</p><h1 className="mt-2 text-3xl font-black sm:text-4xl">Calendário</h1><p className="mt-2 max-w-2xl text-sm text-white/75">Veja os agendamentos de cada dia e crie um novo lançamento diretamente na data escolhida.</p></header>
    <section className="ff-card overflow-hidden p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Filtrar agendamentos por situação">{([['all','Todos'],['pending','Pendentes'],['completed','Concluídos']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={statusFilter === value} onClick={() => setStatusFilter(value)} className={`ff-focus rounded-full border px-4 py-2 text-xs font-extrabold transition ${statusFilter === value ? "border-primary bg-primary text-white" : "border-border bg-surface-muted text-foreground-muted hover:border-primary/35"}`}>{label}</button>)}</div>
      <div className="mb-5 flex items-center justify-between gap-3"><button type="button" onClick={() => selectMonth(-1)} aria-label="Mês anterior" className="ff-focus grid h-10 w-10 place-items-center rounded-full border border-border text-xl">‹</button><h2 className="text-center text-lg font-black text-foreground">{monthLabel(month)}</h2><button type="button" onClick={() => selectMonth(1)} aria-label="Próximo mês" className="ff-focus grid h-10 w-10 place-items-center rounded-full border border-border text-xl">›</button></div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">{["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((day) => <span key={day} className="py-2">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">{cells.map((day, index) => {
        if (!day) return <span key={`blank-${index}`} className="min-h-16 sm:min-h-24" />;
        const date = `${month}-${String(day).padStart(2, "0")}`;
        const entries = byDate.get(date) ?? [];
        const active = selectedDate === date;
        return <button key={date} type="button" onClick={() => setSelectedDate(date)} aria-pressed={active} className={`ff-focus relative min-h-16 rounded-xl border p-1.5 text-left transition sm:min-h-24 sm:p-2.5 ${active ? "border-primary bg-primary/10 ring-1 ring-primary" : date === today ? "border-mint/50 bg-mint/5" : "border-border bg-surface-muted/40 hover:border-primary/35"}`}><strong className="text-xs sm:text-sm">{day}</strong>{entries.length > 0 && <><span className="absolute right-1.5 top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[9px] font-black text-white">{entries.length}</span><span className="mt-2 hidden space-y-1 sm:block">{entries.slice(0, 2).map((entry) => <i key={entry.id} className={`block truncate rounded px-1.5 py-1 text-[9px] font-bold not-italic ${entry.tipo === "receita" ? "bg-primary/10 text-primary" : "bg-red/10 text-red"}`}>{descricaoVisivel(entry.descricao)}</i>)}</span></>}</button>;
      })}</div>
    </section>
    <section className="ff-card mt-5 p-4 sm:p-6"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-primary">Dia selecionado</p><h2 className="mt-1 text-xl font-black">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${selectedDate}T12:00:00Z`))}</h2></div><button type="button" onClick={() => setCreating(true)} className="ff-focus rounded-full bg-primary px-5 py-3 text-sm font-extrabold text-white">+ Agendar nesta data</button></div>
      <div className="mt-4 grid gap-2">{selected.map((transaction) => { const category = transaction.categoria_id ? categoryById.get(transaction.categoria_id) : null; return <article key={transaction.id} className="flex items-center gap-3 rounded-xl border border-border bg-surface-muted p-3"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${transaction.tipo === "receita" ? "bg-primary/10 text-primary" : "bg-red/10 text-red"}`}>{category?.icone ? <FinancialIcon name={category.icone} /> : transaction.tipo === "receita" ? "+" : "−"}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{descricaoVisivel(transaction.descricao)}</strong><small className="text-xs text-foreground-muted">{category?.nome ?? "Sem categoria"} · {transaction.status === "paga" ? "Concluído" : "Pendente"}</small></span><strong data-private-value="true" className={transaction.tipo === "receita" ? "text-primary" : "text-red"}>{transaction.tipo === "receita" ? "+" : "−"}{formatarReais(Number(transaction.valor))}</strong></article>; })}{selected.length === 0 && <p className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-foreground-muted">Nenhum agendamento nesta data.</p>}</div>
    </section>
    {creating && <NewTransactionDialog accounts={accounts} goals={goals} categories={categories} today={today} initialDate={selectedDate} initialKind="despesa" onClose={() => setCreating(false)} onChanged={() => { setCreating(false); router.refresh(); }} />}
  </div>;
}
