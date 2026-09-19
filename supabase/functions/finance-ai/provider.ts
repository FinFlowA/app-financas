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

// O rollout atual usa o limite de 8 mil tokens/minuto da Groq. O request precisa
// caber inteiro nesse teto (entrada + teto de saída), mesmo na primeira chamada.
export const GROQ_COMPATIBLE_TPM_LIMIT = 8_000;
// O contrato operacional completo + o contexto financeiro compactado ocupa
// cerca de 16,5 mil caracteres. O teto de tokens abaixo continua sendo a
// fronteira real de custo; reduzimos o histórico para manter a mesma reserva.
export const MODEL_MAX_SYSTEM_PROMPT_CHARS = 16_600;
export const MODEL_MAX_HISTORY_CHARS = 400;
// Modelos com raciocínio contabilizam os tokens internos dentro do teto de
// conclusão. 512 podia encerrar o JSON estruturado no meio até em comandos
// curtos (por exemplo, "Gastei 70 reais em um lanche"). Subir esse teto ainda
// mais reduziria a reserva de entrada (ver teste do pior caso abaixo) sem
// eliminar o risco — um modelo com raciocínio pode "hesitar" por tempo
// variável e imprevisível. Em vez de perseguir um teto que nunca é garantido,
// `parsedOrNaturalFallback` cobre esse caso com uma resposta segura.
export const MODEL_MAX_OUTPUT_TOKENS = 576;
export const MODEL_PROVIDER_SAFETY_TOKENS = 448;
// Medida conservadora para o prompt pt-BR/JSON do FinFlow, validada contra a
// contagem retornada pelo GPT-OSS. Entradas UTF-8 atípicas continuam protegidas
// pela medição em bytes e pelo teto verificado antes de qualquer fetch.
const TOKEN_ESTIMATE_BYTES_PER_TOKEN = 3;
const TOKEN_ESTIMATE_MARGIN = 256;
const MODEL_INPUT_ENVELOPE_BYTES = 768;
const MODEL_SCHEMA_BYTES = new TextEncoder().encode(JSON.stringify(MODEL_OUTPUT_FORMAT)).byteLength;
export const MODEL_MAX_RESERVED_INPUT_TOKENS = GROQ_COMPATIBLE_TPM_LIMIT
  - MODEL_MAX_OUTPUT_TOKENS
  - MODEL_PROVIDER_SAFETY_TOKENS;

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
  if (trimmed.length > 20_000) throw new Error("AI_PROVIDER_RESPONSE_INVALID");
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error("AI_PROVIDER_RESPONSE_INVALID");
  }
}

function parseProviderOutput(content: string): ModelOutput {
  try {
    return parseModelOutput(safeJsonParse(content));
  } catch (error) {
    if (error instanceof Error && error.message === "AI_PROVIDER_RESPONSE_INVALID") throw error;
    throw new Error("AI_PROVIDER_RESPONSE_INVALID");
  }
}

// Se o provedor consumir a janela de conclusão antes de fechar o JSON, comandos
// cotidianos de lançamento ainda devem entrar no fluxo seguro de perguntas. O
// fallback apenas extrai fatos literais e nunca escolhe conta, categoria, data,
// frequência ou status, nem cria uma proposta executável.
export function fallbackNaturalTransaction(message: string): ModelOutput | null {
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const expense = /\b(gastei|paguei|comprei|despesa)\b/.test(normalized);
  const income = /\b(recebi|ganhei|entrou|receita)\b/.test(normalized);
  if (expense === income) return null;
  const amountRaw = message.match(/r\$\s*([\d.]+(?:,\d{1,2})?)/i)?.[1]
    ?? message.match(/\b([\d.]+(?:,\d{1,2})?)\s*(?:reais|real)\b/i)?.[1];
  if (!amountRaw) return null;
  const compact = amountRaw.replace(/\./g, "").replace(",", ".");
  const amount = Number(compact);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const tail = message.match(/(?:r\$\s*[\d.]+(?:,\d{1,2})?|[\d.]+(?:,\d{1,2})?\s*(?:reais|real))\s+(?:em|com|de)\s+(.+)$/i)?.[1]
    ?.replace(/^(?:um|uma)\s+/i, "").trim();
  const data = [
    { key: "type" as const, value: expense ? "despesa" : "receita" },
    { key: "value" as const, value: String(amount) },
    ...(tail && tail.length >= 2 ? [{ key: "description" as const, value: tail }] : []),
  ];
  return {
    kind: "clarify",
    intent: "create_transaction",
    message: "Esse lançamento é único, parcelado, semanal, mensal ou anual?",
    missing_fields: ["frequency"],
    data,
  };
}

