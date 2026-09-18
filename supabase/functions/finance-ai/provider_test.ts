import { buildSystemPrompt } from "./prompt.ts";
import {
  classifyProviderHttpFailure,
  estimateModelTokenBudget,
  fallbackProductGuidance,
  fallbackNaturalTransaction,
  GROQ_COMPATIBLE_TPM_LIMIT,
  MODEL_MAX_OUTPUT_TOKENS,
  MODEL_MAX_RESERVED_INPUT_TOKENS,
  MODEL_MAX_SYSTEM_PROMPT_CHARS,
  MODEL_PROVIDER_SAFETY_TOKENS,
  parsedOrNaturalFallback,
  supportsStrictGroqSchema,
  validatedModelUsage,
} from "./provider.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("falha de JSON preserva comando natural como rascunho seguro", () => {
  const output = fallbackNaturalTransaction("Gastei 70 reais em um lanche");
  assert(output?.kind === "clarify" && output.intent === "create_transaction", "deveria iniciar lançamento");
  assert(output.data.some((field) => field.key === "type" && field.value === "despesa"), "tipo literal ausente");
  assert(output.data.some((field) => field.key === "value" && field.value === "70"), "valor literal ausente");
  assert(output.data.some((field) => field.key === "description" && field.value === "lanche"), "descrição literal ausente");
  assert(!output.data.some((field) => ["account_id", "category_id", "frequency", "status"].includes(field.key)), "fallback não pode inventar escolhas");
});

Deno.test("frase analitica sobre gasto nao vira comando de lancamento", () => {
  assert(fallbackNaturalTransaction("Quanto gastei com lanche este mês?") === null, "pergunta não pode iniciar escrita");
});

Deno.test("falha de JSON ainda responde orientacao simples do produto", () => {
  const output = fallbackProductGuidance("Como criar uma conta?");
  assert(output?.kind === "answer", "orientacao deve produzir uma resposta segura");
  assert(output.intent === "explain_financial_control", "orientacao deve permanecer no escopo financeiro");
  assert(output.message.includes("Contas") && output.message.includes("Nova conta"), "resposta deve indicar o caminho visivel");
  assert(output.data.length === 0 && output.missing_fields.length === 0, "orientacao nunca deve iniciar uma escrita");

  const transactionHelp = fallbackProductGuidance("Como eu lanço uma receita?");
  assert(transactionHelp?.kind === "answer", "pergunta sobre como lançar deve receber orientação");
  assert(transactionHelp.message.includes("Histórico") && transactionHelp.message.includes("Novo lançamento"), "orientação deve indicar o fluxo de lançamento");
});

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

Deno.test("comando natural de criação cabe no contrato operacional completo", () => {
  const prompt = buildSystemPrompt({
    financialContext: JSON.stringify({ context: "x".repeat(3_900) }),
    conversationState: {},
    analyticsAllowed: false,
    outputCanary: "7f41f60a7f41f60a7f41f60a7f41f60a",
  });
  const budget = estimateModelTokenBudget(prompt, [{
    role: "user",
    content: "Crie uma despesa de 50 reais de almoço para hoje",
  }]);
  assert(budget.estimatedInputTokens <= MODEL_MAX_RESERVED_INPUT_TOKENS, "comando natural deve caber no teto real");
});

Deno.test("orçamento inclui schema, histórico e contexto amplo", () => {
  const short = estimateModelTokenBudget("instruções", [
    { role: "user", content: "Mostre meu saldo." },
  ]);
  const large = estimateModelTokenBudget(`instruções\n${"x".repeat(10_000)}`, [
    { role: "assistant", content: "a".repeat(2_000) },
    { role: "user", content: "Compare minhas despesas." },
  ]);

  assert(large.estimatedInputTokens > short.estimatedInputTokens, "contexto maior deve reservar mais tokens");
  assert(large.maxOutputTokens === short.maxOutputTokens, "o teto de saída deve ser estável");
});

Deno.test("pior request aceito preserva margem dentro dos 8K TPM", () => {
  const history = Array.from({ length: 8 }, (_, index) => ({
    role: index % 2 === 0 ? "assistant" as const : "user" as const,
    content: "h".repeat(2_000),
  }));
  const worstAccepted = estimateModelTokenBudget(
    "p".repeat(MODEL_MAX_SYSTEM_PROMPT_CHARS),
    history,
  );

  assert(
    worstAccepted.estimatedInputTokens <= MODEL_MAX_RESERVED_INPUT_TOKENS,
    "o pré-orçamento precisa cobrir o pior prompt e histórico aceitos",
  );
  assert(
    MODEL_MAX_RESERVED_INPUT_TOKENS + MODEL_MAX_OUTPUT_TOKENS + MODEL_PROVIDER_SAFETY_TOKENS
      === GROQ_COMPATIBLE_TPM_LIMIT,
    "entrada, saída e margem precisam ocupar exatamente o orçamento compatível",
  );
  assert(
    worstAccepted.estimatedInputTokens + MODEL_MAX_OUTPUT_TOKENS + MODEL_PROVIDER_SAFETY_TOKENS
      <= GROQ_COMPATIBLE_TPM_LIMIT,
    "o pior request aceito precisa permanecer abaixo de 8 mil tokens",
  );
});

