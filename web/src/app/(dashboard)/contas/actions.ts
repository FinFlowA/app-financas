"use server";

import { revalidatePath } from "next/cache";
import {
  executeManualFinancialAction,
  executeOptimisticUpdate,
  formInteger,
  formString,
  setFinancialResourceSharing,
} from "@/lib/finance-action";
import { parseMoney } from "@/lib/money";

export type ContaActionState = { erro: string | null; sucesso?: string };

const COLORS = ["#16966E", "#4D76E8", "#F28A55", "#805AD5", "#EE6B63", "#56D39B", "#457B9D", "#6C7D77"];

function refreshAccounts() {
  revalidatePath("/");
  revalidatePath("/contas");
  revalidatePath("/transacoes");
  revalidatePath("/relatorios");
}

function resourceIdFromResult(data: unknown): number | null {
  if (!data || typeof data !== "object") return null;
  const result = (data as Record<string, unknown>).result;
  if (!result || typeof result !== "object") return null;
  const id = Number((result as Record<string, unknown>).id);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export async function criarConta(_: ContaActionState, formData: FormData): Promise<ContaActionState> {
  const name = formString(formData, "name");
  const initialBalance = parseMoney(formData.get("initial_balance"));
  const color = formString(formData, "color");
  const shared = formString(formData, "shared") === "true";
  if (!name || name.length > 100) return { erro: "Informe um nome de até 100 caracteres." };
  if (!Number.isFinite(initialBalance) || initialBalance < 0) return { erro: "Informe um saldo inicial válido." };
  if (!COLORS.includes(color)) return { erro: "Escolha uma cor disponível." };

  const result = await executeManualFinancialAction("create_account", {
    name,
    initial_balance: initialBalance,
    color,
  }, formString(formData, "request_id"));
  if (result.erro) return result;
  if (shared) {
    const accountId = resourceIdFromResult(result.data);
    if (!accountId) {
      refreshAccounts();
      return { erro: "A conta foi criada como privada, mas não foi possível identificá-la para o compartilhamento." };
    }
    const sharing = await setFinancialResourceSharing("account", accountId, true, 1);
    if (sharing.erro) {
      refreshAccounts();
      return { erro: `A conta foi criada como privada. ${sharing.erro}` };
    }
  }
  refreshAccounts();
  return { erro: null, sucesso: shared ? "Conta criada e compartilhada com segurança." : "Conta criada com segurança." };
}

export async function editarConta(_: ContaActionState, formData: FormData): Promise<ContaActionState> {
  const accountId = formInteger(formData, "account_id");
  const expectedVersion = formInteger(formData, "expected_version");
  const name = formString(formData, "name");
  const initialBalance = parseMoney(formData.get("initial_balance"));
  const color = formString(formData, "color");
  if (!Number.isInteger(accountId) || accountId <= 0 || !Number.isInteger(expectedVersion)) return { erro: "Conta inválida." };
  if (!name || name.length > 100) return { erro: "Informe um nome de até 100 caracteres." };
  if (!Number.isFinite(initialBalance) || initialBalance < 0) return { erro: "Informe um saldo inicial válido." };
  if (!COLORS.includes(color)) return { erro: "Escolha uma cor disponível." };

  const result = await executeOptimisticUpdate("update_account", {
    account_id: accountId,
    expected_version: expectedVersion,
    changes: { name, initial_balance: initialBalance, color },
  }, formString(formData, "request_id"));
  if (result.erro) return result;
  refreshAccounts();
  return { erro: null, sucesso: "Conta atualizada." };
}

export async function alterarEstadoConta(_: ContaActionState, formData: FormData): Promise<ContaActionState> {
  const accountId = formInteger(formData, "account_id");
  const operation = formString(formData, "operation");
  if (!Number.isInteger(accountId) || accountId <= 0) return { erro: "Conta inválida." };
  if (!["archive_account", "delete_account", "reactivate_account"].includes(operation)) return { erro: "Ação inválida." };
  const result = await executeManualFinancialAction(operation as "archive_account" | "delete_account" | "reactivate_account", {
    account_id: accountId,
  }, formString(formData, "request_id"));
  if (result.erro) return result;
  refreshAccounts();
  const message = operation === "reactivate_account" ? "Conta reativada." : operation === "delete_account" ? "Conta excluída ou arquivada conforme o histórico." : "Conta arquivada.";
  return { erro: null, sucesso: message };
}

export async function alterarCompartilhamentoConta(
  _: ContaActionState,
  formData: FormData,
): Promise<ContaActionState> {
  const accountId = formInteger(formData, "account_id");
  const expectedVersion = formInteger(formData, "expected_version");
  const sharedValue = formString(formData, "shared");
  if (!Number.isSafeInteger(accountId) || accountId <= 0
    || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0
    || !["true", "false"].includes(sharedValue)) {
    return { erro: "Não foi possível validar a conta. Atualize a página e tente novamente." };
  }

  const shared = sharedValue === "true";
  const result = await setFinancialResourceSharing(
    "account",
    accountId,
    shared,
    expectedVersion,
    formString(formData, "request_id"),
  );
  if (result.erro) return result;
  refreshAccounts();
  return {
    erro: null,
    sucesso: shared ? "Conta compartilhada com seu parceiro." : "Conta agora é privada.",
  };
}

export { COLORS };
