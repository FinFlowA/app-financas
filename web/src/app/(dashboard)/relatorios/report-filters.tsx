"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type AccountOption = { id: number; name: string; color: string };

export default function ReportFilters({ year, selected, accounts }: { year: number; selected: number[]; accounts: AccountOption[] }) {
  const router = useRouter();
  const [draftYear, setDraftYear] = useState(year);
  const [draftAccounts, setDraftAccounts] = useState(selected);
  const currentYear = new Date().getFullYear();
  function apply() {
    if (!draftAccounts.length) return;
    const params = new URLSearchParams({ year: String(draftYear), accounts: draftAccounts.join(",") });
    router.push(`/relatorios?${params.toString()}`);
  }
  return <section className="ff-card mb-5 p-4"><div className="flex flex-wrap items-end gap-4">
    <label className="text-xs font-bold uppercase text-foreground-muted">Ano<select value={draftYear} onChange={(event) => setDraftYear(Number(event.target.value))} className="mt-1 block rounded-ff-sm border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-foreground">{Array.from({ length: 11 }, (_, index) => currentYear - 5 + index).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <fieldset className="min-w-0 flex-1"><legend className="mb-1 text-xs font-bold uppercase text-foreground-muted">Contas</legend><div className="flex flex-wrap gap-2">{accounts.map((account) => { const active = draftAccounts.includes(account.id); return <button type="button" key={account.id} onClick={() => setDraftAccounts((ids) => active ? ids.filter((id) => id !== account.id) : [...ids, account.id])} className={`ff-focus flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-bold ${active ? "border-primary bg-primary-soft text-primary-dark" : "border-border text-foreground-muted"}`}><span className="h-2.5 w-2.5 rounded-full" style={{ background: account.color }} />{account.name}</button>; })}</div></fieldset>
    <button type="button" onClick={apply} disabled={!draftAccounts.length} className="rounded-ff-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">Aplicar</button>
  </div>{!draftAccounts.length && <p className="mt-2 text-xs font-semibold text-red">Selecione ao menos uma conta para calcular o fluxo.</p>}</section>;
}
