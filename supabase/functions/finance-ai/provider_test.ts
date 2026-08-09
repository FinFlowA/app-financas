import { buildSystemPrompt } from "./prompt.ts";
import {
  estimateModelTokenBudget,
  MODEL_MAX_OUTPUT_TOKENS,
  MODEL_MAX_RESERVED_INPUT_TOKENS,
  MODEL_MAX_SYSTEM_PROMPT_CHARS,
  supportsStrictGroqSchema,
  validatedModelUsage,
} from "./provider.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("orçamento conservador permite uma consulta financeira curta no beta", () => {
  const prompt = buildSystemPrompt({
    financialContext: JSON.stringify({
      summary: { balance: 0, income: 0, expenses: 0 },
      dataset_complete: true,
    }),
    conversationState: {},
    analyticsAllowed: false,
  });
  const budget = estimateModelTokenBudget(prompt, [
    { role: "user", content: "Qual é meu saldo atual?" },
  ]);

  assert(budget.estimatedInputTokens > 0, "a entrada precisa reservar tokens");
  assert(budget.maxOutputTokens === MODEL_MAX_OUTPUT_TOKENS, "a saída deve usar o teto real do provedor");
  assert(
    budget.estimatedInputTokens <= MODEL_MAX_RESERVED_INPUT_TOKENS,
    "uma consulta curta precisa caber no pré-orçamento",
  );
});

Deno.test("orçamento inclui schema, histórico e contexto amplo", () => {
  const short = estimateModelTokenBudget("instruções", [
    { role: "user", content: "Mostre meu saldo." },
  ]);
  const large = estimateModelTokenBudget(`instruções\n${"x".repeat(30_000)}`, [
    { role: "assistant", content: "a".repeat(2_000) },
    { role: "user", content: "Compare minhas despesas." },
  ]);

  assert(large.estimatedInputTokens > short.estimatedInputTokens, "contexto maior deve reservar mais tokens");
  assert(large.maxOutputTokens === short.maxOutputTokens, "o teto de saída deve ser estável");
});

Deno.test("qualquer entrada aceita pelos caps cabe no pré-orçamento", () => {
  const threeByteCharacter = "\uFFFF";
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? "assistant" as const : "user" as const,
    content: threeByteCharacter.repeat(2_000),
  }));
  const worstAccepted = estimateModelTokenBudget(
    threeByteCharacter.repeat(MODEL_MAX_SYSTEM_PROMPT_CHARS),
    history,
  );

  assert(
    worstAccepted.estimatedInputTokens <= MODEL_MAX_RESERVED_INPUT_TOKENS,
    "o pré-orçamento precisa cobrir o pior prompt e histórico aceitos",
  );
  assert(
    MODEL_MAX_RESERVED_INPUT_TOKENS >= 125_000 && MODEL_MAX_RESERVED_INPUT_TOKENS <= 130_000,
    "o teto derivado deve permanecer abaixo da janela de 131 mil tokens",
  );
  assert(
    MODEL_MAX_RESERVED_INPUT_TOKENS + MODEL_MAX_OUTPUT_TOKENS < 131_072,
    "entrada e saída máximas precisam caber na janela do modelo recomendado",
  );
});

Deno.test("orçamento não subestima byte-fallback nem texto adversarial", () => {
  const adversarial = `${"\uFFFF".repeat(4_000)}${"~".repeat(4_000)}`;
  const budget = estimateModelTokenBudget(adversarial, [
    { role: "user", content: "\u{1F4B3}".repeat(400) },
  ]);
  const acceptedPromptBytes = new TextEncoder().encode(adversarial).byteLength;

  assert(
    budget.estimatedInputTokens > acceptedPromptBytes,
    "a reserva precisa ser ao menos o total de bytes mais o envelope",
  );
});

Deno.test("uso ausente ou zerado nunca libera a reserva do provedor", () => {
  const valid = validatedModelUsage(321, 45);
  assert(valid.inputTokens === 321 && valid.outputTokens === 45, "uso positivo deve ser aceito");

  for (const [input, output] of [[undefined, undefined], [0, 10], [10, 0], ["inválido", 10]]) {
    let rejected = false;
    try {
      validatedModelUsage(input, output);
    } catch (error) {
      rejected = error instanceof Error && error.message === "AI_PROVIDER_FAILED";
    }
    assert(rejected, `uso inválido deveria ser rejeitado: ${String(input)}/${String(output)}`);
  }
});

Deno.test("Groq só aceita modelos com Structured Outputs estrito", () => {
  assert(supportsStrictGroqSchema("openai/gpt-oss-120b"), "GPT OSS 120B deve ser aceito.");
  assert(supportsStrictGroqSchema("openai/gpt-oss-20b"), "GPT OSS 20B deve ser aceito.");
  assert(!supportsStrictGroqSchema("llama-3.3-70b-versatile"), "JSON mode não pode substituir schema estrito silenciosamente.");
});
