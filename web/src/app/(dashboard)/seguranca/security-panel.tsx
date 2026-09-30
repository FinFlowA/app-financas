"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Factor } from "@supabase/supabase-js";
import { checkPasswordExposureAction } from "@/lib/auth/actions";
import { isMfaPending, MAX_TOTP_FACTORS, normalizeTotpCode, totpErrorMessage, verifyTotpCode } from "@/lib/auth/mfa";
import { isStrongPassword, normalizeBrazilPhone } from "@/lib/auth/validation";
import { createClient } from "@/lib/supabase/client";

type Message = { tone: "success" | "error" | "info"; text: string } | null;
type Enrollment = { factorId: string; qrCode: string; secret: string; uri: string };
const INPUT = "mt-2 w-full rounded-ff-sm border border-border bg-surface-muted/70 px-3.5 py-3 text-foreground outline-none";
const CODE_INPUT = `${INPUT} text-center text-xl tracking-[.35em]`;

function SecurityIcon({ name }: { name: "lock" | "password" | "email" | "phone" | "shield" }) {
  const paths: Record<typeof name, ReactNode> = {
    lock: <><rect x="5" y="10" width="14" height="11" rx="2.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></>,
    password: <><path d="M4 12h16M8 8v8M16 8v8" /><circle cx="12" cy="12" r="9" /></>,
    email: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m4 7 8 6 8-6" /></>,
    phone: <><rect x="7" y="2" width="10" height="20" rx="2.5" /><path d="M10 5h4M11 18h2" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 3 8.5 7 10 4-1.5 7-5.4 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function Notice({ message }: { message: Message }) {
  if (!message) return null;
  const tone = message.tone === "success" ? "border-primary/30 bg-primary-soft text-primary-dark" : message.tone === "error" ? "border-red/30 bg-red/10 text-red" : "border-orange/30 bg-orange/10 text-orange";
  return <p role={message.tone === "error" ? "alert" : "status"} className={`rounded-ff-sm border p-3.5 text-sm font-semibold ${tone}`}>{message.text}</p>;
}

function SecurityCard({ icon, title, description, children }: { icon: "password" | "email" | "phone" | "shield"; title: string; description: string; children: ReactNode }) {
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

/** Mostra a chave em grupos de 4 para facilitar a digitação no autenticador. */
function formatSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

export default function SecurityPanel({ currentEmail, currentPhone }: { currentEmail: string; currentPhone: string | null }) {
  const supabase = useMemo(() => createClient(), []);
  const [unlocked, setUnlocked] = useState(false);
  // Quem ativou MFA confirma a senha e, em seguida, o código do autenticador.
  const [unlockStage, setUnlockStage] = useState<"password" | "code">("password");
  const lockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [savedPhone, setSavedPhone] = useState(currentPhone);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [removalCandidate, setRemovalCandidate] = useState<string | null>(null);

  useEffect(() => () => { if (lockTimer.current) clearTimeout(lockTimer.current); }, []);

  const refreshFactors = useCallback(async () => {
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors(data?.totp ?? []);
  }, [supabase]);

  function grantUnlock() {
    void refreshFactors();
    setUnlocked(true);
    setUnlockStage("password");
    if (lockTimer.current) clearTimeout(lockTimer.current);
    lockTimer.current = setTimeout(() => {
      setUnlocked(false);
      setEnrollment(null);
    }, 5 * 60_000);
    setMessage({ tone: "success", text: "Área liberada com segurança por 5 minutos." });
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const password = String(new FormData(event.currentTarget).get("current_password") ?? "");
    const { error } = await supabase.auth.signInWithPassword({ email: currentEmail, password });
    if (error) {
      setMessage({ tone: "error", text: "Senha atual incorreta. Use ‘Esqueci minha senha’ se não lembrar." });
    } else {
      // Entrar com a senha cria uma sessão nova sem o segundo fator; para quem
      // ativou MFA, o código é exigido antes de liberar alterações sensíveis.
      const { data: userData } = await supabase.auth.getUser();
      if (await isMfaPending(supabase, userData.user)) {
        setUnlockStage("code");
        setMessage({ tone: "info", text: "Senha confirmada. Agora digite o código do seu app autenticador." });
      } else {
        grantUnlock();
      }
    }
    setBusy(false);
  }

  async function unlockWithCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await verifyTotpCode(supabase, String(new FormData(event.currentTarget).get("codigo") ?? ""));
    if (result === "ok") grantUnlock();
    else setMessage({ tone: "error", text: totpErrorMessage(result) });
    setBusy(false);
  }

  async function startEnrollment() {
    setBusy(true);
    setMessage(null);
    setRemovalCandidate(null);
    // Cadastros abandonados ficam como fatores não verificados; limpamos antes
    // de começar outro para não esbarrar no limite do Auth.
    const { data: current } = await supabase.auth.mfa.listFactors();
    for (const factor of current?.all ?? []) {
      if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
    }
    const friendlyName = `Autenticador de ${new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}`;
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName, issuer: "FinFlow" });
    if (error || !data) {
      setMessage({ tone: "error", text: "Não foi possível iniciar a ativação agora. Tente novamente em instantes." });
    } else {
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri });
    }
    setBusy(false);
  }

  async function cancelEnrollment() {
    if (!enrollment) return;
    setBusy(true);
    await supabase.auth.mfa.unenroll({ factorId: enrollment.factorId });
    setEnrollment(null);
    setBusy(false);
  }

  async function confirmEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enrollment) return;
    const code = normalizeTotpCode(String(new FormData(event.currentTarget).get("codigo") ?? ""));
    if (!code) {
      setMessage({ tone: "error", text: "Digite os 6 dígitos que aparecem no app autenticador." });
      return;
    }
    setBusy(true);
    setMessage(null);
    const firstFactor = factors.length === 0;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.factorId, code });
    if (error) {
      setMessage({ tone: "error", text: error.status === 429 ? totpErrorMessage("rate_limited") : totpErrorMessage("invalid") });
    } else {
      setEnrollment(null);
      await refreshFactors();
      setMessage({
        tone: "success",
        text: firstFactor
          ? "Verificação em duas etapas ativada. Outros aparelhos conectados foram desconectados e vão pedir o código no próximo acesso."
          : "Autenticador reserva adicionado.",
      });
    }
    setBusy(false);
  }

  async function removeFactor(factorId: string) {
    if (removalCandidate !== factorId) {
      setRemovalCandidate(factorId);
      return;
    }
    setBusy(true);
    setMessage(null);
    const lastFactor = factors.length === 1;
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    setRemovalCandidate(null);
    if (error) {
      setMessage({ tone: "error", text: "Não foi possível remover o autenticador. Desbloqueie a área novamente e tente outra vez." });
    } else {
      await refreshFactors();
      setMessage({ tone: "success", text: lastFactor ? "Verificação em duas etapas desativada." : "Autenticador removido." });
    }
    setBusy(false);
  }

  async function copySecret() {
    if (!enrollment) return;
    try {
      await navigator.clipboard.writeText(enrollment.secret);
      setMessage({ tone: "success", text: "Chave copiada. Cole no app autenticador para cadastrar o FinFlow." });
    } catch {
      setMessage({ tone: "info", text: "Não foi possível copiar automaticamente. Digite a chave exibida no app autenticador." });
    }
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
    if ((await checkPasswordExposureAction(password)).pwned) {
      setMessage({ tone: "error", text: "Esta senha já apareceu em vazamentos de dados públicos e pode ser descoberta por invasores. Escolha outra senha." });
      setBusy(false);
      return;
    }
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
          {unlockStage === "password" ? (
            <>
              <p className="relative mx-auto mt-3 max-w-md text-sm leading-6 text-foreground-muted">Esta área não usa biometria. Confirme a senha atual da conta antes de alterar seus dados de acesso.</p>
              <form onSubmit={unlock} className="relative mt-6 text-left">
                <label className="text-sm font-bold text-foreground">Senha atual<input type="password" name="current_password" required autoComplete="current-password" className={INPUT} /></label>
                <button disabled={busy} className="ff-focus mt-4 w-full rounded-ff-sm bg-primary px-4 py-3 font-extrabold text-white shadow-lg shadow-primary/10 hover:bg-primary/90">{busy ? "Verificando..." : "Desbloquear área"}</button>
              </form>
              <button type="button" onClick={forgotPassword} disabled={busy} className="ff-focus mt-4 rounded-lg px-3 py-2 text-sm font-bold text-primary-dark hover:bg-primary-soft">Esqueci minha senha</button>
            </>
          ) : (
            <>
              <p className="relative mx-auto mt-3 max-w-md text-sm leading-6 text-foreground-muted">Sua conta usa verificação em duas etapas. Digite o código de 6 dígitos do seu app autenticador.</p>
              <form onSubmit={unlockWithCode} className="relative mt-6 text-left">
                <label className="text-sm font-bold text-foreground">Código do autenticador<input type="text" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required autoFocus className={CODE_INPUT} /></label>
                <button disabled={busy} className="ff-focus mt-4 w-full rounded-ff-sm bg-primary px-4 py-3 font-extrabold text-white shadow-lg shadow-primary/10 hover:bg-primary/90">{busy ? "Verificando..." : "Confirmar código"}</button>
              </form>
            </>
          )}
          <div className="relative mt-4"><Notice message={message} /></div>
          <Link href="/configuracoes" className="ff-focus relative mt-6 inline-flex text-sm font-bold text-foreground-muted hover:text-foreground">← Voltar às configurações</Link>
        </section>
      </div>
    );
  }

  const mfaActive = factors.length > 0;
  return (
    <div className="space-y-6">
      <section className="ff-page-hero p-6 sm:p-8">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div><p className="text-xs font-extrabold uppercase tracking-[.14em] text-white/70">Dados de acesso</p><h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Segurança</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-white/80">Acesso temporário liberado. Ao recarregar, sua senha atual será exigida novamente.</p></div>
          <span className="self-start rounded-full border border-white/20 bg-white/10 px-4 py-2 text-xs font-extrabold text-white">Sessão protegida · 5 min</span>
        </div>
      </section>
      <Notice message={message} />
      <SecurityCard
        icon="shield"
        title="Verificação em duas etapas"
        description="Além da senha, o FinFlow pede um código de 6 dígitos gerado no seu celular por um app autenticador (Google Authenticator, Microsoft Authenticator, Senhas do iPhone…)."
      >
        <p className={`inline-flex rounded-full px-3 py-1 text-xs font-extrabold ${mfaActive ? "bg-primary-soft text-primary-dark" : "bg-surface-muted text-foreground-muted"}`}>
          {mfaActive ? "Ativada" : "Desativada"}
        </p>
        {mfaActive && (
          <ul className="mt-4 space-y-2">
            {factors.map((factor) => (
              <li key={factor.id} className="flex flex-wrap items-center justify-between gap-3 rounded-ff-sm border border-border bg-surface-muted/60 px-3.5 py-3">
                <span className="text-sm font-bold text-foreground">{factor.friendly_name || "Autenticador"}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void removeFactor(factor.id)}
                  className={`ff-focus rounded-lg px-3 py-1.5 text-xs font-extrabold ${removalCandidate === factor.id ? "bg-red text-white" : "text-red hover:bg-red/10"}`}
                >
                  {removalCandidate === factor.id ? (factors.length === 1 ? "Confirmar: desativar a verificação" : "Confirmar remoção") : "Remover"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {enrollment ? (
          <div className="mt-5 rounded-ff-sm border border-primary/25 bg-primary-soft/40 p-4">
            <p className="text-sm font-extrabold text-foreground">1. Cadastre o FinFlow no app autenticador</p>
            <div className="mt-3 flex flex-col items-center gap-4 sm:flex-row sm:items-start">
              {/* eslint-disable-next-line @next/next/no-img-element -- QR em data URI SVG gerado pelo Supabase Auth; não passa pelo otimizador de imagens */}
              <img src={enrollment.qrCode} alt="QR code para cadastrar o FinFlow no app autenticador" width={176} height={176} className="shrink-0 rounded-lg bg-white p-2" />
              <div className="min-w-0 text-sm leading-6 text-foreground-muted">
                <p>No computador, escaneie o QR code com o app autenticador do celular. No próprio celular, use o botão abaixo ou copie a chave.</p>
                <a href={enrollment.uri} className="ff-focus mt-3 inline-flex rounded-ff-sm border border-primary px-3.5 py-2 text-sm font-bold text-primary-dark hover:bg-primary-soft">Abrir no app autenticador</a>
                <p className="mt-3 text-xs font-bold uppercase tracking-wide">Chave manual</p>
                <p className="mt-1 break-all font-mono text-sm text-foreground">{formatSecret(enrollment.secret)}</p>
                <button type="button" onClick={() => void copySecret()} className="ff-focus mt-2 rounded-lg px-2 py-1 text-xs font-extrabold text-primary-dark hover:bg-primary-soft">Copiar chave</button>
              </div>
            </div>
            <form onSubmit={confirmEnrollment} className="mt-4">
              <label className="block text-sm font-extrabold text-foreground">2. Digite o código que o app mostra agora<input type="text" name="codigo" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className={CODE_INPUT} /></label>
              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={busy} className="ff-focus rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">{busy ? "Verificando..." : "Ativar"}</button>
                <button type="button" disabled={busy} onClick={() => void cancelEnrollment()} className="ff-focus rounded-ff-sm border border-border px-4 py-2.5 font-bold text-foreground-muted hover:text-foreground">Cancelar</button>
              </div>
            </form>
          </div>
        ) : factors.length < MAX_TOTP_FACTORS ? (
          <div className="mt-5">
            <button type="button" disabled={busy} onClick={() => void startEnrollment()} className="ff-focus rounded-ff-sm bg-primary px-4 py-2.5 font-bold text-white">
              {mfaActive ? "Adicionar autenticador reserva" : "Ativar verificação em duas etapas"}
            </button>
            <p className="mt-2 text-xs leading-5 text-foreground-muted">
              {mfaActive
                ? "Um segundo aparelho (ex.: outro celular ou tablet) evita perder o acesso se o principal for perdido."
                : "Ao ativar, outros aparelhos conectados serão desconectados e passarão a pedir o código no próximo acesso."}
            </p>
          </div>
        ) : (
          <p className="mt-4 text-xs leading-5 text-foreground-muted">Você já cadastrou o máximo de {MAX_TOTP_FACTORS} autenticadores.</p>
        )}
        {mfaActive && (
          <p className="mt-4 text-xs leading-5 text-foreground-muted">Perdeu o celular com o autenticador? Fale com o suporte pelo e-mail Finflowfinancas@gmail.com para confirmar sua identidade e recuperar o acesso.</p>
        )}
      </SecurityCard>
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
