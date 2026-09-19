import { fetchMarketIndicators } from "./market.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type SeriesFixture = Array<{ data: string; valor: string }> | { data: string; valor: string } | "http_error" | "network_error";

function fakeFetcher(bySeries: Record<number, SeriesFixture>): typeof fetch {
  return ((url: string | URL) => {
    const match = String(url).match(/bcdata\.sgs\.(\d+)\//);
    const code = match ? Number(match[1]) : -1;
    const outcome = bySeries[code];
    if (outcome === "network_error" || outcome === undefined) return Promise.reject(new Error("network down"));
    if (outcome === "http_error") return Promise.resolve(new Response("erro", { status: 500 }));
    const rows = Array.isArray(outcome) ? outcome : [outcome];
    return Promise.resolve(new Response(JSON.stringify(rows), { status: 200 }));
  }) as typeof fetch;
}

Deno.test("indicadores de mercado combinam Selic, CDI e IPCA quando todas as series respondem", async () => {
  const fetcher = fakeFetcher({
    432: { data: "18/09/2026", valor: "13.75" },
    4389: { data: "17/09/2026", valor: "13.65" },
    13522: { data: "01/08/2026", valor: "4.22" },
  });
  const result = await fetchMarketIndicators(fetcher);
  assert(result !== null, "indicadores nao deveriam ser nulos quando todas as series respondem");
  assert(result.selic_rate_annual === 13.75, "taxa Selic incorreta");
  assert(result.selic_reference_date === "2026-09-18", "data de referencia da Selic incorreta");
  assert(result.cdi_rate_annual === 13.65, "taxa CDI incorreta");
  assert(result.ipca_12m_percent === 4.22, "IPCA acumulado incorreto");
  assert(result.source === "bcb_sgs", "fonte deveria ser o SGS do Banco Central");
});

Deno.test("indicadores de mercado degradam por serie sem travar quando uma consulta falha", async () => {
  const fetcher = fakeFetcher({
    432: { data: "18/09/2026", valor: "13.75" },
    4389: "http_error",
    13522: "network_error",
  });
  const result = await fetchMarketIndicators(fetcher);
  assert(result !== null, "uma serie disponivel ja deveria compor o resultado");
  assert(result.selic_rate_annual === 13.75, "a serie que respondeu deveria ser preservada");
  assert(result.cdi_rate_annual === null, "serie com erro HTTP deveria virar null, nao travar tudo");
  assert(result.ipca_12m_percent === null, "serie com falha de rede deveria virar null, nao travar tudo");
});

Deno.test("indicadores de mercado retornam nulo quando todas as series falham", async () => {
  const fetcher = fakeFetcher({ 432: "network_error", 4389: "network_error", 13522: "network_error" });
  const result = await fetchMarketIndicators(fetcher);
  assert(result === null, "sem nenhuma serie disponivel o resultado deveria ser nulo, nao lancar erro");
});

Deno.test("indicadores de mercado ignoram payload com formato inesperado", async () => {
  const fetcher = fakeFetcher({
    432: { data: "data-invalida", valor: "nao-e-numero" },
    4389: { data: "17/09/2026", valor: "13.65" },
    13522: "network_error",
  });
  const result = await fetchMarketIndicators(fetcher);
  assert(result !== null, "a serie valida deveria compor o resultado mesmo com outra malformada");
  assert(result.selic_rate_annual === null, "payload malformado deveria virar null, nunca um valor inventado");
  assert(result.cdi_rate_annual === 13.65, "serie valida nao deveria ser afetada pela malformada");
});

Deno.test("indicadores de mercado acham a data da ultima mudanca real, nao so o dia anterior repetido", async () => {
  // Selic ficou parada em 13.75 por alguns dias, mas a mudanca real (vinda de
  // 14.00) foi em 28/08 -- o "anterior" correto e esse valor/data, nao o dia
  // imediatamente anterior ao mais recente (que so repete o mesmo numero).
  const fetcher = fakeFetcher({
    432: [
      { data: "27/08/2026", valor: "14.00" },
      { data: "28/08/2026", valor: "13.75" },
      { data: "02/09/2026", valor: "13.75" },
      { data: "03/09/2026", valor: "13.75" },
    ],
    4389: { data: "03/09/2026", valor: "13.65" },
    13522: [
      { data: "01/07/2026", valor: "4.30" },
      { data: "01/08/2026", valor: "4.22" },
    ],
  });
  const result = await fetchMarketIndicators(fetcher);
  assert(result !== null, "indicadores nao deveriam ser nulos");
  assert(result.selic_rate_annual === 13.75, "taxa Selic atual incorreta");
  assert(result.selic_reference_date === "2026-09-03", "data de referencia da Selic incorreta");
  assert(result.selic_previous_rate_annual === 14.00, "deveria achar o valor anterior a ultima mudanca real, nao o dia repetido");
  assert(result.selic_previous_reference_date === "2026-08-27", "data da ultima mudanca real da Selic incorreta");
  assert(result.ipca_12m_percent === 4.22, "IPCA atual incorreto");
  assert(result.ipca_previous_12m_percent === 4.30, "IPCA do mes anterior incorreto");
  assert(result.ipca_previous_reference_date === "2026-07-01", "data do IPCA do mes anterior incorreta");
});

Deno.test("indicadores de mercado nao acham mudanca quando a serie e estavel na janela toda", async () => {
  const fetcher = fakeFetcher({
    432: [
      { data: "01/09/2026", valor: "13.75" },
      { data: "02/09/2026", valor: "13.75" },
      { data: "03/09/2026", valor: "13.75" },
    ],
    4389: "network_error",
    13522: "network_error",
  });
  const result = await fetchMarketIndicators(fetcher);
  assert(result !== null, "indicadores nao deveriam ser nulos");
  assert(result.selic_previous_rate_annual === null, "sem mudanca real na janela, nao deveria inventar um valor anterior");
  assert(result.selic_previous_reference_date === null, "sem mudanca real na janela, a data anterior deveria ser nula");
});
