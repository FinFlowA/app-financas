"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

/** Período personalizado do Histórico (datas "AAAA-MM-DD", início ≤ fim). */
export type HistoryRange = { start: string; end: string };

const brDate = (iso: string) => iso.split("-").reverse().join("/");
export const rangeLabel = (range: HistoryRange) => `${brDate(range.start)} a ${brDate(range.end)}`;

const isoDay = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
function shiftView(view: { year: number; month: number }, delta: number) {
  const date = new Date(Date.UTC(view.year, view.month - 1 + delta, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

/**
 * Calendário do período no visual do FinFlow (o mesmo do seletor de datas dos
 * formulários). Fica dentro da janela do mês: um calendário em outra janela
 * seria um clique "fora" e fecharia esta. Toca-se no dia de início e depois
 * no de fim; os dias entre eles ficam destacados.
 */
function RangeCalendar({ draft, month, onChange }: { draft: HistoryRange; month: string; onChange: (next: HistoryRange) => void }) {
  const [editing, setEditing] = useState<"start" | "end">("start");
  // Sem período escolhido, nada vem marcado e o calendário abre no mês do Histórico.
  const inicial = draft.start || `${month}-01`;
  const [view, setView] = useState(() => ({ year: Number(inicial.slice(0, 4)), month: Number(inicial.slice(5, 7)) }));
  // Clicar no mês do calendário abre a escolha de mês e ano (sem ir de seta em seta).
  const [choosingMonth, setChoosingMonth] = useState(false);
  const [gridYear, setGridYear] = useState(view.year);
  const firstWeekday = new Date(Date.UTC(view.year, view.month - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(view.year, view.month, 0)).getUTCDate();
  const days = [...Array<null>(firstWeekday).fill(null), ...Array.from({ length: count }, (_, index) => index + 1)];
  const title = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(view.year, view.month - 1, 1)));

  function pick(date: string) {
    if (editing === "start" || !draft.start) {
      onChange({ start: date, end: draft.end && draft.end >= date ? draft.end : "" });
      setEditing("end");
      return;
    }
    // Dia de fim antes do início: os dois trocam de lugar.
    onChange(date < draft.start ? { start: date, end: draft.start } : { start: draft.start, end: date });
  }

  function field(which: "start" | "end") {
    const active = editing === which;
    const value = which === "start" ? draft.start : draft.end;
    return <button
      type="button"
      aria-pressed={active}
      onClick={() => {
        setEditing(which);
        if (value) setView({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) });
      }}
      className={`ff-focus rounded-xl border px-3 py-2 text-left transition ${active ? "border-primary bg-primary-soft" : "border-border bg-surface-muted hover:border-primary/45"}`}
    >
      <span className="block text-[10px] font-extrabold uppercase tracking-wide text-foreground-muted">{which === "start" ? "De" : "Até"}</span>
      <span className={`block text-sm font-black ${active ? "text-primary-dark" : "text-foreground"}`}>{value ? brDate(value) : "Escolher"}</span>
    </button>;
  }

  return <div className="grid gap-2">
    <div className="grid grid-cols-2 gap-2">{field("start")}{field("end")}</div>
    <p className="text-[11px] text-foreground-muted">{editing === "start" ? "Toque no dia de início." : "Agora toque no dia de fim."}</p>
    {choosingMonth ? <div className="grid gap-2">
      <div className="flex items-center justify-between">
        <button type="button" aria-label="Ano anterior do calendário" disabled={gridYear <= MIN_YEAR} onClick={() => setGridYear((value) => value - 1)} className="ff-focus grid h-9 w-9 place-items-center rounded-full border border-border text-lg text-primary disabled:opacity-40">‹</button>
        <button type="button" aria-label="Voltar para os dias" onClick={() => setChoosingMonth(false)} className="ff-focus rounded-lg px-2 py-1 text-sm font-black hover:bg-primary-soft hover:text-primary-dark">{gridYear} ⌃</button>
        <button type="button" aria-label="Próximo ano do calendário" disabled={gridYear >= MAX_YEAR} onClick={() => setGridYear((value) => value + 1)} className="ff-focus grid h-9 w-9 place-items-center rounded-full border border-border text-lg text-primary disabled:opacity-40">›</button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">{MONTHS.map((name, index) => {
        const active = gridYear === view.year && index + 1 === view.month;
        return <button key={name} type="button" aria-pressed={active} aria-label={`${name} de ${gridYear} no calendário`} onClick={() => { setView({ year: gridYear, month: index + 1 }); setChoosingMonth(false); }} className={`ff-focus rounded-xl px-2 py-2.5 text-sm font-bold transition ${active ? "bg-primary text-white" : "text-foreground-muted hover:bg-surface-muted hover:text-foreground"}`}>{name}</button>;
      })}</div>
    </div> : <>
    <div className="flex items-center justify-between">
      <button type="button" aria-label="Mês anterior do calendário" onClick={() => setView(shiftView(view, -1))} className="ff-focus grid h-9 w-9 place-items-center rounded-full border border-border text-lg text-primary">‹</button>
      <button type="button" aria-label={`${title}. Escolher mês e ano do calendário`} onClick={() => { setGridYear(view.year); setChoosingMonth(true); }} className="ff-focus rounded-lg px-2 py-1 text-sm font-black capitalize hover:bg-primary-soft hover:text-primary-dark">{title} ⌄</button>
      <button type="button" aria-label="Próximo mês do calendário" onClick={() => setView(shiftView(view, 1))} className="ff-focus grid h-9 w-9 place-items-center rounded-full border border-border text-lg text-primary">›</button>
    </div>
    <div className="grid grid-cols-7 text-center text-[10px] font-extrabold uppercase text-foreground-muted">{"DSTQQSS".split("").map((day, index) => <span key={`${day}-${index}`} className="py-0.5">{day}</span>)}</div>
    <div className="grid grid-cols-7 gap-1">{days.map((day, index) => {
      if (day === null) return <span key={`vazio-${index}`} />;
      const date = isoDay(view.year, view.month, day);
      const edge = date === draft.start || date === draft.end;
      const inside = Boolean(draft.start && draft.end) && date > draft.start && date < draft.end;
      return <button
        key={day}
        type="button"
        aria-label={`${day} de ${title}`}
        aria-pressed={edge}
        onClick={() => pick(date)}
        className={`ff-focus grid h-8 place-items-center rounded-lg text-sm font-bold transition ${edge ? "bg-primary text-white" : inside ? "bg-primary-soft text-primary-dark" : "hover:bg-primary-soft hover:text-primary-dark"}`}
      >{day}</button>;
    })}</div>
    </>}
  </div>;
}

