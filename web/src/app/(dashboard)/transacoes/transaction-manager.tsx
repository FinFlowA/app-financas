"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import CurrencyInput from "@/components/ui/currency-input";
import { isAttentionDueDate } from "@/lib/date";
import { formatarData, formatarReais } from "@/lib/format";
import { historyFinancialTotals } from "@/lib/history-totals";
import { filterInvoiceGroupItems, groupInvoiceItems, type InvoiceHistoryGroup } from "@/lib/invoices";
import { descricaoVisivel, isPagamentoFatura } from "@/lib/transacoes";
import type { Cartao, Categoria, Conta, FaturaItem } from "@/lib/types";
import { useRequestId } from "@/lib/use-request-id";
import {
  completeTransaction,
  createTransaction,
  deleteTransaction,
  getTransactionPaymentHistory,
  reopenTransaction,
  updateTransaction,
  type TransactionActionState,
} from "./actions";
import {
  addIsoDays,
  compareMobileHistory,
  destinationAccount,
  effectiveTransactionDate,
  isInstallmentTransaction,
  isSeriesTransaction,
  monthTitle,
  normalizePaymentHistory,
  normalizePaymentSummary,
  normalizeSearch,
  recurrenceLabel,
  shiftMonth,
  transactionKind,
  transactionSearchText,
  visibleBaseDescription,
  type PaymentHistory,
  type PaymentSummary,
  type PeriodFilter,
  type QuickFilter,
  type TransactionKind,
  type TransactionRow,
} from "./transaction-model";

type Props = {
  userId: string;
  initialMonth: string;
  initialQuick: QuickFilter;
  initialOpenNew: boolean;
  initialKind: TransactionKind;
  initialFocusId: number | null;
  returnHomeAfterCreate: boolean;
  today: string;
  accounts: Conta[];
  categories: Categoria[];
  cards: Cartao[];
  invoiceItems: FaturaItem[];
  transactions: TransactionRow[];
  financialEvents: TransactionRow[];
  paymentSummaryRows: unknown[];
};

type HistoryKind = TransactionKind | "fatura";
type HistoryItem =
  | { kind: "transaction"; key: string; id: number; date: string; transaction: TransactionRow }
  | { kind: "invoice"; key: string; id: number; date: string; invoice: InvoiceHistoryGroup };

const INPUT = "ff-focus mt-1.5 w-full rounded-xl border border-border bg-surface-muted px-3.5 py-3 font-normal text-foreground outline-none transition focus:border-primary";
const PAGE_SIZE = 30;
const UNEXPECTED_ACTION_ERROR: TransactionActionState = { erro: "A conexão foi interrompida. Confira os dados antes de tentar novamente." };
const subscribeToNothing = () => () => undefined;
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function isActiveCategory(category: Categoria): boolean {
  return category.ativa === true || category.ativa === 1;
}

