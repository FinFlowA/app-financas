const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const migrationPath = path.join(
  projectRoot,
  "supabase",
  "migrations",
  "20260802000100_secure_finance_ai.sql",
);
const sql = fs.readFileSync(migrationPath, "utf8");
const finalOverridePath = path.join(
  projectRoot,
  "supabase",
  "migrations",
  "20260802000400_harden_plan_limit_trigger.sql",
);
const finalOverrideSql = fs.readFileSync(finalOverridePath, "utf8");
const edgeSource = fs.readFileSync(
  path.join(projectRoot, "supabase", "functions", "finance-ai", "index.ts"),
  "utf8",
);

function assertIncludes(source, fragment, message) {
  if (!source.includes(fragment)) throw new Error(message);
}

function assertMatches(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

assertIncludes(
  sql,
  "state_fingerprint text check",
  "A tabela de propostas precisa guardar o fingerprint privado.",
);
assertIncludes(
  sql,
  "private.ai_action_state_fingerprint(",
  "A função canônica de fingerprint não foi encontrada.",
);
const fingerprintBody = sql.match(
  /create or replace function private\.ai_action_state_fingerprint\([\s\S]*?\nas \$\$([\s\S]*?)\$\$;/,
)?.[1] ?? "";
assertMatches(
  fingerprintBody,
  /^\s*reference_row\s+record;/m,
  "O loop de contas da função de fingerprint precisa declarar reference_row no próprio bloco.",
);
assertIncludes(
  sql,
  "caller,p_action_type,normalized,false",
  "A criação da prévia precisa capturar o estado sem lock duradouro.",
);
assertIncludes(
  sql,
  "verified_state_fingerprint is distinct from state_fingerprint",
  "A própria geração da prévia precisa detectar mudança concorrente.",
);
assertIncludes(
  sql,
  "caller,action_row.action_type,action_row.payload,true",
  "A confirmação precisa recalcular e bloquear o estado-alvo.",
);
assertIncludes(
  sql,
  "current_state_fingerprint is distinct from action_row.state_fingerprint",
  "A comparação null-safe do fingerprint não foi encontrada.",
);
assertIncludes(
  sql,
  "'AI_ACTION_STATE_CHANGED'",
  "O conflito de estado precisa falhar com um código público estável.",
);
assertIncludes(
  sql,
  "revoke all on function private.ai_action_state_fingerprint(uuid,text,jsonb,boolean)",
  "A função privada de fingerprint não pode ser executável pelo cliente.",
);

for (const [fragment, message] of [
  ["caller,p_action_type,normalized,false", "A versão final da criação de propostas perdeu a captura do estado."],
  ["state_fingerprint,preview,idempotency_key", "A versão final precisa persistir o fingerprint."],
  ["verified_state_fingerprint is distinct from state_fingerprint", "A versão final perdeu a dupla leitura da prévia."],
  ["caller,action_row.action_type,action_row.payload,true", "A versão final da confirmação perdeu o lock do estado."],
  ["current_state_fingerprint is distinct from action_row.state_fingerprint", "A versão final perdeu a comparação otimista."],
  ["'AI_ACTION_STATE_CHANGED'", "A versão final precisa falhar fechado em conflito."],
  ["coalesce(action_row.last_error_code='AI_ACTION_STATE_CHANGED',false)", "O replay de uma proposta obsoleta precisa ser identificado sem nova execução."],
]) {
  assertIncludes(finalOverrideSql, fragment, message);
}

assertMatches(
  edgeSource,
  /code === "AI_ACTION_STATE_CHANGED"[\s\S]{0,400}return 409;/,
  "O conflito otimista deve ser traduzido pela Edge como HTTP 409.",
);

process.stdout.write("Finance AI optimistic state guard tests passed.\n");
