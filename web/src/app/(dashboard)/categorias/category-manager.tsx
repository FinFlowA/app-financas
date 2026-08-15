"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type { Categoria } from "@/lib/types";
import {
  alterarEstadoCategoria,
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  criarCategoria,
  editarCategoria,
  type CategoriaActionState,
} from "./actions";

const INITIAL: CategoriaActionState = { erro: null };
const ICON_LABELS: Record<string, string> = {
  wallet: "Carteira", restaurant: "Alimentação", home: "Casa", "directions-car": "Transporte",
  "shopping-bag": "Compras", work: "Trabalho", favorite: "Saúde", "more-horiz": "Outros",
};
const ICON_GLYPHS: Record<string, string> = {
  wallet: "▣", restaurant: "♨", home: "⌂", "directions-car": "▰",
  "shopping-bag": "▱", work: "▤", favorite: "♥", "more-horiz": "•••",
};

function RequestId({ state }: { state: CategoriaActionState }) {
  const [id] = useState(() => crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);
  const previousState = useRef(state);

  useEffect(() => {
    if (state !== previousState.current && state.sucesso && inputRef.current) {
      inputRef.current.value = crypto.randomUUID();
    }
    previousState.current = state;
  }, [state]);

  return <input ref={inputRef} type="hidden" name="request_id" defaultValue={id} />;
}

function Message({ state }: { state: CategoriaActionState }) {
  if (state.erro) return <p role="alert" className="mt-3 text-sm font-semibold text-red">{state.erro}</p>;
  if (state.sucesso) return <p role="status" className="mt-3 text-sm font-semibold text-primary">{state.sucesso}</p>;
  return null;
}

function ChoiceFields({ color, icon, setColor, setIcon }: { color: string; icon: string; setColor: (value: string) => void; setIcon: (value: string) => void }) {
  return <>
    <input type="hidden" name="color" value={color} /><input type="hidden" name="icon" value={icon} />
    <fieldset><legend className="mb-2 text-xs font-bold uppercase text-foreground-muted">Cor</legend><div className="flex flex-wrap gap-2">{CATEGORY_COLORS.map((value) => <button key={value} type="button" aria-label={`Usar cor ${value}`} onClick={() => setColor(value)} className="h-8 w-8 rounded-full" style={{ backgroundColor: value, outline: color === value ? "3px solid var(--color-foreground)" : "none", outlineOffset: 2 }} />)}</div></fieldset>
    <fieldset><legend className="mb-2 text-xs font-bold uppercase text-foreground-muted">Ícone</legend><div className="flex flex-wrap gap-2">{CATEGORY_ICONS.map((value) => <button key={value} type="button" title={ICON_LABELS[value]} aria-label={ICON_LABELS[value]} onClick={() => setIcon(value)} className={`h-10 min-w-10 rounded-ff-sm border px-2 font-extrabold ${icon === value ? "border-primary bg-primary-soft text-primary-dark" : "border-border bg-surface-muted text-foreground-muted"}`}>{ICON_GLYPHS[value]}</button>)}</div></fieldset>
  </>;
}

function NewCategory() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"receita" | "despesa">("despesa");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(CATEGORY_ICONS[7]);
  const [state, action, pending] = useActionState(criarCategoria, INITIAL);
  return <section className="ff-card mb-6 p-5">
    <button type="button" onClick={() => setOpen((value) => !value)} className="ff-focus rounded-ff-sm bg-primary px-4 py-2.5 text-sm font-bold text-white">{open ? "Fechar" : "+ Nova categoria"}</button>
    {open && <form action={action} className="mt-5 grid gap-4 sm:grid-cols-2"><RequestId state={state} />
      <label className="text-sm font-bold">Nome<input name="name" maxLength={80} required className="mt-1 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 font-normal outline-none focus:border-primary" /></label>
      <fieldset><legend className="mb-1 text-sm font-bold">Tipo</legend><div className="grid grid-cols-2 gap-2"><input type="hidden" name="type" value={type} />{(["receita", "despesa"] as const).map((value) => <button key={value} type="button" onClick={() => setType(value)} className={`rounded-ff-sm border px-3 py-2.5 text-sm font-bold capitalize ${type === value ? value === "receita" ? "border-primary bg-primary-soft text-primary-dark" : "border-red bg-red/10 text-red" : "border-border text-foreground-muted"}`}>{value}</button>)}</div></fieldset>
      <div className="grid gap-4 sm:col-span-2"><ChoiceFields color={color} icon={icon} setColor={setColor} setIcon={setIcon} /></div>
      <div className="sm:col-span-2"><button disabled={pending} className="rounded-ff-sm bg-primary px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50">{pending ? "Criando..." : "Criar categoria"}</button><Message state={state} /></div>
    </form>}
  </section>;
}

