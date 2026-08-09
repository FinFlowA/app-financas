import { MODEL_OUTPUT_FORMAT, parseModelOutput, type ConversationMessage, type ModelOutput } from "./contracts.ts";

type ProviderName = "openai" | "groq";

type ProviderConfig = {
  name: ProviderName;
  apiKey: string;
  model: string;
};

export type ProviderFailureMetadata = {
  provider: ProviderName;
  model: string;
  attempted: boolean;
};

class FinanceAiProviderError extends Error {
  readonly metadata: ProviderFailureMetadata;

  constructor(code: string, metadata: ProviderFailureMetadata) {
    super(code);
    this.name = "FinanceAiProviderError";
    this.metadata = metadata;
  }
}

export function providerFailureMetadata(error: unknown): ProviderFailureMetadata | null {
  return error instanceof FinanceAiProviderError ? error.metadata : null;
}

export function supportsStrictGroqSchema(model: string): boolean {
  return /^openai\/gpt-oss-(?:20b|120b)$/.test(model.trim());
}

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type ModelTokenBudget = {
  estimatedInputTokens: number;
  maxOutputTokens: number;
};

// O modelo Groq recomendado tem janela de 131.072 tokens. Estes dois caps,
// somados ao schema, ao envelope e ao teto de saída, mantêm até a pior
// entrada UTF-8 aceita abaixo dessa janela.
export const MODEL_MAX_SYSTEM_PROMPT_CHARS = 38_000;
export const MODEL_MAX_HISTORY_CHARS = 2_500;
export const MODEL_MAX_OUTPUT_TOKENS = 1_000;
// Um token BPE pode representar somente um byte. Portanto, bytes/1 é o teto
// conservador para texto arbitrário; bytes/3 subestimaria emoji, byte-fallback e
// outras entradas adversariais. O envelope abaixo cobre tokens especiais.
const TOKEN_ESTIMATE_BYTES_PER_TOKEN = 1;
const TOKEN_ESTIMATE_MARGIN = 256;
const MODEL_INPUT_ENVELOPE_BYTES = 4_096;
const MODEL_SCHEMA_BYTES = new TextEncoder().encode(JSON.stringify(MODEL_OUTPUT_FORMAT)).byteLength;
// Cada unidade UTF-16 válida ocupa no máximo três bytes em UTF-8 (pares
// substitutos ocupam quatro bytes para duas unidades). O schema e o envelope
// têm orçamento próprio. Esse teto cobre qualquer entrada aceita pelos caps.
export const MODEL_MAX_RESERVED_INPUT_TOKENS = Math.ceil((
  MODEL_MAX_SYSTEM_PROMPT_CHARS * 3
  + MODEL_MAX_HISTORY_CHARS * 3
  + MODEL_SCHEMA_BYTES
  + MODEL_INPUT_ENVELOPE_BYTES
) / TOKEN_ESTIMATE_BYTES_PER_TOKEN) + TOKEN_ESTIMATE_MARGIN;

function optionalSecret(name: string): string {
  return (Deno.env.get(name) ?? "").trim();
}

