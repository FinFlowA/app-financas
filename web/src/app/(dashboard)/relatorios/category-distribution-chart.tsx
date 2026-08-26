"use client";

import { useState } from "react";
import { formatarReais } from "@/lib/format";
import styles from "./relatorios.module.css";

export type CategoryDistributionItem = {
  id: string;
  name: string;
  color: string;
  value: number;
  percentage: number;
  details: { id: string; description: string; value: number; date: string }[];
};

const RADIUS = 52;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export default function CategoryDistributionChart({
  items,
  total,
  kind,
}: {
  items: CategoryDistributionItem[];
  total: number;
  kind: "receitas" | "despesas";
}) {
  const [selected, setSelected] = useState<CategoryDistributionItem | null>(null);
  if (!items.length || total <= 0) {
    return <p className={styles.empty}>Nenhuma {kind === "receitas" ? "receita" : "despesa"} realizada neste mês.</p>;
  }

  const segments = items.map((item, index) => ({
    item,
    accumulated: items.slice(0, index).reduce((sum, previous) => sum + previous.percentage, 0),
  }));

  return (
    <div className={styles.donutLayout}>
      <div className={styles.donutWrap}>
        <svg viewBox="0 0 120 120" width="148" height="148" role="img" aria-label={`Distribuição das ${kind} por categoria`}>
          <circle cx="60" cy="60" r={RADIUS} fill="none" stroke="var(--surface-muted)" strokeWidth="13" />
          {segments.map(({ item, accumulated }) => {
            const length = CIRCUMFERENCE * Math.max(0, Math.min(100, item.percentage)) / 100;
            const offset = -CIRCUMFERENCE * accumulated / 100;
            return (
              <circle
                key={item.id}
                cx="60"
                cy="60"
                r={RADIUS}
                fill="none"
                stroke={item.color}
                strokeWidth="13"
                strokeDasharray={`${length} ${Math.max(0, CIRCUMFERENCE - length)}`}
                strokeDashoffset={offset}
                strokeLinecap="butt"
                transform="rotate(-90 60 60)"
              >
                <title>{item.name}: {formatarReais(item.value)} ({item.percentage.toFixed(0)}%)</title>
              </circle>
            );
          })}
        </svg>
        <div className={styles.donutCenter} data-private-value="true">
          <span>{formatarReais(total)}<small>total no mês</small></span>
        </div>
      </div>
      <div className={styles.distributionLegend}>
        {items.map((item) => (
          <button type="button" key={item.id} onClick={() => setSelected(item)} className={`${styles.distributionLegendItem} ${styles.distributionLegendButton}`}>
            <span className={styles.categoryName}>
              <span className={styles.legendDot} style={{ background: item.color }} />
              <span>{item.name}</span>
            </span>
            <span data-private-value="true">{item.percentage.toFixed(0)}%</span>
          </button>
        ))}
      </div>
      {selected && <div className={styles.categoryDetailBackdrop} role="presentation" onMouseDown={() => setSelected(null)}>
        <section className={styles.categoryDetailDialog} role="dialog" aria-modal="true" aria-labelledby="category-detail-title" onMouseDown={(event) => event.stopPropagation()}>
          <div className={styles.categoryDetailHeader}><div><p>Detalhamento do mês</p><h3 id="category-detail-title"><span style={{ background: selected.color }} />{selected.name}</h3></div><button type="button" onClick={() => setSelected(null)} aria-label="Fechar">×</button></div>
          <div className={styles.categoryDetailSummary}><span>{selected.details.length} {selected.details.length === 1 ? "lançamento" : "lançamentos"}</span><strong data-private-value="true">{formatarReais(selected.value)}</strong></div>
          <div className={styles.categoryDetailList}>{selected.details.map((detail) => <div key={detail.id} className={styles.categoryDetailItem}><span><strong>{detail.description}</strong><small>{new Intl.DateTimeFormat("pt-BR").format(new Date(`${detail.date}T12:00:00-03:00`))}</small></span><strong data-private-value="true">{formatarReais(detail.value)}</strong></div>)}</div>
        </section>
      </div>}
    </div>
  );
}