function CategoryCard({ category }: { category: Categoria }) {
  const active = category.ativa === true || category.ativa === 1;
  const [color, setColor] = useState(category.cor || CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState(category.icone || CATEGORY_ICONS[7]);
  const [editState, editAction, editing] = useActionState(editarCategoria, INITIAL);
  const [state, stateAction, changing] = useActionState(alterarEstadoCategoria, INITIAL);
  return <article className={`ff-card p-5 ${active ? "" : "opacity-70"}`}>
    <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-lg font-extrabold text-white" style={{ backgroundColor: category.cor }}>{ICON_GLYPHS[category.icone] ?? "•••"}</span><div className="min-w-0 flex-1"><h2 className="truncate font-extrabold">{category.nome}</h2><p className={`text-xs font-bold capitalize ${category.tipo === "receita" ? "text-primary" : "text-red"}`}>{category.tipo === "ambos" ? "Receita e despesa (legado)" : category.tipo} · {active ? "Ativa" : "Arquivada"}</p></div></div>
    <details className="mt-4 border-t border-border pt-4"><summary className="font-bold text-primary">Editar categoria</summary><form action={editAction} className="mt-4 grid gap-3"><RequestId state={editState} /><input type="hidden" name="category_id" value={category.id} /><input type="hidden" name="expected_version" value={category.version ?? 1} />
      <label className="text-xs font-bold uppercase text-foreground-muted">Nome<input name="name" required defaultValue={category.nome} maxLength={80} className="mt-1 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-sm normal-case text-foreground outline-none focus:border-primary" /></label>
      <ChoiceFields color={color} icon={icon} setColor={setColor} setIcon={setIcon} />
      <button disabled={editing} className="rounded-ff-sm bg-primary px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{editing ? "Salvando..." : "Salvar alterações"}</button><Message state={editState} />
    </form></details>
    <form action={stateAction} className="mt-3 flex flex-wrap gap-2"><RequestId state={state} /><input type="hidden" name="category_id" value={category.id} />
      {active ? <button name="operation" value="archive_category" disabled={changing} className="rounded-ff-sm border border-border px-3 py-2 text-xs font-bold text-foreground-muted">Arquivar</button> : <button name="operation" value="reactivate_category" disabled={changing} className="rounded-ff-sm border border-primary px-3 py-2 text-xs font-bold text-primary">Reativar</button>}
      <button name="operation" value="delete_category" disabled={changing} onClick={(event) => { if (!confirm("Excluir esta categoria? Se houver lançamentos, ela será arquivada e os vínculos atuais serão preservados.")) event.preventDefault(); }} className="rounded-ff-sm border border-red/40 px-3 py-2 text-xs font-bold text-red">Excluir</button>
    </form><Message state={state} />
  </article>;
}

export default function CategoryManager({ categories }: { categories: Categoria[] }) {
  const ordered = [...categories].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
  return <><NewCategory />{(["receita", "despesa"] as const).map((type) => <section key={type} className="mb-8"><h2 className={`mb-3 text-lg font-extrabold capitalize ${type === "receita" ? "text-primary" : "text-red"}`}>{type}s</h2><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{ordered.filter((category) => category.tipo === type || category.tipo === "ambos").map((category) => <CategoryCard key={`${type}-${category.id}`} category={category} />)}</div></section>)}</>;
}
