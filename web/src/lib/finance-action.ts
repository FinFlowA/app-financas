import "server-only";

import { createClient } from "@/lib/supabase/server";
import { traduzirErro } from "@/lib/error-messages";

export type ManualFinancialAction =
  | "create_account" | "update_account" | "archive_account" | "delete_account" | "reactivate_account"
  | "create_category" | "update_category" | "archive_category" | "delete_category" | "reactivate_category"
  | "create_goal" | "update_goal" | "archive_goal" | "delete_goal" | "reactivate_goal" | "move_goal"
  | "create_transaction" | "transfer_between_accounts" | "update_transaction" | "delete_transaction"
  | "complete_transaction" | "reopen_transaction"
  | "create_card" | "update_card" | "archive_card" | "delete_card" | "reactivate_card"
  | "create_card_purchase" | "update_card_purchase" | "delete_card_purchase"
  | "pay_invoice" | "reverse_invoice_payment";

export type ActionResponse<T = unknown> = {
  erro: string | null;
  data?: T;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function backendCode(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (value.ok === false && typeof value.error_code === "string") return value.error_code;
  if (value.result && typeof value.result === "object") {
    const nested = value.result as Record<string, unknown>;
    if (nested.ok === false && typeof nested.error_code === "string") return nested.error_code;
  }
  return null;
}

function isSuccessfulEnvelope(data: unknown): boolean {
  return Boolean(data && typeof data === "object" && (data as Record<string, unknown>).ok === true);
}

function invalidBackendResponse(): ActionResponse<never> {
  return {
    erro: "O servidor não confirmou a operação. Nenhuma alteração foi considerada concluída.",
  };
}

export async function executeManualFinancialAction<T = unknown>(
  actionType: ManualFinancialAction,
  payload: Record<string, unknown>,
  requestId?: string,
): Promise<ActionResponse<T>> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { erro: "Sua sessão expirou. Entre novamente." };

  const idempotencyKey = requestId && UUID_PATTERN.test(requestId)
    ? requestId
    : crypto.randomUUID();

  const { data, error } = await supabase.rpc("execute_manual_financial_action", {
    p_action_type: actionType,
    p_payload: payload,
    p_idempotency_key: idempotencyKey,
    p_expected_user_id: user.id,
    p_client_created_at: new Date().toISOString(),
  });

  if (error) {
    console.error("[manual-financial-action] Supabase RPC failed", {
      actionType,
      code: error.code ?? "unknown",
    });
    return { erro: traduzirErro(error.message) };
  }
  const code = backendCode(data);
  if (code) return { erro: traduzirErro(code) };
  if (!isSuccessfulEnvelope(data)) return invalidBackendResponse();
  return { erro: null, data: data as T };
}

export type OptimisticUpdateAction =
  | "update_account"
  | "update_category"
  | "update_goal"
  | "update_card"
  | "update_transaction";

export type ShareableFinancialResource = "account" | "goal";

export async function setFinancialResourceSharing<T = unknown>(
  resourceType: ShareableFinancialResource,
  resourceId: number,
  shared: boolean,
  expectedVersion: number,
  requestId?: string,
): Promise<ActionResponse<T>> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { erro: "Sua sessão expirou. Entre novamente." };

  if (!Number.isSafeInteger(resourceId) || resourceId <= 0
    || !Number.isSafeInteger(expectedVersion) || expectedVersion <= 0) {
    return { erro: "O item financeiro informado é inválido." };
  }

  const idempotencyKey = requestId && UUID_PATTERN.test(requestId)
    ? requestId
    : crypto.randomUUID();
  const { data, error } = await supabase.rpc("set_financial_resource_sharing", {
    p_resource_type: resourceType,
    p_resource_id: resourceId,
    p_shared: shared,
    p_expected_version: expectedVersion,
    p_idempotency_key: idempotencyKey,
    p_expected_user_id: user.id,
    p_client_created_at: new Date().toISOString(),
  });
  if (error) return { erro: traduzirErro(error.message) };
  const code = backendCode(data);
  if (code) return { erro: traduzirErro(code) };
  if (!isSuccessfulEnvelope(data)) return invalidBackendResponse();
  return { erro: null, data: data as T };
}

export async function executeOptimisticUpdate<T = unknown>(
  actionType: OptimisticUpdateAction,
  payload: Record<string, unknown>,
  requestId?: string,
): Promise<ActionResponse<T>> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return { erro: "Sua sessão expirou. Entre novamente." };

  const idempotencyKey = requestId && UUID_PATTERN.test(requestId)
    ? requestId
    : crypto.randomUUID();
  const { data, error } = await supabase.rpc("execute_offline_optimistic_update", {
    p_action_type: actionType,
    p_payload: payload,
    p_idempotency_key: idempotencyKey,
    p_expected_user_id: user.id,
    p_client_created_at: new Date().toISOString(),
  });
  if (error) return { erro: traduzirErro(error.message) };
  const code = backendCode(data);
  if (code) return { erro: traduzirErro(code) };
  if (!isSuccessfulEnvelope(data)) return invalidBackendResponse();
  return { erro: null, data: data as T };
}

export function formString(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}

export function formInteger(formData: FormData, name: string): number {
  return Number(formData.get(name));
}
