"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import { createClient } from "@/lib/supabase/client";
import styles from "./assistente.module.css";

type Message = { id: string; role: "user" | "assistant"; text: string };
type Quota = { plan: string; limit: number; remaining: number; model_limit: number; model_remaining: number };
type PendingAction = { id: string; confirmationToken: string; actionType: string; expiresAt: string; preview: { title: string; summary: string; consequences: string[] } };
type AiResponse = {
  error?: string; message?: string; kind?: string; conversationId?: string | null; route?: string;
  pendingAction?: PendingAction; quota?: Quota; cleared?: boolean;
  messages?: { id: string; role: "user" | "assistant"; text: string }[];
};

const WELCOME = "Olá! Sou a IA financeira do FinFlow. Posso analisar seus dados e preparar ações para você revisar. Nenhuma alteração é feita sem sua confirmação.";
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

function validPendingAction(value: unknown): value is PendingAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const action = value as Record<string, unknown>;
  if (!UUID.test(String(action.id)) || !UUID.test(String(action.confirmationToken))) return false;
  if (typeof action.actionType !== "string" || typeof action.expiresAt !== "string" || !Number.isFinite(Date.parse(action.expiresAt))) return false;
  if (!action.preview || typeof action.preview !== "object" || Array.isArray(action.preview)) return false;
  const preview = action.preview as Record<string, unknown>;
  return typeof preview.title === "string"
    && typeof preview.summary === "string"
    && Array.isArray(preview.consequences)
    && preview.consequences.every((item) => typeof item === "string");
}

function parseStoredPendingAction(value: string | null): PendingAction | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!validPendingAction(parsed) || Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

function validResponse(value: unknown): value is AiResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  if (typeof row.error === "string") return !row.message || typeof row.message === "string";
  if (row.cleared === true) return true;
  if (Array.isArray(row.messages)) return row.messages.every((message) => !!message && typeof message === "object" && ["user", "assistant"].includes(String((message as Record<string, unknown>).role)) && typeof (message as Record<string, unknown>).text === "string");
  if (typeof row.kind !== "string" || typeof row.message !== "string") return false;
  if (row.pendingAction !== undefined && !validPendingAction(row.pendingAction)) return false;
  if (row.kind === "navigate" && typeof row.route !== "string") return false;
  return true;
}

function safeError(body: Record<string, unknown>) {
  if (body.mode === "confirm") return "Não foi possível confirmar agora. Tente novamente: a confirmação é idempotente e não duplicará a ação.";
  return "A IA financeira está indisponível agora. Nenhuma alteração foi realizada.";
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const consumedInitialPrompt = useRef<string | null>(null);

  async function invoke(body: Record<string, unknown>): Promise<AiResponse> {
    const { data, error } = await supabase.functions.invoke("finance-ai", { body });
    if (error) {
      if (validResponse(data) && data.error) throw new Error(data.message || safeError(body));
      throw new Error(await publicFunctionError(error) ?? safeError(body));
    }
    if (!validResponse(data)) throw new Error(safeError(body));
    if (data.error) throw new Error(data.message || "A solicitação foi recusada com segurança.");
    return data;
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
    if (response.pendingAction && UUID.test(response.pendingAction.id) && UUID.test(response.pendingAction.confirmationToken)) persistPendingAction(response.pendingAction);
    if (response.kind === "navigate" && response.route) {
      const destination = NAVIGATION_ROUTES[response.route];
      if (destination) router.push(destination);
      else setNotice("A IA sugeriu uma tela que não está disponível no site.");
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
      .catch(() => setNotice("Não foi possível carregar o histórico. Você ainda pode tentar uma nova consulta."))
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
    const text = (suggested ?? input).trim();
    if (!text || busy || pendingAction || !hasAccess) return;
    setBusy(true); setNotice(null); setInput("");
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
          <p className={styles.eyebrow}>IA FinFlow</p>
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
      <section className={styles.chatShell} aria-label="Conversa com a IA financeira">
        <header className={styles.chatHeader}>
          <div className={styles.assistantIdentity}>
            <span className={styles.assistantIcon} aria-hidden>
              <svg width="23" height="23" viewBox="0 0 24 24" fill="none"><path d="m12 2 1.4 4.6L18 8l-4.6 1.4L12 14l-1.4-4.6L6 8l4.6-1.4L12 2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="m18.5 14 .8 2.7 2.7.8-2.7.8-.8 2.7-.8-2.7-2.7-.8 2.7-.8.8-2.7Z" fill="currentColor"/></svg>
            </span>
            <div className="min-w-0">
              <p className={styles.eyebrow}>Somente finanças</p>
              <h1 className={styles.chatTitle}>IA FinFlow</h1>
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
            {messages.map((message) => (
              <div key={message.id} className={styles.messageRow} data-role={message.role}>
                {message.role === "assistant" && <span className={styles.messageAvatar} aria-hidden>✦</span>}
                <div className={styles.messageBubble}>{message.text}</div>
              </div>
            ))}
            {messages.length <= 1 && (
              <div className={styles.suggestions} aria-label="Sugestões de perguntas">
                {["Qual é meu saldo atual?", "Quais despesas tenho neste mês?", "Registrar uma despesa", "Criar um objetivo"].map((suggestion) => (
                  <button type="button" key={suggestion} onClick={() => void send(undefined, suggestion)} className={styles.suggestion}>{suggestion}</button>
                ))}
              </div>
            )}
            {pendingAction && (
              <section className={styles.pendingCard} aria-labelledby="pending-action-title">
                <p className={styles.pendingEyebrow}>Aguardando sua confirmação</p>
                <h2 id="pending-action-title" className={styles.pendingTitle}>{pendingAction.preview.title}</h2>
                <p className={styles.pendingSummary}>{pendingAction.preview.summary}</p>
                {pendingAction.preview.consequences.length > 0 && (
                  <ul className={styles.consequences}>{pendingAction.preview.consequences.map((item) => <li key={item}>{item}</li>)}</ul>
                )}
                <p className={styles.safeNotice}>A ação só será executada pelo botão Confirmar abaixo.</p>
                <div className={styles.pendingActions}>
                  <button type="button" onClick={cancel} disabled={busy} className={styles.cancelButton}>Cancelar</button>
                  <button type="button" onClick={confirmPending} disabled={busy} className={styles.confirmButton}>Confirmar</button>
                </div>
              </section>
            )}
            {busy && <p role="status" className={styles.typing}>A IA está analisando com segurança</p>}
            {notice && <p role="alert" className={styles.notice}>{notice}</p>}
            <div ref={bottomRef} />
          </div>
        </div>

        <form onSubmit={(event) => void send(event)} className={styles.composer}>
          <div className={styles.composerRow}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={busy || !!pendingAction}
              maxLength={2000}
              rows={2}
              enterKeyHint="send"
              aria-label="Mensagem para a IA financeira"
              placeholder={pendingAction ? "Confirme ou cancele a proposta para continuar" : "Pergunte ou peça uma ação financeira"}
              className={styles.textarea}
            />
            <button type="submit" disabled={busy || !!pendingAction || !input.trim()} className={styles.sendButton}>
              <span>Enviar</span>
              <svg aria-hidden width="17" height="17" viewBox="0 0 24 24" fill="none"><path d="m5 12 14-7-4.5 14-3-5.5L5 12Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"/><path d="m11.5 13.5 3.3-3.3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/></svg>
            </button>
          </div>
          <p className={styles.disclaimer}>Revise valores e datas. A IA não substitui orientação profissional.</p>
        </form>
      </section>
    </div>
  );
}
