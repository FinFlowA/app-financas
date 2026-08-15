"use server";

import { revalidatePath } from "next/cache";
import {
  executeManualFinancialAction,
  executeOptimisticUpdate,
  formInteger,
  formString,
} from "@/lib/finance-action";

export type CategoriaActionState = { erro: string | null; sucesso?: string };

const CATEGORY_TYPES = ["receita", "despesa"] as const;
export const CATEGORY_COLORS = ["#16966E", "#4D76E8", "#F28A55", "#805AD5", "#EE6B63", "#56D39B", "#457B9D", "#6C7D77"];
export const CATEGORY_ICONS = ["wallet", "restaurant", "home", "directions-car", "shopping-bag", "work", "favorite", "more-horiz"];

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
  if (!CATEGORY_COLORS.includes(color)) return { erro: "Escolha uma cor disponível." };
  if (!CATEGORY_ICONS.includes(icon)) return { erro: "Escolha um ícone disponível." };

  const result = await executeManualFinancialAction("create_category", { name, type, color, icon }, formString(formData, "request_id"));
  if (result.erro) return result;
  refreshCategories();
  return { erro: null, sucesso: "Categoria criada." };
}

export async function editarCategoria(_: CategoriaActionState, formData: FormData): Promise<CategoriaActionState> {
  const categoryId = formInteger(formData, "category_id");
  const expectedVersion = formInteger(formData, "expected_version");
  const name = formString(formData, "name");
  const color = formString(formData, "color");
  const icon = formString(formData, "icon");
  if (!Number.isInteger(categoryId) || categoryId <= 0 || !Number.isInteger(expectedVersion)) return { erro: "Categoria inválida." };
  if (!name || name.length > 80) return { erro: "Informe um nome de até 80 caracteres." };
  if (!CATEGORY_COLORS.includes(color) || !CATEGORY_ICONS.includes(icon)) return { erro: "Cor ou ícone inválido." };

  const result = await executeOptimisticUpdate("update_category", {
    category_id: categoryId,
    expected_version: expectedVersion,
    changes: { name, color, icon },
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
