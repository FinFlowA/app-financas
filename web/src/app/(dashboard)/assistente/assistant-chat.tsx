"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { ABRIR_AJUDA_EVENTO } from "@/components/layout/contextual-help";
import { formatAssistantMessage } from "../../../../../lib/assistant-message-format";
import { lerCotaConsultas } from "../../../../../lib/cota-ia";
import { inFinnVoice } from "../../../../../lib/finn-voice";
import { finnProductGuidance } from "../../../../../lib/finn-product-guidance";
import { parseFinanceAiHttpResponse } from "../../../../../lib/finance-ai/validation";
import { FINANCE_AI_MUTATION_INTENTS } from "../../../../../lib/finance-ai/types";
import type { FinanceAiAccountBalancesCard, FinanceAiHttpSuccessResponse, FinanceAiMarketIndicators } from "../../../../../lib/finance-ai/types";
import { createClient } from "@/lib/supabase/client";
import styles from "./assistente.module.css";
import stateStyles from "@/app/app-states.module.css";

type Message = {
  id: string; role: "user" | "assistant"; text: string;
  marketIndicators?: FinanceAiMarketIndicators; accountBalances?: FinanceAiAccountBalancesCard;
};
type Quota = { plan: string; limit: number; remaining: number; model_limit: number; model_remaining: number };
type PendingActionPreview = { title?: string; summary?: string; consequences?: string[] };
type PendingAction = { id: string; confirmationToken: string; actionType: string; expiresAt: string; preview?: PendingActionPreview };
type AiResponse = {
  error?: string; message?: string; kind?: string; conversationId?: string | null; route?: string;
  pendingAction?: PendingAction; quota?: Quota; cleared?: boolean; choices?: string[]; missingFields?: string[];
  messages?: { id: string; role: "user" | "assistant"; text: string; marketIndicators?: FinanceAiMarketIndicators; accountBalances?: FinanceAiAccountBalancesCard }[];
  marketIndicators?: FinanceAiMarketIndicators;
  accountBalances?: FinanceAiAccountBalancesCard;
};

const INLINE_CHOICE_LIMIT = 4;
const mutationIntents = new Set<string>(FINANCE_AI_MUTATION_INTENTS);

