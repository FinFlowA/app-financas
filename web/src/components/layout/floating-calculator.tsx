"use client";

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { apagar, CALCULADORA_INICIAL, digitar, igual, inverterSinal, operar, porcento, type EstadoCalculadora, type Operacao } from "@/lib/calculadora";

const LARGURA = 264;
const ALTURA = 372;
const limitar = (valor: number, minimo: number, maximo: number) => Math.min(Math.max(valor, minimo), Math.max(minimo, maximo));

/**
 * Calculadora flutuante: abre pelo menu lateral, fica por cima do conteúdo e
 * pode ser arrastada pela página toda (pelo topo). Aceita o teclado enquanto
 * está aberta. Não grava nada.
 */
export default function FloatingCalculator() {
  const [aberta, setAberta] = useState(false);
  const [estado, setEstado] = useState<EstadoCalculadora>(CALCULADORA_INICIAL);
  const [posicao, setPosicao] = useState({ x: 260, y: 120 });
  const arraste = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    if (!aberta) return;
    function tecla(event: KeyboardEvent) {
      const alvo = event.target as HTMLElement | null;
      if (alvo && (alvo.tagName === "INPUT" || alvo.tagName === "TEXTAREA" || alvo.isContentEditable)) return;
      const k = event.key;
      if (/^\d$/.test(k)) setEstado((e) => digitar(e, k));
      else if (k === "," || k === ".") setEstado((e) => digitar(e, ","));
      else if (k === "+" || k === "-") setEstado((e) => operar(e, k));
      else if (k === "*") setEstado((e) => operar(e, "×"));
      else if (k === "/") { event.preventDefault(); setEstado((e) => operar(e, "÷")); }
      else if (k === "Enter" || k === "=") { event.preventDefault(); setEstado(igual); }
      else if (k === "Backspace") setEstado(apagar);
      else if (k === "%") setEstado(porcento);
      else if (k === "Escape") setAberta(false);
      else if (k === "Delete") setEstado(CALCULADORA_INICIAL);
    }
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [aberta]);

  function iniciarArraste(event: ReactPointerEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    arraste.current = { dx: event.clientX - posicao.x, dy: event.clientY - posicao.y };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function mover(event: ReactPointerEvent<HTMLDivElement>) {
    if (!arraste.current) return;
    setPosicao({
      x: limitar(event.clientX - arraste.current.dx, 0, window.innerWidth - LARGURA),
      y: limitar(event.clientY - arraste.current.dy, 0, window.innerHeight - 48),
    });
  }

  const operacaoBotao = (op: Operacao) => ({ rotulo: op, acao: () => setEstado((e) => operar(e, op)), tipo: "operacao" as const, ativo: estado.operacao === op && estado.novoNumero });
  const botoes = [
    { rotulo: "C", acao: () => setEstado(CALCULADORA_INICIAL), tipo: "funcao" as const },
    { rotulo: "±", acao: () => setEstado(inverterSinal), tipo: "funcao" as const },
    { rotulo: "%", acao: () => setEstado(porcento), tipo: "funcao" as const },
    operacaoBotao("÷"),
    ...["7", "8", "9"].map((d) => ({ rotulo: d, acao: () => setEstado((e) => digitar(e, d)), tipo: "numero" as const })),
    operacaoBotao("×"),
    ...["4", "5", "6"].map((d) => ({ rotulo: d, acao: () => setEstado((e) => digitar(e, d)), tipo: "numero" as const })),
    operacaoBotao("-"),
    ...["1", "2", "3"].map((d) => ({ rotulo: d, acao: () => setEstado((e) => digitar(e, d)), tipo: "numero" as const })),
    operacaoBotao("+"),
    { rotulo: "⌫", acao: () => setEstado(apagar), tipo: "funcao" as const },
    { rotulo: "0", acao: () => setEstado((e) => digitar(e, "0")), tipo: "numero" as const },
    { rotulo: ",", acao: () => setEstado((e) => digitar(e, ",")), tipo: "numero" as const },
    { rotulo: "=", acao: () => setEstado(igual), tipo: "igual" as const },
  ];

  return <>
    <button type="button" onClick={() => setAberta((v) => !v)} aria-expanded={aberta} className="ff-focus mb-3 flex w-full items-center gap-2.5 rounded-xl border border-border px-3 py-2.5 text-sm font-bold text-foreground-muted transition hover:border-primary/40 hover:text-foreground">
      <svg aria-hidden viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><rect x="5" y="3" width="14" height="18" rx="2.5" /><path d="M8.5 7h7M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18h.01M12 18h.01M15.5 18h.01" /></svg>
      Calculadora
    </button>
    {aberta && <div
      role="dialog"
      aria-label="Calculadora"
      className="fixed z-[80] overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_24px_60px_rgba(0,0,0,0.35)]"
      style={{ left: posicao.x, top: posicao.y, width: LARGURA, height: ALTURA }}
    >
      <div onPointerDown={iniciarArraste} onPointerMove={mover} onPointerUp={() => { arraste.current = null; }} className="flex cursor-move touch-none select-none items-center justify-between bg-surface-muted px-3 py-2">
        <span className="text-xs font-extrabold uppercase tracking-wide text-foreground-muted">Calculadora</span>
        <button type="button" onClick={() => setAberta(false)} aria-label="Fechar calculadora" className="ff-focus grid h-7 w-7 place-items-center rounded-full text-foreground-muted hover:bg-surface">×</button>
      </div>
      <div className="px-4 pb-2 pt-3 text-right">
        <p className="h-4 text-xs text-foreground-muted">{estado.guardado !== null && estado.operacao ? `${estado.guardado.toLocaleString("pt-BR", { maximumFractionDigits: 10 })} ${estado.operacao}` : ""}</p>
        <p aria-live="polite" className="truncate text-3xl font-black text-foreground">{estado.visor}</p>
      </div>
      <div className="grid grid-cols-4 gap-1.5 p-3 pt-1">
        {botoes.map((b) => <button
          key={b.rotulo}
          type="button"
          onClick={b.acao}
          className={`ff-focus h-11 rounded-xl text-base font-bold transition active:scale-95 ${b.tipo === "igual" ? "bg-primary text-white" : b.tipo === "operacao" ? ("ativo" in b && b.ativo ? "bg-primary text-white" : "bg-primary-soft text-primary-dark") : b.tipo === "funcao" ? "bg-surface-muted text-foreground-muted" : "bg-surface-muted/60 text-foreground hover:bg-surface-muted"}`}
        >{b.rotulo}</button>)}
      </div>
    </div>}
  </>;
}
