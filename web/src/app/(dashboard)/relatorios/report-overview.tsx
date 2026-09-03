"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarReais } from "@/lib/format";
import FluxoSaldoChart, { type MesFluxo, type PontoSaldo } from "./fluxo-saldo-chart";
import ReportFilters from "./report-filters";
import styles from "./relatorios.module.css";

type AccountOption = { id: number; name: string; color: string };

type Metric = {
  label: string;
  value: number;
  tone: "positive" | "negative" | "neutral";
};

export default function ReportOverview({
  year,
  currentYear,
  currentMonthIndex,
  selectedMonthIndex,
  currentBalance,
  initialBalance,
  months,
  balances,
  metrics,
  selectedAccountIds,
  accounts,
  dailyFlow,
  dailyBalances,
  view,
}: {
  year: number;
  currentYear: number;
  currentMonthIndex: number;
  selectedMonthIndex: number;
  currentBalance: number;
  initialBalance: number;
  months: MesFluxo[];
  balances: PontoSaldo[];
  metrics: Metric[];
  selectedAccountIds: number[];
  accounts: AccountOption[];
  dailyFlow: MesFluxo[];
  dailyBalances: PontoSaldo[];
  view: "monthly" | "daily";
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [selection, setSelection] = useState({
    sourceYear: year,
    sourceMonthIndex: selectedMonthIndex,
    activeMonthIndex: selectedMonthIndex,
  });
  const activeMonthIndex = selection.sourceYear === year && selection.sourceMonthIndex === selectedMonthIndex
    ? selection.activeMonthIndex
    : selectedMonthIndex;
  const defaultDayIndex = year === currentYear && selectedMonthIndex === currentMonthIndex
    ? Math.min(new Date().getDate() - 1, Math.max(0, dailyFlow.length - 1))
    : Math.max(0, dailyFlow.length - 1);
  const [daySelection, setDaySelection] = useState({
    sourceYear: year,
    sourceMonthIndex: selectedMonthIndex,
    activeDayIndex: defaultDayIndex,
  });
  const activeDayIndex = daySelection.sourceYear === year && daySelection.sourceMonthIndex === selectedMonthIndex
    ? Math.min(daySelection.activeDayIndex, Math.max(0, dailyFlow.length - 1))
    : defaultDayIndex;

  const activePoint = balances[activeMonthIndex];
  const isCurrentMonth = year === currentYear && activeMonthIndex === currentMonthIndex;
  const displayedBalance = isCurrentMonth ? currentBalance : activePoint?.saldo ?? initialBalance;
  const balanceLabel = isCurrentMonth
    ? "Saldo atual das contas"
    : activePoint?.projetado
      ? `Saldo previsto no fim de ${months[activeMonthIndex]?.label.split(" ")[0] ?? "mês"}`
      : `Saldo realizado no fim de ${months[activeMonthIndex]?.label.split(" ")[0] ?? "mês"}`;

  function selectMonth(index: number) {
    setSelection({ sourceYear: year, sourceMonthIndex: selectedMonthIndex, activeMonthIndex: index });
    if (index === selectedMonthIndex) return;
    const params = new URLSearchParams({
      year: String(year),
      month: String(index + 1),
      accounts: selectedAccountIds.join(","),
    });
    startTransition(() => router.replace(`/relatorios?${params.toString()}`, { scroll: false }));
  }

  function changeView(nextView: "monthly" | "daily") {
    if (nextView === view) return;
    const params = new URLSearchParams({
      year: String(year),
      month: String(activeMonthIndex + 1),
      accounts: selectedAccountIds.join(","),
    });
    if (nextView === "daily") params.set("view", "daily");
    startTransition(() => router.replace(`/relatorios?${params.toString()}`, { scroll: false }));
  }

  return (
    <>
      <header className={styles.hero}>
        <div>
          <p className={styles.heroEyebrow}>Análise financeira · {year}</p>
          <h1 className={styles.heroTitle}>Fluxo de caixa</h1>
          <p className={styles.balanceLabel}>{balanceLabel}</p>
          <p
            data-private-value="true"
            data-tone={displayedBalance < 0 ? "negative" : "positive"}
            className={styles.balanceValue}
            aria-live="polite"
          >
            {formatarReais(displayedBalance)}
          </p>
          <p className={styles.heroDescription}>Selecione um mês no gráfico para conferir o saldo daquele período. Transferências para objetivos não são tratadas como despesas.</p>
        </div>
        <div className={styles.heroMetrics} aria-label="Resumo do mês atual">
          {metrics.map((metric) => (
            <div className={styles.heroMetric} data-tone={metric.tone} key={metric.label}>
              <span>{metric.label}</span>
              <strong data-private-value="true">{formatarReais(metric.value)}</strong>
            </div>
          ))}
        </div>
      </header>

      <div className={styles.viewToggle} role="group" aria-label="Período do fluxo de caixa">
        <button type="button" data-active={view === "monthly"} aria-pressed={view === "monthly"} onClick={() => changeView("monthly")}>Mensal</button>
        <button type="button" data-active={view === "daily"} aria-pressed={view === "daily"} onClick={() => changeView("daily")}>Diário</button>
      </div>

      <ReportFilters
        key={`${year}:${activeMonthIndex}:${selectedAccountIds.join(",")}`}
        year={year}
        month={activeMonthIndex}
        selected={selectedAccountIds}
        accounts={accounts}
        view={view}
      />
      {view === "monthly" ? (
        <FluxoSaldoChart meses={months} saldos={balances} selectedIndex={activeMonthIndex} onSelect={selectMonth} />
      ) : (
        <FluxoSaldoChart
          meses={dailyFlow}
          saldos={dailyBalances}
          selectedIndex={activeDayIndex}
          onSelect={(index) => setDaySelection({ sourceYear: year, sourceMonthIndex: selectedMonthIndex, activeDayIndex: index })}
          period="day"
        />
      )}
    </>
  );
}
