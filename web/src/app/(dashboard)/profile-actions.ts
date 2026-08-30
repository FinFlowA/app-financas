"use server";

import { LEGAL_DOCUMENT_VERSION } from "@/lib/auth/constants";
import { ageFromIsoDate } from "@/lib/auth/validation";
import { executeManualFinancialAction } from "@/lib/finance-action";
import { createClient } from "@/lib/supabase/server";
import defaultCategoriesJson from "../../../../constants/default-categories.json";

const DEFAULT_CATEGORIES_VERSION = 1;
const DEFAULT_CATEGORIES = defaultCategoriesJson as ReadonlyArray<{
  name: string;
  type: "receita" | "despesa";
  color: string;
  icon: string;
}>;

export type ProfileActionState = { status: "idle" | "success" | "error"; message?: string };

export async function completeRequiredProfile(_: ProfileActionState, formData: FormData): Promise<ProfileActionState> {
  void _;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Sua sessão expirou." };
  const metadata = user.user_metadata as Record<string, unknown>;
  const currentBirth = typeof metadata.data_nascimento === "string" ? metadata.data_nascimento : "";
  const birthDate = currentBirth || String(formData.get("data_nascimento") ?? "");
  const age = ageFromIsoDate(birthDate);
  if (age === null) return { status: "error", message: "Informe uma data de nascimento válida." };
  if (age < 18) { await supabase.auth.signOut({ scope: "local" }); return { status: "error", message: "O FinFlow está disponível somente para maiores de 18 anos." }; }
  const legalCurrent = metadata.termos_versao === LEGAL_DOCUMENT_VERSION && typeof metadata.termos_aceitos_em === "string";
  if (!legalCurrent && formData.get("aceite_legal") !== "on") return { status: "error", message: "Você precisa aceitar os Termos e a Política de Privacidade para continuar." };
  const { error } = await supabase.auth.updateUser({ data: {
    ...metadata,
    data_nascimento: birthDate,
    ...(!legalCurrent ? { termos_aceitos_em: new Date().toISOString(), termos_versao: LEGAL_DOCUMENT_VERSION } : {}),
  } });
  return error ? { status: "error", message: "Não foi possível atualizar seu cadastro agora." } : { status: "success" };
}

export async function completeTutorial(_: ProfileActionState): Promise<ProfileActionState> {
  void _;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { status: "error", message: "Sua sessão expirou." };
  const { error } = await supabase.auth.updateUser({ data: {
    ...user.user_metadata,
    tutorial_pendente: false,
    tutorial_concluido_em: new Date().toISOString(),
  } });
  return error ? { status: "error", message: "Não foi possível concluir o tutorial agora." } : { status: "success" };
}

export async function ensureDefaultCategories(): Promise<ProfileActionState> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { status: "error", message: "Sua sessão expirou." };
  if (user.user_metadata?.categorias_padrao_versao === DEFAULT_CATEGORIES_VERSION) {
    return { status: "success" };
  }

  const { data, error } = await supabase
    .from("categorias")
    .select("id,nome,tipo")
    .eq("user_id", user.id)
    .order("id");
  if (error) return { status: "error", message: "Não foi possível preparar as categorias iniciais." };

  const rows = data ?? [];
  const shouldCompleteCatalog = user.user_metadata?.categorias_iniciais_criadas !== true
    || rows.every((row) => row.nome.trim().toLocaleLowerCase("pt-BR") === "outros");
  const legacy = rows.find((row) => row.tipo === "ambos" && row.nome.trim().toLocaleLowerCase("pt-BR") === "outros");

  if (legacy) {
    const { error: updateError } = await supabase
      .from("categorias")
      .update({ tipo: "despesa" })
      .eq("id", legacy.id)
      .eq("user_id", user.id)
      .eq("tipo", "ambos");
    if (updateError) return { status: "error", message: "Não foi possível normalizar a categoria inicial." };
  }

  const { data: refreshed, error: refreshError } = await supabase
    .from("categorias")
    .select("nome,tipo")
    .eq("user_id", user.id);
  if (refreshError) return { status: "error", message: "Não foi possível preparar as categorias iniciais." };
  const existingKeys = new Set((refreshed ?? []).map((row) =>
    `${row.tipo}:${row.nome.trim().toLocaleLowerCase("pt-BR")}`,
  ));
  const missing = (shouldCompleteCatalog ? DEFAULT_CATEGORIES : []).filter((category) =>
    !existingKeys.has(`${category.type}:${category.name.toLocaleLowerCase("pt-BR")}`),
  );

  for (const category of missing) {
    const result = await executeManualFinancialAction("create_category", {
      name: category.name,
      type: category.type,
      color: category.color,
      icon: category.icon,
    });
    if (result.erro) {
      // O executor serializa as ações por usuário. Se outra aba venceu a
      // corrida, a categoria correta já existe e este bootstrap pode seguir.
      const { data: existingCategory, error: lookupError } = await supabase
        .from("categorias")
        .select("id")
        .eq("user_id", user.id)
        .eq("tipo", category.type)
        .ilike("nome", category.name)
        .limit(1)
        .maybeSingle();
      if (lookupError || !existingCategory) return { status: "error", message: result.erro };
    }
  }

  const { error: metadataError } = await supabase.auth.updateUser({ data: {
    ...user.user_metadata,
    categorias_iniciais_criadas: true,
    categorias_padrao_versao: DEFAULT_CATEGORIES_VERSION,
  } });
  return metadataError
    ? { status: "error", message: "As categorias foram criadas, mas o cadastro não pôde ser finalizado." }
    : { status: "success" };
}
