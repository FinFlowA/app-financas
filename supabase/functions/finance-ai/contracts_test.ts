import { hasRemainingActionQuota, parseModelOutput, publicErrorMessage } from "./contracts.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertRejected(value: unknown): void {
  let rejected = false;
  try {
    parseModelOutput(value);
  } catch {
    rejected = true;
  }
  assert(rejected, "A resposta inválida do modelo deveria ter sido rejeitada.");
}

Deno.test("aceita consulta financeira estruturada", () => {
  const output = parseModelOutput({
    kind: "answer",
    intent: "financial_summary",
    message: "Seu saldo atual é R$ 100,00.",
    missing_fields: [],
    data: [],
  });
  assert(output.intent === "financial_summary", "Intent incorreta.");
});

Deno.test("aceita proposta, mas nunca confirmação pelo modelo", () => {
  const output = parseModelOutput({
    kind: "propose_action",
    intent: "create_account",
    message: "Preparei a criação para sua revisão.",
    missing_fields: [],
    data: [{ key: "name", value: "Conta principal" }],
  });
  assert(output.kind === "propose_action", "A escrita deve continuar sendo apenas proposta.");
});

Deno.test("rejeita campos extras e combinações incompatíveis", () => {
  assertRejected({
    kind: "answer", intent: "financial_summary", message: "Saldo.", missing_fields: [], data: [], sql: "delete"
  });
  assertRejected({
    kind: "answer", intent: "create_account", message: "Criada.", missing_fields: [], data: []
  });
  assertRejected({
    kind: "clarify", intent: "out_of_scope", message: "Diga mais.", missing_fields: ["name"], data: []
  });
  assertRejected({
    kind: "propose_action", intent: "create_account", message: "Confirme.", missing_fields: [], data: []
  });
});

Deno.test("rejeita rascunho duplicado ou campo desconhecido", () => {
  assertRejected({
    kind: "clarify",
    intent: "create_transaction",
    message: "Qual conta?",
    missing_fields: ["account_id", "account_id"],
    data: [],
  });
  assertRejected({
    kind: "propose_action",
    intent: "create_account",
    message: "Confirme.",
    missing_fields: [],
    data: [{ key: "name", value: "Conta" }, { key: "name", value: "Outra" }],
  });
});

Deno.test("explica falhas fechadas de compatibilidade legada", () => {
  assert(
    publicErrorMessage("AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL").includes("somente este item"),
    "Recorrência legada sem marcador deve bloquear escopo coletivo.",
  );
  assert(
    publicErrorMessage("AI_LEGACY_SERIES_AMBIGUOUS").includes("série antiga"),
    "Série legada ambígua deve orientar operação individual.",
  );
  assert(
    publicErrorMessage("AI_LEGACY_GOAL_AMBIGUOUS").includes("mais de um objetivo"),
    "Objetivo legado ambíguo deve explicar a colisão de nomes.",
  );
  assert(
    publicErrorMessage("AI_LEGACY_GOAL_TYPE_MISMATCH").includes("dados incompatíveis"),
    "Movimentação legada inconsistente deve ter mensagem segura.",
  );
});

Deno.test("explica o teto diário antiabuso sem confundir com a franquia", () => {
  const message = publicErrorMessage("AI_DAILY_SAFETY_LIMIT");
  assert(message.includes("muitas tentativas"), "O bloqueio precisa explicar a proteção.");
  assert(message.includes("amanhã"), "O bloqueio precisa informar quando tentar novamente.");
});

Deno.test("orienta nova prévia quando o recurso mudou antes da confirmação", () => {
  const message = publicErrorMessage("AI_ACTION_STATE_CHANGED");
  assert(message.includes("mudou desde a prévia"), "A mensagem deve explicar o conflito de estado.");
  assert(message.includes("Nenhuma alteração foi aplicada"), "A mensagem deve confirmar a falha fechada.");
  assert(message.includes("nova prévia"), "A mensagem deve orientar a regenerar a proposta.");
});

Deno.test("orienta a remover credenciais bancárias antes de reenviar", () => {
  const message = publicErrorMessage("AI_SENSITIVE_DATA_REJECTED");
  assert(message.includes("senhas"), "A orientação precisa mencionar senhas.");
  assert(message.includes("PINs"), "A orientação precisa mencionar PINs.");
  assert(message.includes("códigos bancários"), "A orientação precisa mencionar códigos bancários.");
});

Deno.test("cota de ação falha fechada antes e depois do modelo", () => {
  assert(hasRemainingActionQuota(-1), "Beta sem limite deve continuar permitido.");
  assert(hasRemainingActionQuota(1), "Uma ação restante deve ser permitida.");
  assert(!hasRemainingActionQuota(0), "Cota esgotada deve impedir proposta.");

  for (const invalid of [undefined, null, -2, 1.5, "inválido"]) {
    let rejected = false;
    try {
      hasRemainingActionQuota(invalid);
    } catch (error) {
      rejected = error instanceof Error && error.message === "AI_CONFIGURATION_FAILED";
    }
    assert(rejected, `Cota inválida deveria falhar fechada: ${String(invalid)}`);
  }
});
