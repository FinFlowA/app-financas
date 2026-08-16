"use server";

import { revalidatePath } from "next/cache";
import {
  executeManualFinancialAction,
  executeOptimisticUpdate,
  formInteger,
  formString,
} from "@/lib/finance-action";
import { createClient } from "@/lib/supabase/server";
import { buildCategoryChanges } from "./category-edit";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "./category-options";

export type CategoriaActionState = { erro: string | null; sucesso?: string };

const CATEGORY_TYPES = ["receita", "despesa"] as const;
function refreshCategories() {
  revalidatePath("/");
  revalidatePath("/categorias");
  revalidatePath("/transacoes");
  revalidatePath("/cartoes");
  revalidatePath("/relatorios");
}

export async function criarCategoria(_: CategoriaActionState, formData: FormData): Promise<CategoriaActionState> {
  const name = formString(formData, "name");
  const type = formString(formData, "type") as (typeof CATEGORY_TYPES)[number];
  const color = formString(formData, "color");
  const icon = formString(formData, "icon");
  if (!name || name.length > 80) return { erro: "Informe um nome de até 80 caracteres." };
  if (!CATEGORY_TYPES.includes(type)) return { erro: "Escolha receita ou despesa." };
  if (!CATEGORY_COLORS.includes(color as (typeof CATEGORY_COLORS)[number])) return { erro: "Escolha uma cor disponível." };
  if (!CATEGORY_ICONS.includes(icon as (typeof CATEGORY_ICONS)[number])) return { erro: "Escolha um ícone disponível." };

  const result = await executeManualFinancialAction("create_category", { name, type, color, icon }, formString(formData, "request_id"));
  if (result.erro) return result;
  refreshCategories();
  return { erro: null, sucesso: "Categoria criada." };
}

export async function editarCategoria(_: CategoriaActionState, formData: FormData): Promise<CategoriaActionState> {
  const categoryId = formInteger(formData, "category_id");
  const name = formString(formData, "name");
  const color = formString(formData, "color");
  const icon = formString(formData, "icon");
  const originalName = formString(formData, "original_name");
  const originalColor = formString(formData, "original_color");
  const originalIcon = formString(formData, "original_icon");
  if (!Number.isInteger(categoryId) || categoryId <= 0) return { erro: "Categoria inválida." };
  if (!name || name.length > 80) return { erro: "Informe um nome de até 80 caracteres." };

  const supabase = await createClient();
  const { data: current, error: currentError } = await supabase
    .from("categorias")
    .select("nome, cor, icone, version")
    .eq("id", categoryId)
    .maybeSingle();
  if (currentError || !current) {
    return { erro: "Não foi possível localizar esta categoria. Atualize a página e tente novamente." };
  }

  const expectedVersion = Number(current.version);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
    return { erro: "A categoria está sem uma versão válida. Atualize a página e tente novamente." };
  }

  // Os campos originais identificam exatamente o que a pessoa editou. Assim,
  // uma cor/um ícone legado não é substituído só porque não faz parte
  // da paleta atual, e uma alteração concorrente nunca é sobrescrita.
  const { changes, conflicts } = buildCategoryChanges(
    { name: String(current.nome), color: String(current.cor), icon: String(current.icone) },
    { name: originalName, color: originalColor, icon: originalIcon },
    { name, color, icon },
  );
  if (conflicts.length > 0) {
    return { erro: "Esta categoria mudou em outro dispositivo. Atualize a página antes de editar novamente." };
  }
  if (changes.color && !CATEGORY_COLORS.includes(changes.color as (typeof CATEGORY_COLORS)[number])) {
    return { erro: "Escolha uma cor disponível." };
  }
  if (changes.icon && !CATEGORY_ICONS.includes(changes.icon as (typeof CATEGORY_ICONS)[number])) {
    return { erro: "Escolha um ícone disponível." };
  }
  if (Object.keys(changes).length === 0) return { erro: null, sucesso: "Nenhuma alteração para salvar." };

  const result = await executeOptimisticUpdate("update_category", {
    category_id: categoryId,
    expected_version: expectedVersion,
    changes,
  }, formString(formData, "request_id"));
  if (result.erro) return result;
  refreshCategories();
  return { erro: null, sucesso: "Categoria atualizada." };
}

export async function alterarEstadoCategoria(_: CategoriaActionState, formData: FormData): Promise<CategoriaActionState> {
  const categoryId = formInteger(formData, "category_id");
  const operation = formString(formData, "operation");
  if (!Number.isInteger(categoryId) || categoryId <= 0) return { erro: "Categoria inválida." };
  if (!["archive_category", "delete_category", "reactivate_category"].includes(operation)) return { erro: "Ação inválida." };
  const result = await executeManualFinancialAction(operation as "archive_category" | "delete_category" | "reactivate_category", {
    category_id: categoryId,
  }, formString(formData, "request_id"));
  if (result.erro) return result;
  refreshCategories();
  const sucesso = operation === "reactivate_category"
    ? "Categoria reativada."
    : operation === "delete_category"
      ? "Categoria excluída. Se havia lançamentos, ela foi apenas arquivada e o histórico foi preservado."
      : "Categoria arquivada.";
  return { erro: null, sucesso };
}
