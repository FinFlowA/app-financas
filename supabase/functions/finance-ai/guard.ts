/* eslint-disable security/detect-non-literal-regexp, security/detect-unsafe-regex, security/detect-object-injection -- expressões são constantes internas; mensagens são limitadas antes da avaliação */

const MAX_MESSAGE_CHARS = 2_000;
const REDACTED = "[DADO_SENSIVEL_REMOVIDO]";
const REDACTED_INTERNAL_ID = "[IDENTIFICADOR_INTERNO_REMOVIDO]";

const SECRET_PATTERN = /(sb_secret_|service_role[^\s]{0,8}[=:]|gsk_[A-Za-z0-9_-]{20,}|xkeysib-[A-Za-z0-9_-]{20,}|\bxai-[A-Za-z0-9_-]{20,}|\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}|\bAIza[A-Za-z0-9_-]{20,}|authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/=-]{20,}|\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})/i;
const CREDENTIAL_LABEL = String.raw`(?:senha(?:\s+(?:banc[aá]ria|do\s+banco|da\s+conta|do\s+cart[aã]o|do\s+app))?|password|pin(?:\s+(?:banc[aá]rio|do\s+banco|da\s+conta|do\s+cart[aã]o|do\s+app))?|c[oó]digo\s+(?:banc[aá]rio|de\s+(?:acesso|seguran[cç]a|verifica[cç][aã]o|autentica[cç][aã]o)|do\s+(?:app|cart[aã]o|internet\s+banking)))`;
const CREDENTIAL_VALUE = String.raw`(?:"[^"\r\n]{3,128}"|'[^'\r\n]{3,128}'|[^\s,;]{3,128})`;
const LABELED_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b${CREDENTIAL_LABEL}\s*(?:(?:[ée]|eh)\s+|[:=]\s*)${CREDENTIAL_VALUE}`,
  "i",
);
const POSSESSIVE_CREDENTIAL_PATTERN = new RegExp(
  String.raw`\b(?:minha|meu)\s+${CREDENTIAL_LABEL}\s+(?:(?:[ée]|eh)\s+)?${CREDENTIAL_VALUE}`,
  "i",
);
const LABELED_CREDENTIAL_REDACTION_PATTERN = new RegExp(
  String.raw`\b${CREDENTIAL_LABEL}\s*(?:(?:[ée]|eh)\s+|[:=]\s*)(?:"[^"\r\n]{3,128}"|'[^'\r\n]{3,128}'|[^\r\n,;]{3,128})`,
  "gi",
);
const POSSESSIVE_CREDENTIAL_REDACTION_PATTERN = new RegExp(
  String.raw`\b(?:minha|meu)\s+${CREDENTIAL_LABEL}\s+(?:(?:[ée]|eh)\s+)?(?:"[^"\r\n]{3,128}"|'[^'\r\n]{3,128}'|[^\r\n,;]{3,128})`,
  "gi",
);
const FINANCIAL_TOPIC_PATTERN = /(financ|dinheir|saldo|conta|receit|despes|gast|renda|orcament|balanco|resultado|fluxo|caixa|lanc|transa|transfer|categoria|objetiv|caixinha|cartao|fatura|compra|parcela|pag|receb|pendente|atras|venc|juros|desconto|econom|poup|meta|histor|extrato|realiz|agend|planej|previs|projec|resgat|retir|saqu|aporte|deposit|guard)/;
const IMPLICIT_FINANCIAL_PROJECTION_PATTERN = /\b(?:quanto|qual(?:\s+valor)?)\b.{0,35}\b(?:terei|vou\s+ter|vai\s+sobrar|sobrara|ficara)\b.{0,45}\b(?:fim\s+do\s+(?:mes|ano)|final\s+do\s+ano|proximo\s+mes|mes\s+que\s+vem|em\s+(?:janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))\b/;
const FORBIDDEN_ACCESS_PATTERN = /(senha|password|biometri|login|email|e-mail|telefone|celular|sms|codigo de verificacao|autenticacao|parceria|vinculo|assinatura|plano).{0,45}(alter|editar|trocar|mudar|excluir|remover|recuper|confirm|criar|cancel)|(?:alter|editar|trocar|mudar|excluir|remover|recuper|confirm|criar|cancel).{0,45}(senha|password|biometri|login|email|e-mail|telefone|celular|sms|autenticacao|parceria|vinculo|assinatura)/;
const PROMPT_INJECTION_PATTERN = /(ignore|ignorar|esqueca|esqueça|desconsidere|burlar|contorne|bypass|jailbreak|dan mode).{0,55}(instruc|regra|prompt|sistema|system|developer|seguranc)|(?:revele|mostre|repita|imprima|exponha).{0,55}(prompt|instruc|segredo|chave|token|system|developer)|(?:finja|aja|atue).{0,30}(como|ser).{0,35}(assistente sem regra|dan|outro sistema)/;
const OUTSIDE_TOPIC_PATTERN = /(conte|conta|contar|faca|faça|escreva|gere|crie).{0,24}(piada|poema|curiosidade|historia ficticia|história fictícia|receita culinaria|receita culinária|codigo fonte|código fonte|programa|software)|(?:resultado|placar|noticia|notícia|previsao|previsão|opine|explique|quem ganhou|quem vence).{0,35}(clima|tempo|futebol|campeonato|eleicao|eleição|politica|política)|(?:diagnostique|prescreva|recomende tratamento|interprete exame|aconselhamento juridico|aconselhamento jurídico|redija peticao|redija petição)|\b(capital da|geografia)\b|(?:qual|indique|recomende).{0,35}(acao para comprar|ação para comprar|criptomoeda|aposta|bet)/;
const STRUCTURED_INJECTION_PATTERN = /(?:^|[\s{[,(])(?:system|developer|assistant|tool)\s*(?:role|message|prompt)?\s*[:=]|(?:base64|rot13|unicode|hexadecimal).{0,40}(?:prompt|instruc|regra|system|developer)|(?:prompt|instruc|regra|system|developer).{0,40}(?:base64|rot13|unicode|hexadecimal)/;
const ADDITIONAL_PROMPT_INJECTION_PATTERN = /(?:desobedeca|viole|quebre|substitua|anule).{0,70}(?:politic|regra|instruc|seguranc|sistema|system|developer)|(?:copie|reproduza|parafraseie|resuma|vaze|extraia).{0,70}(?:mensagem|texto|instruc|prompt).{0,35}(?:sistema|system|inicial|developer)|(?:mensagem|texto|instruc|prompt).{0,35}(?:sistema|system|inicial|developer).{0,70}(?:copie|reproduza|parafraseie|resuma|vaze|extraia)/;
const INTERNAL_PROMPT_MARKER_PATTERN = /\b(?:finflow_data(?:_untrusted_json)?|conversation_state(?:_untrusted_json)?|internal_output_canary|mensagem (?:do )?sistema|texto (?:do )?sistema|instrucoes? (?:do )?sistema)\b/;
const GENERAL_REQUEST_START = String.raw`(?:quem|onde|quando|qual|quais|o\s+que|por\s+que|porque|como|explique|resuma|traduza|pesquise|conte|(?:me\s+)?diga|responda|fale|escreva|gere|invente)`;
const GENERAL_REQUEST_PATTERN = new RegExp(String.raw`(?:^|\b)${GENERAL_REQUEST_START}\b`);
const MIXED_REQUEST_BOUNDARY = new RegExp(
  String.raw`(?:,\s+|\s+(?:e|mas|alem\s+disso)\s+)(?=${GENERAL_REQUEST_START}\b)`,
  "g",
);
const INTERNAL_UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const INTERNAL_NUMERIC_REFERENCE_PATTERN = /\b(?:account_id|destination_account_id|category_id|goal_id|card_id|transaction_id|purchase_id|action_id|user_id|conversation_id|id)\s*[:=#]\s*\d+\b/i;
const SENSITIVE_SOLICITATION_PATTERN = /\b(?:informe|digite|envie|diga|qual|confirme)\b.{0,60}\b(?:senha|password|pin|cpf|token|chave secreta|codigo bancario|codigo de verificacao|numero completo do cartao)\b/i;
const FIRST_PERSON_EXECUTION_CLAIM_PATTERN = /\b(?:acabei\s+de\s+)?(?:criei|salvei|registrei|lancei|editei|alterei|atualizei|exclui|apaguei|arquivei|reativei|transferi|guardei|resgatei|paguei|quitei|estornei|reabri|conclui|confirmei|executei|realizei)\b/;
const PASSIVE_EXECUTION_CLAIM_PATTERN = /(?:\b(?:foi|foram|esta|estao|ficou|ficaram)\s+(?:criad[ao]s?|salv[ao]s?|registrad[ao]s?|lancad[ao]s?|editad[ao]s?|alterad[ao]s?|atualizad[ao]s?|excluid[ao]s?|apagad[ao]s?|arquivad[ao]s?|reativad[ao]s?|transferid[ao]s?|guardad[ao]s?|resgatad[ao]s?|pag[ao]s?|quitad[ao]s?|estornad[ao]s?|reabert[ao]s?|concluid[ao]s?|confirmad[ao]s?|executad[ao]s?|realizad[ao]s?)\b|\b(?:acao|operacao)\s+(?:financeira\s+)?(?:foi\s+)?(?:concluida|confirmada|executada|realizada)\b)/;
const IMMEDIATE_SUCCESS_PATTERN = /(?:\bcom sucesso\b|\bconforme (?:voce )?(?:pediu|solicitou)\b|^(?:pronto|feito|concluido|tudo certo)(?:[.!,:;\s]|$))/;
type AssistantOutputKind = "out_of_scope" | "answer" | "clarify" | "propose_action" | "navigate";

export function normalizeText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180B-\u180F\u200B-\u200F\u202A-\u202E\u2060-\u206F\u3164\uFE00-\uFE0F\uFEFF]/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
}

function securityNormalized(value: string): string {
  return normalizeText(value).replace(/(?:\b[a-z]\s+){3,}[a-z]\b/g, (spelled) => spelled.replace(/\s+/g, ""));
}

function containsCpf(value: string): boolean {
  return /(?:^|\D)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?:\D|$)/.test(value);
}

function passesLuhn(value: string): boolean {
  let sum = 0;
  let doubleDigit = false;
  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (doubleDigit) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    doubleDigit = !doubleDigit;
  }
  return sum % 10 === 0;
}

