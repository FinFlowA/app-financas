import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import SignOutButton from "../sign-out-button";
import PreferencesPanel from "./preferences-panel";
import {
  DissolutionDecisions,
  DeleteAccountForm,
  FeedbackForm,
  PartnershipPanel,
  ProfileForm,
  type AccountDecision,
  type GoalDecision,
  type PartnershipRow,
} from "./settings-forms";
import {
  confirmDissolutionSummaryAction,
  markSystemNotificationAction,
} from "./actions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Configurações",
  description: "Perfil, preferências, parceria, avisos e privacidade da conta FinFlow.",
};

type SystemNotification = {
  id: number;
  tipo: string;
  titulo: string;
  mensagem: string;
  criada_em: string;
  lida_em: string | null;
};

type DissolutionItem = {
  id: number;
  tipo: string;
  nome: string;
  saldo_final: number;
  possui_lancamentos: boolean;
  estado: string;
};

type DissolutionSummary = {
  resumo_id: number;
  parceria_id: number;
  criado_em: string;
  itens: DissolutionItem[];
};

function dateTime(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Data indisponível";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(date);
}

function dateOnly(value?: string | null) {
  if (!value) return "Não informada";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatPhone(value?: string | null) {
  if (!value) return "Não informado";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 13 && digits.startsWith("55")) {
    return `+55 (${digits.slice(2, 4)}) ${digits.slice(4, 9)}-${digits.slice(9)}`;
  }
  return value;
}

