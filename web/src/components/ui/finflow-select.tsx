"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type FinFlowSelectOption = { value: string; label: string; group?: string; disabled?: boolean };

export default function FinFlowSelect({ name, value, defaultValue = "", options, placeholder = "Selecione", required, onChange }: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: FinFlowSelectOption[];
  placeholder?: string;
  required?: boolean;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 0 });
  const selected = controlled ? value : internal;
  const selectedLabel = options.find((option) => option.value === selected)?.label;

  useEffect(() => {
    function close(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  function choose(next: string) {
    if (!controlled) setInternal(next);
    onChange?.(next);
    setOpen(false);
  }

  function toggle() {
    if (!open && root.current) {
      const rect = root.current.getBoundingClientRect();
      const estimatedHeight = Math.min(320, options.length * 44 + groups.length * 28 + 16);
      const top = window.innerHeight - rect.bottom >= Math.min(240, estimatedHeight)
        ? rect.bottom + 8
        : Math.max(16, rect.top - estimatedHeight - 8);
      setPosition({ left: rect.left, top, width: rect.width });
    }
    setOpen((current) => !current);
  }

  const groups = [...new Set(options.map((option) => option.group ?? ""))];
  return <div ref={root} className="relative mt-1.5">
    {name && <input type="hidden" name={name} value={selected} required={required} />}
    <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`} onClick={toggle} className="ff-focus flex min-h-12 w-full items-center justify-between rounded-xl border border-border bg-surface-muted px-3.5 py-3 text-left font-normal text-foreground transition hover:border-primary/45 focus:border-primary">
      <span className={selectedLabel ? "" : "text-foreground-muted"}>{selectedLabel ?? placeholder}</span>
      <span aria-hidden="true" className={`text-primary transition ${open ? "rotate-180" : ""}`}>⌄</span>
    </button>
    {open && createPortal(<div ref={menu} id={`${id}-listbox`} role="listbox" style={{ left: position.left, top: position.top, width: position.width }} className="fixed z-[140] max-h-[min(20rem,calc(100dvh-2rem))] min-w-[12rem] overflow-y-auto rounded-2xl border border-border bg-surface p-2 shadow-[0_22px_60px_rgba(0,0,0,.3)]">
      {groups.map((group) => <div key={group || "default"}>{group && <p className="px-3 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-widest text-foreground-muted">{group}</p>}{options.filter((option) => (option.group ?? "") === group).map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === selected} disabled={option.disabled} onClick={() => choose(option.value)} className={`ff-focus flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold transition disabled:opacity-40 ${option.value === selected ? "bg-primary text-white" : "hover:bg-primary-soft hover:text-primary-dark"}`}>{option.label}</button>)}</div>)}
    </div>, document.body)}
  </div>;
}