/**
 * Mês do Histórico clicável: abre uma janela para escolher mês e ano e, com
 * `onRangeChange`, também um período de/até. A janela fica fora do cabeçalho
 * (portal), que corta o que passa da borda.
 */
export default function MonthPicker({ month, currentMonth, label, onChange, range = null, onRangeChange, size = "md" }: {
  month: string;
  currentMonth: string;
  label: string;
  onChange: (month: string) => void;
  range?: HistoryRange | null;
  onRangeChange?: (range: HistoryRange) => void;
  /** "lg": maior e em destaque, para telas em que o período é a escolha principal (Relatórios). */
  size?: "md" | "lg";
}) {
  const large = size === "lg";
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"month" | "range">(range ? "range" : "month");
  const [draft, setDraft] = useState<HistoryRange>(range ?? { start: "", end: "" });
  const [year, setYear] = useState(() => Number(month.slice(0, 4)));
  const [position, setPosition] = useState({ left: 0, top: 0, width: 288, maxHeight: 600 });
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
      const width = Math.min(onRangeChange ? 320 : 288, window.innerWidth - 24);
      const left = Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12));
      const top = rect.bottom + 8;
      setPosition({ left, top, width, maxHeight: Math.max(240, window.innerHeight - top - 12) });
      setYear(Number(month.slice(0, 4)));
      setMode(range && onRangeChange ? "range" : "month");
      setDraft(range ?? { start: "", end: "" });
    }
    setOpen((value) => !value);
  }

  function choose(next: string) {
    setOpen(false);
    trigger.current?.focus();
    if (next !== month || range) onChange(next);
  }

  function applyRange() {
    if (!onRangeChange || !draft.start || !draft.end) return;
    setOpen(false);
    trigger.current?.focus();
    onRangeChange(draft);
  }

  return <>
    {/* Sem fundo branco do Tailwind no hover: no cabeçalho (.ff-page-hero), botões com essa classe ganham borda e fundo de destaque. */}
    <button
      ref={trigger}
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={`${range ? "Período" : "Período mensal"}: ${label}. Escolher ${onRangeChange ? "mês ou período" : "mês e ano"}`}
      onClick={toggle}
      className={large
        ? "ff-focus min-w-0 flex-1 rounded-full px-3 py-1.5 text-center transition hover:bg-surface-muted md:min-w-60 md:px-6"
        : "ff-focus min-w-40 rounded-full px-4 py-1 text-center transition hover:bg-surface"}
    >
      <span className={`block font-extrabold uppercase tracking-[0.16em] ${large ? "text-[11px] text-primary-dark" : "text-[10px] text-foreground-muted"}`}>{range ? "Período" : "Período mensal"}</span>
      <span className={`mt-0.5 flex items-center justify-center gap-1.5 font-black text-foreground ${large ? "text-lg" : ""}`}>{label}<span aria-hidden="true" className={`text-xs text-primary transition ${open ? "rotate-180" : ""}`}>⌄</span></span>
    </button>
    {open && createPortal(<section
      ref={panel}
      role="dialog"
      aria-label="Escolher mês e ano"
      style={{ left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
      className="fixed z-[140] overflow-y-auto overscroll-contain rounded-2xl border border-border bg-surface p-3 text-foreground shadow-[0_22px_60px_rgba(0,0,0,.3)]"
    >
      {onRangeChange && <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1">
        {(["month", "range"] as const).map((value) => <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={`ff-focus rounded-lg px-2 py-2 text-sm font-extrabold transition ${mode === value ? "bg-primary text-white" : "text-foreground-muted hover:text-foreground"}`}>{value === "month" ? "Mês" : "Período"}</button>)}
      </div>}
      {mode === "range" && onRangeChange ? <div className="grid gap-2.5">
        <RangeCalendar draft={draft} month={month} onChange={setDraft} />
        <button type="button" disabled={!draft.start || !draft.end} onClick={applyRange} className="ff-focus mt-1 w-full rounded-xl bg-primary px-3 py-2.5 text-sm font-extrabold text-white transition hover:bg-primary-dark disabled:opacity-50">Aplicar período</button>
        {range && <button type="button" onClick={() => choose(currentMonth)} className="ff-focus w-full rounded-xl border border-border px-3 py-2 text-xs font-extrabold text-primary transition hover:bg-primary-soft">Voltar para o mês atual</button>}
      </div> : <>
      <div className="mb-2 flex items-center justify-between">
        <button type="button" aria-label="Ano anterior" disabled={year <= MIN_YEAR} onClick={() => setYear((value) => value - 1)} className="ff-focus grid h-10 w-10 place-items-center rounded-full border border-border text-xl text-primary disabled:opacity-40">‹</button>
        <strong className="text-base font-black">{year}</strong>
        <button type="button" aria-label="Próximo ano" disabled={year >= MAX_YEAR} onClick={() => setYear((value) => value + 1)} className="ff-focus grid h-10 w-10 place-items-center rounded-full border border-border text-xl text-primary disabled:opacity-40">›</button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {MONTHS.map((name, index) => {
          const value = `${year}-${String(index + 1).padStart(2, "0")}`;
          const active = value === month && !range;
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
      {(month !== currentMonth || range) && <button type="button" onClick={() => choose(currentMonth)} className="ff-focus mt-2 w-full rounded-xl border border-border px-3 py-2 text-xs font-extrabold text-primary transition hover:bg-primary-soft">Voltar para o mês atual</button>}
      </>}
    </section>, document.body)}
  </>;
}

/**
 * Setas e mês numa cápsula só (Histórico e Categorias; em Relatórios, no
 * tamanho maior). Nas setas, o mês anda um mês; com período personalizado,
 * quem chama decide o passo.
 */
export function PeriodNavigator({ onStep, range = null, size = "md", ...picker }: Parameters<typeof MonthPicker>[0] & { onStep: (delta: number) => void }) {
  const large = size === "lg";
  const arrow = large
    ? "ff-focus grid h-11 w-11 shrink-0 place-items-center rounded-full bg-surface-muted text-primary transition hover:bg-primary hover:text-white"
    : "ff-focus grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg font-black text-foreground-muted transition hover:bg-surface hover:text-primary";
  // No tamanho maior, a seta em desenho fica nítida (o caractere "‹" é fino demais).
  const chevron = (path: string) => <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>;
  return <div className={large
    ? "flex w-full items-center gap-1 rounded-full border border-border bg-surface p-1.5 shadow-sm md:inline-flex md:w-auto"
    : "inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted/70 p-1 shadow-sm"}>
    <button type="button" onClick={() => onStep(-1)} aria-label={range ? "Período anterior" : "Mês anterior"} className={arrow}>{large ? chevron("M15 18l-6-6 6-6") : "‹"}</button>
    <MonthPicker {...picker} range={range} size={size} />
    <button type="button" onClick={() => onStep(1)} aria-label={range ? "Próximo período" : "Próximo mês"} className={arrow}>{large ? chevron("M9 18l6-6-6-6") : "›"}</button>
  </div>;
}