export default async function SettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const email = user.email ?? "E-mail indisponível";
  const metadata = user.user_metadata as Record<string, unknown>;
  const name = typeof metadata.nome_usuario === "string"
    ? metadata.nome_usuario
    : typeof metadata.full_name === "string" ? metadata.full_name : email.split("@")[0];
  const phone = user.phone
    || (typeof metadata.telefone === "string" ? metadata.telefone : null);
  const birthDate = typeof metadata.data_nascimento === "string" ? metadata.data_nascimento : null;

  const [
    partnershipResult,
    notificationsResult,
    accountDecisionsResult,
    goalDecisionsResult,
    summaryResult,
  ] = await Promise.all([
    supabase.from("parcerias")
      .select("id,solicitante_id,convidado_id,convidado_email,status")
      .in("status", ["pendente", "aceito"])
      .order("id", { ascending: false }),
    supabase.from("notificacoes_sistema")
      .select("id,tipo,titulo,mensagem,criada_em,lida_em")
      .eq("destinatario_id", user.id)
      .order("criada_em", { ascending: false })
      .limit(30),
    supabase.rpc("get_minhas_decisoes_conta_dissolucao"),
    supabase.rpc("get_minhas_decisoes_caixinha"),
    supabase.rpc("get_meu_resumo_dissolucao"),
  ]);

  const normalizedEmail = email.toLocaleLowerCase("pt-BR");
  const partnerships = ((partnershipResult.data ?? []) as PartnershipRow[])
    .filter((partnership) => partnership.solicitante_id === user.id
      || partnership.convidado_id === user.id
      || partnership.convidado_email.toLocaleLowerCase("pt-BR") === normalizedEmail);
  const activePartnership = partnerships.find((partnership) => partnership.status === "aceito");
  const partnerId = activePartnership
    ? activePartnership.solicitante_id === user.id
      ? activePartnership.convidado_id
      : activePartnership.solicitante_id
    : null;
  const partnerNameResult = partnerId
    ? await supabase.rpc("get_user_name", { user_id: partnerId })
    : null;
  const partnerName = typeof partnerNameResult?.data === "string"
    ? partnerNameResult.data
    : null;
  const notifications = (notificationsResult.data ?? []) as SystemNotification[];
  const accountDecisions = (accountDecisionsResult.data ?? []) as AccountDecision[];
  const goalDecisions = (goalDecisionsResult.data ?? []) as GoalDecision[];
  const summaryRaw = Array.isArray(summaryResult.data) ? summaryResult.data[0] : summaryResult.data;
  const summary = summaryRaw && typeof summaryRaw === "object"
    ? summaryRaw as DissolutionSummary
    : null;

  return (
    <div className="space-y-6">
      <section className="ff-page-hero px-5 py-5 sm:px-7 sm:py-6">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[.14em] text-white/70">Sua conta FinFlow</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight">Configurações</h1>
          <p className="mt-1 max-w-2xl text-sm leading-5 text-white/80">Perfil, aparência, notificações, parceria e privacidade.</p>
        </div>
      </section>

      {summary && (
        <section className="ff-card border-orange/40 p-5 sm:p-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-orange">Parceria encerrada</p>
              <h2 className="mt-1 text-xl font-extrabold text-foreground">Resumo da separação</h2>
              <p className="mt-1 text-sm text-foreground-muted">Processada em {dateTime(summary.criado_em)}. Nenhum saldo foi duplicado.</p>
            </div>
            <form action={confirmDissolutionSummaryAction}>
              <input type="hidden" name="summary_id" value={summary.resumo_id} />
              <button className="ff-focus rounded-ff-sm border border-border bg-surface px-4 py-2 text-sm font-bold text-foreground">Entendi</button>
            </form>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {(summary.itens ?? []).map((item) => (
              <article key={item.id} className="rounded-ff-md border border-border bg-surface-muted p-4">
                <div className="flex items-start justify-between gap-3">
                  <div><p className="font-extrabold text-foreground">{item.nome}</p><p className="mt-1 text-xs capitalize text-foreground-muted">{item.tipo}</p></div>
                  <span className="rounded-full bg-surface px-2.5 py-1 text-[11px] font-bold text-foreground-muted">{item.estado}</span>
                </div>
                <p data-private-value="true" className="mt-3 text-lg font-extrabold text-foreground">{Number(item.saldo_final).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
                {item.possui_lancamentos && <p className="mt-1 text-xs text-foreground-muted">Seus lançamentos foram preservados.</p>}
              </article>
            ))}
          </div>
        </section>
      )}

      <DissolutionDecisions accounts={accountDecisions} goals={goalDecisions} />

      <div className="grid gap-6 xl:grid-cols-[1.1fr_.9fr]">
        <section className="ff-card p-5 sm:p-6" data-interactive="true">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-extrabold text-foreground">Perfil</h2>
              <p className="mt-1 text-sm text-foreground-muted">Seu nome aparece no painel e nas experiências compartilhadas.</p>
            </div>
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-soft text-lg font-extrabold text-primary-dark">{name.slice(0, 1).toLocaleUpperCase("pt-BR")}</div>
          </div>
          <ProfileForm name={name} />
        </section>

        <section className="ff-card p-5 sm:p-6" data-interactive="true">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-extrabold text-foreground">Dados de acesso</h2>
              <p className="mt-1 text-sm text-foreground-muted">Informações protegidas da sua conta.</p>
            </div>
            <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${user.email_confirmed_at ? "bg-primary-soft text-primary-dark" : "bg-orange/10 text-orange"}`}>
              {user.email_confirmed_at ? "E-mail confirmado" : "E-mail pendente"}
            </span>
          </div>
          <dl className="mt-5 space-y-3 text-sm">
            <div className="rounded-ff-sm bg-surface-muted p-3"><dt className="text-xs font-bold uppercase text-foreground-muted">E-mail</dt><dd className="mt-1 break-all font-bold text-foreground">{email}</dd></div>
            <div className="rounded-ff-sm bg-surface-muted p-3"><dt className="text-xs font-bold uppercase text-foreground-muted">Telefone</dt><dd className="mt-1 font-bold text-foreground">{formatPhone(phone)}</dd></div>
            <div className="rounded-ff-sm bg-surface-muted p-3"><dt className="text-xs font-bold uppercase text-foreground-muted">Nascimento</dt><dd className="mt-1 font-bold text-foreground">{dateOnly(birthDate)}</dd></div>
          </dl>
          <p className="mt-4 text-xs leading-5 text-foreground-muted">E-mail e senha exigem reautenticação. O telefone é opcional e não é usado como verificação de identidade.</p>
          <Link href="/seguranca" className="ff-focus mt-4 inline-flex rounded-ff-sm border border-border bg-surface-muted px-4 py-2.5 text-sm font-bold text-foreground hover:border-primary">
            Abrir área de segurança →
          </Link>
        </section>
      </div>

      <PreferencesPanel userId={user.id} />

      <PartnershipPanel partnerships={partnerships} userId={user.id} userEmail={email} partnerName={partnerName} />

      <section className="ff-card p-5 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h2 className="text-lg font-extrabold text-foreground">Central de avisos</h2>
            <p className="mt-1 text-sm text-foreground-muted">Eventos obrigatórios de parceria ficam persistidos e podem ser consultados aqui.</p>
          </div>
          <span className="rounded-full bg-primary-soft px-3 py-1.5 text-xs font-bold text-primary-dark">{notifications.filter((item) => !item.lida_em).length} não lidos</span>
        </div>
        <div className="mt-5 space-y-3">
          {notifications.map((item) => (
            <article key={item.id} className={`rounded-ff-md border p-4 ${item.lida_em ? "border-border bg-surface-muted/50" : "border-primary/30 bg-primary-soft"}`}>
              <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                <div>
                  <div className="flex flex-wrap items-center gap-2"><p className="font-extrabold text-foreground">{item.titulo}</p>{!item.lida_em && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Não lida" />}</div>
                  <p className="mt-1 text-sm leading-6 text-foreground-muted">{item.mensagem}</p>
                  <p className="mt-2 text-xs text-foreground-muted">{dateTime(item.criada_em)}</p>
                </div>
                {!item.lida_em && (
                  <form action={markSystemNotificationAction}>
                    <input type="hidden" name="notification_id" value={item.id} />
                    <button className="ff-focus rounded-ff-sm border border-primary/30 bg-surface px-3 py-2 text-xs font-bold text-primary-dark">Marcar como lida</button>
                  </form>
                )}
              </div>
            </article>
          ))}
          {notifications.length === 0 && <p className="rounded-ff-md bg-surface-muted p-5 text-sm text-foreground-muted">Nenhum aviso de sistema por enquanto.</p>}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="ff-card p-5 sm:p-6">
          <h2 className="text-lg font-extrabold text-foreground">Ajude a melhorar o FinFlow</h2>
          <p className="mt-1 text-sm text-foreground-muted">Relate um problema, sugestão ou reclamação.</p>
          <FeedbackForm />
        </section>

        <section className="ff-card p-5 sm:p-6">
          <h2 className="text-lg font-extrabold text-foreground">Privacidade e suporte</h2>
          <div className="mt-5 grid gap-3">
            <Link href="/privacidade" className="ff-focus rounded-ff-sm border border-border bg-surface-muted px-4 py-3 text-sm font-bold text-foreground hover:border-primary">Política de Privacidade →</Link>
            <Link href="/termos" className="ff-focus rounded-ff-sm border border-border bg-surface-muted px-4 py-3 text-sm font-bold text-foreground hover:border-primary">Termos de Uso →</Link>
            <a href="mailto:Finflowfinancas@gmail.com?subject=%5BFinFlow%20-%20Suporte%5D" className="ff-focus rounded-ff-sm border border-border bg-surface-muted px-4 py-3 text-sm font-bold text-foreground hover:border-primary">Contatar suporte →</a>
          </div>
          <div className="mt-5 border-t border-border pt-5"><SignOutButton /></div>
        </section>
      </div>

      <section className="ff-card border-red/30 p-5 sm:p-6">
        <h2 className="text-lg font-extrabold text-red">Excluir conta</h2>
        <p id="delete-account-warning" className="mt-2 max-w-3xl text-sm leading-6 text-foreground-muted">
          Esta ação é permanente. Por segurança, ela só é executada pela RPC protegida do banco e fica bloqueada enquanto houver assinatura, convite, parceria ou decisão de separação pendente.
        </p>
        <DeleteAccountForm />
      </section>
    </div>
  );
}
