"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

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

export default function AssistantChat({ userId, hasAccess, plan }: { userId: string; hasAccess: boolean; plan: string }) {
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
  const [notice, setNotice] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function invoke(body: Record<string, unknown>): Promise<AiResponse> {
    const { data, error } = await supabase.functions.invoke("finance-ai", { body });
    if (error || !validResponse(data)) throw new Error(safeError(body));
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
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
    // A função invoke usa o cliente estável desta montagem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationKey, hasAccess, pendingKey]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages, pendingAction]);

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
    if (busy || !globalThis.confirm("Apagar todo o histórico desta conversa?")) return;
    setBusy(true); setNotice(null);
    try {
      if (pendingAction) await invoke({ mode: "cancel", actionId: pendingAction.id });
      const response = await invoke({ mode: "clear", ...(conversationId ? { conversationId } : {}) });
      if (!response.cleared) throw new Error("O servidor não confirmou a limpeza.");
      persistPendingAction(null); setConversationId(null);
      try { localStorage.removeItem(conversationKey); } catch { /* armazenamento indisponível */ }
      setMessages([{ id: "welcome", role: "assistant", text: WELCOME }]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Não foi possível limpar agora."); }
    finally { setBusy(false); }
  }

  if (!hasAccess) return <div className="mx-auto max-w-3xl"><section className="rounded-ff-lg bg-gradient-to-br from-primary-dark to-primary p-7 text-white"><p className="text-sm font-bold uppercase text-white/70">IA FinFlow</p><h1 className="mt-2 text-3xl font-black">Seu controle financeiro por conversa</h1><p className="mt-3 text-white/80">A IA operacional está disponível nos planos Smart e Premium. Seu plano atual é {plan}.</p><Link href="/planos" className="mt-5 inline-block rounded-ff-sm bg-white px-5 py-2.5 font-extrabold text-primary-dark">Conhecer planos</Link></section></div>;

  const quotaText = quota ? `${Math.max(0, quota.remaining)}/${quota.limit < 0 ? "∞" : quota.limit} ações · ${Math.max(0, quota.model_remaining)}/${quota.model_limit} consultas` : "Conexão protegida";
  return <div className="mx-auto flex min-h-[calc(100vh-120px)] max-w-4xl flex-col overflow-hidden rounded-ff-lg border border-border bg-surface">
    <header className="flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-primary-dark to-primary p-5 text-white"><div><p className="text-xs font-bold uppercase text-white/65">Somente finanças</p><h1 className="text-2xl font-black">IA FinFlow</h1><p className="text-xs text-white/75">{quotaText}</p></div><button type="button" onClick={clearHistory} disabled={busy} className="rounded-full border border-white/30 px-4 py-2 text-xs font-bold disabled:opacity-50">Limpar conversa</button></header>
    <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">{messages.map((message) => <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[88%] rounded-ff-md px-4 py-3 text-sm leading-relaxed ${message.role === "user" ? "bg-primary text-white" : "border border-border bg-surface-muted text-foreground"}`}>{message.text}</div></div>)}
      {messages.length <= 1 && <div className="grid gap-2 sm:grid-cols-2">{["Qual é meu saldo atual?", "Quais despesas tenho neste mês?", "Registrar uma despesa", "Criar um objetivo"].map((suggestion) => <button type="button" key={suggestion} onClick={() => void send(undefined, suggestion)} className="rounded-ff-sm border border-border p-3 text-left text-sm font-semibold text-foreground hover:border-primary">{suggestion}</button>)}</div>}
      {pendingAction && <section className="rounded-ff-lg border-2 border-primary bg-primary-soft p-5 text-foreground"><p className="text-xs font-black uppercase text-primary">Aguardando sua confirmação</p><h2 className="mt-1 text-lg font-black">{pendingAction.preview.title}</h2><p className="mt-2 text-sm">{pendingAction.preview.summary}</p>{pendingAction.preview.consequences.length > 0 && <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-foreground-muted">{pendingAction.preview.consequences.map((item) => <li key={item}>{item}</li>)}</ul>}<p className="mt-4 rounded-ff-sm bg-orange/15 p-3 text-xs font-bold text-orange">A ação só será executada pelo botão Confirmar abaixo.</p><div className="mt-4 grid grid-cols-2 gap-3"><button type="button" onClick={cancel} disabled={busy} className="rounded-ff-sm border border-border px-4 py-3 font-bold">Cancelar</button><button type="button" onClick={confirmPending} disabled={busy} className="rounded-ff-sm bg-primary px-4 py-3 font-bold text-white">Confirmar</button></div></section>}
      {busy && <p role="status" className="text-sm font-semibold text-foreground-muted">A IA está analisando com segurança...</p>}{notice && <p role="alert" className="rounded-ff-sm bg-orange/10 p-3 text-sm font-semibold text-orange">{notice}</p>}<div ref={bottomRef} />
    </div>
    <form onSubmit={(event) => void send(event)} className="border-t border-border bg-surface p-3 sm:p-4"><div className="flex gap-2"><textarea value={input} onChange={(event) => setInput(event.target.value)} disabled={busy || !!pendingAction} maxLength={2000} rows={2} placeholder={pendingAction ? "Confirme ou cancele a proposta para continuar" : "Pergunte ou peça uma ação financeira"} className="min-h-14 flex-1 resize-none rounded-ff-md border border-border bg-surface-muted px-4 py-3 text-sm outline-none focus:border-primary" /><button disabled={busy || !!pendingAction || !input.trim()} className="rounded-ff-md bg-primary px-5 font-extrabold text-white disabled:opacity-40">Enviar</button></div><p className="mt-2 text-center text-[10px] text-foreground-muted">Revise valores e datas. A IA não substitui orientação profissional.</p></form>
  </div>;
}
