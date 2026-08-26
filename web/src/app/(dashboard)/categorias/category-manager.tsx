"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import ConfirmationDialog from "@/components/ui/confirmation-dialog";
import FinancialIcon from "@/components/ui/financial-icon";
import type { Categoria } from "@/lib/types";
import { useRequestId } from "@/lib/use-request-id";
import {
  alterarEstadoCategoria,
  criarCategoria,
  editarCategoria,
  type CategoriaActionState,
} from "./actions";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "./category-options";

const INITIAL: CategoriaActionState = { erro: null };
const ICON_LABELS: Record<string, string> = {
  label: "Etiqueta", restaurant: "Alimentação", "directions-car": "Carro", home: "Casa", favorite: "Favorito",
  "shopping-cart": "Compras", school: "Educação", "fitness-center": "Atividade física", "local-hospital": "Hospital",
  flight: "Viagem", "beach-access": "Lazer", pets: "Animais", work: "Trabalho", "sports-esports": "Jogos",
  "music-note": "Música", "local-movies": "Cinema", "attach-money": "Dinheiro", savings: "Economia",
  "card-giftcard": "Presente", build: "Manutenção", coffee: "Café", "local-gas-station": "Combustível", "child-care": "Crianças",
  spa: "Bem-estar", book: "Livros", "camera-alt": "Fotografia", palette: "Arte", "two-wheeler": "Moto", commute: "Transporte",
  "electrical-services": "Energia", "water-drop": "Água", wifi: "Internet", "phone-android": "Celular", laptop: "Computador",
  checkroom: "Roupas", "local-grocery-store": "Mercado", "bakery-dining": "Padaria", "medical-services": "Saúde",
  payments: "Pagamentos", "trending-up": "Investimentos", "volunteer-activism": "Doações", "business-center": "Negócios",
  wallet: "Carteira", "shopping-bag": "Compras", "more-horiz": "Outros",
};

function RequestId({ state }: { state: CategoriaActionState }) {
  const [id, renewId] = useRequestId();
  const previousState = useRef(state);

  useEffect(() => {
    if (state !== previousState.current && state.sucesso) {
      renewId();
    }
    previousState.current = state;
  }, [renewId, state]);

  return <input type="hidden" name="request_id" value={id} readOnly />;
}

function Message({ state }: { state: CategoriaActionState }) {
  if (state.erro) return <p role="alert" className="mt-3 text-sm font-semibold text-red">{state.erro}</p>;
  if (state.sucesso) return <p role="status" className="mt-3 text-sm font-semibold text-primary">{state.sucesso}</p>;
  return null;
}

