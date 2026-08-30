import { supabase } from "./supabase";
import defaultCategoriesJson from "../constants/default-categories.json";

const DEFAULT_CATEGORY_TYPES = ["despesa", "receita"] as const;
const DEFAULT_CATEGORIES_VERSION = 1;
const DEFAULT_CATEGORIES = defaultCategoriesJson as ReadonlyArray<{
  name: string;
  type: (typeof DEFAULT_CATEGORY_TYPES)[number];
  color: string;
  icon: string;
}>;

export const CATEGORIAS_INICIAIS_METADATA_KEY = "categorias_iniciais_criadas";

type UserMetadata = Record<string, unknown>;

export type ResultadoCategoriasIniciais = {
  executou: boolean;
  alterouCategorias: boolean;
};

const inicializacoesEmAndamento = new Map<string, Promise<ResultadoCategoriasIniciais>>();

const metadataIndicaInicializacao = (metadata?: UserMetadata | null) =>
  metadata?.categorias_padrao_versao === DEFAULT_CATEGORIES_VERSION;

async function garantirCategoriaOutrosInterno(
  userId: string,
  metadataConhecida?: UserMetadata | null,
): Promise<ResultadoCategoriasIniciais> {
  if (metadataIndicaInicializacao(metadataConhecida)) {
    return { executou: false, alterouCategorias: false };
  }

  const { data, error } = await supabase
    .from("categorias")
    .select("id, nome, tipo, ativa")
    .eq("user_id", userId)
    .order("id", { ascending: true });

  if (error) throw error;

  const existentes = data ?? [];
  const deveCompletarCatalogo = metadataConhecida?.[CATEGORIAS_INICIAIS_METADATA_KEY] !== true
    || existentes.every((categoria) => categoria.nome.trim().toLocaleLowerCase("pt-BR") === "outros");
  const categoriaAmbos = existentes.find((categoria) => categoria.tipo === "ambos" && categoria.nome.toLocaleLowerCase("pt-BR") === "outros");
  let alterouCategorias = false;

  if (categoriaAmbos) {
    const { error: updateError } = await supabase
      .from("categorias")
      .update({ tipo: "despesa" })
      .eq("id", categoriaAmbos.id)
      .eq("user_id", userId);
    if (updateError) throw updateError;
    categoriaAmbos.tipo = "despesa";
    alterouCategorias = true;
  }

  const chavesExistentes = new Set(existentes.map((categoria) =>
    `${categoria.tipo}:${categoria.nome.trim().toLocaleLowerCase("pt-BR")}`,
  ));
  const categoriasAusentes = (deveCompletarCatalogo ? DEFAULT_CATEGORIES : []).filter((categoria) =>
    !chavesExistentes.has(`${categoria.type}:${categoria.name.toLocaleLowerCase("pt-BR")}`),
  );

  if (categoriasAusentes.length > 0) {
    const { error: insertError } = await supabase.from("categorias").insert(
      categoriasAusentes.map((categoria) => ({
        user_id: userId,
        nome: categoria.name,
        tipo: categoria.type,
        cor: categoria.color,
        icone: categoria.icon,
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
      categorias_padrao_versao: DEFAULT_CATEGORIES_VERSION,
    },
  });
  if (metadataError) throw metadataError;

  return { executou: true, alterouCategorias };
}

/**
 * Garante o catálogo inicial compartilhado pelo app e pelo site uma vez por versão.
 *
 * A versão permite complementar cadastros antigos quando o catálogo oficial muda,
 * sem recriar categorias que o usuário remover depois de receber essa versão.
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
