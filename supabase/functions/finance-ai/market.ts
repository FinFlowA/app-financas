export type MarketIndicators = {
  selic_rate_annual: number | null;
  selic_reference_date: string | null;
  cdi_rate_annual: number | null;
  cdi_reference_date: string | null;
  ipca_12m_percent: number | null;
  ipca_reference_date: string | null;
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

function parseBcbDate(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

async function fetchBcbSeriesOnce(
  code: number,
  fetcher: typeof fetch,
): Promise<{ date: string; value: number } | null> {
  const response = await fetcher(
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados/ultimos/1?formato=json`,
    { signal: AbortSignal.timeout(BCB_FETCH_TIMEOUT_MS) },
  );
  if (!response.ok) throw new Error(`BCB_HTTP_${response.status}`);
  const body: unknown = await response.json();
  const row = Array.isArray(body) ? body[0] : null;
  if (!row || typeof row !== "object") throw new Error("BCB_EMPTY_BODY");
  const rawValue = (row as Record<string, unknown>).valor;
  const rawDate = (row as Record<string, unknown>).data;
  if (typeof rawValue !== "string" || typeof rawDate !== "string") throw new Error("BCB_MALFORMED_ROW");
  const value = Number(rawValue.replace(",", "."));
  const date = parseBcbDate(rawDate);
  if (!Number.isFinite(value) || !date) throw new Error("BCB_MALFORMED_VALUE");
  return { date, value: Math.round(value * 100) / 100 };
}

async function fetchBcbSeriesLatest(
  code: number,
  fetcher: typeof fetch,
): Promise<{ date: string; value: number } | null> {
  for (let attempt = 0; attempt <= BCB_FETCH_RETRIES; attempt++) {
    try {
      return await fetchBcbSeriesOnce(code, fetcher);
    } catch (error) {
      const isLastAttempt = attempt === BCB_FETCH_RETRIES;
      // Log em vez de falhar silenciosamente: sem isso, uma falha real (ex.:
      // BCB fora do ar, formato de série mudou) fica invisível para sempre —
      // o usuário só vê "não foi possível consultar", sem nenhum rastro nos
      // logs da function para investigar depois.
      console.error(`[finance-ai/market] série ${code} falhou (tentativa ${attempt + 1}/${BCB_FETCH_RETRIES + 1})`, error);
      if (isLastAttempt) return null;
    }
  }
  return null;
}

// Indicadores públicos e não personalizados do Banco Central, usados apenas
// como contexto factual para educação financeira sobre investimentos. Uma
// falha (rede, timeout, formato inesperado) nunca pode travar a resposta:
// o chamador deve continuar explicando os conceitos de forma genérica e
// informar que a taxa atual não pôde ser consultada agora.
export async function fetchMarketIndicators(fetcher: typeof fetch = fetch): Promise<MarketIndicators | null> {
  const [selic, cdi, ipca] = await Promise.all([
    fetchBcbSeriesLatest(BCB_SERIES.selic, fetcher),
    fetchBcbSeriesLatest(BCB_SERIES.cdi, fetcher),
    fetchBcbSeriesLatest(BCB_SERIES.ipca12m, fetcher),
  ]);
  if (!selic && !cdi && !ipca) return null;
  return {
    selic_rate_annual: selic?.value ?? null,
    selic_reference_date: selic?.date ?? null,
    cdi_rate_annual: cdi?.value ?? null,
    cdi_reference_date: cdi?.date ?? null,
    ipca_12m_percent: ipca?.value ?? null,
    ipca_reference_date: ipca?.date ?? null,
    source: "bcb_sgs",
  };
}
