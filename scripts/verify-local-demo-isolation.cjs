const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const fail = (message) => {
  throw new Error(`Local demo isolation failed: ${message}`);
};

const supabaseAdapter = read("lib/supabase.ts");
const launcher = read("scripts/start-local-demo.cjs");
const guard = read("lib/local-demo/network-guard.ts");

if (!supabaseAdapter.includes("EXPO_PUBLIC_FINFLOW_LOCAL_DEMO")) fail("flag ausente no adaptador Supabase");
if (!supabaseAdapter.includes("createLocalDemoSupabaseClient")) fail("mock local não é selecionado pelo adaptador");
if (!supabaseAdapter.includes("installLocalDemoNetworkGuard")) fail("guarda de rede não é instalado pelo adaptador");
if (!launcher.includes('EXPO_PUBLIC_SUPABASE_URL: "http://127.0.0.1:9"')) fail("launcher não neutraliza a URL remota");
if (!launcher.includes('EXPO_OFFLINE: "1"') || !launcher.includes('"--offline"')) fail("launcher não força Expo offline");
if (!guard.includes("XMLHttpRequest") || !guard.includes("WebSocket") || !guard.includes("sendBeacon")) {
  fail("guarda não cobre os canais esperados");
}

const demoDir = path.join(root, "lib", "local-demo");
for (const entry of fs.readdirSync(demoDir)) {
  if (!entry.endsWith(".ts") || entry === "network-guard.ts") continue;
  const source = fs.readFileSync(path.join(demoDir, entry), "utf8");
  if (/\bcreateClient\s*\(/.test(source)) fail(`${entry} instancia Supabase real`);
  if (/https?:\/\/(?:[^\s"']*supabase|api\.openai|api\.groq)/i.test(source)) fail(`${entry} contém endpoint remoto`);
  if (/\bfetch\s*\(/.test(source)) fail(`${entry} faz fetch direto`);
}

console.log("Local demo isolation checks passed.");
