import type { SupabaseClient } from "@supabase/supabase-js";
import type { OfflineExecutor } from "./offline-queue-core";
import { isOfflineUpdateActionType } from "./offline-update-core";

type OfflineRpcResponse = {
  ok?: boolean;
  replayed?: boolean;
  error_code?: string;
};

type SupabaseLikeError = {
  code?: string;
  message?: string;
  status?: number;
};

const RETRYABLE_CODES = new Set([
  "OFFLINE_RATE_LIMITED",
  "OFFLINE_NETWORK_ERROR",
  "PGRST003",
  "PGRST301",
  "53300",
  "57014",
  "57P01",
  "08000",
  "08001",
  "08003",
  "08006",
]);

function safeCode(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "OFFLINE_SERVER_ERROR";
  return value.trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, "_").slice(0, 80);
}

function isRetryableSupabaseError(error: SupabaseLikeError | null): boolean {
  const code = safeCode(error?.code ?? "");
  const status = error?.status;
  return (
    RETRYABLE_CODES.has(code) ||
    code.startsWith("08") ||
    status === 408 ||
    status === 429 ||
    (typeof status === "number" && status >= 500) ||
    /network|failed to fetch|fetch failed|timeout|timed out|connection|offline/i.test(error?.message ?? "")
  );
}

function errorCodeFromSupabase(error: SupabaseLikeError | null): string {
  if (isRetryableSupabaseError(error) && !error?.code) return "OFFLINE_NETWORK_ERROR";
  const domainCode = error?.message?.match(/\b(?:OFFLINE|AI)_[A-Z0-9_]+\b/)?.[0];
  return safeCode(domainCode ?? error?.code ?? "OFFLINE_SERVER_ERROR");
}

export function createSupabaseOfflineExecutor(client: SupabaseClient): OfflineExecutor {
  return async (request) => {
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) {
      const retryable = isRetryableSupabaseError(userError);
      return {
        ok: false,
        retryable,
        errorCode: retryable ? "OFFLINE_NETWORK_ERROR" : errorCodeFromSupabase(userError),
      };
    }
    if (!userData.user || userData.user.id.toLowerCase() !== request.userId.toLowerCase()) {
      return { ok: false, retryable: false, errorCode: "OFFLINE_AUTH_MISMATCH" };
    }
    const rpcName = isOfflineUpdateActionType(request.actionType)
      ? "execute_offline_optimistic_update"
      : "execute_offline_financial_action";
    const rpcResponse = await client.rpc(rpcName, {
      p_action_type: request.actionType,
      p_payload: request.payload,
      p_idempotency_key: request.idempotencyKey,
      p_expected_user_id: request.userId,
      p_client_created_at: request.createdAt,
    });
    const { data, error } = rpcResponse;
    if (error) {
      const errorWithStatus = { ...error, status: rpcResponse.status };
      const code = errorCodeFromSupabase(errorWithStatus);
      return {
        ok: false,
        retryable: isRetryableSupabaseError(errorWithStatus),
        errorCode: code,
      };
    }
    const responseBody = (data ?? {}) as OfflineRpcResponse;
    if (responseBody.ok) return { ok: true, replayed: responseBody.replayed === true };
    const code = safeCode(responseBody.error_code ?? "OFFLINE_SERVER_REJECTED");
    return { ok: false, retryable: RETRYABLE_CODES.has(code), errorCode: code };
  };
}