function providerConfig(): ProviderConfig {
  const requested = optionalSecret("FINFLOW_AI_PROVIDER").toLowerCase();
  if (requested && requested !== "groq" && requested !== "openai") {
    throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  }

  const hasOpenAiKey = Boolean(optionalSecret("OPENAI_API_KEY"));
  const hasGroqKey = Boolean(optionalSecret("GROQ_API_KEY"));
  if (!requested && hasOpenAiKey === hasGroqKey) {
    // Sem configuração explícita, só é seguro inferir quando há exatamente um
    // fornecedor disponível. Isso evita enviar dados ao provedor errado.
    throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  }
  const name: ProviderName = requested === "groq" || requested === "openai"
    ? requested
    : hasOpenAiKey
    ? "openai"
    : "groq";

  const apiKey = optionalSecret(name === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY");
  const model = optionalSecret(name === "openai" ? "FINFLOW_OPENAI_MODEL" : "FINFLOW_GROQ_MODEL");
  // O modelo é explícito para evitar troca silenciosa de preço, capacidade ou
  // garantia de schema quando o provedor altera defaults.
  if (!apiKey || !model || model.length > 120 || model.includes("\0")) {
    throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  }
  // A operação financeira depende de schema estrito. Não faça downgrade
  // silencioso para JSON mode ao trocar o modelo Groq por um incompatível.
  if (name === "groq" && !supportsStrictGroqSchema(model)) {
    throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  }
  return {
    name,
    apiKey,
    model,
  };
}

function safeJsonParse(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  if (trimmed.length > 20_000) throw new Error("INVALID_MODEL_OUTPUT");
  return JSON.parse(trimmed);
}

function tokenCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function validatedModelUsage(input: unknown, output: unknown): ModelUsage {
  const inputTokens = tokenCount(input);
  const outputTokens = tokenCount(output);
  // Uma resposta com conteúdo necessariamente consumiu entrada e saída. Sem
  // telemetria positiva não é seguro liberar a reserva máxima da chamada.
  if (inputTokens <= 0 || outputTokens <= 0) throw new Error("AI_PROVIDER_FAILED");
  return { inputTokens, outputTokens };
}

function extractOpenAiText(body: Record<string, unknown>): string {
  if (typeof body.output_text === "string") return body.output_text;
  if (!Array.isArray(body.output)) return "";
  for (const item of body.output) {
    if (!item || typeof item !== "object" || !Array.isArray((item as Record<string, unknown>).content)) continue;
    for (const content of (item as { content: unknown[] }).content) {
      if (content && typeof content === "object" && typeof (content as Record<string, unknown>).text === "string") {
        return (content as { text: string }).text;
      }
    }
  }
  return "";
}

async function fetchOnce(url: string, init: RequestInit): Promise<Response> {
  // Uma reserva corresponde exatamente a uma chamada externa. Nova tentativa
  // deve partir do usuário e gerar outra reserva auditável de RPM, TPM e custo.
  return await fetch(url, { ...init, signal: AbortSignal.timeout(25_000) });
}

function compactMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const selected: ConversationMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < 8; index -= 1) {
    const source = messages[index];
    const maximum = selected.length === 0 && source.role === "user" ? 1_500 : 800;
    const content = source.content.trim().slice(-maximum);
    if (!content) continue;
    if (used + content.length > MODEL_MAX_HISTORY_CHARS && selected.length > 0) break;
    selected.push({ role: source.role, content });
    used += content.length;
  }
  return selected.reverse();
}

export function estimateModelTokenBudget(
  systemPrompt: string,
  messages: ConversationMessage[],
): ModelTokenBudget {
  if (!systemPrompt || systemPrompt.length > MODEL_MAX_SYSTEM_PROMPT_CHARS) {
    throw new Error("AI_CONTEXT_TOO_LARGE");
  }
  const compactedMessages = compactMessages(messages);
  // Inclui também o schema estruturado, papéis e envelope que o provedor
  // tokeniza. UTF-8/1 + margem fixa permanece conservador mesmo para texto
  // adversarial, sem depender da distribuição média do português.
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(systemPrompt).byteLength
    + compactedMessages.reduce((total, message) => (
      total + encoder.encode(message.content).byteLength
    ), 0)
    + MODEL_SCHEMA_BYTES
    + MODEL_INPUT_ENVELOPE_BYTES;
  const estimatedInputTokens = Math.min(
    1_000_000_000,
    Math.max(
      1,
      Math.ceil(inputBytes / TOKEN_ESTIMATE_BYTES_PER_TOKEN) + TOKEN_ESTIMATE_MARGIN,
    ),
  );
  return { estimatedInputTokens, maxOutputTokens: MODEL_MAX_OUTPUT_TOKENS };
}

