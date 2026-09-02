import { createClient } from "@/lib/supabase/server";
import type { Categoria } from "@/lib/types";
import CategoryManager from "./category-manager";

export default async function CategoriasPage() {
  const supabase = await createClient();
  // `*` mantém a leitura compatível com bancos que ainda não receberam a
  // coluna `version`; o RLS continua limitando as linhas ao usuário conectado.
  const result = await supabase.from("categorias").select("*").order("nome");
  if (result.error) {
    return <section className="ff-card mx-auto max-w-3xl p-6 text-center"><h1 className="text-xl font-extrabold text-foreground">Categorias indisponíveis</h1><p className="mt-2 text-sm text-foreground-muted">Não foi possível carregar suas categorias agora. Atualize a página em instantes.</p></section>;
  }
  const categories = ((result.data ?? []) as Categoria[]).map((category) => ({ ...category, version: category.version ?? 1 }));
  const active = categories.filter((category) => category.ativa === true || category.ativa === 1);
  const income = active.filter((category) => category.tipo === "receita" || category.tipo === "ambos").length;
  const expenses = active.filter((category) => category.tipo === "despesa" || category.tipo === "ambos").length;

  return (
    <div className="w-full">
      <header className="ff-page-hero mb-6 px-5 py-6 sm:px-7 sm:py-7">
        <div aria-hidden="true" className="absolute -right-20 top-1/2 h-60 w-60 -translate-y-1/2 rounded-full border border-white/10" />
        <div className="relative grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-mint">Organização inteligente</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Categorias</h1>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/72">Organize receitas e despesas sem perder o histórico: categorias usadas são arquivadas com segurança.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="min-w-32 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 backdrop-blur-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Receitas</p><p className="mt-1 text-xl font-black text-mint">{income}</p></div>
            <div className="min-w-32 rounded-2xl border border-white/10 bg-black/15 px-4 py-3 backdrop-blur-sm"><p className="text-[10px] font-bold uppercase tracking-wider text-white/60">Despesas</p><p className="mt-1 text-xl font-black text-[#ff8c84]">{expenses}</p></div>
          </div>
        </div>
      </header>
      <CategoryManager categories={categories} />
    </div>
  );
}