function normalizeChoice(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function actionTitle(action: PendingAction): string {
  return action.preview?.title?.trim() || "Revise a ação financeira";
}

function actionSummary(action: PendingAction): string {
  return action.preview?.summary?.trim() || "Confira todas as informações antes de confirmar.";
}

/** Achata o contrato estrito (por `kind`) no formato interno usado pela tela. */
function toViewModel(value: FinanceAiHttpSuccessResponse): AiResponse {
  if ("cleared" in value && value.cleared) return { cleared: true, conversationId: null, messages: [] };
  if ("kind" in value) {
    const base: AiResponse = { kind: value.kind, message: value.message };
    if ("conversationId" in value) base.conversationId = value.conversationId;
    if ("quota" in value) base.quota = value.quota;
    if (value.kind === "answer" && value.marketIndicators) base.marketIndicators = value.marketIndicators;
    if (value.kind === "answer" && value.accountBalances) base.accountBalances = value.accountBalances;
    if (value.kind === "clarify") {
      base.choices = value.choices;
      base.missingFields = value.missingFields;
    }
    if (value.kind === "navigate") base.route = value.route;
    if (value.kind === "proposal") base.pendingAction = value.pendingAction;
    return base;
  }
  // Formato de histórico: { conversationId, messages, quota? }.
  return { conversationId: value.conversationId, messages: value.messages, quota: value.quota };
}

function AssistantMessage({ text }: { text: string }) {
  return (
    <div className={styles.assistantMessageContent}>
      {formatAssistantMessage(text).map((block, blockIndex) => (
        <p key={`${blockIndex}-${block.parts[0]?.text ?? ""}`}>
          {block.parts.map((part, partIndex) => part.emphasis
            ? <strong key={`${partIndex}-${part.text}`}>{part.text}</strong>
            : <span key={`${partIndex}-${part.text}`}>{part.text}</span>)}
        </p>
      ))}
    </div>
  );
}

function shortReferenceDate(value: string | null): string | null {
  const match = value ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  return match ? `${match[3]}/${match[2]}` : null;
}

function IndicatorTile({ label, rate, referenceDate, suffix = "% a.a." }: { label: string; rate: number | null; referenceDate: string | null; suffix?: string }) {
  const shortDate = shortReferenceDate(referenceDate);
  return (
    <div className={styles.marketIndicatorCard}>
      <span className={styles.marketIndicatorLabel}>{label}</span>
      {rate === null
        ? <span className={styles.marketIndicatorValue} data-unavailable="true">Indisponível</span>
        : <span className={styles.marketIndicatorValue}>{rate.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{suffix}</span>}
      {shortDate && <span className={styles.marketIndicatorDate}>ref. {shortDate}</span>}
    </div>
  );
}

/** Cartão visual com os indicadores públicos do BCB citados na resposta — em
 * vez de deixar os números presos no meio do texto corrido, o que passava
 * despercebido e era pouco interativo para o usuário. */
function MarketIndicatorsCard({ indicators }: { indicators: FinanceAiMarketIndicators }) {
  return (
    <div className={styles.marketIndicators}>
      <IndicatorTile label="Selic" rate={indicators.selic_rate_annual} referenceDate={indicators.selic_reference_date} />
      <IndicatorTile label="CDI" rate={indicators.cdi_rate_annual} referenceDate={indicators.cdi_reference_date} />
      <IndicatorTile label="IPCA 12m" rate={indicators.ipca_12m_percent} referenceDate={indicators.ipca_reference_date} suffix="%" />
      <IndicatorTile label="IGP-M 12m" rate={indicators.igpm_12m_percent} referenceDate={indicators.igpm_reference_date} suffix="%" />
      <span className={styles.marketIndicatorSource}>Fonte: Banco Central (SGS)</span>
    </div>
  );
}

function formatMoney(value: number): string {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** Cartão visual com o saldo por conta — já vem limitado às de maior saldo
 * (no máximo 6) para não poluir a tela de quem tem muitas contas cadastradas. */
function AccountBalancesCard({ accounts }: { accounts: FinanceAiAccountBalancesCard }) {
  return (
    <div className={styles.accountBalances}>
      {accounts.accounts.map((account, index) => (
        <div key={`${account.name}-${index}`} className={styles.accountBalanceCard}>
          <span className={styles.accountBalanceName}>{account.name}</span>
          <span className={styles.accountBalanceValue}>{formatMoney(account.balance)}</span>
        </div>
      ))}
      {accounts.hiddenCount > 0 && (
        <span className={styles.accountBalanceHidden}>+{accounts.hiddenCount} {accounts.hiddenCount === 1 ? "conta" : "contas"}</span>
      )}
    </div>
  );
}

const ICONS = {
  wallet: <><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H17v3" /><path d="M4 7.5v9A2.5 2.5 0 0 0 6.5 19H20V8H6.5A2.5 2.5 0 0 1 4 7.5Z" /><circle cx="16" cy="13.5" r="1.1" fill="currentColor" stroke="none" /></>,
  receipt: <><path d="M6 3.5h12v17l-2.2-1.4-2 1.4-1.8-1.4-1.8 1.4-2-1.4L6 20.5v-17Z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></>,
  add: <><circle cx="12" cy="12" r="8.5" /><path d="M12 8.5v7M8.5 12h7" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" /></>,
  lock: <><rect x="5" y="10.5" width="14" height="10" rx="2.5" /><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" /></>,
  chart: <><path d="M4 19.5h16" /><path d="m6.5 15 4-4.5 3 2.5 4.5-5.5" /></>,
  shield: <><path d="M12 3.5 19 6v5.5c0 4.2-3 7.5-7 9-4-1.5-7-4.8-7-9V6l7-2.5Z" /><path d="m9 12 2 2 4-4" /></>,
  spark: <><path d="m12 3.5 1.6 5 5 1.6-5 1.6-1.6 5-1.6-5-5-1.6 5-1.6 1.6-5Z" /><path d="m18.5 15.5.6 1.9 1.9.6-1.9.6-.6 1.9-.6-1.9-1.9-.6 1.9-.6.6-1.9Z" /></>,
  trash: <><path d="M5 7h14" /><path d="M9.5 7V5h5v2" /><path d="m7 7 .8 12.5h8.4L17 7" /></>,
  help: <><circle cx="12" cy="12" r="8.5" /><path d="M9.7 9.5a2.4 2.4 0 0 1 4.6.9c0 1.6-2.3 2-2.3 3.5" /><circle cx="12" cy="16.9" r="0.9" fill="currentColor" stroke="none" /></>,
  send: <><path d="M12 19V5.5" /><path d="m6.5 11 5.5-5.5 5.5 5.5" /></>,
} satisfies Record<string, ReactNode>;

function Icon({ name, size = 20 }: { name: keyof typeof ICONS; size?: number }) {
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{ICONS[name]}</svg>;
}

// As mesmas quatro sugestões do app, com uma linha dizendo o que cada uma faz.
const SUGGESTIONS: ReadonlyArray<{ text: string; hint: string; icon: keyof typeof ICONS }> = [
  { text: "Qual é meu saldo atual?", hint: "O saldo de cada conta e o total", icon: "wallet" },
  { text: "Quais despesas tenho neste mês?", hint: "O que já saiu e o que ainda vai vencer", icon: "receipt" },
  { text: "Registrar uma despesa", hint: "Eu preparo e você confere antes de salvar", icon: "add" },
  { text: "Criar um objetivo", hint: "Para guardar dinheiro para uma meta", icon: "target" },
];

/** Anel da cota de consultas do dia, como o AnelCota do app (30px, traço de 3px, começa no topo). */
function QuotaRing({ fraction }: { fraction: number }) {
  const radius = 13.5;
  const circumference = 2 * Math.PI * radius;
  return (
    <svg aria-hidden="true" width="30" height="30" viewBox="0 0 30 30">
      <circle cx="15" cy="15" r={radius} className={styles.quotaRingTrack} />
      <circle cx="15" cy="15" r={radius} className={styles.quotaRingValue} strokeDasharray={`${Math.max(0, Math.min(1, fraction)) * circumference} ${circumference}`} transform="rotate(-90 15 15)" />
    </svg>
  );
}

const WELCOME = "Olá! Eu sou o Finn, seu assistente financeiro no FinFlow. Posso conversar, explicar seus números e preparar ações para você revisar. Nenhuma alteração é feita sem sua confirmação.";
// Formato de conversa (em vez da grade genérica de cartões) para condizer com
// o que realmente aparece depois: linhas alternadas simulando trocas entre o
// Finn e a pessoa, do mesmo jeito que o histórico real vai preencher a tela.
const HISTORY_SKELETON_ROWS: ReadonlyArray<{ role: "user" | "assistant"; width: string }> = [
  { role: "assistant", width: "62%" },
  { role: "user", width: "38%" },
  { role: "assistant", width: "74%" },
  { role: "assistant", width: "48%" },
  { role: "user", width: "30%" },
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NAVIGATION_ROUTES: Readonly<Record<string, string>> = {
  "/": "/",
  "/transacoes": "/transacoes",
  "/caixinhas": "/objetivos",
  "/objetivos": "/objetivos",
  "/relatorios": "/relatorios",
  "/cartoes": "/cartoes",
  "/?abrirCategorias=1": "/categorias",
  "/categorias": "/categorias",
};

// Checagem leve de integridade do cache local (aba fechada e reaberta, ou uma
// versão anterior do site). O contrato de rede em si já passou pela validação
// estrita e completa de `parseFinanceAiHttpResponse` antes de ser salvo aqui.
function parseStoredPendingAction(value: string | null): PendingAction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const previewRaw = parsed.preview && typeof parsed.preview === "object" && !Array.isArray(parsed.preview)
      ? parsed.preview as Record<string, unknown>
      : undefined;
    const action: PendingAction = {
      id: typeof parsed.id === "string" ? parsed.id : "",
      confirmationToken: typeof parsed.confirmationToken === "string" ? parsed.confirmationToken : "",
      actionType: typeof parsed.actionType === "string" ? parsed.actionType : "",
      expiresAt: typeof parsed.expiresAt === "string" ? parsed.expiresAt : "",
      ...(previewRaw ? {
        preview: {
          ...(typeof previewRaw.title === "string" ? { title: previewRaw.title } : {}),
          ...(typeof previewRaw.summary === "string" ? { summary: previewRaw.summary } : {}),
          ...(Array.isArray(previewRaw.consequences) && previewRaw.consequences.every((item) => typeof item === "string")
            ? { consequences: previewRaw.consequences.slice(0, 20) as string[] }
            : {}),
        },
      } : {}),
    };
    if (!UUID.test(action.id)
      || !UUID.test(action.confirmationToken)
      || !mutationIntents.has(action.actionType)
      || !Number.isFinite(Date.parse(action.expiresAt))
      || Date.parse(action.expiresAt) <= Date.now()) return null;
    return action;
  } catch {
    return null;
  }
}

function safeError(body: Record<string, unknown>) {
  if (body.mode === "confirm") return "Não foi possível confirmar agora. Tente novamente: a confirmação é idempotente e não duplicará a ação.";
  return "Não consegui processar sua solicitação agora. Nenhuma alteração foi realizada.";
}

async function publicFunctionError(error: unknown): Promise<string | null> {
  if (!error || typeof error !== "object" || !("context" in error)) return null;
  const context = (error as { context?: unknown }).context;
  if (!(context instanceof Response)) return null;
  try {
    const payload: unknown = await context.clone().json();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
    const row = payload as Record<string, unknown>;
    const code = typeof row.error === "string" ? row.error : "";
    const message = typeof row.message === "string" ? row.message.trim() : "";
    if (!/^(?:AI_[A-Z0-9_]+|UNAUTHORIZED|INVALID_REQUEST)$/.test(code)) return null;
    return message.length > 0 && message.length <= 500 ? message : null;
  } catch {
    return null;
  }
}

export default function AssistantChat({
  userId,
  hasAccess,
  plan,
  initialPrompt,
  firstName,
  greeting,
}: {
  userId: string;
  hasAccess: boolean;
  plan: string;
  initialPrompt: string | null;
  firstName: string;
  greeting: string;
}) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const conversationKey = `finflow:web:ai-conversation:${userId}`;
  // O token fica somente na sessão desta aba: sobrevive a um reload acidental,
  // mas é descartado ao fechar a aba e nunca entra no cache do service worker.
  const pendingKey = `finflow:web:ai-pending:${userId}`;
  const [messages, setMessages] = useState<Message[]>([{ id: "welcome", role: "assistant", text: WELCOME }]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [historyReady, setHistoryReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  // Erro da limpeza mostrado dentro da janela de confirmação (atrás dela ninguém veria).
  const [clearError, setClearError] = useState<string | null>(null);
  const [clarificationChoices, setClarificationChoices] = useState<string[]>([]);
  const [clarificationField, setClarificationField] = useState<string | null>(null);
  const [quotaInfoOpen, setQuotaInfoOpen] = useState(false);

  // O balão da cota some sozinho, como o aviso do app.
  useEffect(() => {
    if (!quotaInfoOpen) return;
    const timer = window.setTimeout(() => setQuotaInfoOpen(false), 4000);
    return () => window.clearTimeout(timer);
  }, [quotaInfoOpen]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const consumedInitialPrompt = useRef<string | null>(null);

  // O campo cresce com o texto até o limite do CSS e volta a uma linha ao enviar.
  useEffect(() => {
    const field = textareaRef.current;
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${field.scrollHeight}px`;
  }, [input]);

  const autocompleteChoices = useMemo(() => {
    const query = normalizeChoice(input);
    if (clarificationChoices.length <= INLINE_CHOICE_LIMIT || !query) return [];
    return clarificationChoices.filter((choice) => normalizeChoice(choice).includes(query)).slice(0, 6);
  }, [clarificationChoices, input]);

  async function invoke(body: Record<string, unknown>): Promise<AiResponse> {
    const { data, error } = await supabase.functions.invoke("finance-ai", { body });
    if (error) {
      const parsedErrorBody = parseFinanceAiHttpResponse(data);
      if (parsedErrorBody.ok && "error" in parsedErrorBody.value) {
        throw new Error(parsedErrorBody.value.message || safeError(body));
      }
      throw new Error(await publicFunctionError(error) ?? safeError(body));
    }
    const parsed = parseFinanceAiHttpResponse(data);
    if (!parsed.ok) throw new Error(safeError(body));
    if ("error" in parsed.value) throw new Error(parsed.value.message || "A solicitação foi recusada com segurança.");
    return toViewModel(parsed.value);
  }

  function persistPendingAction(action: PendingAction | null) {
    setPendingAction(action);
    try {
      if (action) sessionStorage.setItem(pendingKey, JSON.stringify(action));
      else sessionStorage.removeItem(pendingKey);
    } catch {
      // A proposta continua disponível nesta montagem quando o navegador
      // bloqueia o armazenamento da sessão.
    }
  }

  function apply(response: AiResponse) {
    if (response.conversationId && UUID.test(response.conversationId)) {
      setConversationId(response.conversationId);
      try { localStorage.setItem(conversationKey, response.conversationId); } catch { /* memória da montagem permanece válida */ }
    }
    if (response.quota) setQuota(response.quota);
    if (response.message) setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: response.message!, marketIndicators: response.marketIndicators, accountBalances: response.accountBalances }]);
    setClarificationChoices(response.kind === "clarify" && Array.isArray(response.choices) ? response.choices : []);
    setClarificationField(response.kind === "clarify" && Array.isArray(response.missingFields) ? response.missingFields[0] ?? null : null);
    if (response.pendingAction && UUID.test(response.pendingAction.id) && UUID.test(response.pendingAction.confirmationToken)) persistPendingAction(response.pendingAction);
    if (response.kind === "navigate" && response.route) {
      const destination = NAVIGATION_ROUTES[response.route];
      if (destination) router.push(destination);
      else setNotice("Não consegui abrir a tela sugerida porque ela não está disponível no site.");
    }
  }

  useEffect(() => {
    if (!hasAccess) return;
    let active = true;
    let stored: string | null = null;
    try { stored = localStorage.getItem(conversationKey); } catch { /* armazenamento indisponível */ }
    const id = stored && UUID.test(stored) ? stored : null;
    let storedPending: string | null = null;
    try { storedPending = sessionStorage.getItem(pendingKey); } catch { /* armazenamento indisponível */ }
    const restoredPending = parseStoredPendingAction(storedPending);
    if (restoredPending) setPendingAction(restoredPending);
    else if (storedPending) {
      try { sessionStorage.removeItem(pendingKey); } catch { /* armazenamento indisponível */ }
    }
    setBusy(true);
    void invoke({ mode: "history", ...(id ? { conversationId: id } : {}) })
      .then((response) => {
        if (!active) return;
        if (response.conversationId && UUID.test(response.conversationId)) {
          setConversationId(response.conversationId);
          try { localStorage.setItem(conversationKey, response.conversationId); } catch { /* memória da montagem permanece válida */ }
        } else if (id) {
          try { localStorage.removeItem(conversationKey); } catch { /* armazenamento indisponível */ }
        }
        if (response.messages?.length) setMessages(response.messages.map((message) => ({ id: String(message.id), role: message.role, text: message.text, marketIndicators: message.marketIndicators, accountBalances: message.accountBalances })));
        if (response.quota) setQuota(response.quota);
      })
      .catch(() => {
        // O histórico é complementar: uma falha silenciosa não deve assustar
        // nem impedir que a pessoa inicie uma nova conversa com o Finn.
      })
      .finally(() => {
        if (!active) return;
        setBusy(false);
        setHistoryReady(true);
      });
    return () => { active = false; };
    // A função invoke usa o cliente estável desta montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, hasAccess, pendingKey]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, pendingAction]);

  useEffect(() => {
    if (!hasAccess || !historyReady || busy || pendingAction || !initialPrompt) return;
    if (consumedInitialPrompt.current === initialPrompt) return;
    consumedInitialPrompt.current = initialPrompt;
    void send(undefined, initialPrompt);
    // Remove o atalho depois de enfileirar a pergunta para que um reload não
    // consuma outra consulta da franquia do usuário.
    router.replace("/assistente", { scroll: false });
    // `send` usa o estado atual da conversa carregado imediatamente antes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, hasAccess, historyReady, initialPrompt, pendingAction, router]);

  async function send(event?: FormEvent, suggested?: string) {
    event?.preventDefault();
    const typed = (suggested ?? input).trim();
    const normalizedTyped = normalizeChoice(typed);
    // Com muitas opções (ex.: categorias), o texto digitado livremente é
    // resolvido para a opção exata quando bate com uma única sugestão — o
    // servidor recebe o texto oficial, não uma variante digitada à mão.
    const matchingChoices = suggested || clarificationChoices.length <= INLINE_CHOICE_LIMIT || !normalizedTyped
      ? []
      : clarificationChoices.filter((choice) => normalizeChoice(choice).includes(normalizedTyped));
    const text = (suggested ?? (matchingChoices.length === 1 ? matchingChoices[0] : typed)).trim();
    if (!text || busy || pendingAction || !hasAccess) return;
    const productGuidance = finnProductGuidance(text, messages.slice(-4).map((message) => message.text).join("\n"));
    if (productGuidance) {
      setNotice(null);
      setInput("");
      setClarificationChoices([]);
      setClarificationField(null);
      setMessages((current) => [
        ...current,
        { id: crypto.randomUUID(), role: "user", text },
        { id: crypto.randomUUID(), role: "assistant", text: productGuidance },
      ]);
      return;
    }
    setBusy(true); setNotice(null); setInput("");
    setClarificationChoices([]); setClarificationField(null);
    setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", text }]);
    try { apply(await invoke({ mode: "message", message: text, ...(conversationId ? { conversationId } : {}), requestId: crypto.randomUUID() })); }
    catch (error) { setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: error instanceof Error ? error.message : "Não foi possível consultar agora." }]); }
    finally { setBusy(false); }
  }

  async function confirmPending() {
    if (!pendingAction || busy) return;
    if (Date.parse(pendingAction.expiresAt) <= Date.now()) { persistPendingAction(null); setNotice("Esta confirmação expirou. Peça novamente para preparar a ação."); return; }
    setBusy(true); setNotice(null);
    try { const response = await invoke({ mode: "confirm", actionId: pendingAction.id, confirmationToken: pendingAction.confirmationToken, ...(conversationId ? { conversationId } : {}) }); persistPendingAction(null); apply(response); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível confirmar."); }
    finally { setBusy(false); }
  }

  async function cancel() {
    if (!pendingAction || busy) return;
    setBusy(true); setNotice(null);
    try { const response = await invoke({ mode: "cancel", actionId: pendingAction.id, ...(conversationId ? { conversationId } : {}) }); persistPendingAction(null); apply(response); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível cancelar."); }
    finally { setBusy(false); }
  }

  async function clearHistory() {
    if (busy) return;
    setBusy(true); setNotice(null); setClearError(null);
    try {
      if (pendingAction) {
        await invoke({ mode: "cancel", actionId: pendingAction.id });
        // Já cancelada no servidor: uma nova tentativa de limpar não repete o cancelamento.
        persistPendingAction(null);
      }
      const response = await invoke({ mode: "clear", ...(conversationId ? { conversationId } : {}) });
      if (!response.cleared) throw new Error("O servidor não confirmou a limpeza.");
      persistPendingAction(null); setConversationId(null);
      try { localStorage.removeItem(conversationKey); } catch { /* armazenamento indisponível */ }
      setMessages([{ id: "welcome", role: "assistant", text: WELCOME }]);
      setClarificationChoices([]);
      setClarificationField(null);
      setConfirmClear(false);
    } catch (error) { setClearError(error instanceof Error ? error.message : "Não foi possível limpar agora."); }
    finally { setBusy(false); }
  }

  if (!hasAccess) {
    return (
      <div className={styles.page}>
        <section className={styles.locked}>
          <button type="button" onClick={() => window.dispatchEvent(new Event(ABRIR_AJUDA_EVENTO))} className={`${styles.helpButton} ${styles.lockedHelp}`} aria-label="Ajuda sobre a tela do Finn" title="Ajuda">
            <Icon name="help" size={18} />
          </button>
          <div className={styles.lockedArt} aria-hidden>
            <span className={styles.heroGlow} />
            <Image src="/finn-help-guide.webp" alt="" width={120} height={120} className={styles.lockedFinn} />
          </div>
          <div className={styles.lockedCopy}>
            <p className={styles.eyebrow}>Finn · FinFlow</p>
            <h1>Seu controle financeiro por conversa</h1>
            <p className={styles.lockedDescription}>A IA operacional está disponível nos planos Smart e Premium. Seu plano atual é {plan}. Todas as ações financeiras exigem sua revisão e confirmação.</p>
            <Link href="/planos" className={styles.lockedCta}>Conhecer planos</Link>
          </div>
        </section>
      </div>
    );
  }

  const cota = lerCotaConsultas(quota);
  const showHero = historyReady && messages.length <= 1 && messages[0]?.id === "welcome";
  return (
    <div className={styles.page}>
      <section className={styles.chatShell} aria-label="Conversa com o Finn, assistente financeiro do FinFlow">
        <header className={styles.chatHeader}>
          <div className={styles.assistantIdentity}>
            <span className={styles.assistantAvatarWrap} aria-hidden>
              <span className={styles.assistantIcon}>
                <Image src="/finn-chat-header.png" alt="" width={48} height={48} />
              </span>
              <span className={styles.statusDot} data-busy={busy} />
            </span>
            <div className="min-w-0">
              <p className={styles.eyebrow}>Assistente financeiro</p>
              <div className={styles.titleRow}>
                <h1 className={styles.chatTitle}>Finn</h1>
                {/* Como no app: "online" ou "digitando…" enquanto ele responde. */}
                <span className={styles.statusText} data-busy={busy}>{busy ? "digitando…" : "online"}</span>
              </div>
            </div>
          </div>
          <div className={styles.headerActions}>
            {/* A ajuda da tela abre por aqui: o botão flutuante cobriria o campo de mensagem. */}
            <button type="button" onClick={() => window.dispatchEvent(new Event(ABRIR_AJUDA_EVENTO))} className={styles.helpButton} aria-label="Ajuda sobre a tela do Finn" title="Ajuda">
              <Icon name="help" size={18} />
            </button>
            <button type="button" onClick={() => { setClearError(null); setConfirmClear(true); }} disabled={busy} className={styles.clearButton} aria-label="Limpar conversa">
              <Icon name="trash" size={17} />
              <span>Limpar conversa</span>
            </button>
          </div>
        </header>

        {confirmClear && <ConfirmationDialog
          title="Limpar esta conversa?"
          description="Todo o histórico será apagado e qualquer ação pendente também será cancelada. Essa escolha não pode ser desfeita."
          confirmLabel="Apagar histórico"
          pending={busy}
          onClose={() => { setConfirmClear(false); setClearError(null); }}
          onConfirm={() => void clearHistory()}
        >
          {clearError && <p role="alert" className={styles.clearError}>{clearError}</p>}
        </ConfirmationDialog>}

        <div className={styles.messages} aria-live="polite" aria-busy={busy}>
          <div className={styles.messagesInner}>
            {!historyReady ? (
              <div className={styles.historySkeleton} role="status" aria-live="polite" aria-busy="true" aria-label="Carregando conversas anteriores">
                <span className={stateStyles.srOnly}>Carregando conversas anteriores...</span>
                {HISTORY_SKELETON_ROWS.map((row, index) => (
                  <div key={index} className={styles.skeletonRow} data-role={row.role} aria-hidden="true">
                    {row.role === "assistant" && <span className={`${stateStyles.skeleton} ${styles.skeletonAvatar}`} />}
                    <span className={`${stateStyles.skeleton} ${styles.skeletonBubble}`} style={{ width: row.width }} />
                  </div>
                ))}
              </div>
            ) : showHero ? (
              // Conversa nova: o Finn se apresenta e mostra por onde começar.
              <div className={styles.hero}>
                <div className={styles.heroArt} aria-hidden>
                  <span className={styles.heroGlow} />
                  <Image src="/finn-chat-header.png" alt="" width={176} height={176} priority className={styles.heroFinn} />
                </div>
                <p className={styles.heroEyebrow}>Finn · seu assistente financeiro</p>
                <h2 className={styles.heroTitle}>{greeting}{firstName ? `, ${firstName}` : ""}! Como posso ajudar?</h2>
                <p className={styles.heroText}>Posso explicar seus números, tirar dúvidas e preparar lançamentos e objetivos para você revisar.</p>
                <div className={styles.suggestions} aria-label="Sugestões de perguntas">
                  {SUGGESTIONS.map((suggestion) => (
                    <button type="button" key={suggestion.text} onClick={() => void send(undefined, suggestion.text)} disabled={busy} className={styles.suggestion}>
                      <span className={styles.suggestionIcon}><Icon name={suggestion.icon} /></span>
                      <span className={styles.suggestionCopy}><strong>{suggestion.text}</strong><small>{suggestion.hint}</small></span>
                      <span className={styles.suggestionArrow} aria-hidden>→</span>
                    </button>
                  ))}
                </div>
                <ul className={styles.trustRow}>
                  <li><Icon name="lock" size={15} />Nada é alterado sem a sua confirmação</li>
                  <li><Icon name="chart" size={15} />Explica os números do seu FinFlow</li>
                  <li><Icon name="shield" size={15} />Conexão protegida</li>
                </ul>
              </div>
            ) : (
              <>
                {messages.map((message) => (
                  <div key={message.id}>
                    <div className={styles.messageRow} data-role={message.role}>
                      {message.role === "assistant" && <span className={styles.messageAvatar} aria-hidden><Image src="/finn-message-avatar.png" alt="" width={32} height={32} /></span>}
                      <div className={styles.messageBubble}>
                        {message.role === "assistant" ? <AssistantMessage text={inFinnVoice(message.text)} /> : message.text}
                      </div>
                    </div>
                    {message.marketIndicators && <MarketIndicatorsCard indicators={message.marketIndicators} />}
                    {message.accountBalances && <AccountBalancesCard accounts={message.accountBalances} />}
                  </div>
                ))}
                {messages.length <= 1 && (
                  <div className={`${styles.suggestions} ${styles.suggestionsInline}`} aria-label="Sugestões de perguntas">
                    {SUGGESTIONS.map((suggestion) => (
                      <button type="button" key={suggestion.text} onClick={() => void send(undefined, suggestion.text)} disabled={busy} className={styles.suggestion}>
                        <span className={styles.suggestionIcon}><Icon name={suggestion.icon} /></span>
                        <span className={styles.suggestionCopy}><strong>{suggestion.text}</strong><small>{suggestion.hint}</small></span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {pendingAction && (
              <section className={styles.pendingCard} aria-labelledby="pending-action-title">
                <p className={styles.pendingEyebrow}><Icon name="spark" size={14} />Aguardando sua confirmação</p>
                <h2 id="pending-action-title" className={styles.pendingTitle}>{actionTitle(pendingAction)}</h2>
                <p className={styles.pendingSummary}>{actionSummary(pendingAction)}</p>
                {(pendingAction.preview?.consequences?.length ?? 0) > 0 && (
                  <ul className={styles.consequences}>{pendingAction.preview!.consequences!.map((item) => <li key={item}>{item}</li>)}</ul>
                )}
                <p className={styles.safeNotice}><Icon name="lock" size={15} />A ação só será executada pelo botão Confirmar abaixo.</p>
                <div className={styles.pendingActions}>
                  <button type="button" onClick={cancel} disabled={busy} className={styles.cancelButton}>Cancelar</button>
                  <button type="button" onClick={confirmPending} disabled={busy} className={styles.confirmButton}>Confirmar</button>
                </div>
              </section>
            )}
            {!pendingAction && clarificationChoices.length > 0 && clarificationChoices.length <= INLINE_CHOICE_LIMIT && (
              <section className={styles.choiceCard} aria-label="Escolha uma opção">
                <p className={styles.choiceTitle}>Escolha uma opção</p>
                <div className={styles.choiceGrid}>
                  {clarificationChoices.map((choice) => (
                    <button type="button" key={choice} onClick={() => void send(undefined, choice)} disabled={busy} className={styles.choiceButton}>{choice}</button>
                  ))}
                </div>
              </section>
            )}
            {historyReady && busy && (
              <div className={styles.messageRow} data-role="assistant" role="status">
                <span className={styles.messageAvatar} aria-hidden><Image src="/finn-message-avatar.png" alt="" width={32} height={32} /></span>
                <div className={`${styles.messageBubble} ${styles.typingBubble}`}>
                  <span className={styles.typingDot} aria-hidden />
                  <span className={styles.typingDot} aria-hidden />
                  <span className={styles.typingDot} aria-hidden />
                  <span className={stateStyles.srOnly}>Estou analisando com segurança</span>
                </div>
              </div>
            )}
            {notice && <p role="alert" className={styles.notice}>{notice}</p>}
            <div ref={bottomRef} />
          </div>
        </div>

        <form onSubmit={(event) => void send(event)} className={styles.composer}>
          <div className={styles.composerInner}>
            {!pendingAction && autocompleteChoices.length > 0 && (
              <div className={styles.autocompletePanel} role="listbox" aria-label="Sugestões de opções">
                {autocompleteChoices.map((choice) => (
                  <button type="button" key={choice} onClick={() => void send(undefined, choice)} disabled={busy} className={styles.autocompleteOption}>{choice}</button>
                ))}
              </div>
            )}
            <div className={styles.composerRow}>
              {/* Como no app: o anel das consultas do dia à esquerda do campo; o clique mostra quantas restam. */}
              {cota && (
                <div className={styles.quotaWrap}>
                  <button
                    type="button"
                    className={styles.quotaButton}
                    data-level={cota.nivel}
                    onClick={() => setQuotaInfoOpen((current) => !current)}
                    onBlur={() => setQuotaInfoOpen(false)}
                    aria-expanded={quotaInfoOpen}
                    aria-label={`${cota.restantes} de ${cota.limite} consultas restantes hoje`}
                    title={`${cota.restantes} de ${cota.limite} consultas ao Finn restantes hoje`}
                  >
                    <QuotaRing fraction={cota.fracao} />
                  </button>
                  {quotaInfoOpen && (
                    <p role="status" className={styles.quotaInfo}>
                      {cota.restantes} de {cota.limite} consultas ao Finn restantes hoje.
                      {quota && <span>{quota.limit < 0 ? "Ações: ilimitadas" : `Ações: ${Math.max(0, quota.remaining)} de ${quota.limit}`}</span>}
                    </p>
                  )}
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                  event.preventDefault();
                  if (!busy && !pendingAction && input.trim()) void send();
                }}
                disabled={busy || !!pendingAction}
                maxLength={2000}
                rows={1}
                enterKeyHint="send"
                aria-label="Mensagem para a IA financeira"
                // Textos curtos: no celular, o anel e o botão de enviar dividem a linha com o campo.
                placeholder={pendingAction
                  ? "Confirme ou cancele acima"
                  : clarificationChoices.length > INLINE_CHOICE_LIMIT
                    ? `Busque ${clarificationField === "category_id" ? "uma categoria" : "uma opção"}`
                    : "Pergunte ou peça uma ação"}
                className={styles.textarea}
              />
              <button type="submit" disabled={busy || !!pendingAction || !input.trim()} className={styles.sendButton} aria-label="Enviar">
                <Icon name="send" size={20} />
              </button>
            </div>
            <p className={styles.disclaimer}><span className={styles.keyboardHint}>Enter envia · Shift + Enter quebra a linha · </span>Revise valores e datas antes de confirmar.</p>
          </div>
        </form>
      </section>
    </div>
  );
}
