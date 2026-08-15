"use client";

import { useActionState, useState } from "react";
import CurrencyInput from "@/components/ui/currency-input";
import AccessibleConfirmationDialog from "@/components/ui/confirmation-dialog";
import {
  acceptPartnerAction,
  closePendingPartnerAction,
  deleteAccountAction,
  dissolvePartnerAction,
  invitePartnerAction,
  resolveAccountDecisionAction,
  resolveGoalDecisionAction,
  sendFeedbackAction,
  updateProfileAction,
  type SettingsActionState,
} from "./actions";
import styles from "./settings.module.css";

const INPUT = styles.input;
const INITIAL_SETTINGS_STATE: SettingsActionState = { status: "idle", message: "" };

type IconName = "alert" | "check" | "feedback" | "goal" | "partnership" | "profile" | "trash" | "wallet";

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, React.ReactNode> = {
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7v6" /><path d="M12 17h.01" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.3 2.3 4.8-5" /></>,
    feedback: <><path d="M5 18.5 3.5 21v-5.2A8.5 8.5 0 1 1 7 19" /><path d="M8 9h8M8 13h5" /></>,
    goal: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="m15 9 5-5M16 4h4v4" /></>,
    partnership: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
    profile: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    trash: <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>,
    wallet: <><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H19v16H6.5A2.5 2.5 0 0 1 4 17.5z" /><path d="M4 7h15M15 11h6v5h-6a2.5 2.5 0 0 1 0-5Z" /></>,
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  );
}

function ConfirmationDialog({
  title,
  description,
  confirmLabel,
  pending,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  onClose: () => void;
}) {
  return (
    <AccessibleConfirmationDialog
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      pending={pending}
      onClose={onClose}
    />
  );
}

export type PartnershipRow = {
  id: number;
  solicitante_id: string | null;
  convidado_id: string | null;
  convidado_email: string;
  status: string | null;
};

export type AccountDecision = {
  id: number;
  nome: string;
  saldo_final: number;
  possui_lancamentos: boolean;
};

export type GoalDecision = {
  id: number;
  nome: string;
  saldo_total: number;
  saldo_disponivel: number;
};

function Feedback({ state }: { state: SettingsActionState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.status === "error" ? "alert" : "status"}
      className={`${styles.feedback} ${state.status === "error" ? styles.feedbackError : ""}`}
    >
      <Icon name={state.status === "error" ? "alert" : "check"} />
      <span>{state.message}</span>
    </p>
  );
}

