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
  igpm_12m_percent: number | null;
  igpm_reference_date: string | null;
  igpm_previous_12m_percent: number | null;
  igpm_previous_reference_date: string | null;
  source: "bcb_sgs";
};

// Séries públicas do SGS (Banco Central): Meta Selic definida pelo Copom,
// CDI acumulado no mês anualizado, IPCA acumulado em 12 meses (calculado
// pelo IBGE) e IGP-M mensal (calculado pela FGV, sem acumulado de 12 meses
// pronto no SGS — precisa ser composto a partir da série mensal) — todas
// em % a.a. (ou % acumulado), sem necessidade de chave de API.
const BCB_SERIES = {
  selic: 432,
  cdi: 4389,
  ipca12m: 13522,
  igpmMonthly: 189,
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
// IPCA é mensal; 100 dias cobre com folga pelo menos 2 divulgações mesmo
// perto do início de um mês, antes do valor do mês corrente ser publicado.
const IPCA_LOOKBACK_DAYS = 100;
// IGP-M não tem uma série "acumulado 12 meses" pronta no SGS como o IPCA;
// precisa compor a partir da série mensal. 430 dias (~14 meses) garante
// pelo menos 13 pontos: 12 para o acumulado atual e mais 1 para comparar
// com o acumulado do mês anterior (ver accumulate12Months).
const IGPM_LOOKBACK_DAYS = 430;

type SeriesPoint = { date: string; value: number };

function parseBcbDate(value: string): string | null {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  return `${year}-${month}-${day}`;
}

function formatBcbDate(date: Date): string {
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

async function fetchBcbSeriesOnce(
  code: number,
  lookbackDays: number,
  fetcher: typeof fetch,
): Promise<SeriesPoint[]> {
  // O endpoint "/dados/ultimos/N" limita N a no máximo 20 valores (erro 400
  // acima disso), o que não cobre a janela necessária para achar a última
  // mudança real de séries diárias. "/dados?dataInicial=" não tem esse teto.
  const startDate = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
  const response = await fetcher(
    `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados?dataInicial=${formatBcbDate(startDate)}&formato=json`,
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
  lookbackDays: number,
  fetcher: typeof fetch,
): Promise<SeriesPoint[]> {
  for (let attempt = 0; attempt <= BCB_FETCH_RETRIES; attempt++) {
    try {
      return await fetchBcbSeriesOnce(code, lookbackDays, fetcher);
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

function compoundPercent(monthlyPoints: SeriesPoint[]): number {
  const factor = monthlyPoints.reduce((accumulated, point) => accumulated * (1 + point.value / 100), 1);
  return Math.round((factor - 1) * 100 * 100) / 100;
}

/** Acumula os últimos 12 meses de uma série mensal (ex.: IGP-M) pelo mesmo
 * método padrão de juros compostos usado pelo IBGE/FGV para "acumulado em
 * 12 meses" — o SGS só disponibiliza a variação mês a mês para o IGP-M, ao
 * contrário do IPCA, que já tem uma série pronta com o acumulado. Também
 * calcula o acumulado da janela de 12 meses imediatamente anterior, para
 * responder se o indicador subiu, caiu ou ficou igual. */
function accumulate12Months(monthlyPoints: SeriesPoint[]): { latest: SeriesPoint; previous: SeriesPoint | null } | null {
  if (monthlyPoints.length < 12) return null;
  const currentWindow = monthlyPoints.slice(monthlyPoints.length - 12);
  const latest = { date: currentWindow[currentWindow.length - 1].date, value: compoundPercent(currentWindow) };
  let previous: SeriesPoint | null = null;
  if (monthlyPoints.length >= 13) {
    const previousWindow = monthlyPoints.slice(monthlyPoints.length - 13, monthlyPoints.length - 1);
    previous = { date: previousWindow[previousWindow.length - 1].date, value: compoundPercent(previousWindow) };
  }
  return { latest, previous };
}

// Indicadores públicos e não personalizados do Banco Central, usados apenas
// como contexto factual para educação financeira sobre investimentos. Uma
// falha (rede, timeout, formato inesperado) nunca pode travar a resposta:
// o chamador deve continuar explicando os conceitos de forma genérica e
// informar que a taxa atual não pôde ser consultada agora.
//
// Bug real: a Selic mostrava "ref. 04/11" com o usuário perguntando em
// 25/09 -- uma data de referência no FUTURO para "a taxa atual". A série
// 432 (Meta Selic) do SGS vem pré-preenchida várias semanas à frente (a
// meta já está decidida e vale até a próxima reunião do Copom), e o código
// não limitava a busca a "até hoje", então pegava esse ponto futuro como
// "o mais recente". Filtra qualquer ponto com data posterior a hoje antes
// de escolher o mais recente, para "ref." nunca vir do futuro.
export async function fetchMarketIndicators(
  fetcher: typeof fetch = fetch,
  todayIso: string = new Date().toISOString().slice(0, 10),
): Promise<MarketIndicators | null> {
  const notInTheFuture = (points: SeriesPoint[]) => points.filter((point) => point.date <= todayIso);
  const [selicPoints, cdiPoints, ipcaPoints, igpmMonthlyPoints] = await Promise.all([
    fetchBcbSeriesRecent(BCB_SERIES.selic, RATE_LOOKBACK_DAYS, fetcher),
    fetchBcbSeriesRecent(BCB_SERIES.cdi, RATE_LOOKBACK_DAYS, fetcher),
    fetchBcbSeriesRecent(BCB_SERIES.ipca12m, IPCA_LOOKBACK_DAYS, fetcher),
    fetchBcbSeriesRecent(BCB_SERIES.igpmMonthly, IGPM_LOOKBACK_DAYS, fetcher),
  ].map((promise) => promise.then(notInTheFuture)));
  const selic = latestWithLastChange(selicPoints);
  const cdi = latestWithLastChange(cdiPoints);
  // IPCA é mensal: cada ponto já é um mês distinto, então o anterior da
  // lista é sempre "o mês anterior", sem precisar procurar uma mudança real.
  const ipca = ipcaPoints.length > 0
    ? { latest: ipcaPoints[ipcaPoints.length - 1], previous: ipcaPoints.length > 1 ? ipcaPoints[ipcaPoints.length - 2] : null }
    : null;
  const igpm = accumulate12Months(igpmMonthlyPoints);
  if (!selic && !cdi && !ipca && !igpm) return null;
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
    igpm_12m_percent: igpm?.latest.value ?? null,
    igpm_reference_date: igpm?.latest.date ?? null,
    igpm_previous_12m_percent: igpm?.previous?.value ?? null,
    igpm_previous_reference_date: igpm?.previous?.date ?? null,
    source: "bcb_sgs",
  };
}
