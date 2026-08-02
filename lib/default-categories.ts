import { supabase } from "./supabase";

const DEFAULT_CATEGORY_TYPES = ["despesa", "receita"] as const;

export const CATEGORIAS_INICIAIS_METADATA_KEY = "categorias_iniciais_criadas";

type UserMetadata = Record<string, unknown>;

export type ResultadoCategoriasIniciais = {
  executou: boolean;
  alterouCategorias: boolean;
};

const inicializacoesEmAndamento = new Map<string, Promise<ResultadoCategoriasIniciais>>();

const metadataIndicaInicializacao = (metadata?: UserMetadata | null) =>
  metadata?.[CATEGORIAS_INICIAIS_METADATA_KEY] === true;

async function garantirCategoriaOutrosInterno(
  userId: string,
  metadataConhecida?: UserMetadata | null,
): Promise<ResultadoCategoriasIniciais> {
  if (metadataIndicaInicializacao(metadataConhecida)) {
    return { executou: false, alterouCategorias: false };
  }

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
  let alterouCategorias = false;

  if (categoriaAmbos && tiposAusentes.length > 0) {
    const tipoNormalizado = tiposAusentes.shift()!;
    const { error: updateError } = await supabase
      .from("categorias")
      .update({ tipo: tipoNormalizado })
      .eq("id", categoriaAmbos.id)
      .eq("user_id", userId);
    if (updateError) throw updateError;
    alterouCategorias = true;
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
    alterouCategorias = true;
  }

  // Busca a versao mais recente antes de gravar para nao remover metadados
  // adicionados por outros fluxos (termos, tutorial, nascimento, telefone etc.).
  const { data: authData, error: userError } = await supabase.auth.getUser();
  if (userError) throw userError;
  if (!authData.user || authData.user.id !== userId) {
    throw new Error("A sessao mudou durante a inicializacao das categorias.");
  }

  const metadataAtual = (authData.user.user_metadata ?? metadataConhecida ?? {}) as UserMetadata;
  const { error: metadataError } = await supabase.auth.updateUser({
    data: {
      ...metadataAtual,
      [CATEGORIAS_INICIAIS_METADATA_KEY]: true,
    },
  });
  if (metadataError) throw metadataError;

  return { executou: true, alterouCategorias };
}

/**
 * Garante as categorias iniciais "Outros" uma unica vez por usuario.
 *
 * Depois que `categorias_iniciais_criadas` e salvo no `user_metadata`, esta
 * funcao nao reconcilia mais a lista. Assim, excluir, arquivar ou renomear uma
 * categoria "Outros" continua sendo uma escolha permanente do usuario.
 */
export function garantirCategoriaOutros(
  userId: string,
  metadataConhecida?: UserMetadata | null,
): Promise<ResultadoCategoriasIniciais> {
  const inicializacaoExistente = inicializacoesEmAndamento.get(userId);
  if (inicializacaoExistente) return inicializacaoExistente;

  const inicializacao = garantirCategoriaOutrosInterno(userId, metadataConhecida)
    .finally(() => inicializacoesEmAndamento.delete(userId));
  inicializacoesEmAndamento.set(userId, inicializacao);
  return inicializacao;
}
