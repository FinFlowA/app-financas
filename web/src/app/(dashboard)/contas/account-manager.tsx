"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import CurrencyInput from "@/components/ui/currency-input";
import { formatarReais } from "@/lib/format";
import type { Conta } from "@/lib/types";
import { useRequestId } from "@/lib/use-request-id";
import {
  alterarCompartilhamentoConta,
  alterarEstadoConta,
  criarConta,
  editarConta,
  type ContaActionState,
} from "./actions";

const COLORS = ["#16966E", "#4D76E8", "#F28A55", "#805AD5", "#EE6B63", "#56D39B", "#457B9D", "#6C7D77"];
const INITIAL: ContaActionState = { erro: null };

function RequestId({ state }: { state: ContaActionState }) {
  const [id, renewId] = useRequestId();
  const previousState = useRef(state);

  useEffect(() => {
    if (state !== previousState.current && state.sucesso) {
      renewId();
    }
    previousState.current = state;
  }, [renewId, state]);

  return <input type="hidden" name="request_id" value={id} readOnly />;
}

function Message({ state }: { state: ContaActionState }) {
  if (state.erro) return <p role="alert" className="mt-3 text-sm font-semibold text-red">{state.erro}</p>;
  if (state.sucesso) return <p role="status" className="mt-3 text-sm font-semibold text-primary">{state.sucesso}</p>;
  return null;
}

function ColorFields({ selected, onChange }: { selected: string; onChange: (value: string) => void }) {
  return <><input type="hidden" name="color" value={selected} /><div className="flex flex-wrap gap-2.5">{COLORS.map((color) => <button key={color} type="button" aria-label={`Usar cor ${color}`} aria-pressed={selected === color} onClick={() => onChange(color)} className="ff-focus h-9 w-9 rounded-full border-2 border-surface shadow-sm transition duration-200 hover:scale-110" style={{ backgroundColor: color, outline: selected === color ? "2px solid var(--color-foreground)" : "none", outlineOffset: 2 }} />)}</div></>;
}

function NewAccount({ partnerName }: { partnerName: string | null }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [state, action, pending] = useActionState(criarConta, INITIAL);
  return <section className="ff-card mb-6 overflow-hidden border-primary/15 bg-[linear-gradient(135deg,var(--color-surface),color-mix(in_srgb,var(--color-primary)_5%,var(--color-surface)))] shadow-[0_18px_50px_rgba(0,0,0,0.08)]">
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div className="flex items-center gap-3"><span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-soft text-xl text-primary">+</span><div><h2 className="font-extrabold text-foreground">Gerenciar contas</h2><p className="text-xs text-foreground-muted">Cadastre uma conta ou ajuste as existentes abaixo.</p></div></div>
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="ff-focus rounded-full bg-primary px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.24)] transition hover:-translate-y-0.5 hover:bg-primary-dark">{open ? "Fechar cadastro" : "+ Nova conta"}</button>
    </div>
    {open && <form action={action} className="grid gap-4 border-t border-border/70 bg-surface-muted/35 p-4 sm:grid-cols-2 sm:p-5">
      <RequestId state={state} />
      <label className="text-sm font-bold text-foreground">Nome<input name="name" required maxLength={100} className="ff-focus mt-1.5 w-full rounded-xl border border-border bg-surface-muted px-3.5 py-3 font-normal outline-none transition focus:border-primary" /></label>
      <label className="text-sm font-bold text-foreground">Saldo inicial<CurrencyInput name="initial_balance" defaultValue={0} required /></label>
      <div className="sm:col-span-2"><p className="mb-2 text-sm font-bold">Cor</p><ColorFields selected={color} onChange={setColor} /></div>
      {partnerName && <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-ff-sm border border-border bg-surface-muted p-3 text-sm text-foreground">
        <input type="checkbox" name="shared" value="true" className="mt-1 h-4 w-4 accent-primary" />
        <span><strong className="block">Compartilhar com {partnerName}</strong><span className="mt-0.5 block text-xs text-foreground-muted">Seu parceiro poderá visualizar a conta e os lançamentos dela. Você continua sendo o titular.</span></span>
      </label>}
      <div className="sm:col-span-2"><button disabled={pending} className="ff-focus rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.2)] transition hover:bg-primary-dark disabled:opacity-50">{pending ? "Criando..." : "Criar conta"}</button><Message state={state} /></div>
    </form>}
  </section>;
}

