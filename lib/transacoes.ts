export type FrequenciaRecorrencia = "semanal" | "mensal" | "anual";

export interface TransacaoComDatas {
  status?: string | null;
  data_vencimento?: string | null;
  data_realizacao?: string | null;
}

export function dataEfetivaTransacao(transacao: TransacaoComDatas): string {
  if (transacao.status === "paga") {
    return transacao.data_realizacao || transacao.data_vencimento || "";
  }
  return transacao.data_vencimento || "";
}

const DESTINO_TRANSFERENCIA_REGEX = /\s*\[Destino:(\d+)\]\s*$/;
const OBJETIVO_TRANSFERENCIA_REGEX = /\s*\[Objetivo:(\d+):(guardar|resgatar)\]\s*$/;
const SERIE_REGEX = /\s*\[Serie:([A-Za-z0-9_-]+)\]/;
const METADADOS_INTERNOS_FINAIS_REGEX = /\s*(?:\[(?:Serie:[A-Za-z0-9_-]+|Destino:\d+|Objetivo:\d+:(?:guardar|resgatar))\]\s*)+$/;

export type OperacaoObjetivo = "guardar" | "resgatar";

export interface MovimentoObjetivo {
  objetivoId: number | null;
  operacao: OperacaoObjetivo;
  nomeLegado?: string;
}

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

export function adicionarIdSerie(descricao: string, serieId: string): string {
  const texto = descricao.trim();
  const metadadoFinal = texto.match(/\s*(\[(?:Destino:\d+|Objetivo:\d+:(?:guardar|resgatar))\])\s*$/);
  if (!metadadoFinal) return `${texto} [Serie:${serieId}]`;

  const inicioMetadado = metadadoFinal.index ?? texto.length - metadadoFinal[0].length;
  return `${texto.slice(0, inicioMetadado).trim()} [Serie:${serieId}] ${metadadoFinal[1]}`;
}

export function getIdSerie(descricao?: string | null): string | null {
  return (descricao ?? "").match(SERIE_REGEX)?.[1] ?? null;
}

export function descricaoTransferenciaObjetivo(
  descricao: string,
  nomeObjetivo: string,
  objetivoId: number,
  operacao: OperacaoObjetivo,
): string {
  const texto = descricao.trim();
  const recorrenciaEncontrada = texto.match(/\s*(\(\d+\/\d+\)|\(Fixa(?: semanal| anual)?\))$/)?.[0] ?? "";
  const recorrencia = recorrenciaEncontrada ? ` ${recorrenciaEncontrada.trim()}` : "";
  const textoSemRecorrencia = recorrenciaEncontrada ? texto.slice(0, -recorrenciaEncontrada.length).trim() : texto;
  const rotuloObjetivo = operacao === "guardar" ? `Guardar em: ${nomeObjetivo}` : `Resgate de: ${nomeObjetivo}`;
  const textoVisivel = textoSemRecorrencia
    ? `${textoSemRecorrencia} · ${rotuloObjetivo}${recorrencia}`
    : `${rotuloObjetivo}${recorrencia}`;

  return `[Transf.] ${textoVisivel} [Objetivo:${objetivoId}:${operacao}]`;
}

export function descricaoVisivel(descricao: string): string {
  return descricao
    .replace(/\s*\[PagFatura:\d+:\d{4}-\d{2}:[^\]]+\]\s*$/, "")
    .replace(DESTINO_TRANSFERENCIA_REGEX, "")
    .replace(OBJETIVO_TRANSFERENCIA_REGEX, "")
    .replace(SERIE_REGEX, "")
    .replace(/^\[Transf\.\]\s*/, "")
    .trim();
}

export function substituirDescricaoBase(descricaoOriginal: string, novaBase: string): string {
  const metadado = descricaoOriginal.match(METADADOS_INTERNOS_FINAIS_REGEX)?.[0] ?? "";
  const recorrencia = descricaoVisivel(descricaoOriginal).match(/\s*(\(\d+\/\d+\)|\(Fixa(?: semanal| anual)?\))$/)?.[0] ?? "";
  const prefixo = isTransferencia(descricaoOriginal) ? "[Transf.] " : "";
  return `${prefixo}${novaBase.trim()}${recorrencia}${metadado}`.trim();
}

export function getMovimentoObjetivo(descricao?: string | null): MovimentoObjetivo | null {
  const texto = descricao ?? "";
  const marcador = texto.match(OBJETIVO_TRANSFERENCIA_REGEX);
  if (marcador) {
    return {
      objetivoId: Number(marcador[1]),
      operacao: marcador[2] as OperacaoObjetivo,
    };
  }

  const visivel = descricaoVisivel(texto)
    .replace(/\s*\(\d+\/\d+\)$/, "")
    .replace(/\s*\(Fixa(?: semanal| anual)?\)$/, "")
    .trim();
  const legado = visivel.match(/^(Guardar em|Resgate de):\s*(.+)$/);
  if (!legado) return null;

  return {
    objetivoId: null,
    operacao: legado[1] === "Guardar em" ? "guardar" : "resgatar",
    nomeLegado: legado[2].trim(),
  };
}

export function isMovimentoObjetivo(descricao?: string | null): boolean {
  return getMovimentoObjetivo(descricao) !== null;
}

export interface ParcelaRecorrencia {
  base: string;
  atual: number;
  total: number;
}

export function getParcelaRecorrencia(descricao?: string | null): ParcelaRecorrencia | null {
  const match = descricaoVisivel(descricao ?? "").match(/^(.+)\s+\((\d+)\/(\d+)\)$/);
  if (!match) return null;
  return { base: match[1].trim(), atual: Number(match[2]), total: Number(match[3]) };
}

export function sufixoRecorrencia(frequencia: FrequenciaRecorrencia): string {
  return frequencia === "mensal" ? "(Fixa)" : `(Fixa ${frequencia})`;
}

export function isRecorrenciaFixa(descricao: string): boolean {
  return /\(Fixa(?: semanal| anual)?\)(?:\s*\[(?:Serie:[A-Za-z0-9_-]+|Destino:\d+|Objetivo:\d+:(?:guardar|resgatar))\])*$/.test(descricao);
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
