import { parseFinanceAiHttpResponse } from "./validation";

const id = "123e4567-e89b-42d3-a456-426614174000";
const otherId = "123e4567-e89b-42d3-a456-426614174001";
const now = "2026-08-02T12:00:00Z";
const quota = {
  plan: "premium",
  limits_enabled: true,
  limit: 50,
  used: 2,
  remaining: 48,
  model_limit: 200,
  model_used: 3,
  model_remaining: 197,
  window_start: "2026-08-02T03:00:00Z",
  window_end: "2026-08-03T03:00:00Z",
  timezone: "America/Sao_Paulo",
};

function expectValid(value: unknown): void {
  const result = parseFinanceAiHttpResponse(value);
  if (!result.ok) throw new Error(`Esperava resposta válida: ${JSON.stringify(result.error)}`);
}

function expectInvalid(value: unknown): void {
  const result = parseFinanceAiHttpResponse(value);
  if (result.ok) throw new Error("Esperava rejeição da resposta.");
}

export function runFinanceAiValidationTests(): void {
expectValid({ kind: "answer", conversationId: id, message: "Saldo atual.", intent: "financial_summary", quota });
expectValid({ kind: "answer", conversationId: id, message: "Só trato de finanças.", intent: "out_of_scope", quota });
expectValid({ kind: "clarify", conversationId: id, message: "Qual conta?", intent: "create_transaction", missingFields: ["account_id"], quota });
expectValid({ kind: "navigate", conversationId: id, message: "Abrindo.", intent: "open_history", route: "/transacoes", quota });
expectValid({
  kind: "proposal",
  conversationId: id,
  message: "Revise.",
  intent: "create_account",
  pendingAction: {
    id: otherId,
    confirmationToken: id,
    actionType: "create_account",
    expiresAt: now,
    preview: { title: "Confirmar criação", summary: "Criar conta.", consequences: ["O saldo será atualizado."] },
  },
  quota,
});
expectValid({ kind: "executed", message: "Concluído.", result: { ok: true, action_id: id, action_type: "create_account", status: "succeeded", result: {}, replayed: false }, quota });
expectValid({ kind: "cancelled", message: "Cancelada.", action: { ok: true, action_id: id, action_type: "create_account", status: "cancelled", cancelled_at: now, replayed: true }, quota });
expectValid({ kind: "cancelled", message: "Cancelada.", action: { ok: true, action_id: id, action_type: "create_account", status: "cancelled", cancelled_at: now, replayed: true } });
expectValid({ conversationId: id, messages: [{ id: "1", role: "assistant", text: "Olá", createdAt: now, intent: null }], quota });
expectValid({ conversationId: id, messages: [{ id: "1", role: "assistant", text: "Olá", createdAt: now, intent: null }] });
expectValid({ cleared: true, conversationId: null, messages: [], quota });
expectValid({ cleared: true, conversationId: null, messages: [] });
expectValid({ error: "AI_RATE_LIMITED", message: "Aguarde." });

expectInvalid("não é json");
expectInvalid({ kind: "answer", conversationId: id, message: "Inválida", intent: "create_account", quota });
expectInvalid({ kind: "answer", conversationId: id, message: "Saldo.", intent: "financial_summary" });
expectInvalid({ kind: "navigate", conversationId: id, message: "Abrindo", intent: "open_history", route: "/cartoes", quota });
expectInvalid({ kind: "clarify", conversationId: id, message: "Qual conta?", intent: "create_transaction", missingFields: [], quota });
expectInvalid({ kind: "executed", message: "Concluído.", result: { ok: true, action_id: id, action_type: "create_account", status: "succeeded", result: {}, replayed: false, extra: true }, quota });
expectInvalid({ error: "erro interno" });
}
