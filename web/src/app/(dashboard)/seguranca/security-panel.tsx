"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { isStrongPassword, normalizeBrazilPhone } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/client";

type Message = { tone: "success" | "error" | "info"; text: string } | null;
const INPUT = "mt-2 w-full rounded-ff-sm border border-border bg-surface-muted/70 px-3.5 py-3 text-foreground outline-none";

function SecurityIcon({ name }: { name: "lock" | "password" | "email" | "phone" }) {
  const paths: Record<typeof name, ReactNode> = {
    lock: <><rect x="5" y="10" width="14" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    password: <><path d="M4 12h16M8 8v8M16 8v8" /><circle cx="12" cy="12" r="9" /></>,
    email: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>,
    phone: <><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M10 5h4M11 18h2" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Notice({ message }: { message: Message }) {
  if (!message) return null;
  const tone = message.tone === "success" ? "border-primary/30 bg-primary-soft text-primary-dark" : message.tone === "error" ? "border-red/30 bg-red/10 text-red" : "border-orange/30 bg-orange/10 text-orange";
  return <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-ff-sm border p-3.5 text-sm font-semibold ${tone}`}>{message.text}</p>;
}

function SecurityCard({ icon, title, description, children }: { icon: "password" | "email" | "phone"; title: string; description: string; children: ReactNode }) {
  return (
    <section className="ff-card p-5 sm:p-6">
      <header className="flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-dark [&>svg]:h-5 [&>svg]:w-5"><SecurityIcon name={icon} /></span>
        <div><h2 className="font-extrabold text-foreground">{title}</h2><p className="mt-1 text-xs leading-5 text-foreground-muted">{description}</p></div>
      </header>
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function SecurityPanel({ currentEmail, currentPhone }: { currentEmail: string; currentPhone: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [unlocked, setUnlocked] = useState(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [savedPhone, setSavedPhone] = useState(currentPhone);

  useEffect(() => () => { if (lockTimer.current) clearTimeout(lockTimer.current); }, []);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const password = String(new FormData(event.currentTarget).get("current_password") ?? "");
    const { error } = await supabase.auth.signInWithPassword({ email: currentEmail, password });
    if (error) {
      setMessage({ tone: "error", text: "Senha atual incorreta. Use ‘Esqueci minha senha’ se não lembrar." });
    } else {
      setUnlocked(true);
      if (lockTimer.current) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => setUnlocked(false), 5 * 60_000);
      setMessage({ tone: "success", text: "Área liberada com segurança por 5 minutos." });
    }
    setBusy(false);
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlocked) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("confirmation") ?? "");
    if (!isStrongPassword(password)) {
      setMessage({ tone: "error", text: "Use ao menos 8 caracteres, com maiúscula, minúscula, número e caractere especial." });
      return;
    }
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirmation) {
      setMessage({ tone: "error", text: "As senhas não coincidem." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error ? { tone: "error", text: "Não foi possível alterar a senha. Se o Supabase pedir confirmação adicional, use ‘Esqueci minha senha’." } : { tone: "success", text: "Senha alterada com segurança." });
    setBusy(false);
  }

  async function updateEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlocked) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setMessage({ tone: "error", text: "Informe um e-mail válido." });
      return;
    }
    if (email === currentEmail.toLowerCase()) {
      setMessage({ tone: "info", text: "Este já é o e-mail atual." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const redirectTo = `${location.origin}/auth/callback?flow=email-change`;
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
    setMessage(error ? { tone: "error", text: error.code === "email_exists" || error.code === "user_already_exists" ? "Já existe uma conta com este e-mail." : "Não foi possível iniciar a troca de e-mail." } : { tone: "success", text: "Enviamos a confirmação da alteração. Confira também o spam." });
    setBusy(false);
  }

  async function updatePhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!unlocked) return;
    const rawPhone = String(new FormData(event.currentTarget).get("phone") ?? "").trim();
    const phone = rawPhone ? normalizeBrazilPhone(rawPhone) : null;
    if (rawPhone && !phone) {
      setMessage({ tone: "error", text: "Informe um celular brasileiro com DDD." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const { data: userData } = await supabase.auth.getUser();
    const metadata = userData.user?.user_metadata ?? {};
    const { error } = await supabase.auth.updateUser({ data: { ...metadata, telefone: phone } });
    if (!error) setSavedPhone(phone);
    setMessage(error
      ? { tone: "error", text: "Não foi possível salvar o telefone agora." }
      : { tone: "success", text: phone ? "Telefone opcional atualizado." : "Telefone removido." });
    setBusy(false);
  }

  async function forgotPassword() {
    setBusy(true);
    setMessage(null);
    const redirectTo = `${location.origin}/auth/callback?flow=recovery`;
    const { error } = await supabase.auth.resetPasswordForEmail(currentEmail, { redirectTo });
    setMessage(error ? { tone: "error", text: "Não foi possível enviar o e-mail agora." } : { tone: "success", text: "Se a conta estiver disponível, enviaremos o link. Confira também o spam." });
    setBusy(false);
  }

  if (!unlocked) {
    return (
      <div className="mx-auto grid min-h-[calc(100dvh-80px)] max-w-5xl place-items-center py-4">
        <section className="ff-card relative w-full max-w-xl overflow-hidden p-6 text-center sm:p-9">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-primary/15 to-transparent" aria-hidden="true" />
          <div className="relative mx-auto grid h-20 w-20 place-items-center rounded-2xl border border-primary/25 bg-primary-soft text-primary-dark shadow-lg shadow-primary/5 [&>svg]:h-9 [&>svg]:w-9"><SecurityIcon name="lock" /></div>
          <p className="ff-eyebrow relative mt-6">Área protegida</p>
          <h1 className="relative mt-2 text-3xl font-black tracking-tight text-foreground">Segurança</h1>
          <p className="relative mx-auto mt-3 max-w-md text-sm leading-6 text-foreground-muted">Esta área não usa biometria. Confirme a senha atual da conta antes de alterar seus dados de acesso.</p>
          <form onSubmit={unlock} className="relative mt-6 text-left">
            <label className="text-sm font-bold text-foreground">Senha atual<input type="password" name="current_password" required autoComplete="current-password" className={INPUT} /></label>
            <button disabled={busy} className="ff-focus mt-4 w-full rounded-ff-sm bg-primary px-4 py-3 font-extrabold text-white shadow-lg shadow-primary/10 hover:bg-primary/90">{busy ? "Verificando..." : "Desbloquear área"}</button>
          </form>
          <button type="button" onClick={forgotPassword} disabled={busy} className="ff-focus mt-4 rounded-lg px-3 py-2 text-sm font-bold text-primary-dark hover:bg-primary-soft">Esqueci minha senha</button>
          <div className="relative mt-4"><Notice message={message} /></div>
          <Link href="/configuracoes" className="ff-focus relative mt-6 inline-flex text-sm font-bold text-foreground-muted hover:text-foreground">← Voltar às configurações</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="ff-page-hero p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="text-xs font-extrabold uppercase tracking-[.14em] text-white/70">Dados de acesso</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Segurança</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">Acesso temporário liberado. Ao recarregar, sua senha atual será exigida novamente.</p></div>
          <span className="self-start rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-extrabold text-white">Sessão protegida · 5 min</span>
        </div>
      </section>
      <Notice message={message} />
      <div className="grid gap-5 md:grid-cols-2">
        <SecurityCard icon="password" title="Alterar senha" description="Use letras maiúsculas e minúsculas, número e caractere especial.">
          <form onSubmit={updatePassword}>
            <label className="block text-sm font-bold">Nova senha<input type="password" name="password" required autoComplete="new-password" className={INPUT} /></label>
            <label className="mt-3 block text-sm font-bold">Confirmar senha<input type="password" name="confirmation" required autoComplete="new-password" className={INPUT} /></label>
            <button disabled={busy} className="ff-focus mt-4 rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">Salvar senha</button>
          </form>
        </SecurityCard>
        <SecurityCard icon="email" title="Alterar e-mail" description={`E-mail atual: ${currentEmail}`}>
          <form onSubmit={updateEmail}>
            <label className="block text-sm font-bold">Novo e-mail<input type="email" name="email" required autoComplete="email" className={INPUT} /></label>
            <button disabled={busy} className="ff-focus mt-4 rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">Enviar confirmação</button>
          </form>
        </SecurityCard>
        <SecurityCard icon="phone" title="Telefone opcional" description={`Telefone atual: ${savedPhone || "não informado"}. Ele não é usado para login ou verificação.`}>
          <form onSubmit={updatePhone}>
            <label className="block text-sm font-bold">Celular com DDD<input type="tel" name="phone" defaultValue={savedPhone ?? ""} placeholder="(11) 99999-9999" autoComplete="tel" className={INPUT} /></label>
            <p className="mt-2 text-xs leading-5 text-foreground-muted">O FinFlow verifica apenas o seu e-mail. Nenhum SMS será enviado.</p>
            <button disabled={busy} className="ff-focus mt-4 rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">Salvar telefone</button>
          </form>
        </SecurityCard>
      </div>
      <Link href="/configuracoes" className="ff-focus inline-flex rounded-ff-sm border border-border bg-surface px-4 py-2.5 text-sm font-bold text-foreground-muted hover:border-primary hover:text-foreground">← Voltar às configurações</Link>
    </div>
  );
}
