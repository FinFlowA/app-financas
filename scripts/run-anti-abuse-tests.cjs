/* global __dirname */
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-require */
// Etapa 7 da auditoria de segurança (V08, V09, V12, V13): contrato entre a
// migration, o app e a Edge Function. O comportamento do banco é testado com
// pgTAP em supabase/tests (job "database" do CI).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8").replace(/\r\n/g, "\n");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-anti-abuse-"));

function load(relative, name) {
  const output = ts.transpileModule(read(relative), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modulePath = path.join(tempDir, name);
  fs.writeFileSync(modulePath, output);
  return require(modulePath);
}

// ---------------------------------------------------------------------------
// Mensagem do teto no app
// ---------------------------------------------------------------------------

const { lerTetoSeguranca, mensagemTetoSeguranca, EMAIL_SUPORTE_TETO } = load("lib/teto-seguranca.ts", "teto-seguranca.js");

assert.equal(
  mensagemTetoSeguranca("FINFLOW_TETO_SEGURANCA:lancamentos:diario:5000"),
  "Você atingiu o limite de segurança de 5.000 lançamentos por dia.\n\n"
    + `Tente de novo amanhã. Se precisar de mais, fale com o suporte: ${EMAIL_SUPORTE_TETO}`,
  "A mensagem do teto diário precisa ser a aprovada.",
);
assert.match(
  mensagemTetoSeguranca({ message: "FINFLOW_TETO_SEGURANCA:contas:total:100", code: "P0001" }),
  /^Você atingiu o limite de segurança de 100 contas\. Esse limite inclui os itens arquivados\./,
);
assert.match(
  mensagemTetoSeguranca("FINFLOW_TETO_SEGURANCA:COMPRAS_CARTAO:DIARIO:3000"),
  /3\.000 compras no cartão por dia/,
  "O código da fila chega em maiúsculas.",
);
assert.match(mensagemTetoSeguranca("FINFLOW_TETO_SEGURANCA:lancamentos:total:50000"), /50\.000 lançamentos/);
assert.deepEqual(lerTetoSeguranca("FINFLOW_TETO_SEGURANCA:convites_parceria:diario:10"), {
  recurso: "convites_parceria", periodo: "diario", teto: 10,
});
for (const outro of ["plan limit reached", "P0001", "AI_PLAN_LIMIT", "", null, undefined, { message: null }]) {
  assert.equal(mensagemTetoSeguranca(outro), null, `Não é teto: ${JSON.stringify(outro)}`);
}
assert.equal(EMAIL_SUPORTE_TETO, "Finflowfinancas@gmail.com");

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

const migrationPath = "supabase/migrations/20260930121216_endurece_banco_etapa7.sql";
const migration = read(migrationPath);
assert.match(migration, /^--\s*Reverter:/m, "A migration precisa do plano de reversão.");

const tetosAprovados = {
  lancamentos: ["public.transacoes", "50000", "5000"],
  compras_cartao: ["public.fatura_itens", "20000", "3000"],
  contas: ["public.contas", "100", "null"],
  objetivos: ["public.caixinhas", "100", "null"],
  cartoes: ["public.cartoes", "50", "null"],
  categorias: ["public.categorias", "300", "null"],
  convites_parceria: ["public.parcerias", "null", "10"],
  feedbacks: ["public.feedbacks", "null", "10"],
  historico_finn: ["public.chat_historico", "2000", "300"],
};
for (const [recurso, [tabela, total, diario]] of Object.entries(tetosAprovados)) {
  assert(
    migration.includes(`('${recurso}', '${tabela}', ${total}, ${diario})`),
    `Teto de ${recurso} diferente do aprovado em 30/09/2026.`,
  );
  const coluna = recurso === "convites_parceria" ? "solicitante_id" : "user_id";
  assert(
    new RegExp(`after insert on ${tabela.replace(".", "\\.")}\\n\\s+referencing new table as novas_linhas\\n\\s+for each statement execute function private\\.aplicar_teto_antiabuso\\('${recurso}', '${coluna}'\\)`).test(migration),
    `Gatilho do teto ausente ou errado em ${tabela}.`,
  );
}
assert.equal((migration.match(/create trigger finflow_teto_antiabuso/g) ?? []).length, 9);
assert(migration.includes("if v_jwt_role = 'service_role' or ((select auth.uid()) is null and v_jwt_role = '') then"),
  "Só backends e manutenção sem JWT podem ficar fora do teto.");
assert(migration.includes("'FINFLOW_TETO_SEGURANCA:%s:diario:%s'") && migration.includes("'FINFLOW_TETO_SEGURANCA:%s:total:%s'"),
  "O código de erro precisa seguir o formato que o app e o site leem.");
assert(migration.includes("revoke all on function public.refresh_my_recurring_schedules() from anon;"), "V09 ausente.");
assert(migration.includes("drop extension if exists pg_net;\ncreate extension if not exists pg_net with schema extensions;"), "V12 ausente.");
assert(migration.includes("elsif v_hash is not null and v_atual.instalacao_hash = v_hash then"),
  "V13: só a mesma instalação pode transferir o token.");
assert(migration.includes("revoke all on function public.registrar_dispositivo_push(text, text, text) from public, anon;"),
  "V13: visitante sem login não registra aparelho.");

// A cópia de ai_consume_pending_action só pode diferir da linha de base pela
// linha que traduz o teto para o Finn.
const baseline = read("supabase/migrations/20260929203600_linha_de_base_producao.sql");
const extrairConsumo = (sql) => {
  const inicio = sql.indexOf('CREATE OR REPLACE FUNCTION "public"."ai_consume_pending_action"(');
  assert(inicio >= 0, "ai_consume_pending_action não encontrada");
  return sql.slice(inicio, sql.indexOf("$_$;", inicio) + 4);
};
const linhaNova = "      when error_message ~ '^FINFLOW_TETO_SEGURANCA:' then 'AI_SAFETY_LIMIT_REACHED'\n";
const consumoMigration = extrairConsumo(migration);
assert(consumoMigration.includes(linhaNova), "O Finn precisa receber AI_SAFETY_LIMIT_REACHED.");
assert.equal(consumoMigration.replace(linhaNova, ""), extrairConsumo(baseline),
  "ai_consume_pending_action mudou além da linha do teto.");

// ---------------------------------------------------------------------------
// Integração: toda criação feita pelo app explica o teto
// ---------------------------------------------------------------------------

const index = read("app/(tabs)/index.tsx");
const caixinhas = read("app/(tabs)/caixinhas.tsx");
const cartoes = read("app/(tabs)/cartoes.tsx");
const configuracoes = read("app/(tabs)/configuracoes.tsx");
const contar = (source) => (source.match(/mensagemTetoSeguranca\(/g) ?? []).length;
assert(contar(index) >= 6, "Tela inicial: categoria, conta, conta conjunta, lançamento e transferência precisam do aviso.");
assert(contar(caixinhas) >= 2, "Objetivos: criação normal e compartilhada precisam do aviso.");
assert(contar(cartoes) >= 2, "Cartões: cartão e compra precisam do aviso.");
assert(contar(configuracoes) >= 2, "Ajustes: convite e feedback precisam do aviso.");
assert(
  /!mensagemErroLimitePlano\(res\.error, "contas", plano\) && !mensagemTetoSeguranca\(res\.error\)/.test(index),
  "A conta conjunta não pode ser reenviada depois de esbarrar no teto.",
);

const financeContracts = read("supabase/functions/finance-ai/contracts.ts");
const financeIndex = read("supabase/functions/finance-ai/index.ts");
assert(/AI_SAFETY_LIMIT_REACHED: "Você atingiu um limite de segurança/.test(financeContracts), "Finn sem mensagem do teto.");
assert(financeIndex.includes('code === "AI_SAFETY_LIMIT_REACHED") return 409;'), "Finn: o teto precisa encerrar a prévia (409).");

// V13 no app: o registro envia o segredo da instalação, sem depender de
// módulo nativo ausente no APK antigo.
const notifications = read("lib/notifications.ts");
assert(notifications.includes("...(instalacao ? { p_instalacao: instalacao } : {})"), "O app precisa enviar o segredo da instalação.");
assert(notifications.includes("getOptionalSecureStore()") && notifications.includes("getOptionalExpoCrypto()"),
  "O segredo precisa usar os carregadores opcionais de módulos nativos.");
assert(!/Math\.random/.test(notifications.slice(notifications.indexOf("function gerarSegredoInstalacaoPush"))),
  "O segredo da instalação não pode usar Math.random.");
assert(notifications.includes("registrado !== false"), "Token recusado pelo servidor não pode ser guardado como registrado.");

console.log("Anti-abuse (Etapa 7) tests passed.");
