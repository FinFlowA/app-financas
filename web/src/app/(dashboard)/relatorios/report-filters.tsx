"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { nextReportAccountSelection } from "@/lib/report-scope";
import styles from "./relatorios.module.css";

type AccountOption = { id: number; name: string; color: string };

export default function ReportFilters({
  year,
  month,
  selected,
  accounts,
  view = "monthly",
  considerarAtrasados = true,
  onAlternarAtrasados,
}: {
  year: number;
  month: number;
  selected: number[];
  accounts: AccountOption[];
  view?: "monthly" | "daily";
  considerarAtrasados?: boolean;
  onAlternarAtrasados?: () => void;
}) {
  const router = useRouter();
  const [draftAccounts, setDraftAccounts] = useState(selected);
  const [periodPickerOpen, setPeriodPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(year);
  const periodPickerRef = useRef<HTMLDivElement>(null);
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
    if (!considerarAtrasados) params.set("atrasados", "0");
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

  useEffect(() => {
    if (!periodPickerOpen) return;
    function close(event: PointerEvent) {
      if (!periodPickerRef.current?.contains(event.target as Node)) setPeriodPickerOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setPeriodPickerOpen(false);
    }
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [periodPickerOpen]);

  function selectPeriod(nextYear: number, nextMonth = month) {
    setPeriodPickerOpen(false);
    router.push(urlFor(nextYear, nextMonth, selected));
  }

  return (
    <>
    <form action="/relatorios" method="get" className={styles.filters} aria-label="Filtros do fluxo de caixa">
      <input type="hidden" name="year" value={year} />
      <input type="hidden" name="month" value={month + 1} />
      <input type="hidden" name="accounts" value={draftAccounts.join(",")} />
      {view === "daily" && <input type="hidden" name="view" value="daily" />}
      {!considerarAtrasados && <input type="hidden" name="atrasados" value="0" />}
      <div className={styles.filtersRow}>
        <div className={styles.yearFilter} ref={periodPickerRef}>
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
            {view === "daily" ? (
              <button
                type="button"
                className={styles.periodPickerButton}
                aria-haspopup="dialog"
                aria-expanded={periodPickerOpen}
                onClick={() => { setPickerYear(year); setPeriodPickerOpen((open) => !open); }}
              >
                <span aria-live="polite">{`${["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"][month]} ${year}`}</span>
                <span aria-hidden className={styles.periodPickerChevron}>⌄</span>
              </button>
            ) : (
              <span aria-live="polite" className={styles.yearValue}>{year}</span>
            )}
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
          {view === "daily" && periodPickerOpen && (
            <section className={styles.periodPicker} role="dialog" aria-label="Selecionar mês e ano">
              <div className={styles.periodPickerHeader}>
                <button type="button" disabled={pickerYear <= minimumYear} onClick={() => setPickerYear((value) => value - 1)} aria-label="Ano anterior">‹</button>
                <strong>{pickerYear}</strong>
                <button type="button" disabled={pickerYear >= maximumYear} onClick={() => setPickerYear((value) => value + 1)} aria-label="Próximo ano">›</button>
              </div>
              <div className={styles.monthPickerGrid}>
                {["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"].map((label, index) => (
                  <button type="button" key={label} data-active={pickerYear === year && index === month} onClick={() => selectPeriod(pickerYear, index)}>{label}</button>
                ))}
              </div>
            </section>
          )}
        </div>
        <fieldset className={styles.accountsFilter}>
          <legend className={styles.filterLegend}>Contas incluídas</legend>
          <div className={styles.accountButtons}>
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
    {/* Filtro de atrasados: cartão próprio fora da caixa de filtros e em
        laranja, como no app, para não parecer mais uma conta. Ligado por
        padrão; desligado, os pendentes já vencidos saem do cálculo. */}
    <button
      type="button"
      role="switch"
      aria-checked={considerarAtrasados}
      data-active={considerarAtrasados}
      className={styles.overdueToggle}
      onClick={onAlternarAtrasados}
    >
      <svg aria-hidden viewBox="0 0 24 24" className={styles.overdueIcon}>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className={styles.overdueText}>
        <strong>Considerar atrasados</strong>
        <small aria-live="polite">{considerarAtrasados ? "Pendentes vencidos entram no saldo previsto." : "Pendentes vencidos estão fora do cálculo."}</small>
      </span>
      <span aria-hidden className={styles.overdueSwitch} />
    </button>
    </>
  );
}
