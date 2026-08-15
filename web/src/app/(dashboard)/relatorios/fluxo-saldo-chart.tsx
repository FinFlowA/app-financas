"use client";

import { useState } from "react";
import { formatarReais } from "@/lib/format";

export type MesFluxo = { label: string; receitas: number; despesas: number };
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
}: {
  meses: MesFluxo[];
  saldos: PontoSaldo[];
}) {
  const [ativo, setAtivo] = useState<number | null>(null);

  const maiorBarra = Math.max(1, ...meses.map((m) => Math.max(m.receitas, m.despesas)));
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
  const mesAtivo = ativo !== null ? meses[ativo] : null;
  const saldoAtivo = ativo !== null ? saldos[ativo] : null;

  return (
    <div className="rounded-ff-lg border border-border bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center gap-4 text-xs font-semibold text-foreground-muted">
        <span className="flex items-center gap-1.5">
          <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="var(--color-blue)" strokeWidth={2} /></svg>
          Saldo
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="16" height="2"><line x1="0" y1="1" x2="16" y2="1" stroke="var(--color-blue)" strokeWidth={2} strokeDasharray="4 3" /></svg>
          Saldo projetado
        </span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" /> Receitas</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-red" /> Despesas</span>
      </div>

      <div className="relative overflow-x-auto">
        <svg
          viewBox={`0 0 ${largura} ${altura}`}
          className="w-full"
          style={{ minWidth: 720 }}
          role="img"
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
            const destacado = ativo === indice;
            return (
              <g
                key={mes.label}
                onMouseEnter={() => setAtivo(indice)}
                onMouseLeave={() => setAtivo((atual) => (atual === indice ? null : atual))}
                onFocus={() => setAtivo(indice)}
                onBlur={() => setAtivo((atual) => (atual === indice ? null : atual))}
                tabIndex={0}
                style={{ cursor: "pointer", outline: "none" }}
              >
                <rect x={grupoX} y={margemTopo} width={larguraGrupo} height={areaAltura} fill="transparent" />
                <title>
                  {`${mes.label}: recebido ${formatarReais(mes.receitas)}, gasto ${formatarReais(mes.despesas)}, saldo ${formatarReais(saldos[indice]?.saldo ?? 0)}`}
                </title>
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
              r={ativo === indice ? 5 : 4}
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

        {mesAtivo && saldoAtivo && (
          <div className="pointer-events-none absolute top-2 right-2 rounded-ff-sm border border-border bg-surface px-3 py-2 text-xs shadow-sm" role="status">
            <p className="mb-1 font-bold text-foreground">{mesAtivo.label}</p>
            <p style={{ color: "var(--color-blue)" }}>
              <strong>{formatarReais(saldoAtivo.saldo)}</strong> saldo{saldoAtivo.projetado ? " (projetado)" : ""}
            </p>
            <p className="text-primary"><strong>{formatarReais(mesAtivo.receitas)}</strong> recebido</p>
            <p className="text-red"><strong>{formatarReais(mesAtivo.despesas)}</strong> gasto</p>
          </div>
        )}
      </div>
    </div>
  );
}
