"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { isStrongPassword, normalizeBrazilPhone } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/client";

type Message = { tone: "success" | "error" | "info"; text: string } | null;
const INPUT = "mt-1 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-3 text-foreground outline-none focus:border-primary";

function Notice({ message }: { message: Message }) {
  if (!message) return null;
  return <p role={message.tone === "error" ? "alert" : "status"} className={`mt-3 rounded-ff-sm p-3 text-sm font-semibold ${message.tone === "success" ? "bg-primary-soft text-primary-dark" : message.tone === "error" ? "bg-red/10 text-red" : "bg-orange/10 text-orange"}`}>{message.text}</p>;
}

export default function SecurityPanel({ currentEmail, currentPhone }: { currentEmail: string; currentPhone: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [unlocked, setUnlocked] = useState(false);
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  useEffect(() => () => { if (lockTimer.current) clearTimeout(lockTimer.current); }, []);

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage(null);
    const password = String(new FormData(event.currentTarget).get("current_password") ?? "");
    const { error } = await supabase.auth.signInWithPassword({ email: currentEmail, password });
    if (error) setMessage({ tone: "error", text: "Senha atual incorreta. Use ‘Esqueci minha senha’ se não lembrar." });
    else {
      setUnlocked(true);
      if (lockTimer.current) clearTimeout(lockTimer.current);
      lockTimer.current = setTimeout(() => setUnlocked(false), 5 * 60_000);
      setMessage({ tone: "success", text: "Área liberada por 5 minutos." });
    }
    setBusy(false);
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!unlocked) return;
    const data = new FormData(event.currentTarget); const password = String(data.get("password") ?? ""); const confirmation = String(data.get("confirmation") ?? "");
    if (!isStrongPassword(password)) { setMessage({ tone: "error", text: "Use ao menos 8 caracteres, com maiúscula, minúscula, número e caractere especial." }); return; }
    // Comparação apenas de confirmação digitada localmente; não é validação de segredo no servidor.
    // eslint-disable-next-line security/detect-possible-timing-attacks
    if (password !== confirmation) { setMessage({ tone: "error", text: "As senhas não coincidem." }); return; }
    setBusy(true); setMessage(null);
    const { error } = await supabase.auth.updateUser({ password });
    setMessage(error ? { tone: "error", text: "Não foi possível alterar a senha. Se o Supabase pedir confirmação adicional, use ‘Esqueci minha senha’." } : { tone: "success", text: "Senha alterada com segurança." }); setBusy(false);
  }

  async function updateEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!unlocked) return;
    const email = String(new FormData(event.currentTarget).get("email") ?? "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setMessage({ tone: "error", text: "Informe um e-mail válido." }); return; }
    if (email === currentEmail.toLowerCase()) { setMessage({ tone: "info", text: "Este já é o e-mail atual." }); return; }
    setBusy(true); setMessage(null);
    const redirectTo = `${location.origin}/auth/callback?flow=email-change`;
    const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
    setMessage(error ? { tone: "error", text: error.code === "email_exists" || error.code === "user_already_exists" ? "Já existe uma conta com este e-mail." : "Não foi possível iniciar a troca de e-mail." } : { tone: "success", text: "Enviamos a confirmação da alteração. Confira também o spam." }); setBusy(false);
  }

  async function updatePhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!unlocked) return;
    const phone = normalizeBrazilPhone(String(new FormData(event.currentTarget).get("phone") ?? ""));
    if (!phone) { setMessage({ tone: "error", text: "Informe um celular brasileiro com DDD." }); return; }
    setBusy(true); setMessage(null);
    const { error } = await supabase.auth.updateUser({ phone });
    if (error) setMessage({ tone: "error", text: error.code === "phone_exists" || error.code === "user_already_exists" ? "Já existe uma conta com este telefone." : "Não foi possível enviar o SMS agora." });
    else { setPendingPhone(phone); setMessage({ tone: "info", text: "Enviamos um código por SMS para confirmar o novo telefone." }); }
    setBusy(false);
  }

  async function verifyPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!pendingPhone || !unlocked) return;
    const token = String(new FormData(event.currentTarget).get("token") ?? "").replace(/\D/g, "");
    if (token.length < 6) { setMessage({ tone: "error", text: "Informe o código recebido por SMS." }); return; }
    setBusy(true); setMessage(null);
    const { data, error } = await supabase.auth.verifyOtp({ phone: pendingPhone, token, type: "phone_change" });
    if (!error) await supabase.auth.updateUser({ data: { ...data.user?.user_metadata, telefone: pendingPhone, telefone_verificado: true, telefone_verificado_em: new Date().toISOString() } });
    setMessage(error ? { tone: "error", text: "Código inválido ou expirado." } : { tone: "success", text: "Telefone confirmado com segurança." });
    if (!error) setPendingPhone(null); setBusy(false);
  }

  async function forgotPassword() {
    setBusy(true); setMessage(null);
    const redirectTo = `${location.origin}/auth/callback?flow=recovery`;
    const { error } = await supabase.auth.resetPasswordForEmail(currentEmail, { redirectTo });
    setMessage(error ? { tone: "error", text: "Não foi possível enviar o e-mail agora." } : { tone: "success", text: "Se a conta estiver disponível, enviaremos o link. Confira também o spam." }); setBusy(false);
  }

  if (!unlocked) return <section className="ff-card mx-auto max-w-lg p-6"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary-soft text-2xl text-primary">⌾</div><h1 className="mt-4 text-center text-2xl font-black">Segurança</h1><p className="mt-2 text-center text-sm text-foreground-muted">Esta área não usa biometria. Confirme a senha atual da conta para alterar dados de acesso.</p><form onSubmit={unlock} className="mt-5"><label className="text-sm font-bold">Senha atual<input type="password" name="current_password" required autoComplete="current-password" className={INPUT} /></label><button disabled={busy} className="mt-4 w-full rounded-ff-sm bg-primary px-4 py-3 font-extrabold text-white disabled:opacity-50">{busy ? "Verificando..." : "Continuar"}</button></form><button type="button" onClick={forgotPassword} disabled={busy} className="mt-4 w-full text-sm font-bold text-primary">Esqueci minha senha</button><Notice message={message} /><Link href="/configuracoes" className="mt-5 block text-center text-sm font-bold text-foreground-muted">Voltar aos Ajustes</Link></section>;

  return <div className="mx-auto max-w-4xl"><div className="mb-6"><p className="text-sm font-bold uppercase text-primary">Dados de acesso</p><h1 className="text-3xl font-black">Segurança</h1><p className="mt-1 text-sm text-foreground-muted">Acesso temporário liberado. Ao recarregar, a senha atual será exigida novamente.</p></div><Notice message={message} /><div className="mt-5 grid gap-5 md:grid-cols-2">
    <form onSubmit={updatePassword} className="ff-card p-5"><h2 className="font-extrabold">Alterar senha</h2><label className="mt-4 block text-sm font-bold">Nova senha<input type="password" name="password" required autoComplete="new-password" className={INPUT} /></label><label className="mt-3 block text-sm font-bold">Confirmar senha<input type="password" name="confirmation" required autoComplete="new-password" className={INPUT} /></label><button disabled={busy} className="mt-4 rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">Salvar senha</button></form>
    <form onSubmit={updateEmail} className="ff-card p-5"><h2 className="font-extrabold">Alterar e-mail</h2><p className="mt-1 text-xs text-foreground-muted">Atual: {currentEmail}</p><label className="mt-4 block text-sm font-bold">Novo e-mail<input type="email" name="email" required autoComplete="email" className={INPUT} /></label><button disabled={busy} className="mt-4 rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">Enviar confirmação</button></form>
    <form onSubmit={updatePhone} className="ff-card p-5"><h2 className="font-extrabold">Alterar telefone</h2><p className="mt-1 text-xs text-foreground-muted">Atual: {currentPhone || "não informado"}</p><label className="mt-4 block text-sm font-bold">Celular com DDD<input type="tel" name="phone" required placeholder="(11) 99999-9999" autoComplete="tel" className={INPUT} /></label><button disabled={busy} className="mt-4 rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">Enviar SMS</button></form>
    {pendingPhone && <form onSubmit={verifyPhone} className="ff-card border-primary p-5"><h2 className="font-extrabold">Confirmar SMS</h2><p className="mt-1 text-xs text-foreground-muted">Código enviado para {pendingPhone}.</p><label className="mt-4 block text-sm font-bold">Código<input inputMode="numeric" name="token" required maxLength={8} autoComplete="one-time-code" className={INPUT} /></label><button disabled={busy} className="mt-4 rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">Confirmar telefone</button></form>}
  </div></div>;
}
