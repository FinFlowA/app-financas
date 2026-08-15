import { createClient } from "@/lib/supabase/server";
import type { Categoria } from "@/lib/types";
import CategoryManager from "./category-manager";

export default async function CategoriasPage() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categorias")
    .select("id, user_id, nome, cor, icone, tipo, ativa, bloqueado_plano, version")
    .order("nome");
  if (error) throw new Error("Não foi possível carregar suas categorias agora.");
  return <div className="max-w-6xl"><div className="mb-6"><p className="text-sm font-bold uppercase tracking-wide text-primary">Organização</p><h1 className="text-3xl font-extrabold">Categorias</h1><p className="mt-1 text-sm text-foreground-muted">Organize receitas e despesas. Categorias utilizadas são arquivadas sem alterar os lançamentos existentes.</p></div><CategoryManager categories={(data ?? []) as Categoria[]} /></div>;
}
