import { supabase } from "./supabase";

const DEFAULT_CATEGORY_TYPES = ["despesa", "receita"] as const;

/**
 * Mantém uma categoria "Outros" em cada tipo de lançamento.
 * Registros antigos criados como `ambos` são normalizados para os dois tipos
 * usados pelo restante do app. Categorias já arquivadas não são reativadas.
 */
export async function garantirCategoriaOutros(userId: string) {
  const { data, error } = await supabase
    .from("categorias")
    .select("id, tipo, ativa")
    .eq("user_id", userId)
    .ilike("nome", "Outros")
    .order("id", { ascending: true });

  if (error) throw error;

  const existentes = data ?? [];
  const tiposExistentes = new Set(existentes.map((categoria) => categoria.tipo));
  const categoriaAmbos = existentes.find((categoria) => categoria.tipo === "ambos");
  const tiposAusentes = DEFAULT_CATEGORY_TYPES.filter((tipo) => !tiposExistentes.has(tipo));

  if (categoriaAmbos && tiposAusentes.length > 0) {
    const tipoNormalizado = tiposAusentes.shift()!;
    const { error: updateError } = await supabase
      .from("categorias")
      .update({ tipo: tipoNormalizado })
      .eq("id", categoriaAmbos.id)
      .eq("user_id", userId);
    if (updateError) throw updateError;
  }

  if (tiposAusentes.length > 0) {
    const { error: insertError } = await supabase.from("categorias").insert(
      tiposAusentes.map((tipo) => ({
        user_id: userId,
        nome: "Outros",
        tipo,
        cor: "#6C7D77",
        icone: "more-horiz",
        ativa: 1,
      })),
    );
    if (insertError) throw insertError;
  }
}
