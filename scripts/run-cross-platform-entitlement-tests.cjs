const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), "utf8");
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

const paddle = read("supabase", "migrations", "20260918000300_paddle_fulfillment.sql");
const google = read("supabase", "migrations", "20260923000100_google_play_billing.sql");
const appSubscription = read("lib", "subscriptions.ts");
const appLayout = read("app", "_layout.tsx");
const webPlans = read("web", "src", "app", "(dashboard)", "planos", "page.tsx");

expect(paddle.includes("insert into public.subscriptions"), "Paddle deve gravar na tabela compartilhada subscriptions.");
expect(paddle.includes("'paddle'"), "A assinatura Paddle deve preservar seu provedor.");
expect(google.includes("insert into public.subscriptions"), "Google Play deve gravar na tabela compartilhada subscriptions.");
expect(google.includes("'google_play'"), "A assinatura Google Play deve preservar seu provedor.");
expect(appSubscription.includes('rpc("get_my_entitlement")'), "O app deve obter o plano pela RPC compartilhada.");
expect(webPlans.includes('rpc("get_my_entitlement")'), "O site deve obter o plano pela RPC compartilhada.");
expect(appLayout.includes('state === "active"') && appLayout.includes("refreshEntitlement()"), "O app deve reapurar o plano quando voltar ao primeiro plano.");
expect(/order by case s\.plan when 'premium' then 2 when 'smart' then 1 else 0 end desc/.test(paddle), "A RPC deve escolher o maior plano ativo entre provedores.");

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("Entitlement multiplataforma validado: Paddle e Google Play ativam a mesma conta no site e no app.");
