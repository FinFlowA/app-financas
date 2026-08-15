"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import CurrencyInput from "@/components/ui/currency-input";
import { formatarReais } from "@/lib/format";
import type { Conta } from "@/lib/types";
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
  const [id] = useState(() => crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);
  const previousState = useRef(state);

  useEffect(() => {
    if (state !== previousState.current && state.sucesso && inputRef.current) {
      inputRef.current.value = crypto.randomUUID();
    }
    previousState.current = state;
  }, [state]);

  return <input ref={inputRef} type="hidden" name="request_id" defaultValue={id} />;
}

function Message({ state }: { state: ContaActionState }) {
  if (state.erro) return <p role="alert" className="mt-3 text-sm font-semibold text-red">{state.erro}</p>;
  if (state.sucesso) return <p role="status" className="mt-3 text-sm font-semibold text-primary">{state.sucesso}</p>;
  return null;
}

function ColorFields({ selected, onChange }: { selected: string; onChange: (value: string) => void }) {
  return <><input type="hidden" name="color" value={selected} /><div className="flex flex-wrap gap-2">{COLORS.map((color) => <button key={color} type="button" aria-label={`Usar cor ${color}`} onClick={() => onChange(color)} className="h-8 w-8 rounded-full" style={{ backgroundColor: color, outline: selected === color ? "3px solid var(--color-foreground)" : "none", outlineOffset: 2 }} />)}</div></>;
}

function NewAccount({ partnerName }: { partnerName: string | null }) {
  const [open, setOpen] = useState(false);
  const [color, setColor] = useState(COLORS[0]);
  const [state, action, pending] = useActionState(criarConta, INITIAL);
  return <section className="ff-card mb-6 p-5">
    <button type="button" onClick={() => setOpen((value) => !value)} className="ff-focus rounded-ff-sm bg-primary px-4 py-2.5 text-sm font-bold text-white">{open ? "Fechar" : "+ Nova conta"}</button>
    {open && <form action={action} className="mt-5 grid gap-4 sm:grid-cols-2">
      <RequestId state={state} />
      <label className="text-sm font-bold text-foreground">Nome<input name="name" required maxLength={100} className="mt-1 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 font-normal outline-none focus:border-primary" /></label>
      <label className="text-sm font-bold text-foreground">Saldo inicial<CurrencyInput name="initial_balance" defaultValue={0} required /></label>
      <div className="sm:col-span-2"><p className="mb-2 text-sm font-bold">Cor</p><ColorFields selected={color} onChange={setColor} /></div>
      {partnerName && <label className="sm:col-span-2 flex cursor-pointer items-start gap-3 rounded-ff-sm border border-border bg-surface-muted p-3 text-sm text-foreground">
        <input type="checkbox" name="shared" value="true" className="mt-1 h-4 w-4 accent-primary" />
        <span><strong className="block">Compartilhar com {partnerName}</strong><span className="mt-0.5 block text-xs text-foreground-muted">Seu parceiro poderá visualizar a conta e os lançamentos dela. Você continua sendo o titular.</span></span>
      </label>}
      <div className="sm:col-span-2"><button disabled={pending} className="rounded-ff-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{pending ? "Criando..." : "Criar conta"}</button><Message state={state} /></div>
    </form>}
  </section>;
}

function AccountCard({ account, balance, own, partnerName }: { account: Conta; balance: number; own: boolean; partnerName: string | null }) {
  const [color, setColor] = useState(account.cor || COLORS[0]);
  const [editState, editAction, editing] = useActionState(editarConta, INITIAL);
  const [state, stateAction, changing] = useActionState(alterarEstadoConta, INITIAL);
  const [sharingState, sharingAction, sharing] = useActionState(alterarCompartilhamentoConta, INITIAL);
  return <article className="ff-card overflow-hidden">
    <div className="h-2" style={{ backgroundColor: account.cor || COLORS[0] }} />
    <div className="p-5">
      <div className="flex items-start justify-between gap-3"><div><h2 className="font-extrabold text-foreground">{account.nome}</h2><p data-private-value="true" className="mt-1 text-xl font-extrabold">{formatarReais(balance)}</p></div><span className="rounded-full bg-surface-muted px-2.5 py-1 text-[11px] font-bold text-foreground-muted">{account.arquivado ? "Arquivada" : account.compartilhado ? "Compartilhada" : "Ativa"}</span></div>
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
      {own && <details className="mt-4 border-t border-border pt-4"><summary className="font-bold text-primary">Editar conta</summary><form action={editAction} className="mt-4 grid gap-3">
        <RequestId state={editState} /><input type="hidden" name="account_id" value={account.id} /><input type="hidden" name="expected_version" value={account.version ?? 1} />
        <label className="text-xs font-bold uppercase text-foreground-muted">Nome<input name="name" required defaultValue={account.nome} maxLength={100} className="mt-1 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-sm normal-case text-foreground outline-none focus:border-primary" /></label>
        <label className="text-xs font-bold uppercase text-foreground-muted">Saldo inicial<CurrencyInput name="initial_balance" defaultValue={Number(account.saldo_inicial)} required /></label>
        <ColorFields selected={color} onChange={setColor} />
        <button disabled={editing} className="rounded-ff-sm bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{editing ? "Salvando..." : "Salvar alterações"}</button><Message state={editState} />
      </form></details>}
      {own && <form action={stateAction} className="mt-3 flex flex-wrap gap-2"><RequestId state={state} /><input type="hidden" name="account_id" value={account.id} />
        {account.arquivado ? <button name="operation" value="reactivate_account" disabled={changing} className="rounded-ff-sm border border-primary px-3 py-2 text-xs font-bold text-primary">Reativar</button> : <button name="operation" value="archive_account" disabled={changing} className="rounded-ff-sm border border-border px-3 py-2 text-xs font-bold text-foreground-muted">Arquivar</button>}
        <button name="operation" value="delete_account" disabled={changing} onClick={(event) => { if (!confirm("Excluir esta conta? Se houver lançamentos, ela será apenas arquivada para preservar o histórico.")) event.preventDefault(); }} className="rounded-ff-sm border border-red/40 px-3 py-2 text-xs font-bold text-red">Excluir</button>
      </form>}
      <Message state={state} />
    </div>
  </article>;
}

export default function AccountManager({ accounts, balances, userId, partnerName }: { accounts: Conta[]; balances: Record<number, number>; userId: string; partnerName: string | null }) {
  return <><NewAccount partnerName={partnerName} /><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{accounts.map((account) => <AccountCard key={account.id} account={account} balance={balances[account.id] ?? Number(account.saldo_inicial)} own={account.user_id === userId} partnerName={partnerName} />)}</div>{accounts.length === 0 && <p className="text-foreground-muted">Nenhuma conta cadastrada.</p>}</>;
}
