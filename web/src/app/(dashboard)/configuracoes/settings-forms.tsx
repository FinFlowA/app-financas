"use client";

import { useActionState } from "react";
import CurrencyInput from "@/components/ui/currency-input";
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

const INPUT = "mt-1.5 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20";
const INITIAL_SETTINGS_STATE: SettingsActionState = { status: "idle", message: "" };

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
      className={`mt-3 rounded-ff-sm border px-3 py-2 text-sm font-semibold ${state.status === "error" ? "border-red/30 bg-red/10 text-red" : "border-primary/30 bg-primary-soft text-primary-dark"}`}
    >
      {state.message}
    </p>
  );
}

export function ProfileForm({ name }: { name: string }) {
  const [state, action, pending] = useActionState(updateProfileAction, INITIAL_SETTINGS_STATE);
  return (
    <form action={action} className="mt-5">
      <label className="block text-xs font-bold uppercase tracking-wide text-foreground-muted">
        Nome
        <input className={INPUT} name="name" defaultValue={name} minLength={2} maxLength={80} required autoComplete="name" />
      </label>
      <button disabled={pending} className="ff-focus mt-4 rounded-ff-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
      <button disabled={pending} className="ff-focus justify-self-start rounded-ff-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
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
  const active = partnerships.find((item) => item.status === "aceito");
  const pending = partnerships.filter((item) => item.status === "pendente");

  return (
    <section className="ff-card p-5 sm:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-lg font-extrabold text-foreground">Conta compartilhada</h2>
          <p className="mt-1 text-sm text-foreground-muted">Vincule-se a uma pessoa cadastrada. O compartilhamento de cada conta ou objetivo continua opcional.</p>
        </div>
        <span className="rounded-full bg-surface-muted px-3 py-1.5 text-xs font-bold text-foreground-muted">1 parceria por vez</span>
      </div>

      {!active && pending.length === 0 && (
        <form action={inviteAction} className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-xs font-bold uppercase tracking-wide text-foreground-muted">
            E-mail do parceiro
            <input className={INPUT} type="email" name="email" required maxLength={254} placeholder="pessoa@exemplo.com" />
          </label>
          <button disabled={inviting} className="ff-focus rounded-ff-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">
            {inviting ? "Enviando..." : "Enviar convite"}
          </button>
        </form>
      )}
      <Feedback state={inviteState} />

      {active && (
        <div className="mt-5 rounded-ff-md border border-primary/30 bg-primary-soft p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-primary-dark">Parceria ativa</p>
          <p className="mt-1 font-extrabold text-foreground">
            {partnerName ?? (active.solicitante_id === userId ? active.convidado_email : "Parceiro(a)")}
          </p>
          {active.solicitante_id === userId && partnerName && <p className="mt-1 text-xs text-foreground-muted">{active.convidado_email}</p>}
          <form action={dissolveAction} className="mt-4">
            <input type="hidden" name="partnership_id" value={active.id} />
            <button
              disabled={dissolving}
              onClick={(event) => {
                if (!confirm("Desfazer a parceria? Contas e objetivos serão separados de forma atômica e cada pessoa verá suas decisões pendentes.")) event.preventDefault();
              }}
              className="ff-focus rounded-ff-sm border border-red/40 bg-surface px-4 py-2 text-sm font-bold text-red disabled:opacity-50"
            >
              {dissolving ? "Desfazendo..." : "Desfazer parceria"}
            </button>
          </form>
          <Feedback state={dissolveState} />
        </div>
      )}

      {pending.map((item) => {
        const invited = item.convidado_email.toLocaleLowerCase("pt-BR") === userEmail.toLocaleLowerCase("pt-BR") && item.solicitante_id !== userId;
        return (
          <article key={item.id} className="mt-5 rounded-ff-md border border-border bg-surface-muted p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-foreground-muted">{invited ? "Convite recebido" : "Convite enviado"}</p>
            <p className="mt-1 font-extrabold text-foreground">{item.convidado_email}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {invited && (
                <form action={acceptAction}>
                  <input type="hidden" name="partnership_id" value={item.id} />
                  <button disabled={accepting} className="ff-focus rounded-ff-sm bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">Aceitar</button>
                </form>
              )}
              <form action={closeAction}>
                <input type="hidden" name="partnership_id" value={item.id} />
                <button disabled={closing} className="ff-focus rounded-ff-sm border border-red/40 bg-surface px-4 py-2 text-sm font-bold text-red disabled:opacity-50">
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
    <article className="rounded-ff-md border border-border bg-surface-muted p-4">
      <p className="font-extrabold text-foreground">{item.nome}</p>
      <p className="mt-1 text-sm text-foreground-muted">Saldo final: {Number(item.saldo_final).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
      <p className="mt-1 text-xs text-foreground-muted">{item.possui_lancamentos ? "Possui lançamentos: escolha manter ativa ou arquivar." : "Sem lançamentos pessoais."}</p>
      <form action={action} className="mt-4 flex flex-wrap gap-2">
        <input type="hidden" name="item_id" value={item.id} />
        <button name="decision" value="keep" disabled={pending} className="ff-focus rounded-ff-sm bg-primary px-4 py-2 text-sm font-bold text-white">Manter ativa</button>
        <button name="decision" value="archive" disabled={pending} className="ff-focus rounded-ff-sm border border-border bg-surface px-4 py-2 text-sm font-bold text-foreground-muted">Arquivar</button>
      </form>
      <Feedback state={state} />
    </article>
  );
}

function GoalDecisionCard({ item }: { item: GoalDecision }) {
  const [state, action, pending] = useActionState(resolveGoalDecisionAction, INITIAL_SETTINGS_STATE);
  return (
    <article className="rounded-ff-md border border-border bg-surface-muted p-4">
      <p className="font-extrabold text-foreground">{item.nome}</p>
      <p className="mt-1 text-sm text-foreground-muted">Saldo total: {Number(item.saldo_total).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
      <p className="mt-1 text-sm font-bold text-primary">Disponível para você: {Number(item.saldo_disponivel).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}</p>
      <form action={action} className="mt-4 grid gap-3">
        <input type="hidden" name="decision_id" value={item.id} />
        <label className="text-xs font-bold uppercase tracking-wide text-foreground-muted">
          Saldo que deseja manter
          <CurrencyInput name="balance" defaultValue={Number(item.saldo_disponivel)} />
        </label>
        <div className="flex flex-wrap gap-2">
          <button name="decision" value="keep" disabled={pending} className="ff-focus rounded-ff-sm bg-primary px-4 py-2 text-sm font-bold text-white">Manter objetivo</button>
          <button name="decision" value="discard" disabled={pending} className="ff-focus rounded-ff-sm border border-red/40 bg-surface px-4 py-2 text-sm font-bold text-red">Não manter</button>
        </div>
      </form>
      <Feedback state={state} />
    </article>
  );
}

export function DissolutionDecisions({ accounts, goals }: { accounts: AccountDecision[]; goals: GoalDecision[] }) {
  if (accounts.length === 0 && goals.length === 0) return null;
  return (
    <section className="ff-card border-orange/40 p-5 sm:p-6">
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
        disabled={pending}
        onClick={(event) => {
          if (!confirm("Excluir permanentemente sua conta FinFlow e todos os dados vinculados? Esta ação não pode ser desfeita.")) {
            event.preventDefault();
          }
        }}
        className="ff-focus mt-4 rounded-ff-sm border border-red/50 bg-red px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? "Validando e excluindo..." : "Excluir minha conta"}
      </button>
      <Feedback state={state} />
    </form>
  );
}