function AccountCard({ account, balance, own, partnerName }: { account: Conta; balance: number; own: boolean; partnerName: string | null }) {
  const [color, setColor] = useState(account.cor || COLORS[0]);
  const [editState, editAction, editing] = useActionState(editarConta, INITIAL);
  const [state, stateAction, changing] = useActionState(alterarEstadoConta, INITIAL);
  const [sharingState, sharingAction, sharing] = useActionState(alterarCompartilhamentoConta, INITIAL);
  const [deleteBaseline, setDeleteBaseline] = useState<ContaActionState | null>(null);
  const confirmDelete = deleteBaseline !== null && !(state !== deleteBaseline && state.sucesso);
  return <article className="ff-card group relative overflow-hidden border-white/5 shadow-[0_16px_44px_rgba(0,0,0,0.1)] transition duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_22px_56px_rgba(0,0,0,0.16)]">
    <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: account.cor || COLORS[0] }} />
    <div aria-hidden="true" className="absolute -right-16 -top-16 h-40 w-40 rounded-full opacity-[0.08] blur-2xl transition group-hover:opacity-[0.14]" style={{ backgroundColor: account.cor || COLORS[0] }} />
    <div className="relative p-5 pl-6">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: account.cor || COLORS[0] }} /><h2 className="truncate font-extrabold text-foreground">{account.nome}</h2></div><p data-private-value="true" className="mt-3 text-2xl font-black tracking-tight">{formatarReais(balance)}</p><p className="mt-1 text-[10px] font-bold uppercase tracking-widest text-foreground-muted">Saldo disponível</p></div><span className="rounded-full border border-border/70 bg-surface-muted/70 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">{account.arquivado ? "Arquivada" : account.compartilhado ? "Compartilhada" : "Ativa"}</span></div>
      {!own && <p className="mt-3 text-xs text-foreground-muted">Conta compartilhada pelo parceiro. A edição pertence ao titular.</p>}
      {own && partnerName && (!account.arquivado || account.compartilhado) && <form action={sharingAction} className="mt-4 rounded-ff-sm border border-border bg-surface-muted p-3">
        <RequestId state={sharingState} />
        <input type="hidden" name="account_id" value={account.id} />
        <input type="hidden" name="expected_version" value={account.version ?? 1} />
        <input type="hidden" name="shared" value={account.compartilhado ? "false" : "true"} />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><p className="text-sm font-bold text-foreground">{account.compartilhado ? `Visível para ${partnerName}` : "Conta privada"}</p><p className="mt-0.5 text-xs text-foreground-muted">{account.compartilhado ? "Somente você pode retirar o compartilhamento." : "Compartilhe apenas os dados que deseja mostrar ao parceiro."}</p></div>
          <button disabled={sharing} className={`rounded-ff-sm px-3 py-2 text-xs font-bold disabled:opacity-50 ${account.compartilhado ? "border border-border bg-surface text-foreground" : "bg-primary text-white"}`}>
            {sharing ? "Salvando..." : account.compartilhado ? "Tornar privada" : `Compartilhar com ${partnerName}`}
          </button>
        </div>
        <Message state={sharingState} />
      </form>}
      {own && <details className="group/edit mt-4 border-t border-border/70 pt-4"><summary className="ff-focus flex list-none items-center justify-between rounded-lg py-1 font-bold text-primary"><span>Editar conta</span><span className="transition group-open/edit:rotate-180">⌄</span></summary><form action={editAction} className="mt-4 grid gap-3 rounded-2xl bg-surface-muted/50 p-4">
        <RequestId state={editState} /><input type="hidden" name="account_id" value={account.id} /><input type="hidden" name="expected_version" value={account.version ?? 1} />
        <label className="text-xs font-bold uppercase text-foreground-muted">Nome<input name="name" required defaultValue={account.nome} maxLength={100} className="mt-1 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-sm normal-case text-foreground outline-none focus:border-primary" /></label>
        <label className="text-xs font-bold uppercase text-foreground-muted">Saldo inicial<CurrencyInput name="initial_balance" defaultValue={Number(account.saldo_inicial)} required /></label>
        <ColorFields selected={color} onChange={setColor} />
        <button disabled={editing} className="ff-focus rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-dark disabled:opacity-50">{editing ? "Salvando..." : "Salvar alterações"}</button><Message state={editState} />
      </form></details>}
      {own && <form action={stateAction} className="mt-3 flex flex-wrap gap-2"><RequestId state={state} /><input type="hidden" name="account_id" value={account.id} />
        {account.arquivado ? <button name="operation" value="reactivate_account" disabled={changing} className="rounded-ff-sm border border-primary px-3 py-2 text-xs font-bold text-primary">Reativar</button> : <button name="operation" value="archive_account" disabled={changing} className="rounded-ff-sm border border-border px-3 py-2 text-xs font-bold text-foreground-muted">Arquivar</button>}
        <button type="button" disabled={changing} onClick={() => setDeleteBaseline(state)} className="rounded-ff-sm border border-red/40 px-3 py-2 text-xs font-bold text-red">Excluir</button>
        {confirmDelete && <ConfirmationDialog
          title={`Excluir ${account.nome}?`}
          description="Se houver lançamentos, a conta será apenas arquivada para preservar todo o histórico financeiro. Uma conta vazia será excluída definitivamente."
          confirmLabel="Confirmar exclusão"
          confirmName="operation"
          confirmValue="delete_account"
          pending={changing}
          onClose={() => setDeleteBaseline(null)}
        >
          {state !== deleteBaseline && state.erro && <p role="alert" className="mt-4 rounded-xl bg-red/10 p-3 text-sm font-semibold text-red">{state.erro}</p>}
        </ConfirmationDialog>}
      </form>}
      <Message state={state} />
    </div>
  </article>;
}

export default function AccountManager({ accounts, balances, userId, partnerName }: { accounts: Conta[]; balances: Record<number, number>; userId: string; partnerName: string | null }) {
  return <><NewAccount partnerName={partnerName} /><div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-extrabold text-foreground">Todas as contas</h2><span className="rounded-full bg-surface-muted px-3 py-1 text-xs font-bold text-foreground-muted">{accounts.length} {accounts.length === 1 ? "conta" : "contas"}</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <AccountCard key={account.id} account={account} balance={balances[account.id] ?? Number(account.saldo_inicial)} own={account.user_id === userId} partnerName={partnerName} />)}</div>{accounts.length === 0 && <section className="ff-card grid min-h-48 place-content-center border-dashed p-8 text-center"><span className="text-3xl text-primary">＋</span><h2 className="mt-2 font-extrabold text-foreground">Nenhuma conta cadastrada</h2><p className="mt-1 text-sm text-foreground-muted">Use o botão acima para criar sua primeira conta.</p></section>}</>;
}
