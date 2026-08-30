"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { formatarReais } from "@/lib/format";
import { parseBankStatement, statementFingerprint, type StatementEntry } from "@/lib/bank-statement";
import type { Categoria, Conta } from "@/lib/types";
import { ignoreStatementEntries, ignoreStatementEntry, reconcileStatementEntry } from "./actions";

export type ReconciliationCandidate = {
  id: number;
  accountId: number;
  categoryId: number | null;
  type: "receita" | "despesa";
  description: string;
  dueDate: string;
  remainingValue: number;
  kind: "standard" | "transfer";
};

type ImportedEntry = StatementEntry & { fingerprint: string };
type Draft = {
  mode: "existing" | "new";
  transactionId: number | null;
  categoryId: number | null;
  description: string;
  requestId: string;
  busy: boolean;
  error: string | null;
  search: string;
  month: string;
};

const SESSION_KEY = "finflow:bank-statement-workspace:v1";

type StoredWorkspace = {
  accountId: number;
  entries: ImportedEntry[];
  drafts: Record<string, Draft>;
  fileName: string;
  ignoredCount: number;
};

let memoryWorkspace: StoredWorkspace | null = null;

function storeWorkspace(workspace: StoredWorkspace) {
  memoryWorkspace = workspace;
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(workspace));
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(`${value}T12:00:00-03:00`));
}

function normalizedWords(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 2));
}

function normalizedSearch(value: string): string {
  return value.toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function shiftMonth(value: string, delta: number): string {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 15));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function descriptionScore(a: string, b: string): number {
  const left = normalizedWords(a); const right = normalizedWords(b);
  if (!left.size || !right.size) return 0;
  let matches = 0; for (const word of left) if (right.has(word)) matches += 1;
  return matches / Math.max(left.size, right.size);
}

function dayDistance(a: string, b: string): number {
  return Math.abs(new Date(`${a}T12:00:00Z`).getTime() - new Date(`${b}T12:00:00Z`).getTime()) / 86_400_000;
}

function rankedCandidates(entry: StatementEntry, accountId: number, candidates: ReconciliationCandidate[]): ReconciliationCandidate[] {
  return candidates.filter((candidate) => candidate.accountId === accountId && candidate.type === entry.type)
    .sort((a, b) => {
      const exactA = Math.round(a.remainingValue * 100) === Math.round(entry.amount * 100) ? 1 : 0;
      const exactB = Math.round(b.remainingValue * 100) === Math.round(entry.amount * 100) ? 1 : 0;
      return exactB - exactA
        || descriptionScore(entry.description, b.description) - descriptionScore(entry.description, a.description)
        || dayDistance(entry.date, a.dueDate) - dayDistance(entry.date, b.dueDate);
    });
}