export function ProfileForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, INITIAL_SETTINGS_STATE);
  return (
    <form action={action} className="mt-5 grid gap-4">
      <label className="block text-xs font-bold uppercase tracking-wide text-foreground-muted">
        Nome
        <input className={INPUT} name="name" defaultValue={name} minLength={2} maxLength={80} required autoComplete="name" />
      </label>
      <button disabled={pending} className={`ff-focus justify-self-start ${styles.primaryButton}`}>
        {pending ? "Salvando..." : "Salvar nome"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function FeedbackForm() {
  const [state, action, pending] = useActionState(sendFeedbackAction, INITIAL_SETTINGS_STATE);
  return (
    <form action={action} className="mt-5 grid gap-4">
      <label className="block text-xs font-bold uppercase tracking-wide text-foreground-muted">
        Tipo
        <select className={INPUT} name="type" defaultValue="sugestao">
          <option value="sugestao">Sugestão</option>
          <option value="problema">Problema</option>
          <option value="reclamação">Reclamação</option>
        </select>
      </label>
      <label className="block text-xs font-bold uppercase tracking-wide text-foreground-muted">
        Mensagem
        <textarea className={`${INPUT} min-h-32 resize-y`} name="message" minLength={10} maxLength={2000} required placeholder="Conte o que aconteceu ou o que podemos melhorar." />
      </label>
      <button disabled={pending} className={`ff-focus justify-self-start ${styles.primaryButton}`}>
        {pending ? "Enviando..." : "Enviar feedback"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function PartnershipPanel({
  partnerships,
  userId,
  userEmail,
  partnerName,
}: {
  partnerships: PartnershipRow[];
  userId: string;
  userEmail: string;
  partnerName: string | null;
}) {
  const [inviteState, inviteAction, inviting] = useActionState(invitePartnerAction, INITIAL_SETTINGS_STATE);
  const [acceptState, acceptAction, accepting] = useActionState(acceptPartnerAction, INITIAL_SETTINGS_STATE);
  const [closeState, closeAction, closing] = useActionState(closePendingPartnerAction, INITIAL_SETTINGS_STATE);
  const [dissolveState, dissolveAction, dissolving] = useActionState(dissolvePartnerAction, INITIAL_SETTINGS_STATE);
  const [confirmDissolution, setConfirmDissolution] = useState(false);
  const active = partnerships.find((item) => item.status === "aceito");
  const pending = partnerships.filter((item) => item.status === "pendente");

  return (
    <section className={`ff-card p-5 sm:p-6 ${styles.panel}`}>
      <div className={styles.panelHeader}>
        <div className={styles.headingGroup}>
          <span className={styles.iconBox}><Icon name="partnership" /></span>
          <div>
            <h2 className="text-lg font-extrabold text-foreground">Conta compartilhada</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-foreground-muted">Vincule-se a uma pessoa cadastrada. O compartilhamento de cada conta ou objetivo continua opcional.</p>
          </div>
        </div>
        <span className={styles.statusBadge}>1 parceria por vez</span>
      </div>

      {!active && pending.length === 0 && (
        <form action={inviteAction} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-foreground-muted">
            E-mail do parceiro
            <input className={INPUT} type="email" name="email" required maxLength={254} placeholder="pessoa@exemplo.com" />
          </label>
          <button disabled={inviting} className={`ff-focus ${styles.primaryButton}`}>
            {inviting ? "Enviando..." : "Enviar convite"}
          </button>
        </form>
      )}
      <Feedback state={inviteState} />

      {active && (
        <div className={`mt-5 p-4 sm:p-5 ${styles.activePartnership}`}>
          <p className="text-xs font-bold uppercase tracking-wide text-primary-dark">Parceria ativa</p>
          <p className="mt-1 font-extrabold text-foreground">
            {partnerName ?? (active.solicitante_id === userId ? active.convidado_email : "Parceiro(a)")}
          </p>
          {active.solicitante_id === userId && partnerName && <p className="mt-1 text-xs text-foreground-muted">{active.convidado_email}</p>}
          <form action={dissolveAction} className="mt-4">
            <input type="hidden" name="partnership_id" value={active.id} />
            <button
              type="button"
              disabled={dissolving}
              onClick={() => setConfirmDissolution(true)}
              className={`ff-focus ${styles.dangerButton}`}
            >
              {dissolving ? "Desfazendo..." : "Desfazer parceria"}
            </button>
            {confirmDissolution && (
              <ConfirmationDialog
                title="Desfazer esta parceria?"
                description="Contas e objetivos serão separados de forma segura. Cada pessoa verá as decisões pendentes e nenhum saldo será duplicado."
                confirmLabel="Sim, desfazer parceria"
                pending={dissolving}
                onClose={() => setConfirmDissolution(false)}
              />
            )}
          </form>
          <Feedback state={dissolveState} />
        </div>
      )}

      {pending.map((item) => {
        const invited = item.convidado_email.toLocaleLowerCase("pt-BR") === userEmail.toLocaleLowerCase("pt-BR") && item.solicitante_id !== userId;
        return (
          <article key={item.id} className={`mt-5 p-4 ${styles.decisionCard}`}>
            <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">{invited ? "Convite recebido" : "Convite enviado"}</p>
            <p className="mt-1 font-extrabold text-foreground">{item.convidado_email}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {invited && (
                <form action={acceptAction}>
                  <input type="hidden" name="partnership_id" value={item.id} />
                  <button disabled={accepting} className={`ff-focus ${styles.primaryButton}`}>Aceitar</button>
                </form>
              )}
              <form action={closeAction}>
                <input type="hidden" name="partnership_id" value={item.id} />
                <button disabled={closing} className={`ff-focus ${styles.dangerButton}`}>
                  {invited ? "Recusar" : "Cancelar convite"}
                </button>
              </form>
            </div>
          </article>
        );
      })}
      <Feedback state={acceptState} />
      <Feedback state={closeState} />
    </section>
  );
}

function AccountDecisionCard({ item }: { item: AccountDecision }) {
  const [state, action, pending] = useActionState(resolveAccountDecisionAction, INITIAL_SETTINGS_STATE);
  return (
    <article className={`p-4 ${styles.decisionCard}`}>
      <div className="flex items-start gap-3">
        <span className={styles.iconBox}><Icon name="wallet" /></span>
        <div className="min-w-0">
          <p className="font-extrabold text-foreground">{item.nome}</p>
          <p data-private-value="true" className="mt-1 text-sm font-bold text-foreground">{Number(item.saldo_final).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
        </div>
      </div>
      <p className="mt-1 text-xs text-foreground-muted">{item.possui_lancamentos ? "Possui lançamentos: escolha manter ativa ou arquivar." : "Sem lançamentos pessoais."}</p>
      <form action={action} className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="item_id" value={item.id} />
        <button name="decision" value="keep" disabled={pending} className={`ff-focus ${styles.primaryButton}`}>Manter ativa</button>
        <button name="decision" value="archive" disabled={pending} className={`ff-focus ${styles.secondaryButton}`}>Arquivar</button>
      </form>
      <Feedback state={state} />
    </article>
  );
}

function GoalDecisionCard({ item }: { item: GoalDecision }) {
  const [state, action, pending] = useActionState(resolveGoalDecisionAction, INITIAL_SETTINGS_STATE);
  return (
    <article className={`p-4 ${styles.decisionCard}`}>
      <div className="flex items-start gap-3">
        <span className={styles.iconBox}><Icon name="goal" /></span>
        <div className="min-w-0">
          <p className="font-extrabold text-foreground">{item.nome}</p>
          <p data-private-value="true" className="mt-1 text-sm text-foreground-muted">Saldo total: {Number(item.saldo_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
          <p data-private-value="true" className="mt-1 text-sm font-bold text-primary-dark">Disponível para você: {Number(item.saldo_disponivel).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
        </div>
      </div>
      <form action={action} className="mt-4 grid gap-3">
        <input type="hidden" name="decision_id" value={item.id} />
        <label className="text-xs font-bold uppercase tracking-wide text-foreground-muted">
          Saldo que deseja manter
          <CurrencyInput name="balance" defaultValue={Number(item.saldo_disponivel)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button name="decision" value="keep" disabled={pending} className={`ff-focus ${styles.primaryButton}`}>Manter objetivo</button>
          <button name="decision" value="discard" disabled={pending} className={`ff-focus ${styles.dangerButton}`}>Não manter</button>
        </div>
      </form>
      <Feedback state={state} />
    </article>
  );
}

export function DissolutionDecisions({ accounts, goals }: { accounts: AccountDecision[]; goals: GoalDecision[] }) {
  if (accounts.length === 0 && goals.length === 0) return null;
  return (
    <section className={`ff-card border-orange/40 p-5 sm:p-6 ${styles.panel}`}>
      <div className="rounded-ff-md bg-orange/10 p-4">
        <h2 className="text-lg font-extrabold text-foreground">Finalize a separação da parceria</h2>
        <p className="mt-1 text-sm leading-6 text-foreground-muted">As decisões abaixo são individuais. O banco limita atomicamente o saldo que pode permanecer em cada objetivo.</p>
      </div>
      {accounts.length > 0 && <><h3 className="mb-3 mt-5 font-extrabold text-foreground">Contas</h3><div className="grid gap-3 md:grid-cols-2">{accounts.map((item) => <AccountDecisionCard key={item.id} item={item} />)}</div></>}
      {goals.length > 0 && <><h3 className="mb-3 mt-5 font-extrabold text-foreground">Objetivos</h3><div className="grid gap-3 md:grid-cols-2">{goals.map((item) => <GoalDecisionCard key={item.id} item={item} />)}</div></>}
    </section>
  );
}

export function DeleteAccountForm() {
  const [state, action, pending] = useActionState(deleteAccountAction, INITIAL_SETTINGS_STATE);
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <form action={action} className="mt-5 max-w-xl">
      <label className="block text-xs font-bold uppercase tracking-wide text-foreground-muted">
        Senha atual
        <input
          className={INPUT}
          name="current_password"
          type="password"
          required
          minLength={8}
          maxLength={128}
          autoComplete="current-password"
        />
      </label>
      <label className="mt-4 block text-xs font-bold uppercase tracking-wide text-foreground-muted">
        Para confirmar, digite EXCLUIR
        <input
          className={INPUT}
          name="confirmation"
          type="text"
          required
          maxLength={20}
          autoComplete="off"
          spellCheck={false}
          aria-describedby="delete-account-warning"
        />
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => setConfirmDelete(true)}
        className={`ff-focus mt-4 ${styles.dangerButton}`}
      >
        {pending ? "Validando e excluindo..." : "Excluir minha conta"}
      </button>
      {confirmDelete && (
        <ConfirmationDialog
          title="Excluir sua conta permanentemente?"
          description="Todos os dados vinculados serão removidos. Esta ação é definitiva e não poderá ser desfeita."
          confirmLabel="Excluir conta definitivamente"
          pending={pending}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      <Feedback state={state} />
    </form>
  );
}