function containsPaymentCard(value: string): boolean {
  const candidates = value.match(/(?:\d[ -]?){13,19}/g) ?? [];
  return candidates.some((candidate) => {
    const digits = candidate.replace(/\D/g, "");
    return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits);
  });
}

export function containsSensitiveData(value: string): boolean {
  return SECRET_PATTERN.test(value)
    || LABELED_CREDENTIAL_PATTERN.test(value)
    || POSSESSIVE_CREDENTIAL_PATTERN.test(value)
    || containsCpf(value)
    || containsPaymentCard(value);
}

export function redactSensitiveText(value: unknown): string {
  let result = String(value ?? "");
  const patterns = [
    LABELED_CREDENTIAL_REDACTION_PATTERN,
    POSSESSIVE_CREDENTIAL_REDACTION_PATTERN,
    /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    /\b(?:sb_secret_|sb_publishable_|gsk_|xkeysib-|xai-)[A-Za-z0-9._-]+/gi,
    /\bsk-(?:ant-)?[A-Za-z0-9_-]{8,}/gi,
    /\bAIza[A-Za-z0-9_-]{20,}/g,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
    /\bservice_role\b(?:\s*[:=]\s*[A-Za-z0-9._~+/=-]{4,})?/gi,
    /(?:^|\D)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?=\D|$)/g,
    /(?:\d[ -]?){13,19}/g,
    /(?=[A-Za-z0-9._~+/=-]{40,}\b)(?=[^\s]*[A-Za-z])(?=[^\s]*\d)[A-Za-z0-9._~+/=-]{40,}/g,
  ];
  for (const pattern of patterns) result = result.replace(pattern, REDACTED);
  return result.replace(
    /\[DADO_SENSIVEL_REMOVIDO\](?:\s*\[DADO_SENSIVEL_REMOVIDO\])+/g,
    REDACTED,
  );
}

