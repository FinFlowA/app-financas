"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
// Mesma busca do app (SeletorLista): sem acentos, sem maiúsculas, palavras em qualquer ordem.
import { filtrarOpcoesSeletor } from "../../../../lib/seletor-busca";

export type FinFlowSelectOption = { value: string; label: string; group?: string; disabled?: boolean };

export default function FinFlowSelect({ name, value, defaultValue = "", options, placeholder = "Selecione", required, searchable = false, onChange }: {
  name?: string;
  value?: string;
  defaultValue?: string;
  options: FinFlowSelectOption[];
  placeholder?: string;
  required?: boolean;
  /** Campo de pesquisa no topo da lista (categorias, contas e destinos, como no app). */
  searchable?: boolean;
  onChange?: (value: string) => void;
}) {
  const id = useId();
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
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

  const visible = searchable && search.trim()
    ? filtrarOpcoesSeletor(options.map((option) => ({ ...option, id: option.value, titulo: option.label })), search)
    : options;
  const choosable = visible.filter((option) => !option.disabled);
  const groups = [...new Set(visible.map((option) => option.group ?? ""))];

  function choose(next: string) {
    if (!controlled) setInternal(next);
    onChange?.(next);
    setOpen(false);
    button.current?.focus();
  }

  function openMenu(initialSearch = "") {
    if (root.current) {
      const rect = root.current.getBoundingClientRect();
      const estimatedHeight = Math.min(320, options.length * 44 + groups.length * 28 + 16 + (searchable ? 60 : 0));
      const top = window.innerHeight - rect.bottom >= Math.min(240, estimatedHeight)
        ? rect.bottom + 8
        : Math.max(16, rect.top - estimatedHeight - 8);
      setPosition({ left: rect.left, top, width: rect.width });
    }
    setSearch(initialSearch);
    // Sem texto, o destaque começa na opção já escolhida.
    setHighlighted(initialSearch ? 0 : Math.max(0, options.filter((option) => !option.disabled).findIndex((option) => option.value === selected)));
    setOpen(true);
  }

  function toggle() {
    if (open) setOpen(false);
    else openMenu();
  }

  // Com o campo fechado e em foco, começar a digitar já abre a lista pesquisando.
  function onButtonKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (!searchable || open || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key.length === 1 && event.key !== " ") {
      event.preventDefault();
      openMenu(event.key);
    }
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((current) => Math.min(current + 1, Math.max(choosable.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = choosable[highlighted];
      if (option) choose(option.value);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      button.current?.focus();
    }
  }

  const highlightedValue = searchable ? choosable[highlighted]?.value : undefined;

  // Setas do teclado: mantém a opção destacada à vista.
  useEffect(() => {
    if (open) menu.current?.querySelector('[data-destacada="true"]')?.scrollIntoView({ block: "nearest" });
  }, [open, highlighted]);

  return <div ref={root} className="relative mt-1.5">
    {name && <input type="hidden" name={name} value={selected} required={required} />}
    <button ref={button} type="button" aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-listbox`} onClick={toggle} onKeyDown={onButtonKeyDown} className="ff-focus flex min-h-12 w-full items-center justify-between rounded-xl border border-border bg-surface-muted px-3.5 py-3 text-left font-normal text-foreground transition hover:border-primary/45 focus:border-primary">
      <span className={selectedLabel ? "" : "text-foreground-muted"}>{selectedLabel ?? placeholder}</span>
      <span aria-hidden="true" className={`text-primary transition ${open ? "rotate-180" : ""}`}>⌄</span>
    </button>
    {open && createPortal(<div ref={menu} style={{ left: position.left, top: position.top, width: position.width }} className="fixed z-[140] flex max-h-[min(20rem,calc(100dvh-2rem))] min-w-[12rem] flex-col rounded-2xl border border-border bg-surface p-2 shadow-[0_22px_60px_rgba(0,0,0,.3)]">
      {searchable && <label className="relative mb-2 block shrink-0">
        <span className="sr-only">Pesquisar</span>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 grid place-items-center text-foreground-muted">⌕</span>
        <input autoFocus value={search} onChange={(event) => { setSearch(event.target.value); setHighlighted(0); }} onKeyDown={onSearchKeyDown} placeholder="Digite para pesquisar" aria-controls={`${id}-listbox`} className="ff-focus min-h-10 w-full rounded-xl border border-border bg-surface-muted py-2 pl-9 pr-3 text-sm font-normal text-foreground outline-none transition placeholder:text-foreground-muted/70 focus:border-primary" />
      </label>}
      <div id={`${id}-listbox`} role="listbox" className="min-h-0 overflow-y-auto">
        {groups.map((group) => <div key={group || "default"}>{group && <p className="px-3 pb-1 pt-2 text-[10px] font-extrabold uppercase tracking-widest text-foreground-muted">{group}</p>}{visible.filter((option) => (option.group ?? "") === group).map((option) => <button key={option.value} type="button" role="option" aria-selected={option.value === selected} data-destacada={option.value === highlightedValue} disabled={option.disabled} onClick={() => choose(option.value)} onMouseEnter={() => { const index = choosable.findIndex((item) => item.value === option.value); if (index >= 0) setHighlighted(index); }} className={`ff-focus flex min-h-11 w-full items-center rounded-xl px-3 py-2 text-left text-sm font-semibold transition disabled:opacity-40 ${option.value === selected ? "bg-primary text-white" : option.value === highlightedValue ? "bg-primary-soft text-primary-dark" : "hover:bg-primary-soft hover:text-primary-dark"}`}>{option.label}</button>)}</div>)}
        {visible.length === 0 && <p className="px-3 py-4 text-center text-sm text-foreground-muted">Nada encontrado para &quot;{search.trim()}&quot;.</p>}
      </div>
    </div>, document.body)}
  </div>;
}