function CandidatePicker({ entry, draft, candidates, onChange }: {
  entry: ImportedEntry;
  draft: Draft;
  candidates: ReconciliationCandidate[];
  onChange: (changes: Partial<Draft>) => void;
}) {
  const search = normalizedSearch(draft.search.trim());
  const statementMonth = draft.month || entry.date.slice(0, 7);
  const visible = search
    ? candidates.filter((candidate) => normalizedSearch(candidate.description).includes(search))
    : candidates.filter((candidate) => candidate.dueDate.startsWith(statementMonth));
  return <div className="mt-4 rounded-2xl border border-border bg-surface-muted/45 p-4">
    <label className="block text-sm font-bold text-foreground">
      <span className="mb-2 block">Pesquisar lançamento</span>
      <span className="relative block"><span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-foreground-muted">⌕</span><input type="search" value={draft.search} onChange={(event) => onChange({ search: event.target.value })} placeholder={`Buscar ${entry.type === "receita" ? "receitas" : "despesas"} ou transferências`} className="ff-focus min-h-12 w-full rounded-xl border border-border bg-surface py-3 pl-11 pr-4 font-normal outline-none transition placeholder:text-foreground-muted/65 hover:border-primary/35 focus:border-primary" /></span>
    </label>
    <div className="mt-3" role="listbox" aria-label="Lançamentos pendentes">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-extrabold uppercase tracking-[.1em] text-foreground-muted">Selecione o lançamento</p>{search ? <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-extrabold uppercase text-primary">Todos os meses</span> : <div className="flex items-center rounded-full border border-primary/25 bg-primary/10 p-1"><button type="button" aria-label="Mês anterior" onClick={() => onChange({ month: shiftMonth(statementMonth, -1) })} className="ff-focus grid h-8 w-8 place-items-center rounded-full text-primary transition hover:bg-primary/15">‹</button><span className="min-w-32 px-2 text-center text-[10px] font-extrabold uppercase text-primary">{new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${statementMonth}-15T12:00:00Z`))}</span><button type="button" aria-label="Próximo mês" onClick={() => onChange({ month: shiftMonth(statementMonth, 1) })} className="ff-focus grid h-8 w-8 place-items-center rounded-full text-primary transition hover:bg-primary/15">›</button></div>}</div>
      <div className="grid max-h-64 gap-2 overflow-y-auto pr-1">
        {visible.map((candidate) => {
          const selected = draft.transactionId === candidate.id;
          const exact = Math.round(candidate.remainingValue * 100) === Math.round(entry.amount * 100);
          return <button key={`${candidate.id}:${candidate.accountId}:${candidate.type}`} type="button" role="option" aria-selected={selected} onClick={() => onChange({ transactionId: candidate.id })} className={`ff-focus flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left transition ${selected ? "border-primary bg-primary/10 shadow-[0_8px_22px_rgba(22,150,110,.12)]" : "border-border bg-surface hover:border-primary/35 hover:bg-primary/5"}`}><span className="min-w-0"><strong className="block truncate text-sm text-foreground">{candidate.description}</strong><small className="mt-1 block text-xs text-foreground-muted">{candidate.kind === "transfer" ? "Transferência · " : ""}{formatDate(candidate.dueDate)}</small></span><span className="shrink-0 text-right"><strong className={exact ? "text-primary" : "text-orange"}>{formatarReais(candidate.remainingValue)}</strong>{exact && <small className="block text-[10px] font-extrabold uppercase text-primary">valor exato</small>}</span></button>;
        })}
        {visible.length === 0 && <p className="rounded-xl border border-dashed border-border bg-surface p-4 text-center text-sm text-foreground-muted">Nenhum lançamento compatível encontrado.</p>}
      </div>
    </div>
  </div>;
}

export default function ReconciliationWorkspace({
  accounts,
  categories,
  candidates,
  reconciledFingerprints,
}: {
  accounts: Conta[];
  categories: Categoria[];
  candidates: ReconciliationCandidate[];
  reconciledFingerprints: string[];
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? 0);
  const [entries, setEntries] = useState<ImportedEntry[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [reconciled, setReconciled] = useState(() => new Set(reconciledFingerprints));
  const [sessionRestored, setSessionRestored] = useState(false);
  const [interestEntryId, setInterestEntryId] = useState<string | null>(null);
  const [ignoreEntryId, setIgnoreEntryId] = useState<string | null>(null);
  const [partialEntryId, setPartialEntryId] = useState<string | null>(null);
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(() => new Set());
  const [bulkIgnoreOpen, setBulkIgnoreOpen] = useState(false);
  const [bulkIgnoring, setBulkIgnoring] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);

  useEffect(() => {
    const restoreTimer = window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (memoryWorkspace || raw) {
          const stored = memoryWorkspace ?? JSON.parse(raw!) as StoredWorkspace;
          if (accounts.some((account) => account.id === stored.accountId)) {
            setAccountId(stored.accountId);
            setEntries(Array.isArray(stored.entries) ? stored.entries : []);
            setDrafts(stored.drafts && typeof stored.drafts === "object" ? Object.fromEntries(Object.entries(stored.drafts).map(([id, draft]) => [id, { ...draft, busy: false, error: null, search: draft.search ?? "", month: draft.month ?? "" }])) : {});
            setFileName(typeof stored.fileName === "string" ? stored.fileName : "");
            setIgnoredCount(Number.isFinite(stored.ignoredCount) ? stored.ignoredCount : 0);
          }
        }
      } catch {
        sessionStorage.removeItem(SESSION_KEY);
      } finally {
        setSessionRestored(true);
      }
    }, 0);
    return () => window.clearTimeout(restoreTimer);
  }, [accounts]);

  useEffect(() => {
    if (!sessionRestored) return;
    const workspace: StoredWorkspace = { accountId, entries, drafts, fileName, ignoredCount };
    storeWorkspace(workspace);
  }, [accountId, drafts, entries, fileName, ignoredCount, sessionRestored]);

  const selectedAccount = accounts.find((account) => account.id === accountId);
  const totals = useMemo(() => entries.reduce((summary, entry) => {
    summary[entry.type] += entry.amount; return summary;
  }, { receita: 0, despesa: 0 }), [entries]);

  async function loadFile(file: File) {
    if (!accountId) { setFileError("Selecione a conta antes de importar o extrato."); return; }
    if (file.size > 5 * 1024 * 1024) { setFileError("O arquivo deve ter no máximo 5 MB."); return; }
    setLoading(true); setFileError(null);
    try {
      const parsed = parseBankStatement(file.name, await file.text());
      const withHashes = await Promise.all(parsed.map(async (entry) => ({ ...entry, fingerprint: await statementFingerprint(accountId, entry) })));
      const pending = withHashes.filter((entry) => !reconciled.has(`${accountId}:${entry.fingerprint}`));
      const nextDrafts: Record<string, Draft> = {};
      for (const entry of pending) {
        const ranked = rankedCandidates(entry, accountId, candidates);
        const sameMonth = ranked.filter((candidate) => candidate.dueDate.startsWith(entry.date.slice(0, 7)));
        const exact = ranked.find((candidate) => Math.round(candidate.remainingValue * 100) === Math.round(entry.amount * 100));
        const compatibleCategories = categories.filter((category) => category.tipo === entry.type || category.tipo === "ambos");
        nextDrafts[entry.id] = {
          mode: exact ? "existing" : "new",
          transactionId: exact?.id ?? sameMonth[0]?.id ?? null,
          categoryId: exact?.categoryId ?? compatibleCategories[0]?.id ?? null,
          description: entry.description.slice(0, 100),
          requestId: crypto.randomUUID(), busy: false, error: null, search: "", month: exact?.dueDate.slice(0, 7) ?? entry.date.slice(0, 7),
        };
      }
      const nextIgnoredCount = withHashes.length - pending.length;
      setEntries(pending); setDrafts(nextDrafts); setFileName(file.name); setIgnoredCount(nextIgnoredCount); setSelectedEntryIds(new Set());
      storeWorkspace({ accountId, entries: pending, drafts: nextDrafts, fileName: file.name, ignoredCount: nextIgnoredCount });
    } catch (error) {
      setEntries([]); setDrafts({}); setFileName(""); setIgnoredCount(0);
      setFileError(error instanceof Error ? error.message : "Não foi possível ler este extrato.");
    } finally { setLoading(false); }
  }

  function receiveDroppedFile(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!accountId || loading) return;
    const file = event.dataTransfer.files?.[0];
    if (file) void loadFile(file);
  }

  function updateDraft(id: string, changes: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...changes, requestId: crypto.randomUUID(), error: null } }));
  }

  async function reconcile(entry: ImportedEntry, confirmation?: "interest" | "partial") {
    const draft = drafts[entry.id];
    if (!draft || draft.busy) return;
    const selected = candidates.find((candidate) => candidate.id === draft.transactionId && candidate.accountId === accountId && candidate.type === entry.type);
    const excess = draft.mode === "existing" && selected ? Math.round((entry.amount - selected.remainingValue) * 100) / 100 : 0;
    const remainingAfterPartial = selected ? Math.round((selected.remainingValue - entry.amount) * 100) / 100 : 0;
    if (excess > 0 && confirmation !== "interest") {
      setInterestEntryId(entry.id);
      return;
    }
    if (remainingAfterPartial > 0 && selected?.kind !== "transfer" && confirmation !== "partial") {
      setPartialEntryId(entry.id);
      return;
    }
    setInterestEntryId(null);
    setPartialEntryId(null);
    setDrafts((current) => ({ ...current, [entry.id]: { ...draft, busy: true, error: null } }));
    const result = await reconcileStatementEntry({
      accountId, fingerprint: entry.fingerprint, date: entry.date, type: entry.type, amount: entry.amount,
      mode: draft.mode, transactionId: draft.transactionId, categoryId: draft.categoryId,
      description: draft.description, requestId: draft.requestId, excessAsInterest: excess > 0,
      existingKind: selected?.kind,
    });
    if (result.erro) {
      setDrafts((current) => ({ ...current, [entry.id]: { ...current[entry.id], busy: false, error: result.erro } }));
      return;
    }
    setReconciled((current) => new Set(current).add(`${accountId}:${entry.fingerprint}`));
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    setDrafts((current) => { const next = { ...current }; delete next[entry.id]; return next; });
  }

  async function ignoreEntry(entry: ImportedEntry) {
    const draft = drafts[entry.id];
    if (!draft || draft.busy) return;
    setDrafts((current) => ({ ...current, [entry.id]: { ...draft, busy: true, error: null } }));
    const result = await ignoreStatementEntry({ accountId, fingerprint: entry.fingerprint, date: entry.date, type: entry.type, amount: entry.amount, requestId: crypto.randomUUID() });
    if (result.erro) {
      setDrafts((current) => ({ ...current, [entry.id]: { ...current[entry.id], busy: false, error: result.erro } }));
      setIgnoreEntryId(null);
      return;
    }
    setIgnoreEntryId(null);
    setReconciled((current) => new Set(current).add(`${accountId}:${entry.fingerprint}`));
    setEntries((current) => current.filter((item) => item.id !== entry.id));
    setDrafts((current) => { const next = { ...current }; delete next[entry.id]; return next; });
  }

  function toggleSelectedEntry(id: string) {
    setSelectedEntryIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  async function ignoreSelectedEntries() {
    const selected = entries.filter((entry) => selectedEntryIds.has(entry.id));
    if (!selected.length || bulkIgnoring) return;
    setBulkIgnoring(true); setBulkError(null);
    const result = await ignoreStatementEntries(selected.map((entry) => ({
      accountId, fingerprint: entry.fingerprint, date: entry.date, type: entry.type,
      amount: entry.amount, requestId: crypto.randomUUID(),
    })));
    if (result.erro) { setBulkError(result.erro); setBulkIgnoring(false); return; }
    const removed = new Set(selected.map((entry) => entry.id));
    setReconciled((current) => { const next = new Set(current); for (const entry of selected) next.add(`${accountId}:${entry.fingerprint}`); return next; });
    setEntries((current) => current.filter((entry) => !removed.has(entry.id)));
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !removed.has(id))));
    setSelectedEntryIds(new Set()); setBulkIgnoreOpen(false); setBulkIgnoring(false);
  }

  const allEntriesSelected = entries.length > 0 && selectedEntryIds.size === entries.length;

  return <div className="mx-auto w-full max-w-6xl pb-10">
    <header className="relative overflow-hidden rounded-[28px] border border-primary/25 bg-[linear-gradient(135deg,#075f50,#063a36)] p-6 text-white shadow-[0_24px_70px_rgba(0,0,0,.24)] sm:p-8">
      <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-mint/10 blur-2xl" aria-hidden="true" />
      <p className="text-[11px] font-extrabold uppercase tracking-[.16em] text-mint">Conferência bancária</p>
      <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Extrato e conciliação</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75">Compare seu extrato com lançamentos pendentes, registre baixas parciais ou crie movimentações realizadas sem digitar tudo novamente.</p>
    </header>

    <section className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
      <div className="ff-card p-5 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm font-bold text-foreground">Conta do extrato<select value={accountId} onChange={(event) => { setAccountId(Number(event.target.value)); setEntries([]); setDrafts({}); setFileName(""); setIgnoredCount(0); if (inputRef.current) inputRef.current.value = ""; }} className="ff-focus min-h-12 rounded-xl border border-border bg-surface-muted px-4 text-foreground"><option value={0}>Selecione</option>{accounts.map((account) => <option key={account.id} value={account.id}>{account.nome}</option>)}</select></label>
          <div
            role="button"
            tabIndex={accountId && !loading ? 0 : -1}
            aria-disabled={!accountId || loading}
            onClick={() => { if (accountId && !loading) inputRef.current?.click(); }}
            onKeyDown={(event) => { if ((event.key === "Enter" || event.key === " ") && accountId && !loading) { event.preventDefault(); inputRef.current?.click(); } }}
            onDragEnter={(event) => { event.preventDefault(); if (accountId && !loading) setDragging(true); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = accountId && !loading ? "copy" : "none"; }}
            onDragLeave={(event) => { event.preventDefault(); if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
            onDropCapture={receiveDroppedFile}
            className={`ff-focus grid min-h-24 cursor-pointer place-content-center rounded-xl border border-dashed p-4 text-center transition ${accountId ? "border-primary/45 bg-primary/5 hover:bg-primary/10" : "cursor-not-allowed border-border opacity-50"} ${dragging ? "scale-[1.01] border-primary bg-primary/15 shadow-[0_0_0_3px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]" : ""}`}
          ><input ref={inputRef} type="file" accept=".csv,.ofx,.txt,text/csv,application/x-ofx" disabled={!accountId || loading} className="sr-only" onChange={(event) => { const file = event.target.files?.[0]; if (file) void loadFile(file); event.currentTarget.value = ""; }} /><strong className="text-sm text-primary">{loading ? "Lendo extrato..." : dragging ? "Solte o extrato aqui" : "Selecionar ou arrastar CSV/OFX"}</strong><small className="mt-1 text-xs text-foreground-muted">Leitura local · máximo de 5 MB</small></div>
        </div>
        {fileError && <p role="alert" className="mt-4 rounded-xl border border-red/25 bg-red/10 p-3 text-sm font-semibold text-red">{fileError}</p>}
      </div>
      <aside className="ff-card p-5"><p className="text-[10px] font-extrabold uppercase tracking-[.12em] text-primary">Privacidade</p><h2 className="mt-2 font-extrabold text-foreground">O arquivo não é enviado</h2><p className="mt-2 text-xs leading-5 text-foreground-muted">A leitura acontece nesta aba. O FinFlow salva apenas as movimentações confirmadas e um identificador irreversível para não repeti-las na próxima importação.</p></aside>
    </section>

    {fileName && <section className="mt-5 ff-card p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold text-foreground-muted">{fileName} · {selectedAccount?.nome}</p><h2 className="mt-1 text-xl font-black text-foreground">{entries.length} {entries.length === 1 ? "movimentação para revisar" : "movimentações para revisar"}</h2></div><div className="flex flex-wrap gap-2 text-xs font-extrabold"><span className="rounded-full bg-primary/10 px-3 py-2 text-primary">Entradas {formatarReais(totals.receita)}</span><span className="rounded-full bg-red/10 px-3 py-2 text-red">Saídas {formatarReais(totals.despesa)}</span></div></div>{ignoredCount > 0 && <p className="mt-3 text-xs font-semibold text-foreground-muted">{ignoredCount} {ignoredCount === 1 ? "linha já conciliada foi ocultada" : "linhas já conciliadas foram ocultadas"}.</p>}</section>}
    {fileName && entries.length > 0 && <section className="sticky top-3 z-20 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-surface/95 p-3 shadow-[0_14px_34px_rgba(0,0,0,.18)] backdrop-blur"><p className="text-sm font-bold text-foreground">{selectedEntryIds.size ? `${selectedEntryIds.size} selecionada${selectedEntryIds.size === 1 ? "" : "s"}` : "Seleção em massa"}</p><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setSelectedEntryIds(allEntriesSelected ? new Set() : new Set(entries.map((entry) => entry.id)))} className="ff-focus rounded-full border border-primary/35 px-4 py-2 text-xs font-extrabold text-primary transition hover:bg-primary/10">{allEntriesSelected ? "Desmarcar todos" : "Selecionar todos"}</button>{selectedEntryIds.size > 0 && <><button type="button" onClick={() => setBulkIgnoreOpen(true)} className="ff-focus rounded-full bg-red px-4 py-2 text-xs font-extrabold text-white transition hover:brightness-95">Excluir selecionados</button><button type="button" onClick={() => setSelectedEntryIds(new Set())} className="ff-focus rounded-full border border-border px-4 py-2 text-xs font-bold text-foreground-muted transition hover:bg-surface-muted">Cancelar</button></>}</div></section>}

    <div className="mt-4 grid gap-4">
      {entries.map((entry) => {
        const draft = drafts[entry.id]; if (!draft) return null;
        const ranked = rankedCandidates(entry, accountId, candidates);
        const exact = ranked.find((candidate) => candidate.dueDate.startsWith(entry.date.slice(0, 7)) && Math.round(candidate.remainingValue * 100) === Math.round(entry.amount * 100));
        const compatibleCategories = categories.filter((category) => category.tipo === entry.type || category.tipo === "ambos");
        return <article key={entry.id} className={`ff-card overflow-hidden border-l-4 p-5 ${entry.type === "receita" ? "border-l-primary" : "border-l-red"} ${selectedEntryIds.has(entry.id) ? "ring-2 ring-primary/60" : ""}`}>
          <div className="mb-3 flex justify-end"><label className="ff-focus flex cursor-pointer items-center gap-2 rounded-full border border-border bg-surface-muted px-3 py-2 text-xs font-bold text-foreground-muted"><input type="checkbox" checked={selectedEntryIds.has(entry.id)} onChange={() => toggleSelectedEntry(entry.id)} className="h-4 w-4 accent-primary" />Selecionar</label></div>
          <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${entry.type === "receita" ? "bg-primary/10 text-primary" : "bg-red/10 text-red"}`}>{entry.type}</span>{exact && <span className="rounded-full bg-mint/10 px-2.5 py-1 text-[10px] font-extrabold uppercase text-mint">Agendamento do mesmo valor encontrado</span>}</div><h3 className="mt-2 break-words text-lg font-extrabold text-foreground">{entry.description}</h3><p className="mt-1 text-xs font-semibold text-foreground-muted">Data do banco: {formatDate(entry.date)}</p></div><strong data-private-value="true" className={`text-xl font-black ${entry.type === "receita" ? "text-primary" : "text-red"}`}>{entry.type === "receita" ? "+" : "−"}{formatarReais(entry.amount)}</strong></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => updateDraft(entry.id, { mode: "existing", transactionId: draft.transactionId ?? ranked[0]?.id ?? null })} disabled={!ranked.length || draft.busy} className={`rounded-xl border p-4 text-left transition ${draft.mode === "existing" ? "border-primary bg-primary/10" : "border-border bg-surface-muted"} disabled:opacity-45`}><strong className="block text-sm text-foreground">Conciliar com lançamento existente</strong><small className="mt-1 block text-xs text-foreground-muted">Dá baixa total ou parcial e mantém eventual saldo pendente.</small></button><button type="button" onClick={() => updateDraft(entry.id, { mode: "new" })} disabled={draft.busy} className={`rounded-xl border p-4 text-left transition ${draft.mode === "new" ? "border-primary bg-primary/10" : "border-border bg-surface-muted"}`}><strong className="block text-sm text-foreground">Criar nova {entry.type}</strong><small className="mt-1 block text-xs text-foreground-muted">Usa o valor e a data apresentados no extrato.</small></button></div>
          {draft.mode === "existing" ? <CandidatePicker entry={entry} draft={draft} candidates={ranked} onChange={(changes) => updateDraft(entry.id, changes)} /> : <div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="grid gap-2 text-sm font-bold text-foreground">Descrição<input value={draft.description} maxLength={100} onChange={(event) => updateDraft(entry.id, { description: event.target.value })} className="ff-focus min-h-12 rounded-xl border border-border bg-surface-muted px-4" /></label><label className="grid gap-2 text-sm font-bold text-foreground">Categoria<select value={draft.categoryId ?? ""} onChange={(event) => updateDraft(entry.id, { categoryId: Number(event.target.value) || null })} className="ff-focus min-h-12 rounded-xl border border-border bg-surface-muted px-4"><option value="">Selecione</option>{compatibleCategories.map((category) => <option key={category.id} value={category.id}>{category.nome}</option>)}</select></label></div>}
          {draft.error && <p role="alert" className="mt-4 rounded-xl bg-red/10 p-3 text-sm font-semibold text-red">{draft.error}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><button type="button" disabled={draft.busy} onClick={() => setIgnoreEntryId(entry.id)} className="ff-focus min-h-11 rounded-full border border-red/30 px-5 text-sm font-bold text-red transition hover:bg-red/10 disabled:opacity-45">Excluir do extrato</button><button type="button" disabled={draft.busy || (draft.mode === "existing" ? !draft.transactionId : !draft.categoryId || !draft.description.trim())} onClick={() => void reconcile(entry)} className="ff-focus min-h-11 rounded-full bg-primary px-6 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,.2)] disabled:cursor-not-allowed disabled:opacity-45">{draft.busy ? "Conciliando..." : "Confirmar conciliação"}</button></div>
        </article>;
      })}
      {fileName && entries.length === 0 && <section className="ff-card grid min-h-56 place-content-center p-6 text-center"><span className="text-4xl text-primary">✓</span><h2 className="mt-3 text-xl font-black text-foreground">Extrato conciliado</h2><p className="mt-2 text-sm text-foreground-muted">Não há novas movimentações para revisar neste arquivo.</p></section>}
    </div>
    {interestEntryId && (() => { const entry = entries.find((item) => item.id === interestEntryId); const draft = drafts[interestEntryId]; const candidate = candidates.find((item) => item.id === draft?.transactionId && item.accountId === accountId && item.type === entry?.type); if (!entry || !candidate) return null; const excess = Math.round((entry.amount - candidate.remainingValue) * 100) / 100; return <ConfirmationDialog title="Confirmar valor excedente" description={`O valor recebido é ${formatarReais(excess)} maior que o saldo agendado. Deseja registrar essa diferença como juros?`} confirmLabel="Sim, registrar juros" onClose={() => setInterestEntryId(null)} onConfirm={() => void reconcile(entry, "interest")} />; })()}
    {partialEntryId && (() => { const entry = entries.find((item) => item.id === partialEntryId); const draft = drafts[partialEntryId]; const candidate = candidates.find((item) => item.id === draft?.transactionId && item.accountId === accountId && item.type === entry?.type); if (!entry || !candidate) return null; const remaining = Math.round((candidate.remainingValue - entry.amount) * 100) / 100; return <ConfirmationDialog title="Confirmar pagamento parcial" description={`Após conciliar ${formatarReais(entry.amount)}, o valor de ${formatarReais(remaining)} continuará em aberto neste agendamento.`} confirmLabel="Confirmar parcial" onClose={() => setPartialEntryId(null)} onConfirm={() => void reconcile(entry, "partial")} />; })()}
    {ignoreEntryId && (() => { const entry = entries.find((item) => item.id === ignoreEntryId); if (!entry) return null; return <ConfirmationDialog title="Excluir movimentação do extrato?" description="Ela será ignorada permanentemente nas próximas importações deste extrato. Nenhum lançamento financeiro será criado ou alterado." confirmLabel="Excluir movimentação" pending={drafts[entry.id]?.busy} onClose={() => setIgnoreEntryId(null)} onConfirm={() => void ignoreEntry(entry)} />; })()}
    {bulkIgnoreOpen && <ConfirmationDialog title={`Excluir ${selectedEntryIds.size} movimentações do extrato?`} description="As linhas selecionadas serão ignoradas permanentemente nas próximas importações. Nenhum lançamento financeiro será criado ou alterado." confirmLabel="Excluir selecionadas" pending={bulkIgnoring} onClose={() => { if (!bulkIgnoring) { setBulkIgnoreOpen(false); setBulkError(null); } }} onConfirm={() => void ignoreSelectedEntries()}>{bulkError && <p role="alert" className="mt-4 rounded-xl bg-red/10 p-3 text-sm font-semibold text-red">{bulkError}</p>}</ConfirmationDialog>}
  </div>;
}
