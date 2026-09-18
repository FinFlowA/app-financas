export type AssistantMessagePart = {
  text: string;
  emphasis: boolean;
};

export type AssistantMessageBlock = {
  parts: AssistantMessagePart[];
};

const EMPHASIS_PATTERN = /(R\$\s?-?[\d.]+,\d{2}|-?\d+(?:[.,]\d+)?%|\b\d{2}\/\d{2}\/\d{4}\b)/giu;

function partsFromText(text: string): AssistantMessagePart[] {
  return text.split(EMPHASIS_PATTERN).filter(Boolean).map((part) => ({
    text: part,
    emphasis: /^(?:R\$\s?-?[\d.]+,\d{2}|-?\d+(?:[.,]\d+)?%|\d{2}\/\d{2}\/\d{4})$/iu.test(part),
  }));
}

export function formatAssistantMessage(text: string): AssistantMessageBlock[] {
  const normalized = text.trim();
  if (!normalized) return [];
  if (normalized.length < 120) return [{ parts: partsFromText(normalized) }];

  // Só considere uma pontuação como fim de frase quando ela for seguida por
  // espaço e pelo início provável de uma nova frase. Isso preserva números no
  // padrão brasileiro, como "R$ 1.976,90", em uma única linha/bloco.
  const sentences = normalized
    .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ý])/gu)
    .map((sentence) => sentence.trim())
    .filter(Boolean);

  if (sentences.length < 2) return [{ parts: partsFromText(normalized) }];
  return sentences.map((sentence) => ({ parts: partsFromText(sentence) }));
}