export function fallbackProductGuidance(message: string): ModelOutput | null {
  const normalized = message.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const asksHow = /\b(como|onde|qual (?:e|seria) a forma)\b/.test(normalized);
  if (!asksHow) return null;

  const guidance: ReadonlyArray<readonly [RegExp, string]> = [
    [
      /\b(criar|cadastrar|adicionar|lanco|lancar|registro|registrar)\b.*\b(receita|despesa|lancamento)\b|\b(receita|despesa|lancamento)\b.*\b(criar|cadastrar|adicionar|lanco|lancar|registro|registrar)\b/,
      "Para registrar uma receita ou despesa, abra Histórico e selecione Novo lançamento. Escolha o tipo, preencha descrição, valor, conta, categoria e data, revise e salve. Se preferir, diga diretamente o que aconteceu e eu preparo o lançamento para sua confirmação.",
    ],
    [
      /\b(criar|cadastrar|adicionar|abrir)\b.*\bconta\b|\bconta\b.*\b(criar|cadastrar|adicionar|abrir)\b/,
      "Para criar uma conta, abra Contas e selecione Nova conta. Informe o nome, o saldo inicial e a cor; depois revise os dados e salve. Se preferir, também posso preparar a criação por aqui: diga o nome da conta e eu pedirei somente as informações que faltarem.",
    ],
    [
      /\b(criar|cadastrar|adicionar)\b.*\bcategoria\b|\bcategoria\b.*\b(criar|cadastrar|adicionar)\b/,
      "Para criar uma categoria, abra Categorias e selecione Nova categoria. Escolha se ela é de receita ou despesa, informe o nome, a cor e o ícone e salve. Também posso preparar essa criação por aqui.",
    ],
    [
      /\b(criar|cadastrar|adicionar)\b.*\b(objetivo|meta|caixinha)\b|\b(objetivo|meta|caixinha)\b.*\b(criar|cadastrar|adicionar)\b/,
      "Para criar um objetivo, abra Objetivos e selecione Novo objetivo. Informe o nome e o valor da meta; a data é opcional. Depois você poderá guardar ou resgatar valores pela própria tela.",
    ],
    [
      /\b(criar|cadastrar|adicionar)\b.*\bcartao\b|\bcartao\b.*\b(criar|cadastrar|adicionar)\b/,
      "Para cadastrar um cartão, abra Cartões e selecione Novo cartão. Informe o nome, o limite e os dias de fechamento e vencimento, revise e salve.",
    ],
  ];
  const match = guidance.find(([pattern]) => pattern.test(normalized));
  if (!match) return null;
  return {
    kind: "answer",
    intent: "explain_financial_control",
    message: match[1],
    missing_fields: [],
    data: [],
  };
}

// Último recurso quando nem o schema estrito nem os atalhos literais acima
// resolvem: modelos com raciocínio podem consumir todo o teto de saída
// pensando e não deixar espaço para fechar o JSON (comum em mensagens curtas
// e fora de escopo, que levam o modelo a "hesitar" antes de responder). Uma
// pessoa que só mandou um "oi" ou uma pergunta fora do FinFlow não deveria
// ver um erro técnico por isso — ela só precisa poder tentar de novo. Nunca
// propõe nem executa nada: kind=out_of_scope não pode carregar uma ação.
function genericSafeFallback(): ModelOutput {
  return {
    kind: "out_of_scope",
    intent: "out_of_scope",
    message: "Não consegui organizar minha resposta agora. Pode repetir ou reformular sua mensagem?",
    missing_fields: [],
    data: [],
  };
}