function Modal({ title, subtitle, onClose, children, wide = false }: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const canUseDOM = useSyncExternalStore(subscribeToNothing, getClientSnapshot, getServerSnapshot);
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const closeCallbackRef = useRef(onClose);

  useEffect(() => {
    closeCallbackRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeCallbackRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]):not([type='hidden']), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) ?? []);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const activeElement = document.activeElement;
      if (event.shiftKey && (activeElement === first || !panelRef.current?.contains(activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeElement === last || !panelRef.current?.contains(activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", handleKeyDown);
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  if (!canUseDOM) return null;

  return createPortal(
    <div className="fixed inset-0 z-[90] grid place-items-center overflow-y-auto bg-[#02090c]/80 p-3 backdrop-blur-[5px] sm:p-5" onMouseDown={onClose}>
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`max-h-[calc(100dvh-1.5rem)] w-full overscroll-contain overflow-y-auto rounded-[26px] border border-primary/15 bg-surface p-5 shadow-[0_32px_100px_rgba(0,0,0,0.48)] sm:max-h-[calc(100dvh-2.5rem)] sm:p-6 ${wide ? "sm:max-w-3xl" : "sm:max-w-xl"}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><p className="mb-1 text-[10px] font-extrabold uppercase tracking-[0.16em] text-primary">FinFlow</p><h2 className="text-xl font-black text-foreground">{title}</h2>{subtitle && <p className="mt-1 max-w-xl text-sm leading-relaxed text-foreground-muted">{subtitle}</p>}</div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Fechar" className="ff-focus grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-muted text-xl font-bold text-foreground-muted transition hover:bg-primary-soft hover:text-primary">×</button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}

function Feedback({ state }: { state: TransactionActionState | null }) {
  if (!state) return null;
  return state.erro
    ? <p role="alert" className="rounded-ff-sm bg-red/10 px-3 py-2 text-sm font-semibold text-red">{state.erro}</p>
    : <p role="status" className="rounded-ff-sm bg-primary-soft px-3 py-2 text-sm font-semibold text-primary-dark">{state.sucesso}</p>;
}

function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return <label className={`text-sm font-bold text-foreground ${className}`}>{label}{children}</label>;
}

function NewTransactionDialog({ accounts, categories, today, initialKind, onClose, onChanged }: {
  accounts: Conta[];
  categories: Categoria[];
  today: string;
  initialKind: TransactionKind;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [kind, setKind] = useState<TransactionKind>(initialKind);
  const [frequency, setFrequency] = useState("unica");
  const [valueMode, setValueMode] = useState("total");
  const [status, setStatus] = useState("paga");
  const [accountId, setAccountId] = useState("");
  // A mesma chave precisa sobreviver a uma resposta perdida: se a primeira
  // tentativa chegou ao banco, reenviar o formulário reproduz o recibo em vez
  // de criar um segundo lançamento. O modal desmonta após o sucesso e, então,
  // uma nova abertura recebe naturalmente outra chave.
  const [requestId] = useRequestId();
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<TransactionActionState | null>(null);
  const activeAccounts = accounts.filter((account) => !account.arquivado);
  const compatibleCategories = categories.filter((category) => isActiveCategory(category)
    && (category.tipo === kind || category.tipo === "ambos"));
  const recurring = frequency !== "unica";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    formData.set("request_id", requestId);
    try {
      const result = await createTransaction(formData);
      if (result.erro) return setFeedback(result);
      onChanged(result.sucesso ?? "Lançamento criado.");
    } catch { setFeedback(UNEXPECTED_ACTION_ERROR); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="Novo lançamento" subtitle="Receita, despesa ou transferência — única, parcelada ou fixa." onClose={onClose} wide>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="kind" value={kind} />
        <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm font-bold">Tipo</legend><div className="grid grid-cols-3 gap-2 rounded-2xl bg-surface-muted/65 p-1.5">
          {(["receita", "despesa", "transferencia"] as const).map((value) => <button key={value} type="button" aria-pressed={kind === value} onClick={() => setKind(value)} className={`ff-focus rounded-xl border px-2 py-3 text-xs font-extrabold transition sm:text-sm ${kind === value ? value === "receita" ? "border-primary bg-primary text-white shadow-sm" : value === "despesa" ? "border-red bg-red text-white shadow-sm" : "border-orange bg-orange text-white shadow-sm" : "border-transparent bg-transparent text-foreground-muted hover:bg-surface"}`}>{value === "transferencia" ? "Transferência" : value.charAt(0).toUpperCase() + value.slice(1)}</button>)}
        </div></fieldset>
        <Field label="Descrição" className="sm:col-span-2"><input name="description" required maxLength={100} placeholder={kind === "transferencia" ? "Ex.: Reserva para outra conta" : "Ex.: Mercado"} className={INPUT} /></Field>
        <Field label={frequency === "parcelada" && valueMode === "parcela" ? "Valor de cada parcela" : frequency === "parcelada" ? "Valor total" : "Valor"}><CurrencyInput name="value" required /></Field>
        <Field label="Data"><input type="date" name="scheduled_date" required defaultValue={today} className={INPUT} /></Field>
        <Field label="Frequência"><select name="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value)} className={INPUT}>
          <option value="unica">Única</option><option value="parcelada">Parcelada</option><option value="semanal">Fixa semanal</option><option value="mensal">Fixa mensal</option><option value="anual">Fixa anual</option>
        </select></Field>
        {frequency === "parcelada" ? <Field label="Parcelas"><input name="installments" type="number" min={2} max={120} defaultValue={2} required className={INPUT} /></Field> : <input type="hidden" name="installments" value="2" />}
        {frequency === "parcelada" && <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm font-bold">O valor informado é</legend><div className="grid grid-cols-2 gap-2">
          {[["total", "Total da série"], ["parcela", "De cada parcela"]].map(([value, label]) => <button key={value} type="button" onClick={() => setValueMode(value)} className={`rounded-ff-sm border px-3 py-2 text-sm font-bold ${valueMode === value ? "border-primary bg-primary-soft text-primary-dark" : "border-border text-foreground-muted"}`}>{label}</button>)}
          <input type="hidden" name="value_mode" value={valueMode} />
        </div></fieldset>}
        {frequency !== "parcelada" && <input type="hidden" name="value_mode" value="total" />}
        <Field label="Conta de origem"><select name="account_id" required value={accountId} onChange={(event) => setAccountId(event.target.value)} className={INPUT}><option value="" disabled>Selecione</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.nome}</option>)}</select></Field>
        {kind === "transferencia" ? <Field label="Conta de destino"><select name="destination_account_id" required defaultValue="" className={INPUT}><option value="" disabled>Selecione</option>{activeAccounts.filter((account) => String(account.id) !== accountId).map((account) => <option key={account.id} value={account.id}>{account.nome}</option>)}</select></Field> : <Field label="Categoria"><select key={kind} name="category_id" required defaultValue="" className={INPUT}><option value="" disabled>Selecione</option>{compatibleCategories.map((category) => <option key={category.id} value={category.id}>{category.nome}</option>)}</select></Field>}
        {kind === "transferencia" && <input type="hidden" name="category_id" value="0" />}
        {recurring ? <><input type="hidden" name="status" value="pendente" /><div className="sm:col-span-2 rounded-ff-sm bg-orange/10 p-3 text-xs font-semibold text-orange">Parcelas e fixas nascem pendentes. Horizontes: semanal 5 anos, mensal 5 anos e anual 5 ocorrências.</div></> : <Field label="Status"><select name="status" value={status} onChange={(event) => setStatus(event.target.value)} className={INPUT}><option value="paga">Concluído na data</option><option value="pendente">Pendente</option></select></Field>}
        {!recurring && <div className="hidden sm:block" />}
        {activeAccounts.length === 0 && <p role="alert" className="sm:col-span-2 text-sm font-semibold text-red">Crie ou reative uma conta antes de lançar.</p>}
        {kind !== "transferencia" && compatibleCategories.length === 0 && <p role="alert" className="sm:col-span-2 text-sm font-semibold text-red">Crie uma categoria ativa compatível antes de lançar.</p>}
        <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[1fr_auto_auto] sm:items-center"><Feedback state={feedback} /><button type="button" onClick={onClose} className="ff-focus rounded-full border border-border px-5 py-3 text-sm font-bold text-foreground-muted transition hover:bg-surface-muted">Cancelar</button><button disabled={busy || activeAccounts.length < (kind === "transferencia" ? 2 : 1) || (kind !== "transferencia" && compatibleCategories.length === 0)} className="ff-focus rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.2)] transition hover:bg-primary-dark disabled:opacity-50">{busy ? "Salvando..." : "Criar lançamento"}</button></div>
      </form>
    </Modal>
  );
}

function EditTransactionDialog({ transaction, summary, accounts, categories, userId, onClose, onChanged }: {
  transaction: TransactionRow;
  summary: PaymentSummary;
  accounts: Conta[];
  categories: Categoria[];
  userId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [scope, setScope] = useState<"one" | "open_series">("one");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<TransactionActionState | null>(null);
  const transfer = transactionKind(transaction) === "transferencia";
  const series = isSeriesTransaction(transaction);
  const canEditSeries = series && transaction.status === "pendente" && summary.paymentCount === 0;
  const compatibleCategories = categories.filter((category) => (isActiveCategory(category) || category.id === transaction.categoria_id)
    && (category.tipo === transaction.tipo || category.tipo === "ambos"));
  const editableAccounts = accounts.filter((account) => !account.arquivado || account.id === transaction.conta_id);
  const destination = destinationAccount(transaction, accounts);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    formData.set("request_id", crypto.randomUUID());
    try {
      const result = await updateTransaction(formData);
      if (result.erro) return setFeedback(result);
      onChanged(result.sucesso ?? "Lançamento atualizado.");
    } catch { setFeedback(UNEXPECTED_ACTION_ERROR); }
    finally { setBusy(false); }
  }

  return <Modal title="Editar lançamento" subtitle={transaction.status === "paga" ? "O status é alterado apenas pelos fluxos Concluir e Reabrir." : "Altere os dados do agendamento com validação de concorrência."} onClose={onClose} wide>
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="transaction_id" value={transaction.id} /><input type="hidden" name="expected_version" value={transaction.version} /><input type="hidden" name="series_scope" value={scope} />
      <Field label="Descrição" className="sm:col-span-2"><input name="description" required maxLength={100} defaultValue={visibleBaseDescription(transaction.descricao)} className={INPUT} /></Field>
      <Field label="Valor"><CurrencyInput name="value" defaultValue={Number(transaction.valor)} required /></Field>
      <Field label="Data agendada"><input name="scheduled_date" type="date" required defaultValue={transaction.data_vencimento} className={INPUT} /></Field>
      <Field label="Conta"><select name="account_id" required defaultValue={transaction.conta_id} className={INPUT}>{editableAccounts.map((account) => <option key={account.id} value={account.id}>{account.nome}{account.arquivado ? " (arquivada)" : ""}</option>)}</select></Field>
      {transfer ? <div className="rounded-ff-sm bg-orange/10 p-3 text-xs text-orange"><strong>Destino preservado:</strong> {destination?.nome ?? "conta vinculada"}. Para trocar origem e destino, exclua os itens pendentes e crie outra transferência.</div> : <Field label="Categoria"><select name="category_id" required defaultValue={transaction.categoria_id ?? ""} className={INPUT}>{compatibleCategories.map((category) => <option key={category.id} value={category.id}>{category.nome}{!isActiveCategory(category) ? " (arquivada)" : ""}</option>)}</select></Field>}
      {transfer && <input type="hidden" name="category_id" value="0" />}
      {canEditSeries && <fieldset className="sm:col-span-2"><legend className="mb-2 text-sm font-bold">Aplicar a</legend><div className="grid gap-2 sm:grid-cols-2">{[["one", "Somente este item"], ["open_series", "Todos os itens pendentes da série"]].map(([value, label]) => <button key={value} type="button" onClick={() => setScope(value as typeof scope)} className={`rounded-ff-sm border px-3 py-2.5 text-sm font-bold ${scope === value ? "border-primary bg-primary-soft text-primary-dark" : "border-border text-foreground-muted"}`}>{label}</button>)}</div></fieldset>}
      {summary.paymentCount > 0 && <p className="sm:col-span-2 rounded-ff-sm bg-orange/10 p-3 text-xs font-semibold text-orange">Como existem pagamentos registrados, somente o saldo deste item pode ser editado. As baixas anteriores permanecem no detalhe.</p>}
      {transaction.user_id !== userId && <p className="sm:col-span-2 text-xs text-foreground-muted">Lançamento compartilhado: conta e categoria pertencem ao titular e podem ter restrições adicionais.</p>}
      <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[1fr_auto_auto] sm:items-center"><Feedback state={feedback} /><button type="button" onClick={onClose} className="ff-focus rounded-full border border-border px-5 py-3 text-sm font-bold text-foreground-muted transition hover:bg-surface-muted">Cancelar</button><button disabled={busy} className="ff-focus rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.2)] transition hover:bg-primary-dark disabled:opacity-50">{busy ? "Salvando..." : "Salvar"}</button></div>
    </form>
  </Modal>;
}

function CompleteTransactionDialog({ transaction, today, onClose, onChanged }: {
  transaction: TransactionRow;
  today: string;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const [realizationDate, setRealizationDate] = useState(today);
  const [adjustmentType, setAdjustmentType] = useState<"none" | "interest" | "discount">("none");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<TransactionActionState | null>(null);
  const common = transaction.categoria_id !== null && transactionKind(transaction) !== "transferencia" && !/\[(?:Objetivo:|PagFatura:)/.test(transaction.descricao);
  const adjustmentAllowed = common && realizationDate > transaction.data_vencimento;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    formData.set("request_id", crypto.randomUUID());
    try {
      const result = await completeTransaction(formData);
      if (result.erro) return setFeedback(result);
      onChanged(result.sucesso ?? "Lançamento concluído.");
    } catch { setFeedback(UNEXPECTED_ACTION_ERROR); }
    finally { setBusy(false); }
  }

  return <Modal title="Concluir lançamento" subtitle={`Agendado para ${formatarData(transaction.data_vencimento)}.`} onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4">
      <input type="hidden" name="transaction_id" value={transaction.id} /><input type="hidden" name="expected_value" value={Number(transaction.valor)} />
      <Field label="Data da realização"><input name="realization_date" type="date" required max={today} value={realizationDate} onChange={(event) => { setRealizationDate(event.target.value); if (event.target.value <= transaction.data_vencimento) setAdjustmentType("none"); }} className={INPUT} /></Field>
      {common ? <>
        <Field label={transaction.tipo === "receita" ? "Quanto foi recebido?" : "Quanto foi pago?"}><CurrencyInput name="realized_value" defaultValue={Number(transaction.valor)} required /></Field>
        <p className="rounded-ff-sm bg-primary-soft p-3 text-xs font-semibold text-primary-dark">Se o valor for menor, a baixa fica registrada e o restante continua pendente neste mesmo agendamento.</p>
        {adjustmentAllowed ? <Field label="Ajuste depois do vencimento"><select name="adjustment_type" value={adjustmentType} onChange={(event) => setAdjustmentType(event.target.value as typeof adjustmentType)} className={INPUT}><option value="none">Sem ajuste</option><option value="interest">Juros</option><option value="discount">Desconto</option></select></Field> : <input type="hidden" name="adjustment_type" value="none" />}
        {adjustmentAllowed && adjustmentType !== "none" && <Field label={`Valor do ${adjustmentType === "interest" ? "juros" : "desconto"}`}><CurrencyInput name="adjustment_value" required /></Field>}
      </> : <><input type="hidden" name="realized_value" value={Number(transaction.valor)} /><input type="hidden" name="adjustment_type" value="none" /><p className="rounded-ff-sm bg-orange/10 p-3 text-xs font-semibold text-orange">Transferências e movimentos internos são concluídos integralmente e não aceitam pagamento parcial, juros ou desconto.</p></>}
      <Feedback state={feedback} />
      <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="ff-focus rounded-full border border-border px-4 py-3 text-sm font-bold text-foreground-muted transition hover:bg-surface-muted">Cancelar</button><button disabled={busy} className="ff-focus rounded-full bg-primary px-4 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.2)] transition hover:bg-primary-dark disabled:opacity-50">{busy ? "Concluindo..." : "Confirmar"}</button></div>
    </form>
  </Modal>;
}

function DeleteTransactionDialog({ transaction, summary, onClose, onChanged }: {
  transaction: TransactionRow;
  summary: PaymentSummary;
  onClose: () => void;
  onChanged: (message: string) => void;
}) {
  const series = isSeriesTransaction(transaction) && transaction.status === "pendente";
  const installment = isInstallmentTransaction(transaction);
  const [scope, setScope] = useState<"one" | "current_and_future" | "open_series">("one");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<TransactionActionState | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setFeedback(null);
    const formData = new FormData(event.currentTarget);
    formData.set("request_id", crypto.randomUUID());
    try {
      const result = await deleteTransaction(formData);
      if (result.erro) return setFeedback(result);
      onChanged(result.sucesso ?? "Lançamento excluído.");
    } catch { setFeedback(UNEXPECTED_ACTION_ERROR); }
    finally { setBusy(false); }
  }

  return <Modal title="Excluir lançamento" subtitle="Itens concluídos nunca são removidos junto com uma série aberta." onClose={onClose}>
    <form onSubmit={submit} className="grid gap-4">
      <input type="hidden" name="transaction_id" value={transaction.id} /><input type="hidden" name="expected_version" value={transaction.version} /><input type="hidden" name="series_scope" value={scope} />
      <div className="rounded-ff-sm bg-surface-muted p-4"><p className="font-extrabold">{descricaoVisivel(transaction.descricao)}</p><p data-private-value="true" className="mt-1 text-sm font-bold text-red">{formatarReais(summary.totalValue)}</p></div>
      {series && <fieldset><legend className="mb-2 text-sm font-bold">O que excluir?</legend><div className="grid gap-2">
        <button type="button" onClick={() => setScope("one")} className={`rounded-ff-sm border p-3 text-left text-sm font-bold ${scope === "one" ? "border-primary bg-primary-soft text-primary-dark" : "border-border"}`}>Somente este item</button>
        {installment && <button type="button" onClick={() => setScope("current_and_future")} className={`rounded-ff-sm border p-3 text-left text-sm font-bold ${scope === "current_and_future" ? "border-primary bg-primary-soft text-primary-dark" : "border-border"}`}>Esta parcela e as próximas pendentes</button>}
        <button type="button" onClick={() => setScope("open_series")} className={`rounded-ff-sm border p-3 text-left text-sm font-bold ${scope === "open_series" ? "border-primary bg-primary-soft text-primary-dark" : "border-border"}`}>Todos os itens pendentes da série</button>
      </div></fieldset>}
      <Feedback state={feedback} />
      <div className="grid grid-cols-2 gap-3"><button type="button" onClick={onClose} className="ff-focus rounded-full border border-border px-4 py-3 text-sm font-bold text-foreground-muted transition hover:bg-surface-muted">Cancelar</button><button disabled={busy} className="ff-focus rounded-full bg-red px-4 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(238,107,99,0.18)] transition hover:brightness-95 disabled:opacity-50">{busy ? "Excluindo..." : "Excluir"}</button></div>
    </form>
  </Modal>;
}

function MultiFilter({ label, summary, children, onClear, disabled = false }: {
  label: string;
  summary: string;
  children: ReactNode;
  onClear: () => void;
  disabled?: boolean;
}) {
  return <details className="group/filter relative min-w-0" {...(disabled ? { open: false } : {})}><summary className={`ff-focus flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-xl border border-border bg-surface-muted/55 px-3.5 py-2.5 text-sm transition hover:border-primary/35 hover:bg-surface-muted ${disabled ? "pointer-events-none opacity-45" : ""}`}><span className="min-w-0"><span className="block text-[10px] font-extrabold uppercase tracking-[0.12em] text-foreground-muted">{label}</span><strong className="block truncate text-foreground">{summary}</strong></span><span className="shrink-0 text-primary transition group-open/filter:rotate-180">⌄</span></summary><div className="absolute left-0 top-full z-40 mt-2 w-full min-w-[min(19rem,calc(100vw-3rem))] rounded-2xl border border-border bg-surface p-3 shadow-[0_22px_60px_rgba(0,0,0,0.28)]"><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-extrabold uppercase tracking-widest text-foreground-muted">Filtrar por {label.toLowerCase()}</span><button type="button" onClick={onClear} className="ff-focus rounded-full px-2 py-1 text-xs font-bold text-primary hover:bg-primary-soft">Selecionar todos</button></div><div className="max-h-64 space-y-1 overflow-y-auto overscroll-contain">{children}</div></div></details>;
}

function FilterOption({ checked, label, color, onChange }: { checked: boolean; label: string; color?: string; onChange: () => void }) {
  return <label className="flex cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2.5 transition hover:bg-surface-muted"><input type="checkbox" checked={checked} onChange={onChange} className="h-4 w-4 shrink-0 accent-primary" /><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color ?? "var(--color-primary)" }} /><span className="min-w-0 flex-1 break-words text-sm font-semibold leading-tight">{label}</span></label>;
}

function TransactionCard({ transaction, summary, accounts, categories, today, onOpen }: {
  transaction: TransactionRow;
  summary: PaymentSummary;
  accounts: Conta[];
  categories: Categoria[];
  today: string;
  onOpen: () => void;
}) {
  const kind = transactionKind(transaction);
  const account = accounts.find((item) => item.id === transaction.conta_id);
  const destination = destinationAccount(transaction, accounts);
  const category = categories.find((item) => item.id === transaction.categoria_id);
  const effectiveDate = effectiveTransactionDate(transaction, summary);
  const partial = summary.paymentCount > 0 && summary.remainingValue > 0;
  const status = summary.isFullyPaid ? "Concluído" : partial ? "Parcial" : transaction.data_vencimento < today ? "Atrasado" : transaction.data_vencimento === today ? "Hoje" : "Pendente";
  const statusClass = summary.isFullyPaid ? "bg-primary-soft text-primary-dark" : status === "Atrasado" ? "bg-red/10 text-red" : "bg-orange/10 text-orange";
  const valueClass = kind === "receita" ? "text-primary" : kind === "despesa" ? "text-red" : "text-orange";
  const recurrence = recurrenceLabel(transaction.descricao);

  return <article className="ff-card group overflow-hidden border-white/5 shadow-[0_12px_34px_rgba(0,0,0,0.07)] transition duration-300 hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_18px_44px_rgba(0,0,0,0.13)]"><button type="button" onClick={onOpen} className="ff-focus grid w-full gap-3 p-4 text-left sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center">
    <div className="hidden h-14 w-14 place-content-center rounded-2xl border border-border/60 bg-surface-muted/75 text-center transition group-hover:border-primary/25 sm:grid"><span className="text-lg font-black text-foreground">{effectiveDate.slice(8, 10)}</span><span className="text-[10px] font-bold uppercase text-foreground-muted">{new Intl.DateTimeFormat("pt-BR", { month: "short", timeZone: "UTC" }).format(new Date(`${effectiveDate}T12:00:00Z`)).replace(".", "")}</span></div>
    <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide ${kind === "receita" ? "bg-primary-soft text-primary-dark" : kind === "despesa" ? "bg-red/10 text-red" : "bg-orange/10 text-orange"}`}>{kind === "transferencia" ? "Transferência" : kind}</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${statusClass}`}>{status}</span>{recurrence && <span className="rounded-full bg-purple/10 px-2.5 py-1 text-[10px] font-bold text-purple">{recurrence}</span>}</div><h2 className="mt-2 truncate font-extrabold text-foreground">{descricaoVisivel(transaction.descricao)}</h2><div className="mt-1 flex flex-wrap gap-x-2 text-xs font-semibold text-foreground-muted"><span className="sm:hidden">{formatarData(effectiveDate)}</span>{account && <span style={{ color: account.cor }}>{account.nome}</span>}{destination && <span>→ {destination.nome}</span>}{category && <span style={{ color: category.cor }}>{category.nome}</span>}</div>{partial && <p data-private-value="true" className="mt-2 text-xs font-semibold text-orange">Realizado {formatarReais(summary.paidTotal)} · falta {formatarReais(summary.remainingValue)}</p>}</div>
    <div className="flex items-center justify-between gap-3 sm:block sm:text-right"><span className="text-xs font-semibold text-primary sm:hidden">Ver detalhes</span><p data-private-value="true" className={`text-lg font-black ${valueClass}`}>{kind === "receita" ? "+ " : kind === "despesa" ? "- " : "↔ "}{formatarReais(summary.totalValue)}</p><p className="mt-1 hidden text-xs font-semibold text-primary sm:block">Ver detalhes ›</p></div>
  </button></article>;
}

function InvoiceCard({ invoice, today }: { invoice: InvoiceHistoryGroup; today: string }) {
  const status = invoice.filtered
    ? "Resultado filtrado"
    : invoice.paid
      ? "Paga"
      : invoice.dueDate < today
        ? "Atrasada"
        : "Em aberto";
  const statusClass = invoice.filtered
    ? "bg-purple/10 text-purple"
    : invoice.paid
      ? "bg-primary-soft text-primary-dark"
      : invoice.dueDate < today
        ? "bg-red/10 text-red"
        : "bg-orange/10 text-orange";

  return <article className="ff-card group overflow-hidden border-white/5 shadow-[0_12px_34px_rgba(0,0,0,0.07)] transition duration-300 hover:-translate-y-0.5 hover:border-purple/25 hover:shadow-[0_18px_44px_rgba(0,0,0,0.13)]">
    <Link href={`/cartoes/${invoice.cardId}?fatura=${invoice.invoiceMonth}`} className="ff-focus grid w-full gap-3 border-l-4 p-4 text-left sm:grid-cols-[64px_minmax(0,1fr)_auto] sm:items-center" style={{ borderLeftColor: invoice.cardColor }}>
      <div className="hidden h-14 w-14 place-content-center rounded-ff-md bg-purple/10 text-center sm:grid"><span className="text-sm font-black text-purple">FAT</span><span className="text-[10px] font-bold uppercase text-foreground-muted">{invoice.invoiceMonth.slice(5)}/{invoice.invoiceMonth.slice(2, 4)}</span></div>
      <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-purple/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-purple">Fatura</span><span className={`rounded-full px-2.5 py-1 text-[10px] font-extrabold uppercase ${statusClass}`}>{status}</span>{!invoice.cardActive && <span className="rounded-full bg-surface-muted px-2.5 py-1 text-[10px] font-bold text-foreground-muted">Cartão arquivado</span>}</div><h2 className="mt-2 truncate font-extrabold text-foreground">Fatura de {monthTitle(invoice.invoiceMonth)}</h2><div className="mt-1 flex flex-wrap gap-x-2 text-xs font-semibold text-foreground-muted"><span className="sm:hidden">Vence em {formatarData(invoice.dueDate)}</span><span style={{ color: invoice.cardColor }}>{invoice.cardName}</span><span>{invoice.items.length} {invoice.items.length === 1 ? "item" : "itens"}</span></div>{invoice.filtered && <p className="mt-2 truncate text-xs font-semibold text-purple">{invoice.items.map((item) => item.descricao).join(" · ")}</p>}</div>
      <div className="flex items-center justify-between gap-3 sm:block sm:text-right"><span className="text-xs font-semibold text-primary sm:hidden">Ver fatura</span><p data-private-value="true" className={`text-lg font-black ${invoice.paid && !invoice.filtered ? "text-foreground-muted" : "text-red"}`}>- {formatarReais(invoice.total)}</p><p className="mt-1 hidden text-xs font-semibold text-primary sm:block">Vence {formatarData(invoice.dueDate)} ›</p></div>
    </Link>
  </article>;
}

export default function TransactionManager({ userId, initialMonth, initialQuick, initialOpenNew, initialKind, initialFocusId, returnHomeAfterCreate, today, accounts, categories, cards, invoiceItems, transactions, financialEvents, paymentSummaryRows }: Props) {
  const router = useRouter();
  const [month, setMonth] = useState(initialMonth);
  const [period, setPeriod] = useState<PeriodFilter>(initialQuick ?? "all");
  const [search, setSearch] = useState("");
  const [types, setTypes] = useState<HistoryKind[]>([]);
  const [accountIds, setAccountIds] = useState<number[]>([]);
  const [categoryIds, setCategoryIds] = useState<number[]>([]);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [newOpen, setNewOpen] = useState(initialOpenNew);
  const [detail, setDetail] = useState<TransactionRow | null>(null);
  const [detailHistory, setDetailHistory] = useState<PaymentHistory | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TransactionRow | null>(null);
  const [completing, setCompleting] = useState<TransactionRow | null>(null);
  const [deleting, setDeleting] = useState<TransactionRow | null>(null);
  const [reopening, setReopening] = useState<TransactionRow | null>(null);
  const [operationBusy, setOperationBusy] = useState(false);
  const [operationFeedback, setOperationFeedback] = useState<TransactionActionState | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const detailRequest = useRef(0);
  const focusedFromShortcut = useRef<number | null>(null);

  useEffect(() => {
    if (!initialOpenNew) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("new");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [initialOpenNew]);
  useEffect(() => {
    if (!flash) return;
    const timeout = window.setTimeout(() => setFlash(null), 4_500);
    return () => window.clearTimeout(timeout);
  }, [flash]);

  const summaryById = useMemo(() => {
    const rawById = new Map<number, unknown>();
    for (const row of paymentSummaryRows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const id = Number((row as Record<string, unknown>).root_transaction_id ?? (row as Record<string, unknown>).transaction_id);
      if (Number.isSafeInteger(id) && id > 0) rawById.set(id, row);
    }
    return new Map(transactions.map((transaction) => [transaction.id, normalizePaymentSummary(rawById.get(transaction.id), transaction)]));
  }, [paymentSummaryRows, transactions]);
  const summaryFor = (transaction: TransactionRow) => summaryById.get(transaction.id) ?? normalizePaymentSummary(null, transaction);
  const focusedTransaction = useMemo(() => {
    if (!initialFocusId) return null;
    return transactions.find((transaction) => transaction.id === initialFocusId)
      ?? transactions.find((transaction) => summaryById.get(transaction.id)?.technicalTransactionIds.includes(initialFocusId))
      ?? null;
  }, [initialFocusId, summaryById, transactions]);
  const focusedTransactionId = focusedTransaction?.id ?? null;
  const searchTerm = normalizeSearch(search.trim());
  const nextSeven = addIsoDays(today, 7);
  const invoiceGroups = useMemo(() => groupInvoiceItems(invoiceItems, cards), [cards, invoiceItems]);
  const categoryNamesById = useMemo(() => new Map(categories.map((category) => [category.id, category.nome])), [categories]);

  function matchesBasic(transaction: TransactionRow): boolean {
    const kind = transactionKind(transaction);
    if (types.length && !types.includes(kind)) return false;
    if (accountIds.length) {
      const destination = destinationAccount(transaction, accounts);
      if (!accountIds.includes(transaction.conta_id) && (!destination || !accountIds.includes(destination.id))) return false;
    }
    if (categoryIds.length && (transaction.categoria_id === null || !categoryIds.includes(transaction.categoria_id))) return false;
    return !searchTerm || transactionSearchText(transaction, accounts, categories).includes(searchTerm);
  }

  function matchesPeriod(transaction: TransactionRow, candidate: PeriodFilter): boolean {
    const summary = summaryFor(transaction);
    const date = effectiveTransactionDate(transaction, summary);
    if (candidate === "attention") return !summary.isFullyPaid && isAttentionDueDate(transaction.data_vencimento, today);
    if (candidate === "overdue") return !summary.isFullyPaid && transaction.data_vencimento < today;
    if (candidate === "today") return !summary.isFullyPaid && transaction.data_vencimento === today;
    if (candidate === "next7") return !summary.isFullyPaid && transaction.data_vencimento >= today && transaction.data_vencimento <= nextSeven;
    if (!date.startsWith(month)) return false;
    if (candidate === "completed") return summary.isFullyPaid;
    if (candidate === "pending") return !summary.isFullyPaid;
    return true;
  }

  const basicTransactions = transactions.filter(matchesBasic);
  const basicInvoices = (!types.length || types.includes("fatura")) && accountIds.length === 0
    ? invoiceGroups.flatMap((group) => {
      const filteredGroup = filterInvoiceGroupItems(group, search, categoryIds, categoryNamesById);
      return filteredGroup ? [filteredGroup] : [];
    })
    : [];
  function matchesInvoicePeriod(invoice: InvoiceHistoryGroup, candidate: PeriodFilter): boolean {
    if (candidate === "attention") return false;
    if (candidate === "overdue") return !invoice.paid && invoice.dueDate < today;
    // O app mantém os atalhos de hoje e sete dias para agendamentos. Faturas
    // entram no atalho específico de atraso e na navegação mensal.
    if (candidate === "today" || candidate === "next7") return false;
    if (invoice.invoiceMonth !== month) return false;
    if (candidate === "completed") return invoice.paid;
    if (candidate === "pending") return !invoice.paid;
    return true;
  }
  const filteredTransactions = basicTransactions.filter((transaction) => matchesPeriod(transaction, period));
  const filteredInvoices = basicInvoices.filter((invoice) => matchesInvoicePeriod(invoice, period));
  const filtered: HistoryItem[] = [
    ...filteredTransactions.map((transaction): HistoryItem => ({
      kind: "transaction",
      key: `transaction:${transaction.id}`,
      id: transaction.id,
      date: effectiveTransactionDate(transaction, summaryFor(transaction)),
      transaction,
    })),
    ...filteredInvoices.map((invoice): HistoryItem => ({
      kind: "invoice",
      key: `invoice:${invoice.cardId}:${invoice.invoiceMonth}`,
      id: invoice.orderId,
      date: invoice.dueDate,
      invoice,
    })),
  ].sort((first, second) => compareMobileHistory(
    { id: first.id, date: first.date },
    { id: second.id, date: second.date },
    today,
  ));
  const filteredFinancialEvents = financialEvents.filter((transaction) => {
    if (!matchesBasic(transaction)) return false;
    const eventDate = transaction.status === "paga"
      ? transaction.data_realizacao ?? transaction.data_vencimento
      : transaction.data_vencimento;
    if (period === "attention") return transaction.status === "pendente" && isAttentionDueDate(transaction.data_vencimento, today);
    if (period === "overdue") return transaction.status === "pendente" && transaction.data_vencimento < today;
    if (period === "today") return transaction.status === "pendente" && transaction.data_vencimento === today;
    if (period === "next7") return transaction.status === "pendente" && transaction.data_vencimento >= today && transaction.data_vencimento <= nextSeven;
    if (!eventDate.startsWith(month)) return false;
    if (period === "completed") return transaction.status === "paga";
    if (period === "pending") return transaction.status === "pendente";
    return true;
  });
  const totals = historyFinancialTotals(filteredFinancialEvents, filteredInvoices);

  function syncUrl(nextPeriod: PeriodFilter, nextMonth = month) {
    const url = new URL(window.location.href);
    url.searchParams.set("month", nextMonth);
    url.searchParams.delete("new");
    if (nextPeriod === "attention" || nextPeriod === "overdue" || nextPeriod === "today" || nextPeriod === "next7") url.searchParams.set("quick", nextPeriod);
    else url.searchParams.delete("quick");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }
  function choosePeriod(value: PeriodFilter) { setPeriod(value); setLimit(PAGE_SIZE); syncUrl(value); }
  function changeMonth(delta: number) { const next = shiftMonth(month, delta); setMonth(next); setPeriod("all"); setLimit(PAGE_SIZE); syncUrl("all", next); }
  function clearFilters() {
    setSearch("");
    setPeriod("all");
    setTypes([]);
    setAccountIds([]);
    setCategoryIds([]);
    setLimit(PAGE_SIZE);
    syncUrl("all");
  }
  function toggle<T>(value: T, values: T[], setter: (next: T[]) => void) { setter(values.includes(value) ? values.filter((item) => item !== value) : [...values, value]); setLimit(PAGE_SIZE); }
  function toggleType(value: HistoryKind) {
    const next = types.includes(value) ? types.filter((item) => item !== value) : [...types, value];
    setTypes(next);
    if (next.length > 0 && next.every((type) => type === "transferencia")) setCategoryIds([]);
    setLimit(PAGE_SIZE);
  }
  function closeDetails() { detailRequest.current += 1; setDetail(null); setDetailHistory(null); setDetailError(null); setDetailLoading(false); }
  function changed(message: string) { setNewOpen(false); setEditing(null); setCompleting(null); setDeleting(null); setReopening(null); closeDetails(); setFlash(message); router.refresh(); }
  function created(message: string) {
    setNewOpen(false);
    if (returnHomeAfterCreate) {
      router.replace("/");
      return;
    }
    setFlash(message);
    router.refresh();
  }

  const openDetails = useCallback(async (transaction: TransactionRow) => {
    const requestNumber = detailRequest.current + 1;
    detailRequest.current = requestNumber;
    setDetail(transaction); setDetailHistory(null); setDetailError(null); setDetailLoading(true); setOperationFeedback(null);
    try {
      const result = await getTransactionPaymentHistory(transaction.id);
      if (detailRequest.current !== requestNumber) return;
      setDetailLoading(false);
      if (result.erro) return setDetailError(result.erro);
      if (result.dados) setDetailHistory(normalizePaymentHistory(result.dados, transaction));
    } catch {
      if (detailRequest.current === requestNumber) { setDetailLoading(false); setDetailError(UNEXPECTED_ACTION_ERROR.erro); }
    }
  }, []);

  useEffect(() => {
    if (!initialFocusId || !focusedTransaction || focusedFromShortcut.current === initialFocusId) return;
    focusedFromShortcut.current = initialFocusId;
    const url = new URL(window.location.href);
    url.searchParams.delete("focus");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    void openDetails(focusedTransaction);
  }, [focusedTransaction, initialFocusId, openDetails]);

  async function reopen(transaction: TransactionRow) {
    if (operationBusy) return;
    setOperationBusy(true); setOperationFeedback(null);
    const formData = new FormData(); formData.set("transaction_id", String(transaction.id)); formData.set("request_id", crypto.randomUUID());
    try {
      const result = await reopenTransaction(formData);
      if (result.erro) return setOperationFeedback(result);
      changed(result.sucesso ?? "Lançamento reaberto.");
    } catch { setOperationFeedback(UNEXPECTED_ACTION_ERROR); }
    finally { setOperationBusy(false); }
  }

  const typeSummary = types.length ? types.map((value) => value === "transferencia" ? "Transferências" : value === "fatura" ? "Faturas" : `${value.charAt(0).toUpperCase()}${value.slice(1)}s`).join(", ") : "Todos";
  const accountSummary = accountIds.length === 0 ? "Todas" : accountIds.length === 1 ? accounts.find((account) => account.id === accountIds[0])?.nome ?? "1 conta" : `${accountIds.length} contas`;
  const categoryDisabled = types.length > 0 && types.every((type) => type === "transferencia");
  const categorySummary = categoryDisabled ? "Não se aplica" : categoryIds.length === 0 ? "Todas" : categoryIds.length === 1 ? categories.find((category) => category.id === categoryIds[0])?.nome ?? "1 categoria" : `${categoryIds.length} categorias`;
  const periods: { value: PeriodFilter; label: string }[] = [{ value: "all", label: "Todos" }, { value: "completed", label: "Concluídos" }, { value: "pending", label: "Pendentes" }, { value: "overdue", label: "Atrasados" }];
  const detailSummary = detail ? detailHistory?.summary ?? summaryFor(detail) : null;
  const activeCategories = categories.filter(isActiveCategory);
  const revenueCategories = activeCategories.filter((category) => category.tipo === "receita" || category.tipo === "ambos");
  const expenseCategories = activeCategories.filter((category) => category.tipo === "despesa" || category.tipo === "ambos");
  const hasActiveFilters = search.trim().length > 0
    || period !== "all"
    || types.length > 0
    || accountIds.length > 0
    || categoryIds.length > 0;

  return <>
    <header className="ff-page-hero mb-5 px-5 py-6 sm:px-7 sm:py-7">
      <div aria-hidden="true" className="absolute -right-20 -top-24 h-64 w-64 rounded-full border border-white/10" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
        <div><p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mint">Movimentações</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Histórico</h1><p className="mt-2 max-w-xl text-sm leading-relaxed text-white/72">Lançamentos, recorrências, transferências e faturas em uma linha do tempo completa.</p></div>
      </div>
      <div className="relative mt-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-2"><button type="button" onClick={() => changeMonth(-1)} aria-label="Mês anterior" className="ff-focus grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/10 text-xl font-black text-white transition hover:bg-white/10">‹</button><div className="min-w-40 text-center"><p className="text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/55">Período mensal</p><p className="mt-0.5 font-black text-white">{monthTitle(month)}</p></div><button type="button" onClick={() => changeMonth(1)} aria-label="Próximo mês" className="ff-focus grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-black/10 text-xl font-black text-white transition hover:bg-white/10">›</button></div>
        <div className="grid grid-cols-3 gap-2"><div className="min-w-0 rounded-xl border border-white/10 bg-black/15 px-2.5 py-2 sm:px-3"><p className="text-[9px] font-bold uppercase text-white/55">Itens</p><p className="truncate font-black">{filtered.length}</p></div><div className="min-w-0 rounded-xl border border-white/10 bg-black/15 px-2.5 py-2 sm:px-3"><p className="text-[9px] font-bold uppercase text-white/55">Receitas</p><p data-private-value="true" className="truncate text-sm font-black text-mint sm:text-base">{formatarReais(totals.receita)}</p></div><div className="min-w-0 rounded-xl border border-white/10 bg-black/15 px-2.5 py-2 sm:px-3"><p className="text-[9px] font-bold uppercase text-white/55">Despesas</p><p data-private-value="true" className="truncate text-sm font-black text-[#ff8c84] sm:text-base">{formatarReais(totals.despesa)}</p></div></div>
      </div>
    </header>
    {flash && <p role="status" className="mb-4 rounded-ff-md border border-primary/25 bg-primary-soft px-4 py-3 text-sm font-bold text-primary-dark">{flash}</p>}
    <section className="ff-card mb-4 border-white/5 p-4 shadow-[0_14px_40px_rgba(0,0,0,0.08)] sm:p-5">
      <label className="relative block w-full"><span className="sr-only">Buscar no Histórico</span><span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-foreground-muted">⌕</span><input value={search} onChange={(event) => { setSearch(event.target.value); setLimit(PAGE_SIZE); }} placeholder="Buscar descrição, conta, categoria ou item da fatura" className="ff-focus w-full rounded-full border border-border bg-surface-muted py-3.5 pl-11 pr-4 text-sm outline-none transition focus:border-primary" /></label>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">{periods.map((item) => <button key={item.value} type="button" onClick={() => choosePeriod(item.value)} className={`ff-focus shrink-0 rounded-full border px-4 py-2 text-xs font-extrabold transition ${period === item.value ? "border-primary bg-primary text-white shadow-[0_8px_18px_rgba(22,150,110,0.2)]" : "border-border bg-surface text-foreground-muted hover:border-primary/35 hover:text-foreground"}`}>{item.label}</button>)}</div>
        <button type="button" onClick={clearFilters} disabled={!hasActiveFilters} className="ff-focus shrink-0 rounded-full border border-border bg-surface px-4 py-2 text-xs font-extrabold text-primary transition hover:border-primary/40 hover:bg-primary-soft disabled:cursor-not-allowed disabled:opacity-40">Limpar filtros</button>
      </div>
      {(period === "attention" || period === "overdue" || period === "today" || period === "next7") && <p className="mt-3 text-xs font-semibold text-orange">Este filtro rápido atravessa meses. Use as setas para voltar à visão mensal.</p>}
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <MultiFilter label="Tipo" summary={typeSummary} onClear={() => { setTypes([]); setLimit(PAGE_SIZE); }}>{(["receita", "despesa", "transferencia", "fatura"] as HistoryKind[]).map((value) => <FilterOption key={value} checked={types.includes(value)} label={value === "transferencia" ? "Transferências" : value === "fatura" ? "Faturas" : `${value.charAt(0).toUpperCase()}${value.slice(1)}s`} color={value === "receita" ? "#16966E" : value === "despesa" ? "#EE6B63" : value === "fatura" ? "#805AD5" : "#F28A55"} onChange={() => toggleType(value)} />)}</MultiFilter>
        <MultiFilter label="Conta" summary={accountSummary} onClear={() => { setAccountIds([]); setLimit(PAGE_SIZE); }}>{accounts.map((account) => <FilterOption key={account.id} checked={accountIds.includes(account.id)} label={`${account.nome}${account.arquivado ? " (arquivada)" : ""}`} color={account.cor} onChange={() => toggle(account.id, accountIds, setAccountIds)} />)}</MultiFilter>
        <MultiFilter label="Categoria" summary={categorySummary} disabled={categoryDisabled} onClear={() => { setCategoryIds([]); setLimit(PAGE_SIZE); }}>
          {expenseCategories.length > 0 && <><p className="px-2 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-[.12em] text-red">Despesas</p>{expenseCategories.map((category) => <FilterOption key={`expense-${category.id}`} checked={categoryIds.includes(category.id)} label={category.nome} color={category.cor} onChange={() => toggle(category.id, categoryIds, setCategoryIds)} />)}</>}
          {revenueCategories.length > 0 && <><p className="mt-2 border-t border-border px-2 pb-1 pt-3 text-[10px] font-extrabold uppercase tracking-[.12em] text-primary">Receitas</p>{revenueCategories.map((category) => <FilterOption key={`revenue-${category.id}`} checked={categoryIds.includes(category.id)} label={category.nome} color={category.cor} onChange={() => toggle(category.id, categoryIds, setCategoryIds)} />)}</>}
        </MultiFilter>
      </div>
    </section>
    <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold text-foreground">Linha do tempo</h2><span className="text-xs font-semibold text-foreground-muted">Mais recentes primeiro</span></div>
    <div className="grid gap-3">{filtered.slice(0, limit).map((item) => item.kind === "invoice"
      ? <InvoiceCard key={item.key} invoice={item.invoice} today={today} />
      : <div key={item.key} className={focusedTransactionId === item.transaction.id ? "rounded-[22px] ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}><TransactionCard transaction={item.transaction} summary={summaryFor(item.transaction)} accounts={accounts} categories={categories} today={today} onOpen={() => { void openDetails(item.transaction); }} /></div>)}</div>
    {filtered.length === 0 && <section className="ff-card grid min-h-48 place-content-center p-6 text-center"><p className="text-3xl">⌕</p><h2 className="mt-2 font-extrabold">Nenhum lançamento encontrado</h2><p className="mt-1 text-sm text-foreground-muted">Ajuste o período, a busca ou os filtros.</p></section>}
    {limit < filtered.length && <button type="button" onClick={() => setLimit((value) => value + PAGE_SIZE)} className="mx-auto mt-5 block rounded-full border border-primary px-5 py-2.5 text-sm font-extrabold text-primary">Mostrar mais {Math.min(PAGE_SIZE, filtered.length - limit)}</button>}

    {newOpen && <NewTransactionDialog accounts={accounts} categories={categories} today={today} initialKind={initialKind} onClose={() => setNewOpen(false)} onChanged={created} />}
    {editing && <EditTransactionDialog transaction={editing} summary={summaryFor(editing)} accounts={accounts} categories={categories} userId={userId} onClose={() => setEditing(null)} onChanged={changed} />}
    {completing && <CompleteTransactionDialog transaction={completing} today={today} onClose={() => setCompleting(null)} onChanged={changed} />}
    {deleting && <DeleteTransactionDialog transaction={deleting} summary={summaryFor(deleting)} onClose={() => setDeleting(null)} onChanged={changed} />}
    {reopening && <ConfirmationDialog
      title={summaryFor(reopening).paymentCount > 0 ? "Reabrir o último pagamento?" : "Reabrir este lançamento?"}
      description={summaryFor(reopening).paymentCount > 0
        ? "A baixa mais recente será desfeita e o valor restante do lançamento será recalculado."
        : "O lançamento voltará a ficar pendente e deixará de compor os valores realizados."}
      confirmLabel={summaryFor(reopening).paymentCount > 0 ? "Reabrir último" : "Reabrir lançamento"}
      pending={operationBusy}
      onClose={() => { if (!operationBusy) { setReopening(null); setOperationFeedback(null); } }}
      onConfirm={() => { void reopen(reopening); }}
    >
      <Feedback state={operationFeedback} />
    </ConfirmationDialog>}

    {detail && detailSummary && <Modal title="Detalhes do lançamento" subtitle={recurrenceLabel(detail.descricao) ?? undefined} onClose={closeDetails} wide>
      <div className="grid gap-5">
        <div className="rounded-ff-md bg-surface-muted p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-bold uppercase text-foreground-muted">{transactionKind(detail) === "transferencia" ? "Transferência" : detail.tipo}</p><h3 className="mt-1 text-lg font-extrabold">{descricaoVisivel(detail.descricao)}</h3></div><p data-private-value="true" className={`text-xl font-black ${transactionKind(detail) === "receita" ? "text-primary" : transactionKind(detail) === "despesa" ? "text-red" : "text-orange"}`}>{formatarReais(detailSummary.totalValue)}</p></div><dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-xs text-foreground-muted">Conta</dt><dd className="font-bold">{accounts.find((account) => account.id === detail.conta_id)?.nome ?? "Conta indisponível"}{destinationAccount(detail, accounts) ? ` → ${destinationAccount(detail, accounts)?.nome}` : ""}</dd></div><div><dt className="text-xs text-foreground-muted">Categoria</dt><dd className="font-bold">{categories.find((category) => category.id === detail.categoria_id)?.nome ?? "Não se aplica"}</dd></div><div><dt className="text-xs text-foreground-muted">Agendado</dt><dd className="font-bold">{formatarData(detail.data_vencimento)}</dd></div><div><dt className="text-xs text-foreground-muted">Última realização</dt><dd className="font-bold">{detailSummary.lastRealizationDate ? formatarData(detailSummary.lastRealizationDate) : "Ainda não realizada"}</dd></div></dl></div>
        <div><div className="flex items-center justify-between"><h3 className="font-extrabold">Pagamentos</h3>{detailSummary.paymentCount > 0 && <span className="rounded-full bg-orange/10 px-2.5 py-1 text-xs font-bold text-orange">{detailSummary.paymentCount} {detailSummary.paymentCount === 1 ? "baixa" : "baixas"}</span>}</div><div className="mt-3 grid grid-cols-3 gap-2"><div className="rounded-ff-sm bg-surface-muted p-3"><p className="text-[10px] font-bold uppercase text-foreground-muted">Total</p><p data-private-value="true" className="mt-1 text-sm font-black">{formatarReais(detailSummary.totalValue)}</p></div><div className="rounded-ff-sm bg-primary-soft p-3"><p className="text-[10px] font-bold uppercase text-primary-dark">Realizado</p><p data-private-value="true" className="mt-1 text-sm font-black text-primary-dark">{formatarReais(detailSummary.paidTotal)}</p></div><div className="rounded-ff-sm bg-orange/10 p-3"><p className="text-[10px] font-bold uppercase text-orange">Restante</p><p data-private-value="true" className="mt-1 text-sm font-black text-orange">{formatarReais(detailSummary.remainingValue)}</p></div></div>
          {detailLoading && <p className="mt-3 text-sm text-foreground-muted">Carregando pagamentos...</p>}{detailError && <p role="alert" className="mt-3 text-sm font-semibold text-red">{detailError}</p>}{detailHistory && detailHistory.payments.length > 0 && <div className="mt-3 space-y-2">{detailHistory.payments.map((payment) => <div key={payment.paymentId} className={`flex items-center justify-between gap-3 rounded-ff-sm border border-border px-3 py-2 text-sm ${payment.active ? "" : "opacity-55"}`}><div><p className="font-bold">{payment.active ? `Pagamento ${payment.paymentSequence}` : `Pagamento ${payment.paymentSequence} reaberto`}</p><p className="text-xs text-foreground-muted">{formatarData(payment.realizationDate)}{payment.adjustmentType !== "none" ? ` · ${payment.adjustmentType === "interest" ? "juros" : "desconto"} ${formatarReais(payment.adjustmentValue)}` : ""}</p></div><strong data-private-value="true" className={payment.active ? "text-primary" : "line-through"}>{formatarReais(payment.value)}</strong></div>)}</div>}
        </div>
        <Feedback state={operationFeedback} />
        {!isPagamentoFatura(detail.descricao) ? <div className="grid grid-cols-2 gap-2 sm:grid-cols-4"><button type="button" onClick={() => { const selected = detail; closeDetails(); setEditing(selected); }} className="rounded-ff-sm border border-blue/35 bg-blue/10 px-3 py-2.5 text-sm font-bold text-blue">Editar</button>{!detailSummary.isFullyPaid && <button type="button" onClick={() => { const selected = detail; closeDetails(); setCompleting(selected); }} className="rounded-ff-sm bg-primary px-3 py-2.5 text-sm font-bold text-white">Concluir</button>}{(detailSummary.isFullyPaid || detailSummary.paymentCount > 0) && <button type="button" disabled={operationBusy} onClick={() => { const selected = detail; setOperationFeedback(null); closeDetails(); setReopening(selected); }} className="rounded-ff-sm border border-orange/40 bg-orange/10 px-3 py-2.5 text-sm font-bold text-orange disabled:opacity-50">{detailSummary.paymentCount > 0 ? "Reabrir último" : "Reabrir"}</button>}{detailSummary.paymentCount === 0 && <button type="button" onClick={() => { const selected = detail; closeDetails(); setDeleting(selected); }} className="rounded-ff-sm border border-red/40 bg-red/10 px-3 py-2.5 text-sm font-bold text-red">Excluir</button>}</div> : <p className="rounded-ff-sm bg-orange/10 p-3 text-sm font-semibold text-orange">Este item pertence a um pagamento de fatura. Use a tela do cartão para estornar com segurança.</p>}
        <div className="flex justify-end"><button type="button" onClick={closeDetails} className="rounded-ff-sm border border-border px-5 py-2.5 text-sm font-bold text-foreground-muted">Fechar</button></div>
      </div>
    </Modal>}
    <p className="mt-6 text-center text-xs text-foreground-muted">Precisa organizar contas ou categorias? <Link href="/contas" className="font-bold text-primary">Contas</Link> · <Link href="/categorias" className="font-bold text-primary">Categorias</Link></p>
  </>;
}
