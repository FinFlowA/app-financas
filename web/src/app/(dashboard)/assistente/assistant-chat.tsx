"use client";

import Link from "next/link";
import Image from "next/image";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { formatAssistantMessage } from "../../../../../lib/assistant-message-format";
import { inFinnVoice } from "../../../../../lib/finn-voice";
import { finnProductGuidance } from "../../../../../lib/finn-product-guidance";
import { parseFinanceAiHttpResponse } from "../../../../../lib/finance-ai/validation";
import { FINANCE_AI_MUTATION_INTENTS } from "../../../../../lib/finance-ai/types";
import type { FinanceAiHttpSuccessResponse } from "../../../../../lib/finance-ai/types";
import { createClient } from "@/lib/supabase/client";
import styles from "./assistente.module.css";
import stateStyles from "@/app/app-states.module.css";

type Message = { id: string; role: "user" | "assistant"; text: string };
type Quota = { plan: string; limit: number; remaining: number; model_limit: number; model_remaining: number };
type PendingActionPreview = { title?: string; summary?: string; consequences?: string[] };
type PendingAction = { id: string; confirmationToken: string; actionType: string; expiresAt: string; preview?: PendingActionPreview };
type AiResponse = {
  error?: string; message?: string; kind?: string; conversationId?: string | null; route?: string;
  pendingAction?: PendingAction; quota?: Quota; cleared?: boolean; choices?: string[]; missingFields?: string[];
  messages?: { id: string; role: "user" | "assistant"; text: string }[];
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
}: {
  userId: string;
  hasAccess: boolean;
  plan: string;
  initialPrompt: string | null;
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
  const [clarificationChoices, setClarificationChoices] = useState<string[]>([]);
  const [clarificationField, setClarificationField] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const consumedInitialPrompt = useRef<string | null>(null);

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
    if (response.message) setMessages((current) => [...current, { id: crypto.randomUUID(), role: "assistant", text: response.message! }]);
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
        if (response.messages?.length) setMessages(response.messages.map((message) => ({ id: String(message.id), role: message.role, text: message.text })));
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
    setBusy(true); setNotice(null);
    try {
      if (pendingAction) await invoke({ mode: "cancel", actionId: pendingAction.id });
      const response = await invoke({ mode: "clear", ...(conversationId ? { conversationId } : {}) });
      if (!response.cleared) throw new Error("O servidor não confirmou a limpeza.");
      persistPendingAction(null); setConversationId(null);
      try { localStorage.removeItem(conversationKey); } catch { /* armazenamento indisponível */ }
      setMessages([{ id: "welcome", role: "assistant", text: WELCOME }]);
      setClarificationChoices([]);
      setClarificationField(null);
      setConfirmClear(false);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível limpar agora."); }
    finally { setBusy(false); }
  }

  if (!hasAccess) {
    return (
      <div className={styles.page}>
        <section className={styles.locked}>
          <div className={styles.lockedIcon} aria-hidden>
            <svg width="27" height="27" viewBox="0 0 24 24" fill="none"><path d="m12 2 1.4 4.6L18 8l-4.6 1.4L12 14l-1.4-4.6L6 8l4.6-1.4L12 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="m18.5 14 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z" fill="currentColor"/></svg>
          </div>
          <p className={styles.eyebrow}>Finn · FinFlow</p>
          <h1>Seu controle financeiro por conversa</h1>
          <p className={styles.lockedDescription}>A IA operacional está disponível nos planos Smart e Premium. Seu plano atual é {plan}. Todas as ações financeiras exigem sua revisão e confirmação.</p>
          <Link href="/planos" className={styles.lockedCta}>Conhecer planos</Link>
        </section>
      </div>
    );
  }

  const quotaText = quota ? `${Math.max(0, quota.remaining)}/${quota.limit < 0 ? "∞" : quota.limit} ações · ${Math.max(0, quota.model_remaining)}/${quota.model_limit} consultas` : "Conexão protegida";
  return (
    <div className={styles.page}>
      <section className={styles.chatShell} aria-label="Conversa com o Finn, assistente financeiro do FinFlow">
        <header className={styles.chatHeader}>
          <div className={styles.assistantIdentity}>
            <span className={styles.assistantIcon} aria-hidden>
              <Image src="/finn-chat-header.png" alt="" width={43} height={43} />
            </span>
            <div className="min-w-0">
              <p className={styles.eyebrow}>Assistente financeiro</p>
              <h1 className={styles.chatTitle}>Finn</h1>
              <p className={styles.quota}>{quotaText}</p>
            </div>
          </div>
          <div className={styles.headerActions}>
            <button type="button" onClick={() => setConfirmClear(true)} disabled={busy} className={styles.clearButton}>Limpar conversa</button>
          </div>
        </header>

        {confirmClear && <ConfirmationDialog
          title="Limpar esta conversa?"
          description="Todo o histórico será apagado e qualquer ação pendente também será cancelada. Essa escolha não pode ser desfeita."
          confirmLabel="Apagar histórico"
          pending={busy}
          onClose={() => setConfirmClear(false)}
          onConfirm={() => void clearHistory()}
        />}

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
            ) : (
              <>
                {messages.map((message) => (
                  <div key={message.id} className={styles.messageRow} data-role={message.role}>
                    {message.role === "assistant" && <span className={styles.messageAvatar} aria-hidden><Image src="/finn-message-avatar.png" alt="" width={31} height={31} /></span>}
                    <div className={styles.messageBubble}>
                      {message.role === "assistant" ? <AssistantMessage text={inFinnVoice(message.text)} /> : message.text}
                    </div>
                  </div>
                ))}
                {messages.length <= 1 && (
                  <div className={styles.suggestions} aria-label="Sugestões de perguntas">
                    {["Qual é meu saldo atual?", "Quais despesas tenho neste mês?", "Registrar uma despesa", "Criar um objetivo"].map((suggestion) => (
                      <button type="button" key={suggestion} onClick={() => void send(undefined, suggestion)} className={styles.suggestion}>{suggestion}</button>
                    ))}
                  </div>
                )}
              </>
            )}
            {pendingAction && (
              <section className={styles.pendingCard} aria-labelledby="pending-action-title">
                <p className={styles.pendingEyebrow}>Aguardando sua confirmação</p>
                <h2 id="pending-action-title" className={styles.pendingTitle}>{actionTitle(pendingAction)}</h2>
                <p className={styles.pendingSummary}>{actionSummary(pendingAction)}</p>
                {(pendingAction.preview?.consequences?.length ?? 0) > 0 && (
                  <ul className={styles.consequences}>{pendingAction.preview!.consequences!.map((item) => <li key={item}>{item}</li>)}</ul>
                )}
                <p className={styles.safeNotice}>A ação só será executada pelo botão Confirmar abaixo.</p>
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
            {busy && <p role="status" className={styles.typing}>Estou analisando com segurança</p>}
            {notice && <p role="alert" className={styles.notice}>{notice}</p>}
            <div ref={bottomRef} />
          </div>
        </div>

        <form onSubmit={(event) => void send(event)} className={styles.composer}>
          {!pendingAction && autocompleteChoices.length > 0 && (
            <div className={styles.autocompletePanel} role="listbox" aria-label="Sugestões de opções">
              {autocompleteChoices.map((choice) => (
                <button type="button" key={choice} onClick={() => void send(undefined, choice)} disabled={busy} className={styles.autocompleteOption}>{choice}</button>
              ))}
            </div>
          )}
          <div className={styles.composerRow}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
                event.preventDefault();
                if (!busy && !pendingAction && input.trim()) void send();
              }}
              disabled={busy || !!pendingAction}
              maxLength={2000}
              rows={2}
              enterKeyHint="send"
              aria-label="Mensagem para a IA financeira"
              placeholder={pendingAction
                ? "Confirme ou cancele a proposta para continuar"
                : clarificationChoices.length > INLINE_CHOICE_LIMIT
                  ? `Digite para buscar ${clarificationField === "category_id" ? "uma categoria" : "uma opção"}`
                  : "Pergunte ou peça uma ação financeira"}
              className={styles.textarea}
            />
            <button type="submit" disabled={busy || !!pendingAction || !input.trim()} className={styles.sendButton}>
              <span>Enviar</span>
              <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="m5 12 14-7-4.5 14-3-5.5L5 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m11.5 13.5 3.3-3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
          <p className={styles.disclaimer}>Enter envia • Shift + Enter quebra a linha. Revise valores e datas.</p>
        </form>
      </section>
    </div>
  );
}
