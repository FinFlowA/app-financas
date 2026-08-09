const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function includesAll(source, fragments, label) {
  for (const fragment of fragments) {
    assert(source.includes(fragment), `${label}: ausente ${fragment}`);
  }
}

const http = read("supabase/functions/_shared/http.ts");
includesAll(http, [
  "FINFLOW_ALLOWED_ORIGINS",
  "if (origin === null) return true",
  "ORIGIN_NOT_ALLOWED",
  "REQUEST_TOO_LARGE",
  "req.body?.getReader()",
  "reader.cancel",
  "INVALID_CONTENT_LENGTH",
  "UNSUPPORTED_MEDIA_TYPE",
  '"Cache-Control": "no-store"',
  '"X-Content-Type-Options": "nosniff"',
], "HTTP/CORS");
assert(!http.includes('"Access-Control-Allow-Origin": "*"'), "CORS não pode liberar wildcard");

const supabaseShared = read("supabase/functions/_shared/supabase.ts");
const financeContext = read("supabase/functions/finance-ai/context.ts");
assert(supabaseShared.includes("@supabase/supabase-js@2.111.0"), "Supabase Edge precisa de versão exata");
assert(financeContext.includes("@supabase/supabase-js@2.111.0"), "Tipo Supabase da IA precisa de versão exata");
assert(!supabaseShared.includes("@supabase/supabase-js@2\""), "Import major-only ainda presente");

const webhook = read("supabase/functions/mercado-pago-webhook/index.ts");
includesAll(webhook, [
  "readJsonRequest(req, { maxBytes: MAX_WEBHOOK_BYTES })",
  '"claim_subscription_event"',
  '"finalize_subscription_event"',
  "EVENT_PROCESSING",
  "storedPayload(payload, dataId)",
  "p_error_code: code",
], "Webhook Mercado Pago");
assert(!webhook.includes('.from("subscription_events").insert'), "Webhook não pode confirmar por insert simples");

const migration = read("supabase/migrations/20260808001000_harden_external_edges.sql");
includesAll(migration, [
  "alter table public.%I enable row level security",
  "create or replace function private.finflow_validate_financial_references",
  "FINFLOW_TRANSACTION_CATEGORY_INVALID",
  "FINFLOW_TRANSACTION_ACCOUNT_INVALID",
  "FINFLOW_INVOICE_CATEGORY_INVALID",
  "FINFLOW_INVOICE_CARD_INVALID",
  "finflow_validate_transaction_references",
  "finflow_validate_invoice_item_references",
  'drop policy if exists "fatura_itens_owner_all"',
  "and fatura_itens.categoria_id is not null",
  "status = 'pendente'",
  "FINFLOW_ACCEPTED_PARTNERSHIP_RPC_REQUIRED",
  "create or replace function public.claim_subscription_event",
  "create or replace function public.finalize_subscription_event",
  "processing_locked_until",
  "LEGACY_REDACTED",
  "create or replace function public.reserve_edge_rate_limit",
  "subscriptions_checkout_idempotency_unique",
  "finflow_cleanup_external_edge_retention",
  "interval '180 days'",
], "Migration de hardening");
assert(
  migration.indexOf("processed_at is not null") < migration.indexOf("return jsonb_build_object(\n      'claimed', false,\n      'processed', true"),
  "Replay processado deve ser distinguido de claim em andamento",
);

const sms = read("supabase/functions/send-auth-sms/index.ts");
includesAll(sms, [
  "readJsonRequest(req, { maxBytes: 16_000 })",
  '"reserve_edge_rate_limit"',
  'p_scope: "sms_verification"',
  "`user:${userId}`",
  "`phone:${phone}`",
  "p_cooldown_seconds: 60",
  '"Retry-After"',
], "SMS");

const checkout = read("supabase/functions/create-subscription-checkout/index.ts");
includesAll(checkout, [
  'allowedFields: ["productCode", "requestId"]',
  "ALLOWED_PRODUCTS",
  '"smart_monthly"',
  '"premium_annual"',
  "x-idempotency-key",
  "checkout_idempotency_key",
  'p_scope: "subscription_checkout"',
  "`user:${user.id}`",
  "`product:${user.id}:${product.code}`",
  "CHECKOUT_RECONCILIATION_REQUIRED",
  "checkout_requires_reconciliation",
], "Checkout");

for (const relative of [
  "supabase/functions/cancel-subscription/index.ts",
  "supabase/functions/sync-subscription/index.ts",
]) {
  const source = read(relative);
  assert(source.includes('req.method !== "POST"'), `${relative}: POST não é obrigatório`);
  assert(source.includes('405, req'), `${relative}: erro de método não preserva CORS`);
  assert(source.includes("subscriptionError"), `${relative}: falha de leitura não é tratada`);
  assert(source.includes("updateError"), `${relative}: falha de persistência não é tratada`);
}

const mercadoPago = read("supabase/functions/_shared/mercado-pago.ts");
assert(!mercadoPago.includes("response.status, body"), "Resposta bruta do provedor não pode ir para logs");
includesAll(mercadoPago, ["MercadoPagoRequestError", "AbortSignal.timeout(15_000)", "safeProviderCode"], "Cliente Mercado Pago");

const edgeFiles = [];
function collectTypeScript(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) collectTypeScript(absolute);
    else if (entry.isFile() && entry.name.endsWith(".ts")) edgeFiles.push(absolute);
  }
}
collectTypeScript(path.join(root, "supabase", "functions"));
for (const file of edgeFiles) {
  const result = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      strict: true,
    },
  });
  const errors = (result.diagnostics ?? []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert(errors.length === 0, `${path.relative(root, file)}: sintaxe TypeScript inválida`);
}

console.log("Edge security validation tests passed.");
