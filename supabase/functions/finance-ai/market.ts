export type MarketIndicators = {
  selic_rate_annual: number | null;
  selic_reference_date: string | null;
  selic_previous_rate_annual: number | null;
  selic_previous_reference_date: string | null;
  cdi_rate_annual: number | null;
  cdi_reference_date: string | null;
  cdi_previous_rate_annual: number | null;
  cdi_previous_reference_date: string | null;
  ipca_12m_percent: number | null;
  ipca_reference_date: string | null;
  ipca_previous_12m_percent: number | null;
  ipca_previous_reference_date: string | null;
  source: "bcb_sgs";
};

// Séries públicas do SGS (Banco Central): Meta Selic definida pelo Copom,
// CDI acumulado no mês anualizado e IPCA acumulado em 12 meses — todas em
// % a.a. (ou % acumulado, no caso do IPCA), sem necessidade de chave de API.
const BCB_SERIES = {
  selic: 432,
  cdi: 4389,
  ipca12m: 13522,
} as const;

const BCB_FETCH_TIMEOUT_MS = 6_000;
// A API do BCB ocasionalmente tem uma falha momentânea (rede, cold start).
// Uma tentativa extra evita que isso apareça como "indicador indisponível"
// para o usuário quando a causa real foi só uma resposta lenta pontual.
const BCB_FETCH_RETRIES = 1;
// Selic e CDI são séries diárias que repetem o mesmo valor todo dia útil
// entre uma decisão do Copom e outra (a cada ~45 dias); pegar só "o dia
// anterior" quase sempre mostra o mesmo número e nunca diz quando a taxa
// realmente mudou. Uma janela de ~90 dias cobre pelo menos um ciclo cheiro.
const RATE_LOOKBACK_DAYS = 90;
const IPCA_LOOKBACK_MONTHS = 2;

type SeriesPoint = { date: string; value: number };

function parseBcbDate(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

async function fetchBcbSeriesOnce(
  code: number,
  count: number,
  fetcher: typeof fetch,
): Promise<SeriesPoint[]> {
  const response = await fetcher(
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/${count}?formato=json`,
    { signal: AbortSignal.timeout(BCB_FETCH_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`BCB_HTTP_${response.status}`);
  const body: unknown = await response.json();
  if (!Array.isArray(body)) throw new Error("BCB_EMPTY_BODY");
  // A API devolve em ordem cronológica (mais antigo primeiro, mais recente
  // por último) — confirmado empiricamente contra a série 432.
  return body.map((row) => {
    if (!row || typeof row !== "object") throw new Error("BCB_MALFORMED_ROW");
    const rawValue = (row as Record<string, unknown>).valor;
    const rawDate = (row as Record<string, unknown>).data;
    if (typeof rawValue !== "string" || typeof rawDate !== "string") throw new Error("BCB_MALFORMED_ROW");
    const value = Number(rawValue.replace(",", "."));
    const date = parseBcbDate(rawDate);
    if (!Number.isFinite(value) || !date) throw new Error("BCB_MALFORMED_VALUE");
    return { date, value: Math.round(value * 100) / 100 };
  });
}

async function fetchBcbSeriesRecent(
  code: number,
  count: number,
  fetcher: typeof fetch,
): Promise<SeriesPoint[]> {
  for (let attempt = 0; attempt <= BCB_FETCH_RETRIES; attempt++) {
    try {
      return await fetchBcbSeriesOnce(code, count, fetcher);
    } catch (error) {
      const isLastAttempt = attempt === BCB_FETCH_RETRIES;
      // Log em vez de falhar silenciosamente: sem isso, uma falha real (ex.:
      // BCB fora do ar, formato de série mudou) fica invisível para sempre —
      // o usuário só vê "não foi possível consultar", sem nenhum rastro nos
      // logs da function para investigar depois.
      console.error(`[finance-ai/market] série ${code} falhou (tentativa ${attempt + 1}/${BCB_FETCH_RETRIES + 1})`, error);
      if (isLastAttempt) return [];
    }
  }
  return [];
}

/** Último ponto e, quando existir dentro da janela buscada, o ponto anterior
 * em que o valor foi de fato diferente do atual — não simplesmente "o dia
 * anterior" (que para séries diárias como Selic/CDI quase sempre repete o
 * mesmo número). Isso permite responder "mudou recentemente?" com a data e
 * o valor exatos da última alteração real. */
function latestWithLastChange(points: SeriesPoint[]): { latest: SeriesPoint; previous: SeriesPoint | null } | null {
  if (points.length === 0) return null;
  const latest = points[points.length - 1];
  let previous: SeriesPoint | null = null;
  for (let index = points.length - 2; index >= 0; index--) {
    if (Math.abs(points[index].value - latest.value) > 0.001) {
      previous = points[index];
      break;
    }
  }
  return { latest, previous };
}

// Indicadores públicos e não personalizados do Banco Central, usados apenas
// como contexto factual para educação financeira sobre investimentos. Uma
// falha (rede, timeout, formato inesperado) nunca pode travar a resposta:
// o chamador deve continuar explicando os conceitos de forma genérica e
// informar que a taxa atual não pôde ser consultada agora.
export async function fetchMarketIndicators(fetcher: typeof fetch = fetch): Promise<MarketIndicators | null> {
  const [selicPoints, cdiPoints, ipcaPoints] = await Promise.all([
    fetchBcbSeriesRecent(BCB_SERIES.selic, RATE_LOOKBACK_DAYS, fetcher),
    fetchBcbSeriesRecent(BCB_SERIES.cdi, RATE_LOOKBACK_DAYS, fetcher),
    fetchBcbSeriesRecent(BCB_SERIES.ipca12m, IPCA_LOOKBACK_MONTHS, fetcher),
  ]);
  const selic = latestWithLastChange(selicPoints);
  const cdi = latestWithLastChange(cdiPoints);
  // IPCA é mensal: cada ponto já é um mês distinto, então o anterior da
  // lista é sempre "o mês anterior", sem precisar procurar uma mudança real.
  const ipca = ipcaPoints.length > 0
    ? { latest: ipcaPoints[ipcaPoints.length - 1], previous: ipcaPoints.length > 1 ? ipcaPoints[ipcaPoints.length - 2] : null }
    : null;
  if (!selic && !cdi && !ipca) return null;
  return {
    selic_rate_annual: selic?.latest.value ?? null,
    selic_reference_date: selic?.latest.date ?? null,
    selic_previous_rate_annual: selic?.previous?.value ?? null,
    selic_previous_reference_date: selic?.previous?.date ?? null,
    cdi_rate_annual: cdi?.latest.value ?? null,
    cdi_reference_date: cdi?.latest.date ?? null,
    cdi_previous_rate_annual: cdi?.previous?.value ?? null,
    cdi_previous_reference_date: cdi?.previous?.date ?? null,
    ipca_12m_percent: ipca?.latest.value ?? null,
    ipca_reference_date: ipca?.latest.date ?? null,
    ipca_previous_12m_percent: ipca?.previous?.value ?? null,
    ipca_previous_reference_date: ipca?.previous?.date ?? null,
    source: "bcb_sgs",
  };
}
