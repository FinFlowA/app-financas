export interface HistoricoOrdenavel {
  id: number;
  data: string;
}

/**
 * Retorna a data efetiva de vencimento de uma fatura dentro do próprio mês.
 * Cartões com vencimento no dia 29, 30 ou 31 são ajustados para o último dia
 * de meses mais curtos, mantendo a fatura no período selecionado.
 */
export const dataVencimentoFaturaHistorico = (
  mesFatura: string,
  diaVencimento: number,
): string => {
  const [ano, mes] = mesFatura.split("-").map(Number);
  if (!ano || !mes || mes < 1 || mes > 12) return "";

  const ultimoDia = new Date(ano, mes, 0).getDate();
  const diaSeguro = Math.min(Math.max(Math.trunc(diaVencimento) || 1, 1), ultimoDia);
  return `${ano}-${String(mes).padStart(2, "0")}-${String(diaSeguro).padStart(2, "0")}`;
};

const timestampDataLocal = (valor: string): number => {
  const [ano, mes, dia] = valor.slice(0, 10).split("-").map(Number);
  if (!ano || !mes || !dia) return Number.NaN;
  return new Date(ano, mes - 1, dia).getTime();
};

/**
 * Ordena o histórico em blocos cronológicos úteis para o acompanhamento:
 *
 * - hoje aparece primeiro;
 * - datas futuras aparecem da mais próxima para a mais distante;
 * - depois dos próximos, datas passadas aparecem da mais recente para a mais antiga;
 * - IDs mais novos desempatarão lançamentos do mesmo dia.
 */
export const compararHistoricoPorData = (
  a: HistoricoOrdenavel,
  b: HistoricoOrdenavel,
  hoje: Date,
): number => {
  const inicioHoje = new Date(hoje);
  inicioHoje.setHours(0, 0, 0, 0);
  const hojeTimestamp = inicioHoje.getTime();
  const dataA = timestampDataLocal(a.data);
  const dataB = timestampDataLocal(b.data);

  const aValida = Number.isFinite(dataA);
  const bValida = Number.isFinite(dataB);
  if (!aValida && !bValida) return b.id - a.id;
  if (!aValida) return 1;
  if (!bValida) return -1;

  const grupoA = dataA === hojeTimestamp ? 0 : dataA > hojeTimestamp ? 1 : 2;
  const grupoB = dataB === hojeTimestamp ? 0 : dataB > hojeTimestamp ? 1 : 2;
  if (grupoA !== grupoB) return grupoA - grupoB;

  if (dataA !== dataB) return grupoA === 1 ? dataA - dataB : dataB - dataA;
  return b.id - a.id;
};
