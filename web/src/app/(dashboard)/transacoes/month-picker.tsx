"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/**
 * Mês do Histórico clicável: abre uma janela para escolher mês e ano. A
 * janela fica fora do cabeçalho (portal), que corta o que passa da borda.
 */
export default function MonthPicker({ month, currentMonth, label, onChange }: {
  month: string;
  currentMonth: string;
  label: string;
  onChange: (month: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const [position, setPosition] = useState({ left: 0, top: 0, width: 288 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    function close(event: PointerEvent) {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      trigger.current?.focus();
    }
    // A janela é posicionada pela tela; se a página rolar ou mudar de
    // tamanho, ela fecha em vez de ficar solta.
    function closeOnMove(event: Event) {
      if (event.type === "scroll" && panel.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnMove);
    window.addEventListener("scroll", closeOnMove, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnMove);
      window.removeEventListener("scroll", closeOnMove, true);
    };
  }, [open]);

  function toggle() {
    if (!open && trigger.current) {
      const rect = trigger.current.getBoundingClientRect();
      const width = Math.min(288, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
      setPosition({ left, top: rect.bottom + 8, width });
      setYear(Number(month.slice(0, 4)));
    }
    setOpen((value) => !value);
  }

  function choose(next: string) {
    setOpen(false);
    trigger.current?.focus();
    if (next !== month) onChange(next);
  }

  return <>
    <button
      ref={trigger}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`Período mensal: ${label}. Escolher mês e ano`}
      onClick={toggle}
      className="ff-focus min-w-40 rounded-xl px-3 py-1 text-center transition hover:bg-white/10"
    >
      <span className="block text-[10px] font-extrabold uppercase tracking-[0.16em] text-white/55">Período mensal</span>
      <span className="mt-0.5 flex items-center justify-center gap-1.5 font-black text-white">{label}<span aria-hidden="true" className={`text-xs text-primary transition ${open ? "rotate-180" : ""}`}>⌄</span></span>
    </button>
    {open && createPortal(<section
      ref={panel}
      role="dialog"
      aria-label="Escolher mês e ano"
      style={{ left: position.left, top: position.top, width: position.width }}
      className="fixed z-[140] rounded-2xl border border-border bg-surface p-3 text-foreground shadow-[0_22px_60px_rgba(0,0,0,.3)]"
    >
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Ano anterior" disabled={year <= MIN_YEAR} onClick={() => setYear((value) => value - 1)} className="ff-focus grid h-10 w-10 place-items-center rounded-full border border-border text-xl text-primary disabled:opacity-40">‹</button>
        <strong className="text-base font-black">{year}</strong>
        <button type="button" aria-label="Próximo ano" disabled={year >= MAX_YEAR} onClick={() => setYear((value) => value + 1)} className="ff-focus grid h-10 w-10 place-items-center rounded-full border border-border text-xl text-primary disabled:opacity-40">›</button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS.map((name, index) => {
          const value = `${year}-${String(index + 1).padStart(2, "0")}`;
          const active = value === month;
          return <button
            key={name}
            type="button"
            aria-pressed={active}
            aria-label={`${name} de ${year}`}
            onClick={() => choose(value)}
            className={`ff-focus rounded-xl px-2 py-2.5 text-sm font-bold transition ${active ? "bg-primary text-white" : value === currentMonth ? "border border-primary/40 text-primary hover:bg-primary-soft" : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"}`}
          >{name}</button>;
        })}
      </div>
      {month !== currentMonth && <button type="button" onClick={() => choose(currentMonth)} className="ff-focus mt-2 w-full rounded-xl border border-border px-3 py-2 text-xs font-extrabold text-primary transition hover:bg-primary-soft">Voltar para o mês atual</button>}
    </section>, document.body)}
  </>;
}
