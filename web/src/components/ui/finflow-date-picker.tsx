"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

function parts(value: string) { const [year, month, day] = value.split("-").map(Number); return { year, month, day }; }
function iso(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function shift(year: number, month: number, delta: number) { const date = new Date(Date.UTC(year, month - 1 + delta, 1)); return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 }; }

export default function FinFlowDatePicker({ name, value, defaultValue, required, min, max, onChange }: { name: string; value?: string; defaultValue: string; required?: boolean; min?: string; max?: string; onChange?: (value: string) => void }) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const selected = controlled ? value : internal;
  const selectedParts = parts(selected);
  const [view, setView] = useState({ year: selectedParts.year, month: selectedParts.month });
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 336 });
  useEffect(() => { const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) setOpen(false); }; document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close); }, []);
  const days = useMemo(() => {
    const firstWeekday = new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay();
    const count = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
    return [...Array(firstWeekday).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  }, [view]);
  const title = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(view.year, view.month - 1, 1)));
  function choose(day: number) { const next = iso(view.year, view.month, day); if (!controlled) setInternal(next); onChange?.(next); setOpen(false); }
  function toggle() {
    if (!open && root.current) {
      const rect = root.current.getBoundingClientRect();
      const width = Math.min(336, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const top = window.innerHeight - rect.bottom >= 390 ? rect.bottom + 8 : Math.max(12, rect.top - 386);
      setPosition({ left, top, width });
    }
    setOpen((current) => !current);
  }
  return <div ref={root} className="relative mt-1.5">
    <input type="hidden" name={name} value={selected} required={required} />
    <button type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setView({ year: selectedParts.year, month: selectedParts.month }); toggle(); }} className="ff-focus flex min-h-12 w-full items-center justify-between rounded-xl border border-border bg-surface-muted px-3.5 py-3 text-left font-normal text-foreground transition hover:border-primary/45 focus:border-primary"><span>{new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${selected}T12:00:00Z`))}</span><span aria-hidden="true" className="text-primary">▣</span></button>
    {open && createPortal(<section ref={panel} role="dialog" aria-label="Escolher data" style={{ left: position.left, top: position.top, width: position.width }} className="fixed z-[140] max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-2xl border border-border bg-surface p-3 shadow-[0_22px_60px_rgba(0,0,0,.3)]">
      <div className="mb-3 flex items-center justify-between"><button type="button" aria-label="Mês anterior" onClick={() => setView(shift(view.year, view.month, -1))} className="ff-focus grid h-11 w-11 place-items-center rounded-full border border-border text-xl text-primary">‹</button><strong className="capitalize">{title}</strong><button type="button" aria-label="Próximo mês" onClick={() => setView(shift(view.year, view.month, 1))} className="ff-focus grid h-11 w-11 place-items-center rounded-full border border-border text-xl text-primary">›</button></div>
      <div className="grid grid-cols-7 text-center text-[10px] font-extrabold uppercase text-foreground-muted">{"DSTQQSS".split("").map((day, index) => <span key={`${day}-${index}`} className="py-1">{day}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">{days.map((day, index) => {
        if (day === null) return <span key={`empty-${index}`} />;
        const date = iso(view.year, view.month, day);
        const disabled = Boolean((min && date < min) || (max && date > max));
        return <button key={day} type="button" disabled={disabled} aria-label={`${day} de ${title}`} aria-pressed={selected === date} onClick={() => choose(day)} className={`ff-focus grid aspect-square min-h-9 place-items-center rounded-xl text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-30 ${selected === date ? "bg-primary text-white" : "hover:bg-primary-soft hover:text-primary-dark"}`}>{day}</button>;
      })}</div>
    </section>, document.body)}
  </div>;
}
