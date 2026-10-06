"use server";

import { revalidatePath } from "next/cache";
import {
  executeManualFinancialAction,
  executeOptimisticUpdate,
  formInteger,
  formString,
} from "@/lib/finance-action";
import { moneyIsPositive, parseMoney } from "@/lib/money";
import { createClient } from "@/lib/supabase/server";
import { buildCategoryChanges, buildTargetChange, type CategoryTargetField } from "./category-edit";
import { CATEGORY_COLORS, CATEGORY_ICONS } from "./category-options";

export type CategoriaActionState = { erro: string | null; sucesso?: string };

const CATEGORY_TYPES = ["receita", "despesa"] as const;
// Toda tela que le a tabela categorias precisa ser revalidada aqui, senao uma
// categoria criada/editada/arquivada fica invisivel nela ate um refresh
// manual. Calendario e Conciliacao ficaram de fora por um tempo -- uma
// categoria nova nao aparecia no lancamento rapido de despesa dessas telas.
function refreshCategories() {
  revalidatePath("/");
  revalidatePath("/categorias");
  revalidatePath("/transacoes");
  revalidatePath("/cartoes");
  revalidatePath("/relatorios");
  revalidatePath("/calendario");
  revalidatePath("/conciliacao");
}

/** Meta/limite do formulário: null quando o campo está vazio; "invalid" quando não é um valor positivo. */
function readTarget(formData: FormData, name: string): number | null | "invalid" {
  const raw = formString(formData, name);
  if (!raw) return null;
  const value = parseMoney(raw);
  return moneyIsPositive(value) ? value : "invalid";
}

/** Valor gravado (campo oculto com o número original ou vazio). */
function readStoredTarget(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * 100) / 100 : null;
}

const TARGET_ERROR: Record<CategoryTargetField, string> = {
  monthly_goal: "Informe uma meta maior que zero ou deixe o campo em branco.",
  monthly_limit: "Informe um limite maior que zero ou deixe o campo em branco.",
};

export async function criarCategoria(_: CategoriaActionState, formData: FormData): Promise<CategoriaActionState> {
  const name = formString(formData, "name");
  const type = formString(formData, "type") as (typeof CATEGORY_TYPES)[number];
  const color = formString(formData, "color");
  const icon = formString(formData, "icon");
  if (!name || name.length > 80) return { erro: "Informe um nome de até 80 caracteres." };
  if (!CATEGORY_TYPES.includes(type)) return { erro: "Escolha receita ou despesa." };
  if (!CATEGORY_COLORS.includes(color as (typeof CATEGORY_COLORS)[number])) return { erro: "Escolha uma cor disponível." };
  if (!CATEGORY_ICONS.includes(icon as (typeof CATEGORY_ICONS)[number])) return { erro: "Escolha um ícone disponível." };
  // Receita tem meta mensal; despesa, limite mensal. Os dois são opcionais.
  const targetField: CategoryTargetField = type === "receita" ? "monthly_goal" : "monthly_limit";
  const target = readTarget(formData, "monthly_target");
  if (target === "invalid") return { erro: TARGET_ERROR[targetField] };

  const payload: Record<string, unknown> = { name, type, color, icon };
  if (target !== null) payload[targetField] = target;
  const result = await executeManualFinancialAction("create_category", payload, formString(formData, "request_id"));
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
    .select("nome, cor, icone, version, meta_mensal, limite_mensal")
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

  // Meta (receita) e limite (despesa) mensais: o formulário só envia os campos
  // do tipo da categoria. Campo vazio tira o valor.
  const allChanges: Record<string, unknown> = { ...changes };
  const currentTargets: Record<CategoryTargetField, unknown> = { monthly_goal: current.meta_mensal, monthly_limit: current.limite_mensal };
  for (const field of ["monthly_goal", "monthly_limit"] as const) {
    if (!formData.has(field)) continue;
    const desired = readTarget(formData, field);
    if (desired === "invalid") return { erro: TARGET_ERROR[field] };
    const { changed, conflict } = buildTargetChange(
      readStoredTarget(currentTargets[field]),
      readStoredTarget(formData.get(`original_${field}`)),
      desired,
    );
    if (conflict) return { erro: "Esta categoria mudou em outro dispositivo. Atualize a página antes de editar novamente." };
    if (changed) allChanges[field] = desired;
  }
  if (Object.keys(allChanges).length === 0) return { erro: null, sucesso: "Nenhuma alteração para salvar." };

  const result = await executeOptimisticUpdate("update_category", {
    category_id: categoryId,
    expected_version: expectedVersion,
    changes: allChanges,
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