Deno.test("texto multibyte adversarial que excede o orçamento falha antes do fetch", () => {
  let rejected = false;
  try {
    estimateModelTokenBudget("\uFFFF".repeat(8_000), [
      { role: "user", content: "\u{1F4B3}".repeat(400) },
    ]);
  } catch (error) {
    rejected = error instanceof Error && error.message === "AI_CONTEXT_TOO_LARGE";
  }
  assert(rejected, "entrada multibyte excessiva precisa ser recusada localmente");
});

Deno.test("uso ausente ou zerado nunca libera a reserva do provedor", () => {
  const valid = validatedModelUsage(321, 45);
  assert(valid.inputTokens === 321 && valid.outputTokens === 45, "uso positivo deve ser aceito");

  for (const [input, output] of [[undefined, undefined], [0, 10], [10, 0], ["inválido", 10]]) {
    let rejected = false;
    try {
      validatedModelUsage(input, output);
    } catch (error) {
      rejected = error instanceof Error && error.message === "AI_PROVIDER_USAGE_INVALID";
    }
    assert(rejected, `uso inválido deveria ser rejeitado: ${String(input)}/${String(output)}`);
  }
});

Deno.test("Groq só aceita modelos com Structured Outputs estrito", () => {
  assert(supportsStrictGroqSchema("openai/gpt-oss-120b"), "GPT OSS 120B deve ser aceito.");
  assert(supportsStrictGroqSchema("openai/gpt-oss-20b"), "GPT OSS 20B deve ser aceito.");
  assert(!supportsStrictGroqSchema("llama-3.3-70b-versatile"), "JSON mode não pode substituir schema estrito silenciosamente.");
});

Deno.test("saida sem JSON valido e fora de escopo cai numa resposta segura, nunca num erro tecnico", () => {
  const messages = [{ role: "user" as const, content: "Que horas são agora?" }];

  const withoutContent = parsedOrNaturalFallback(undefined, messages);
  assert(withoutContent.kind === "out_of_scope" && withoutContent.intent === "out_of_scope", "sem conteudo deve virar resposta segura fora de escopo");
  assert(withoutContent.data.length === 0 && withoutContent.missing_fields.length === 0, "fallback generico nunca inicia escrita nem pede campo");
  assert(withoutContent.message.trim().length > 0, "fallback generico precisa responder algo à pessoa");

  const truncatedJson = parsedOrNaturalFallback('{"kind":"answer","intent":"casual_con', messages);
  assert(truncatedJson.kind === "out_of_scope", "JSON truncado por raciocinio tambem cai no fallback seguro");

  const notJson = parsedOrNaturalFallback("Desculpe, não tenho acesso à hora atual.", messages);
  assert(notJson.kind === "out_of_scope", "texto livre do modelo (sem JSON) tambem cai no fallback seguro");
});

Deno.test("fallback generico so entra quando os atalhos literais nao resolvem", () => {
  const expense = parsedOrNaturalFallback(undefined, [{ role: "user", content: "Gastei 70 reais em um lanche" }]);
  assert(expense.kind === "clarify" && expense.intent === "create_transaction", "comando literal de despesa continua tendo prioridade sobre o fallback generico");

  const guidance = parsedOrNaturalFallback(undefined, [{ role: "user", content: "Como criar uma conta?" }]);
  assert(guidance.kind === "answer" && guidance.intent === "explain_financial_control", "orientacao de produto continua tendo prioridade sobre o fallback generico");
});

Deno.test("falhas HTTP do provedor são classificadas sem ler corpo sensível", () => {
  assert(classifyProviderHttpFailure(413).code === "AI_PROVIDER_REQUEST_TOO_LARGE", "413 precisa ser específico");
  assert(classifyProviderHttpFailure(413).category === "request_too_large", "categoria 413 incorreta");
  assert(classifyProviderHttpFailure(429).code === "AI_PROVIDER_RATE_LIMITED", "429 precisa preservar rate limit");
  assert(classifyProviderHttpFailure(401).code === "AI_PROVIDER_AUTH_FAILED", "401 precisa identificar autenticacao sem expor a chave");
  assert(classifyProviderHttpFailure(400).code === "AI_PROVIDER_REQUEST_INVALID", "400 precisa identificar contrato invalido");
  assert(classifyProviderHttpFailure(503).code === "AI_PROVIDER_UNAVAILABLE", "5xx precisa identificar indisponibilidade");
});