export function redactInternalIdentifiers(value: unknown): string {
  return String(value ?? "").replace(INTERNAL_UUID_PATTERN, REDACTED_INTERNAL_ID);
}

function containsFalseExecutionClaim(normalized: string, kind?: AssistantOutputKind): boolean {
  if (FIRST_PERSON_EXECUTION_CLAIM_PATTERN.test(normalized)) return true;
  if (!PASSIVE_EXECUTION_CLAIM_PATTERN.test(normalized)) return false;
  // Uma consulta pode legitimamente descrever um fato histórico, por exemplo
  // "a fatura está paga". Fora de answer, voz passiva de conclusão é sempre
  // incompatível com um modelo que apenas prepara propostas.
  return kind !== "answer" || IMMEDIATE_SUCCESS_PATTERN.test(normalized);
}

function containsMixedOutsideRequest(normalized: string): boolean {
  const clauses = normalized
    .replace(MIXED_REQUEST_BOUNDARY, ";")
    .split(/\s*(?:;|\r?\n+|[!?](?:\s+|$)|\.(?:\s+|$))\s*/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  if (clauses.length < 2 || !clauses.some((clause) => FINANCIAL_TOPIC_PATTERN.test(clause))) return false;
  return clauses.some((clause) => (
    !FINANCIAL_TOPIC_PATTERN.test(clause) && GENERAL_REQUEST_PATTERN.test(clause)
  ));
}

function containsUnsafeOrOutsideTopic(normalized: string): boolean {
  const hardened = securityNormalized(normalized);
  return FORBIDDEN_ACCESS_PATTERN.test(hardened)
    || PROMPT_INJECTION_PATTERN.test(hardened)
    || ADDITIONAL_PROMPT_INJECTION_PATTERN.test(hardened)
    || STRUCTURED_INJECTION_PATTERN.test(hardened)
    || OUTSIDE_TOPIC_PATTERN.test(hardened)
    || containsMixedOutsideRequest(hardened);
}

function isSafeDraftContinuation(normalized: string, state: Record<string, string>): boolean {
  if (Object.keys(state).length === 0 || normalized.length > 160 || containsUnsafeOrOutsideTopic(normalized)) return false;
  if (FINANCIAL_TOPIC_PATTERN.test(normalized)) return true;
  if (/^(sim|nao|não|ok|certo|confirmo|cancelar?|desistir|deixa pra la|deixa pra lá)[.!\s]*$/.test(normalized)) return true;
  if (/^(mensal|semanal|anual|unica|única|pendente|paga|pago|receita|despesa|transferencia|transferência|individual|serie|série|parcelas?)[.!\s]*$/.test(normalized)) return true;
  if (/^(?:r\$\s*)?[+-]?[\d.,%/ -]{1,40}$/.test(normalized)) return true;
  if (/^\d{4}-\d{2}(?:-\d{2})?$/.test(normalized)) return true;
  return /^[\p{L}\p{N}][\p{L}\p{N} .,'’()&+_-]{0,79}$/u.test(normalized)
    && !/\b(conte|explique|fale|escreva|gere|invente|responda|traduza|pesquise)\b/.test(normalized);
}

export function isFinancialControlMessage(message: string, state: Record<string, string>): boolean {
  if (!message || message.length > MAX_MESSAGE_CHARS) return false;
  const normalized = normalizeText(message);
  if (containsUnsafeOrOutsideTopic(normalized)) return false;
  return FINANCIAL_TOPIC_PATTERN.test(normalized)
    || IMPLICIT_FINANCIAL_PROJECTION_PATTERN.test(normalized)
    || isSafeDraftContinuation(normalized, state);
}

export function safeAssistantMessage(
  message: string,
  intent: string,
  kind?: AssistantOutputKind,
  outputCanary?: string,
): string | null {
  if (outputCanary && String(message).includes(outputCanary)) return null;
  // UUIDs precisam ser removidos primeiro: seus dígitos podem parecer um
  // cartão e uma redação parcial impediria o reconhecimento posterior do ID.
  const redacted = redactSensitiveText(redactInternalIdentifiers(message)).trim().slice(0, MAX_MESSAGE_CHARS);
  if (!redacted || containsSensitiveData(redacted)) return null;
  if (INTERNAL_NUMERIC_REFERENCE_PATTERN.test(redacted)) return null;
  const normalized = normalizeText(redacted);
  if (INTERNAL_PROMPT_MARKER_PATTERN.test(normalized)) return null;
  if (SENSITIVE_SOLICITATION_PATTERN.test(normalized)) return null;
  // O modelo apenas interpreta e propõe. Mensagens de sucesso são produzidas
  // exclusivamente pelo servidor depois do RPC transacional de confirmação.
  if (containsFalseExecutionClaim(normalized, kind)) return null;
  if (containsUnsafeOrOutsideTopic(normalized)
    || /\b(piada|poema|receita culinaria|historia ficticia|codigo fonte)\b/.test(normalized)) return null;
  if (FINANCIAL_TOPIC_PATTERN.test(normalized) || /(?:r\$|\d+[,.]\d{2}|\d+%|\d{4}-\d{2})/i.test(redacted)) return redacted;
  if (kind === "clarify" && /^(?:qual|quais|quando|quant[oa]s?|em qual|aplicar|mostrar)\b/i.test(normalized)) return redacted;
  if (kind === "propose_action" && /\b(?:revise|confira|previa|confirmar)\b/i.test(normalized)) return redacted;
  if (/^(pronto|feito|concluido|concluído|encontrei|nao encontrei|não encontrei|preciso de mais informacoes|preciso de mais informações)/i.test(redacted)
    && intent !== "out_of_scope") return redacted;
  return null;
}
