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
}: {
  year: number;
  month: number;
  selected: number[];
  accounts: AccountOption[];
}) {
  const router = useRouter();
  const [draftAccounts, setDraftAccounts] = useState(selected);
  const currentYear = new Date().getFullYear();
  const minimumYear = currentYear - 10;
  const maximumYear = currentYear + 10;

  function urlFor(nextYear: number, accountIds: number[]) {
    const params = new URLSearchParams({
      year: String(nextYear),
      month: String(month + 1),
      accounts: accountIds.join(","),
    });
    return `/relatorios?${params.toString()}`;
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
      <div className={styles.filtersRow}>
        <div className={styles.yearFilter}>
          <span className={styles.filterLabel}>Ano</span>
          <div className={styles.yearStepper} aria-label={`Ano analisado: ${year}`}>
            <button
              type="button"
              aria-label="Ver ano anterior"
              disabled={year <= minimumYear}
              onClick={() => router.push(urlFor(year - 1, selected))}
              className={styles.yearArrow}
            >
              <span aria-hidden>‹</span>
            </button>
            <strong aria-live="polite">{year}</strong>
            <button
              type="button"
              aria-label="Ver próximo ano"
              disabled={year >= maximumYear}
              onClick={() => router.push(urlFor(year + 1, selected))}
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