export function parsedOrNaturalFallback(content: string | undefined, messages: ConversationMessage[]): ModelOutput {
  if (content) {
    try {
      return parseProviderOutput(content);
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "AI_PROVIDER_RESPONSE_INVALID") throw error;
    }
  }
  const lastMessage = messages.at(-1)?.content ?? "";
  const fallback = fallbackNaturalTransaction(lastMessage) ?? fallbackProductGuidance(lastMessage);
  return fallback ?? genericSafeFallback();
}

export type ProviderHttpFailure = {
  code: string;
  category: "request_too_large" | "rate_limited" | "authentication" | "invalid_request" | "upstream_unavailable" | "unexpected";
};

export function classifyProviderHttpFailure(status: number): ProviderHttpFailure {
  if (status === 413) return { code: "AI_PROVIDER_REQUEST_TOO_LARGE", category: "request_too_large" };
  if (status === 429) return { code: "AI_PROVIDER_RATE_LIMITED", category: "rate_limited" };
  if (status === 401 || status === 403) return { code: "AI_PROVIDER_AUTH_FAILED", category: "authentication" };
  if (status >= 400 && status < 500) return { code: "AI_PROVIDER_REQUEST_INVALID", category: "invalid_request" };
  if (status >= 500) return { code: "AI_PROVIDER_UNAVAILABLE", category: "upstream_unavailable" };
  return { code: "AI_PROVIDER_FAILED", category: "unexpected" };
}

function throwProviderHttpFailure(provider: ProviderName, status: number): never {
  const failure = classifyProviderHttpFailure(status);
  // Não registre corpo, headers, prompt nem resposta do provedor: eles podem
  // conter dados financeiros ou detalhes da credencial. Status/categoria bastam.
  console.error("finance-ai provider failure", JSON.stringify({
    provider,
    status,
    category: failure.category,
  }));
  throw new Error(failure.code);
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
  if (inputTokens <= 0 || outputTokens <= 0) throw new Error("AI_PROVIDER_USAGE_INVALID");
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

export function compactMessages(messages: ConversationMessage[]): ConversationMessage[] {
  const selected: ConversationMessage[] = [];
  let used = 0;
  for (let index = messages.length - 1; index >= 0 && selected.length < 4; index -= 1) {
    const source = messages[index];
    const maximum = selected.length === 0 && source.role === "user" ? 500 : 300;
    const trimmed = source.content.trim();
    // Resposta do assistente: mantém o início, onde o tema é apresentado —
    // um fragmento cortado no meio de uma frase final (ex.: só a conclusão
    // de uma explicação de investimentos, sem a frase que diz do que se
    // trata) deixava o histórico confuso e podia levar o modelo a classificar
    // mal a pergunta seguinte. Mensagem do usuário: mantém o fim, onde
    // normalmente estão os detalhes concretos (valor, data etc.) de um pedido.
    const content = source.role === "assistant" ? trimmed.slice(0, maximum) : trimmed.slice(-maximum);
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
  if (estimatedInputTokens > MODEL_MAX_RESERVED_INPUT_TOKENS) {
    throw new Error("AI_CONTEXT_TOO_LARGE");
  }
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

  if (!response.ok) throwProviderHttpFailure(config.name, response.status);
  const body = await response.json() as Record<string, unknown>;
  const content = extractOpenAiText(body);
  const usage = body.usage && typeof body.usage === "object"
    ? body.usage as Record<string, unknown>
    : {};
  return {
    output: parsedOrNaturalFallback(content, messages),
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
      max_completion_tokens: MODEL_MAX_OUTPUT_TOKENS,
      reasoning_effort: reasoningEffort,
      include_reasoning: false,
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

  if (!response.ok) throwProviderHttpFailure(config.name, response.status);
  const body = await response.json() as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content;
  return {
    output: parsedOrNaturalFallback(content, messages),
    usage: validatedModelUsage(body.usage?.prompt_tokens, body.usage?.completion_tokens),
  };
}

export async function requestModel(
  systemPrompt: string,
  messages: ConversationMessage[],
  safetyIdentifier?: string,
): Promise<{ output: ModelOutput; provider: ProviderName; model: string; usage: ModelUsage }> {
  estimateModelTokenBudget(systemPrompt, messages);
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