async function callOpenAi(
  config: ProviderConfig,
  systemPrompt: string,
  messages: ConversationMessage[],
  safetyIdentifier?: string,
): Promise<{ output: ModelOutput; usage: ModelUsage }> {
  const configuredEffort = optionalSecret("FINFLOW_OPENAI_REASONING_EFFORT").toLowerCase();
  const effort = ["none", "low", "medium"].includes(configuredEffort) ? configuredEffort : "low";
  const response = await fetchOnce("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      store: false,
      max_output_tokens: MODEL_MAX_OUTPUT_TOKENS,
      reasoning: { effort },
      ...(safetyIdentifier ? { safety_identifier: safetyIdentifier } : {}),
      input: [
        { role: "system", content: [{ type: "input_text", text: systemPrompt }] },
        ...messages.map((message) => ({
          role: message.role,
          content: [{ type: "input_text", text: message.content }],
        })),
      ],
      text: { format: MODEL_OUTPUT_FORMAT },
    }),
  });

  if (response.status === 429) throw new Error("AI_PROVIDER_RATE_LIMITED");
  if (!response.ok) {
    console.error("finance-ai provider", config.name, response.status);
    throw new Error("AI_PROVIDER_FAILED");
  }
  const body = await response.json() as Record<string, unknown>;
  const content = extractOpenAiText(body);
  if (!content) throw new Error("AI_PROVIDER_FAILED");
  const usage = body.usage && typeof body.usage === "object"
    ? body.usage as Record<string, unknown>
    : {};
  return {
    output: parseModelOutput(safeJsonParse(content)),
    usage: validatedModelUsage(usage.input_tokens, usage.output_tokens),
  };
}

async function callGroq(
  config: ProviderConfig,
  systemPrompt: string,
  messages: ConversationMessage[],
): Promise<{ output: ModelOutput; usage: ModelUsage }> {
  const configuredEffort = optionalSecret("FINFLOW_GROQ_REASONING_EFFORT").toLowerCase();
  const reasoningEffort = ["low", "medium", "high"].includes(configuredEffort)
    ? configuredEffort
    : "low";
  const response = await fetchOnce("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      temperature: 0.1,
      max_tokens: MODEL_MAX_OUTPUT_TOKENS,
      reasoning_effort: reasoningEffort,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: MODEL_OUTPUT_FORMAT.name,
          strict: true,
          schema: MODEL_OUTPUT_FORMAT.schema,
        },
      },
    }),
  });

  if (response.status === 429) throw new Error("AI_PROVIDER_RATE_LIMITED");
  if (!response.ok) {
    console.error("finance-ai provider", config.name, response.status);
    throw new Error("AI_PROVIDER_FAILED");
  }
  const body = await response.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("AI_PROVIDER_FAILED");
  return {
    output: parseModelOutput(safeJsonParse(content)),
    usage: validatedModelUsage(body.usage?.prompt_tokens, body.usage?.completion_tokens),
  };
}

export async function requestModel(
  systemPrompt: string,
  messages: ConversationMessage[],
  safetyIdentifier?: string,
): Promise<{ output: ModelOutput; provider: ProviderName; model: string; usage: ModelUsage }> {
  if (!systemPrompt || systemPrompt.length > MODEL_MAX_SYSTEM_PROMPT_CHARS) throw new Error("AI_CONTEXT_TOO_LARGE");
  const config = providerConfig();
  const compactedMessages = compactMessages(messages);
  try {
    const result = config.name === "openai"
      ? await callOpenAi(config, systemPrompt, compactedMessages, safetyIdentifier)
      : await callGroq(config, systemPrompt, compactedMessages);
    return { ...result, provider: config.name, model: config.model };
  } catch (error) {
    const rawCode = error instanceof Error ? error.message : "AI_PROVIDER_FAILED";
    const code = /^AI_[A-Z0-9_]+$/.test(rawCode) ? rawCode : "AI_PROVIDER_FAILED";
    throw new FinanceAiProviderError(code, {
      provider: config.name,
      model: config.model,
      attempted: true,
    });
  }
}
