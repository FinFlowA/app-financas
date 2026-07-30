export type FrequenciaRecorrencia = "semanal" | "mensal" | "anual";

const DESTINO_TRANSFERENCIA_REGEX = /\s*\[Destino:(\d+)\]\s*$/;

export function isTransferencia(descricao?: string | null): boolean {
  return (descricao ?? "").includes("[Transf.]");
}

export function getContaDestinoTransferencia(descricao?: string | null): number | null {
  const match = (descricao ?? "").match(DESTINO_TRANSFERENCIA_REGEX);
  return match ? Number(match[1]) : null;
}

export function descricaoTransferencia(descricao: string, contaDestinoId: number): string {
  return `[Transf.] ${descricao.trim()} [Destino:${contaDestinoId}]`;
}

export function descricaoVisivel(descricao: string): string {
  return descricao
    .replace(/\s*\[PagFatura:\d+:\d{4}-\d{2}:[^\]]+\]\s*$/, "")
    .replace(DESTINO_TRANSFERENCIA_REGEX, "")
    .trim();
}

export function sufixoRecorrencia(frequencia: FrequenciaRecorrencia): string {
  return frequencia === "mensal" ? "(Fixa)" : `(Fixa ${frequencia})`;
}

export function isRecorrenciaFixa(descricao: string): boolean {
  return /\(Fixa(?: semanal| anual)?\)(?:\s*\[Destino:\d+\])?$/.test(descricao);
}

export function descricaoBaseRecorrencia(descricao: string): string {
  return descricaoVisivel(descricao)
    .replace(/\s*\(\d+\/\d+\)$/, "")
    .replace(/\s*\(Fixa(?: semanal| anual)?\)$/, "")
    .trim();
}

export function adicionarRecorrencia(
  dataBase: Date,
  indice: number,
  frequencia: FrequenciaRecorrencia,
): Date {
  if (frequencia === "semanal") {
    const data = new Date(dataBase);
    data.setDate(data.getDate() + indice * 7);
    return data;
  }

  const meses = frequencia === "anual" ? indice * 12 : indice;
  const ano = dataBase.getFullYear();
  const mes = dataBase.getMonth() + meses;
  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(
    primeiroDia.getFullYear(),
    primeiroDia.getMonth() + 1,
    0,
  ).getDate();

  return new Date(
    primeiroDia.getFullYear(),
    primeiroDia.getMonth(),
    Math.min(dataBase.getDate(), ultimoDia),
  );
}
