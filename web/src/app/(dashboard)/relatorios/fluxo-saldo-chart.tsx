"use client";

import { useState } from "react";
import { formatarReais } from "@/lib/format";
import styles from "./relatorios.module.css";

export type MesFluxo = {
  label: string;
  receitas: number;
  despesas: number;
  receitasPrevistas?: number;
  despesasPrevistas?: number;
  guardadoObjetivos?: number;
  resgatadoObjetivos?: number;
  guardarObjetivosPrevisto?: number;
  resgatarObjetivosPrevisto?: number;
};
export type PontoSaldo = { label: string; saldo: number; projetado: boolean };

function numeroLimpo(valor: number): number {
  const absoluto = Math.abs(valor);
  if (absoluto === 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(absoluto));
  return Math.ceil(absoluto / magnitude) * magnitude;
}

export default function FluxoSaldoChart({
  meses,
  saldos,
  selectedIndex,
  onSelect,
}: {
  meses: MesFluxo[];
  saldos: PontoSaldo[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const [ativo, setAtivo] = useState<number | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<{ left: number; top: number } | null>(null);

  const maiorBarra = Math.max(1, ...meses.map((m) => Math.max(
    m.receitas + (m.receitasPrevistas ?? 0),
    m.despesas + (m.despesasPrevistas ?? 0),
  )));
  const saldoValores = saldos.map((p) => p.saldo);
  const maxValor = Math.max(maiorBarra, ...saldoValores, 0);
  const minValor = Math.min(...saldoValores, 0);
  const tetoEixo = numeroLimpo(maxValor);
  const pisoEixo = minValor < 0 ? -numeroLimpo(Math.abs(minValor)) : 0;
  const range = tetoEixo - pisoEixo || 1;

  // Gráfico mais largo: mais respiro por mês para as duas barras + a linha.
  const largura = 1080;
  const altura = 320;
  const margemEsquerda = 64;
  const margemDireita = 20;
  const margemBaixo = 28;
  const margemTopo = 20;
  const areaAltura = altura - margemBaixo - margemTopo;
  const areaLargura = largura - margemEsquerda - margemDireita;
  const larguraGrupo = areaLargura / meses.length;
  const larguraBarra = Math.min(22, larguraGrupo / 2 - 6);

  // Mesma escala e o mesmo ponto de 0 para as barras e para a linha — as
  // barras crescem a partir de y(0), exatamente onde a linha cruza o zero.
  const y = (valor: number) => margemTopo + areaAltura - ((valor - pisoEixo) / range) * areaAltura;
  const xCentro = (indice: number) => margemEsquerda + larguraGrupo * (indice + 0.5);

  const primeiroProjetadoIdx = saldos.findIndex((p) => p.projetado);
  const fimRealizado = primeiroProjetadoIdx === -1 ? saldos.length - 1 : primeiroProjetadoIdx;
  const caminho = (inicio: number, fim: number) => saldos
    .slice(inicio, fim + 1)
    .map((ponto, indice) => `${indice === 0 ? "M" : "L"} ${xCentro(inicio + indice)} ${y(ponto.saldo)}`)
    .join(" ");

  const ultimoSaldo = saldos.at(-1);
  const detailIndex = ativo ?? selectedIndex;
  const mesAtivo = meses[detailIndex];
  const saldoAtivo = saldos[detailIndex];
  const linhasObjetivoTooltip = mesAtivo
    ? [mesAtivo.guardadoObjetivos, mesAtivo.resgatadoObjetivos, mesAtivo.guardarObjetivosPrevisto, mesAtivo.resgatarObjetivosPrevisto].filter((valor) => (valor ?? 0) > 0).length
    : 0;

  return (
    <section className={styles.chartPanel}>
      <div className={styles.chartHeader}>
        <div>
          <h2 className={styles.chartTitle}>Evolução mensal</h2>
          <p className={styles.chartSubtitle}>Receitas, despesas e saldo acumulado no mesmo eixo.</p>
        </div>
        <div className={styles.legend} aria-label="Legenda do gráfico">
        <span className={styles.legendItem}>
          <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="var(--color-blue)" strokeWidth={2} /></svg>
          Saldo
        </span>
        <span className={styles.legendItem}>
          <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="var(--color-blue)" strokeWidth={2} strokeDasharray="4 3" /></svg>
          Saldo projetado
        </span>
        <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: "var(--color-primary)" }} /> Receitas</span>
        <span className={styles.legendItem}><span className={styles.legendDot} style={{ background: "var(--color-red)" }} /> Despesas</span>
        </div>
      </div>

      <div className={styles.chartScroll}>
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          className={styles.chartSvg}
          role="group"
          aria-label="Receitas, despesas e saldo acumulado por mês, no mesmo eixo com 0 compartilhado"
        >
          {[0, 0.25, 0.5, 0.75, 1].map((fracao) => {
            const valor = pisoEixo + range * fracao;
            const posY = y(valor);
            return (
              <g key={fracao}>
                <line x1={margemEsquerda} x2={largura - margemDireita} y1={posY} y2={posY} stroke="var(--color-border)" strokeWidth={1} />
                <text x={margemEsquerda - 8} y={posY + 3} textAnchor="end" fontSize={10} fill="var(--color-foreground-muted)">
                  {Math.abs(valor) >= 1000 ? `${(valor / 1000).toFixed(1)}k` : valor.toFixed(0)}
                </text>
              </g>
            );
          })}
          {/* Linha de 0 destacada — mesma referência para as barras e para a linha de saldo. */}
          <line x1={margemEsquerda} x2={largura - margemDireita} y1={y(0)} y2={y(0)} stroke="var(--color-foreground-muted)" strokeWidth={1} />

          {meses.map((mes, indice) => {
            const centro = xCentro(indice);
            const grupoX = margemEsquerda + indice * larguraGrupo;
            const destacado = ativo === indice || selectedIndex === indice;
            return (
              <g
                key={mes.label}
                className={styles.chartMonthGroup}
                onMouseEnter={() => setAtivo(indice)}
                onMouseMove={(event) => {
                  const container = event.currentTarget.ownerSVGElement?.parentElement;
                  if (!container) return;
                  const bounds = container.getBoundingClientRect();
                  const tooltipWidth = 224;
                  const tooltipHeight = 166 + linhasObjetivoTooltip * 24;
                  const cursorLeft = event.clientX - bounds.left + container.scrollLeft;
                  const cursorTop = event.clientY - bounds.top + container.scrollTop;
                  const minLeft = container.scrollLeft + 8;
                  const maxLeft = container.scrollLeft + container.clientWidth - tooltipWidth - 8;
                  setTooltipPosition({
                    left: Math.max(minLeft, Math.min(cursorLeft + 14, maxLeft)),
                    top: Math.max(8, Math.min(cursorTop + 14, container.clientHeight - tooltipHeight - 8)),
                  });
                }}
                onMouseLeave={() => {
                  setAtivo((atual) => (atual === indice ? null : atual));
                  setTooltipPosition(null);
                }}
                onFocus={() => {
                  setAtivo(indice);
                  onSelect(indice);
                }}
                onBlur={() => setAtivo((atual) => (atual === indice ? null : atual))}
                onClick={() => onSelect(indice)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  onSelect(indice);
                }}
                tabIndex={0}
                role="button"
                aria-pressed={selectedIndex === indice}
                aria-label={`${mes.label}: recebido ${formatarReais(mes.receitas)}, a receber ${formatarReais(mes.receitasPrevistas ?? 0)}, gasto ${formatarReais(mes.despesas)}, a pagar ${formatarReais(mes.despesasPrevistas ?? 0)}, saldo ${formatarReais(saldos[indice]?.saldo ?? 0)}`}
                style={{ cursor: "pointer" }}
              >
                <rect className={styles.chartMonthHitArea} x={grupoX} y={margemTopo} width={larguraGrupo} height={areaAltura} fill="transparent" />
                <rect
                  x={centro - larguraBarra - 1}
                  y={y(mes.receitas + (mes.receitasPrevistas ?? 0))}
                  width={larguraBarra}
                  height={Math.max(0, y(0) - y(mes.receitas + (mes.receitasPrevistas ?? 0)))}
                  rx={3}
                  fill="var(--color-primary)"
                  opacity={destacado || ativo === null ? 0.3 : 0.15}
                />
                <rect
                  x={centro - larguraBarra - 1}
                  y={y(mes.receitas)}
                  width={larguraBarra}
                  height={Math.max(0, y(0) - y(mes.receitas))}
                  rx={3}
                  fill="var(--color-primary)"
                  opacity={destacado || ativo === null ? 1 : 0.4}
                />
                <rect
                  x={centro + 1}
                  y={y(mes.despesas + (mes.despesasPrevistas ?? 0))}
                  width={larguraBarra}
                  height={Math.max(0, y(0) - y(mes.despesas + (mes.despesasPrevistas ?? 0)))}
                  rx={3}
                  fill="var(--color-red)"
                  opacity={destacado || ativo === null ? 0.3 : 0.15}
                />
                <rect
                  x={centro + 1}
                  y={y(mes.despesas)}
                  width={larguraBarra}
                  height={Math.max(0, y(0) - y(mes.despesas))}
                  rx={3}
                  fill="var(--color-red)"
                  opacity={destacado || ativo === null ? 1 : 0.4}
                />
                <text x={centro} y={altura - 8} textAnchor="middle" fontSize={10} fill="var(--color-foreground-muted)">
                  {mes.label.slice(0, 3)}
                </text>
              </g>
            );
          })}

          <path d={caminho(0, fimRealizado)} fill="none" stroke="var(--color-blue)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {primeiroProjetadoIdx !== -1 && (
            <path
              d={caminho(fimRealizado, saldos.length - 1)}
              fill="none"
              stroke="var(--color-blue)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              strokeDasharray="5 4"
            />
          )}
          {saldos.map((ponto, indice) => (
            <circle
              key={ponto.label}
              cx={xCentro(indice)}
              cy={y(ponto.saldo)}
              r={ativo === indice || selectedIndex === indice ? 5 : 4}
              fill="var(--color-blue)"
              stroke="var(--color-surface)"
              strokeWidth={2}
            />
          ))}
          {ultimoSaldo && (
            <text
              x={xCentro(saldos.length - 1) - 10}
              y={y(ultimoSaldo.saldo) + (y(ultimoSaldo.saldo) < margemTopo + 16 ? 16 : -10)}
              textAnchor="end"
              fontSize={11}
              fontWeight={700}
              fill="var(--color-foreground)"
            >
              {formatarReais(ultimoSaldo.saldo)}
            </text>
          )}
        </svg>

        {ativo !== null && mesAtivo && saldoAtivo && (
          <aside className={styles.tooltip} style={tooltipPosition ? { ...tooltipPosition, right: "auto" } : undefined} aria-hidden="true">
            <p className={styles.tooltipTitle}>{mesAtivo.label}</p>
            {mesAtivo.receitas > 0 && <div className={styles.tooltipRow} data-tone="positive"><span>Receitas realizadas</span><strong>+{formatarReais(mesAtivo.receitas)}</strong></div>}
            {(mesAtivo.receitasPrevistas ?? 0) > 0 && <div className={styles.tooltipRow} data-tone="expected-positive"><span>Receitas previstas</span><strong>+{formatarReais(mesAtivo.receitasPrevistas ?? 0)}</strong></div>}
            {mesAtivo.despesas > 0 && <div className={styles.tooltipRow} data-tone="negative"><span>Despesas realizadas</span><strong>−{formatarReais(mesAtivo.despesas)}</strong></div>}
            {(mesAtivo.despesasPrevistas ?? 0) > 0 && <div className={styles.tooltipRow} data-tone="expected-negative"><span>Despesas previstas</span><strong>−{formatarReais(mesAtivo.despesasPrevistas ?? 0)}</strong></div>}
            {(mesAtivo.guardadoObjetivos ?? 0) > 0 && <div className={styles.tooltipRow} data-tone="goal-save"><span>Guardado em objetivos</span><strong>−{formatarReais(mesAtivo.guardadoObjetivos ?? 0)}</strong></div>}
            {(mesAtivo.resgatadoObjetivos ?? 0) > 0 && <div className={styles.tooltipRow} data-tone="goal-withdraw"><span>Resgatado de objetivos</span><strong>+{formatarReais(mesAtivo.resgatadoObjetivos ?? 0)}</strong></div>}
            {(mesAtivo.guardarObjetivosPrevisto ?? 0) > 0 && <div className={styles.tooltipRow} data-tone="goal-save"><span>A guardar em objetivos</span><strong>−{formatarReais(mesAtivo.guardarObjetivosPrevisto ?? 0)}</strong></div>}
            {(mesAtivo.resgatarObjetivosPrevisto ?? 0) > 0 && <div className={styles.tooltipRow} data-tone="goal-withdraw"><span>A resgatar de objetivos</span><strong>+{formatarReais(mesAtivo.resgatarObjetivosPrevisto ?? 0)}</strong></div>}
            <div className={styles.tooltipRow} data-tone={saldoAtivo.saldo < 0 ? "negative" : "balance"}><span>{saldoAtivo.projetado ? "Saldo projetado" : "Saldo realizado"}</span><strong>{formatarReais(saldoAtivo.saldo)}</strong></div>
          </aside>
        )}

      </div>

      {mesAtivo && saldoAtivo && (
        <section className={styles.monthDetails} aria-live="polite" aria-label={`Resumo de ${mesAtivo.label}`}>
          <div className={styles.monthDetailsHeader}>
            <div>
              <p className={styles.monthDetailsEyebrow}>Mês selecionado</p>
              <h3>{mesAtivo.label}</h3>
            </div>
            <span className={styles.monthDetailsStatus} data-projected={saldoAtivo.projetado}>
              {saldoAtivo.projetado ? "Projeção" : "Realizado"}
            </span>
          </div>
          <div className={styles.monthDetailsGrid}>
            {mesAtivo.receitas > 0 && <div className={styles.monthDetailItem} data-tone="positive">
              <span>Receitas realizadas</span>
              <strong>+ {formatarReais(mesAtivo.receitas)}</strong>
            </div>}
            {mesAtivo.despesas > 0 && <div className={styles.monthDetailItem} data-tone="negative">
              <span>Despesas realizadas</span>
              <strong>- {formatarReais(mesAtivo.despesas)}</strong>
            </div>}
            {(mesAtivo.receitasPrevistas ?? 0) > 0 && <div className={styles.monthDetailItem} data-tone="expected-positive">
              <span>A receber</span>
              <strong>+ {formatarReais(mesAtivo.receitasPrevistas ?? 0)}</strong>
            </div>}
            {(mesAtivo.despesasPrevistas ?? 0) > 0 && <div className={styles.monthDetailItem} data-tone="expected-negative">
              <span>A pagar</span>
              <strong>- {formatarReais(mesAtivo.despesasPrevistas ?? 0)}</strong>
            </div>}
            {(mesAtivo.guardadoObjetivos ?? 0) > 0 && <div className={styles.monthDetailItem} data-tone="goal-save"><span>Guardado em objetivos</span><strong>- {formatarReais(mesAtivo.guardadoObjetivos ?? 0)}</strong></div>}
            {(mesAtivo.resgatadoObjetivos ?? 0) > 0 && <div className={styles.monthDetailItem} data-tone="goal-withdraw"><span>Resgatado de objetivos</span><strong>+ {formatarReais(mesAtivo.resgatadoObjetivos ?? 0)}</strong></div>}
            {(mesAtivo.guardarObjetivosPrevisto ?? 0) > 0 && <div className={styles.monthDetailItem} data-tone="goal-save"><span>A guardar em objetivos</span><strong>- {formatarReais(mesAtivo.guardarObjetivosPrevisto ?? 0)}</strong></div>}
            {(mesAtivo.resgatarObjetivosPrevisto ?? 0) > 0 && <div className={styles.monthDetailItem} data-tone="goal-withdraw"><span>A resgatar de objetivos</span><strong>+ {formatarReais(mesAtivo.resgatarObjetivosPrevisto ?? 0)}</strong></div>}
          </div>
        </section>
      )}
    </section>
  );
}
