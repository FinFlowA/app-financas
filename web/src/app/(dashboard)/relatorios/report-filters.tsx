"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { nextReportAccountSelection } from "@/lib/report-scope";
import styles from "./relatorios.module.css";

type AccountOption = { id: number; name: string; color: string };

export default function ReportFilters({
  year,
  month,
  selected,
  accounts,
  view = "monthly",
}: {
  year: number;
  month: number;
  selected: number[];
  accounts: AccountOption[];
  view?: "monthly" | "daily";
}) {
  const router = useRouter();
  const [draftAccounts, setDraftAccounts] = useState(selected);
  const currentYear = new Date().getFullYear();
  const minimumYear = currentYear - 10;
  const maximumYear = currentYear + 10;

  function urlFor(nextYear: number, nextMonth: number, accountIds: number[]) {
    const params = new URLSearchParams({
      year: String(nextYear),
      month: String(nextMonth + 1),
      accounts: accountIds.join(","),
    });
    if (view === "daily") params.set("view", "daily");
    return `/relatorios?${params.toString()}`;
  }

  function moveMonth(offset: number) {
    const date = new Date(year, month + offset, 1);
    router.push(urlFor(date.getFullYear(), date.getMonth(), selected));
  }

  function toggleAccount(accountId: number) {
    setDraftAccounts((ids) => nextReportAccountSelection(
      ids,
      accounts.map((account) => account.id),
      accountId,
    ));
  }

  const allDraftSelected = accounts.length > 0 && draftAccounts.length === accounts.length
    && accounts.every((account) => draftAccounts.includes(account.id));
  return (
    <form action="/relatorios" method="get" className={styles.filters} aria-label="Filtros do fluxo de caixa">
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month + 1} />
      <input type="hidden" name="accounts" value={draftAccounts.join(",")} />
      {view === "daily" && <input type="hidden" name="view" value="daily" />}
      <div className={styles.filtersRow}>
        <div className={styles.yearFilter}>
          <span className={styles.filterLabel}>{view === "daily" ? "Mês" : "Ano"}</span>
          <div className={styles.yearStepper} aria-label={view === "daily" ? `Mês analisado: ${month + 1} de ${year}` : `Ano analisado: ${year}`}>
            <button
              type="button"
              aria-label="Ver ano anterior"
              disabled={view === "monthly" ? year <= minimumYear : year === minimumYear && month === 0}
              onClick={() => view === "daily" ? moveMonth(-1) : router.push(urlFor(year - 1, month, selected))}
              className={styles.yearArrow}
            >
              <span aria-hidden>‹</span>
            </button>
            <strong aria-live="polite">{view === "daily" ? `${["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][month]} ${year}` : year}</strong>
            <button
              type="button"
              aria-label="Ver próximo ano"
              disabled={view === "monthly" ? year >= maximumYear : year === maximumYear && month === 11}
              onClick={() => view === "daily" ? moveMonth(1) : router.push(urlFor(year + 1, month, selected))}
              className={styles.yearArrow}
            >
              <span aria-hidden>›</span>
            </button>
          </div>
        </div>
        <fieldset className={styles.accountsFilter}>
          <legend className={styles.filterLegend}>Contas incluídas</legend>
          <div className={styles.accountButtons}>
            <button
              type="button"
              onClick={() => setDraftAccounts(accounts.map((account) => account.id))}
              className={styles.accountButton}
              data-active={allDraftSelected}
              aria-pressed={allDraftSelected}
            >
              Todas as contas
            </button>
            {accounts.map((account) => {
              const active = draftAccounts.includes(account.id);
              return (
                <button
                  type="button"
                  key={account.id}
                  onClick={() => toggleAccount(account.id)}
                  className={styles.accountButton}
                  data-active={active}
                  aria-pressed={active}
                >
                  <span className={styles.accountDot} style={{ background: account.color }} />
                  {account.name}
                </button>
              );
            })}
          </div>
        </fieldset>
        <button type="submit" disabled={!draftAccounts.length} className={styles.applyButton}>Aplicar contas</button>
      </div>
      {!draftAccounts.length && <p className={styles.filterError}>Selecione ao menos uma conta para calcular o fluxo.</p>}
    </form>
  );
}