function ChoiceFields({ color, icon, setColor, setIcon }: { color: string; icon: string; setColor: (value: string) => void; setIcon: (value: string) => void }) {
  return <>
    <input type="hidden" name="color" value={color} /><input type="hidden" name="icon" value={icon} />
    <fieldset><legend className="mb-2 text-xs font-bold uppercase tracking-wide text-foreground-muted">Cor</legend><div className="flex flex-wrap gap-2.5">{CATEGORY_COLORS.map((value) => <button key={value} type="button" aria-label={`Usar cor ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} className="ff-focus h-9 w-9 rounded-full border-2 border-surface shadow-sm transition duration-200 hover:scale-110" style={{ backgroundColor: value, outline: color === value ? "2px solid var(--color-foreground)" : "none", outlineOffset: 2 }} />)}</div></fieldset>
    <fieldset><legend className="mb-2 text-xs font-bold uppercase tracking-wide text-foreground-muted">Ícone</legend><div className="flex max-h-44 flex-wrap gap-2 overflow-y-auto pr-1">{CATEGORY_ICONS.map((value) => <button key={value} type="button" title={ICON_LABELS[value]} aria-label={ICON_LABELS[value]} aria-pressed={icon === value} onClick={() => setIcon(value)} className={`ff-focus grid h-11 w-11 place-items-center rounded-xl border transition duration-200 hover:-translate-y-0.5 ${icon === value ? "border-primary bg-primary-soft text-primary shadow-sm" : "border-border bg-surface-muted text-foreground-muted hover:border-primary/40"}`}><FinancialIcon name={value} size={20} /></button>)}</div></fieldset>
  </>;
}

function NewCategory() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"receita" | "despesa">("despesa");
  const [color, setColor] = useState<string>(CATEGORY_COLORS[0]);
  const [icon, setIcon] = useState<string>(CATEGORY_ICONS[0]);
  const [state, action, pending] = useActionState(criarCategoria, INITIAL);
  return <section className="ff-card mb-7 overflow-hidden border-primary/15 shadow-[0_18px_50px_rgba(0,0,0,0.08)]">
    <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex items-center gap-3"><span aria-hidden="true" className="grid h-11 w-11 place-items-center rounded-2xl bg-primary-soft text-xl font-black text-primary">⌁</span><div><h2 className="font-extrabold text-foreground">Personalize sua organização</h2><p className="text-xs text-foreground-muted">Use cores e ícones para encontrar cada lançamento rapidamente.</p></div></div><button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} className="ff-focus rounded-full bg-primary px-5 py-2.5 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.24)] transition hover:-translate-y-0.5 hover:bg-primary-dark">{open ? "Fechar cadastro" : "+ Nova categoria"}</button></div>
    {open && <form action={action} className="grid gap-4 border-t border-border/70 bg-surface-muted/35 p-4 sm:grid-cols-2 sm:p-5"><RequestId state={state} />
      <label className="text-sm font-bold">Nome<input name="name" maxLength={80} required className="ff-focus mt-1.5 w-full rounded-xl border border-border bg-surface-muted px-3.5 py-3 font-normal outline-none transition focus:border-primary" /></label>
      <fieldset><legend className="mb-1 text-sm font-bold">Tipo</legend><div className="grid grid-cols-2 gap-2 rounded-2xl bg-surface-muted/70 p-1.5"><input type="hidden" name="type" value={type} />{(["receita", "despesa"] as const).map((value) => <button key={value} type="button" aria-pressed={type === value} onClick={() => setType(value)} className={`ff-focus rounded-xl border px-3 py-2.5 text-sm font-bold capitalize transition ${type === value ? value === "receita" ? "border-primary bg-primary text-white shadow-sm" : "border-red bg-red text-white shadow-sm" : "border-transparent text-foreground-muted hover:bg-surface"}`}>{value}</button>)}</div></fieldset>
      <div className="grid gap-4 sm:col-span-2"><ChoiceFields color={color} icon={icon} setColor={setColor} setIcon={setIcon} /></div>
      <div className="sm:col-span-2"><button disabled={pending} className="ff-focus rounded-full bg-primary px-6 py-3 text-sm font-extrabold text-white shadow-[0_10px_24px_rgba(22,150,110,0.2)] transition hover:bg-primary-dark disabled:opacity-50">{pending ? "Criando..." : "Criar categoria"}</button><Message state={state} /></div>
    </form>}
  </section>;
}

function CategoryEditForm({ category, onDiscard }: { category: Categoria; onDiscard: () => void }) {
  // Preserve valores legados até que a pessoa escolha explicitamente uma
  // opção nova. Isso evita alterar o visual ao editar somente o nome.
  const initialColor = category.cor || CATEGORY_COLORS[0];
  const initialIcon = category.icone || CATEGORY_ICONS[0];
  const [color, setColor] = useState<string>(initialColor);
  const [icon, setIcon] = useState<string>(initialIcon);
  const [editState, editAction, editing] = useActionState(editarCategoria, INITIAL);

  return <form action={editAction} className="mt-4 grid gap-3 rounded-2xl bg-surface-muted/50 p-4">
    <RequestId state={editState} />
    <input type="hidden" name="category_id" value={category.id} />
    <input type="hidden" name="original_name" value={category.nome} />
    <input type="hidden" name="original_color" value={category.cor} />
    <input type="hidden" name="original_icon" value={category.icone} />
    <label className="text-xs font-bold uppercase text-foreground-muted">Nome<input name="name" required defaultValue={category.nome} maxLength={80} className="mt-1 w-full rounded-ff-sm border border-border bg-surface-muted px-3 py-2.5 text-sm normal-case text-foreground outline-none focus:border-primary" /></label>
    <ChoiceFields color={color} icon={icon} setColor={setColor} setIcon={setIcon} />
    <div className="grid gap-2 sm:grid-cols-2">
      <button type="button" disabled={editing} onClick={onDiscard} className="ff-focus rounded-full border border-border px-4 py-2.5 text-sm font-bold text-foreground-muted transition hover:bg-surface disabled:opacity-50">Descartar alterações</button>
      <button type="submit" disabled={editing} className="ff-focus rounded-full bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-primary-dark disabled:opacity-50">{editing ? "Salvando..." : "Salvar alterações"}</button>
    </div>
    <Message state={editState} />
  </form>;
}

function CategoryCard({ category }: { category: Categoria }) {
  const active = category.ativa === true || category.ativa === 1;
  const [editOpen, setEditOpen] = useState(false);
  const [state, stateAction, changing] = useActionState(alterarEstadoCategoria, INITIAL);
  const [deleteBaseline, setDeleteBaseline] = useState<CategoriaActionState | null>(null);
  const confirmDelete = deleteBaseline !== null && !(state !== deleteBaseline && state.sucesso);
  return <article className={`ff-card group relative overflow-hidden p-5 shadow-[0_14px_40px_rgba(0,0,0,0.08)] transition duration-300 hover:-translate-y-1 hover:border-primary/25 hover:shadow-[0_20px_52px_rgba(0,0,0,0.14)] ${active ? "" : "opacity-65"}`}>
    <div aria-hidden="true" className="absolute -right-10 -top-12 h-32 w-32 rounded-full opacity-[0.08] blur-2xl transition group-hover:opacity-[0.16]" style={{ backgroundColor: category.cor }} />
    <div className="relative flex items-start gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-white shadow-lg" style={{ backgroundColor: category.cor }}><FinancialIcon name={category.icone} size={22} /></span><div className="min-w-0 flex-1"><h2 className="truncate font-extrabold text-foreground">{category.nome}</h2><p className={`mt-1 text-[10px] font-extrabold uppercase tracking-wide ${category.tipo === "receita" ? "text-primary" : "text-red"}`}>{category.tipo === "ambos" ? "Receita e despesa (legado)" : category.tipo} · {active ? "Ativa" : "Arquivada"}</p></div></div>
    <div className="relative mt-4 border-t border-border/70 pt-4">
      {active ? <>
        <button type="button" aria-expanded={editOpen} onClick={() => setEditOpen((value) => !value)} className="ff-focus flex w-full items-center justify-between rounded-lg py-1 text-left font-bold text-primary"><span>Editar categoria</span><span aria-hidden="true" className={`transition ${editOpen ? "rotate-180" : ""}`}>⌄</span></button>
        {editOpen && <CategoryEditForm category={category} onDiscard={() => setEditOpen(false)} />}
      </> : <p className="text-xs font-semibold text-foreground-muted">Reative a categoria para editá-la.</p>}
    </div>
    <form action={stateAction} className="mt-3 flex flex-wrap gap-2"><RequestId state={state} /><input type="hidden" name="category_id" value={category.id} />
      {active ? <button name="operation" value="archive_category" disabled={changing} className="rounded-ff-sm border border-border px-3 py-2 text-xs font-bold text-foreground-muted">Arquivar</button> : <button name="operation" value="reactivate_category" disabled={changing} className="rounded-ff-sm border border-primary px-3 py-2 text-xs font-bold text-primary">Reativar</button>}
      <button type="button" disabled={changing} onClick={() => setDeleteBaseline(state)} className="rounded-ff-sm border border-red/40 px-3 py-2 text-xs font-bold text-red">Excluir</button>
      {confirmDelete && <ConfirmationDialog
        title={`Excluir ${category.nome}?`}
        description="Se houver lançamentos nesta categoria, ela será arquivada e os vínculos atuais continuarão preservados. Uma categoria sem uso será excluída definitivamente."
        confirmLabel="Confirmar exclusão"
        confirmName="operation"
        confirmValue="delete_category"
        pending={changing}
        onClose={() => setDeleteBaseline(null)}
      >
        {state !== deleteBaseline && state.erro && <p role="alert" className="mt-4 rounded-xl bg-red/10 p-3 text-sm font-semibold text-red">{state.erro}</p>}
      </ConfirmationDialog>}
    </form><Message state={state} />
  </article>;
}

export default function CategoryManager({ categories }: { categories: Categoria[] }) {
  const ordered = [...categories].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }));
  return <><NewCategory />{(["receita", "despesa"] as const).map((type) => { const filtered = ordered.filter((category) => category.tipo === type || category.tipo === "ambos"); return <section key={type} className="mb-9"><div className="mb-3 flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${type === "receita" ? "bg-primary" : "bg-red"}`} /><h2 className="text-lg font-extrabold text-foreground">Categorias de {type}</h2><span className="rounded-full bg-surface-muted px-2.5 py-1 text-[10px] font-extrabold text-foreground-muted">{filtered.length}</span></div><div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((category) => <CategoryCard key={`${type}-${category.id}`} category={category} />)}</div>{filtered.length === 0 && <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-foreground-muted">Nenhuma categoria de {type} cadastrada.</div>}</section>; })}</>;
}
