#!/usr/bin/env node

/**
 * Leitor operacional do monitor da IA.
 * Use somente em ambiente administrativo/CI: a service role nunca deve entrar
 * no aplicativo, em variável EXPO_PUBLIC_ ou nos logs.
 */

const baseUrl = (process.env.FINFLOW_SUPABASE_URL || process.env.SUPABASE_URL || "").trim();
const serviceRole = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const requestedWindow = Number(process.env.FINFLOW_AI_MONITOR_WINDOW_MINUTES || "60");
const windowMinutes = Number.isInteger(requestedWindow)
  ? Math.min(10080, Math.max(5, requestedWindow))
  : 60;

function fail(message) {
  console.error(`Monitor da IA: ${message}`);
  process.exit(2);
}

if (!baseUrl || !serviceRole) {
  fail("configure FINFLOW_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY somente no ambiente administrativo.");
}

let endpoint;
try {
  const parsed = new URL(baseUrl);
  const local = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
  if (parsed.protocol !== "https:" && !local) fail("a URL remota do Supabase precisa usar HTTPS.");
  endpoint = new URL("/rest/v1/rpc/ai_monitor_health", parsed);
} catch {
  fail("URL do Supabase inválida.");
}

async function main() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: serviceRole,
        authorization: `Bearer ${serviceRole}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ p_window_minutes: windowMinutes }),
      signal: controller.signal,
    });
  } catch (error) {
    fail(error?.name === "AbortError" ? "consulta expirou." : "não foi possível consultar o backend.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) fail(`backend respondeu HTTP ${response.status}.`);

  const payload = await response.json().catch(() => null);
  const validStatus = new Set(["healthy", "attention", "degraded", "no_data"]);
  if (!payload || !validStatus.has(payload.status)) fail("resumo inválido recebido do backend.");

  const summary = {
    status: payload.status,
    window_minutes: payload.window_minutes,
    requests: payload.requests,
    completed: payload.completed,
    failed: payload.failed,
    reserved: payload.reserved,
    failure_rate: payload.failure_rate,
    average_latency_ms: payload.average_latency_ms,
    p95_latency_ms: payload.p95_latency_ms,
    last_success_at: payload.last_success_at,
    errors: Array.isArray(payload.errors) ? payload.errors : [],
  };
  console.log(JSON.stringify(summary, null, 2));

  if (payload.status === "degraded") process.exit(2);
  if (payload.status === "attention") process.exit(1);
}

main().catch(() => fail("falha inesperada sem exposição de dados financeiros."));
