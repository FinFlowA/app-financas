/* global __dirname */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "lib", "finance-ai");
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-finance-ai-tests-"));

function stringArray(source, constantName) {
  const escaped = constantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`export const ${escaped} = \\[([\\s\\S]*?)\\] as const;`));
  if (!match) throw new Error(`Contrato ${constantName} não encontrado.`);
  return [...match[1].matchAll(/"([a-z0-9_]+)"/g)].map((item) => item[1]);
}

function assertSameContract(clientName, edgeName) {
  const client = fs.readFileSync(path.join(sourceRoot, "types.ts"), "utf8");
  const edge = fs.readFileSync(path.join(projectRoot, "supabase", "functions", "finance-ai", "contracts.ts"), "utf8");
  const left = stringArray(client, clientName);
  const right = stringArray(edge, edgeName);
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`Contrato divergente: ${clientName} != ${edgeName}.`);
  }
}

function assertSqlSafetyGuards() {
  const migrationsRoot = path.join(projectRoot, "supabase", "migrations");
  const core = fs.readFileSync(
    path.join(migrationsRoot, "20260802000100_secure_finance_ai.sql"),
    "utf8",
  );
  const planLimit = fs.readFileSync(
    path.join(migrationsRoot, "20260802000400_harden_plan_limit_trigger.sql"),
    "utf8",
  );
  const realization = fs.readFileSync(
    path.join(migrationsRoot, "20260802000000_ensure_data_realizacao.sql"),
    "utf8",
  );
  const monitoring = fs.readFileSync(
    path.join(migrationsRoot, "20260808000000_ai_safe_monitoring.sql"),
    "utf8",
  );
  const edge = fs.readFileSync(
    path.join(projectRoot, "supabase", "functions", "finance-ai", "index.ts"),
    "utf8",
  );
  const chat = fs.readFileSync(
    path.join(projectRoot, "app", "chat-ia.tsx"),
    "utf8",
  );

  const recurringGuard = "AI_LEGACY_RECURRING_SERIES_REQUIRES_INDIVIDUAL";
  if ((core.match(new RegExp(recurringGuard, "g")) ?? []).length < 2) {
    throw new Error("Recorrência legada precisa falhar tanto na prévia quanto na execução.");
  }
  if (!core.includes("target_kind='recorrente'")) {
    throw new Error("Executor não bloqueia recorrência legada sem identificador persistente.");
  }
  if (!planLimit.includes("jwt_role='service_role'")
      || !planLimit.includes("session_user in ('postgres','supabase_admin')")
      || !planLimit.includes("actor_id is null or new.user_id is distinct from actor_id")) {
    throw new Error("Trigger de plano não distingue usuário, service_role e manutenção controlada.");
  }
  const ownershipGuard = planLimit.indexOf("actor_id is null or new.user_id is distinct from actor_id");
  const limitsShortcut = planLimit.indexOf("if not coalesce(limits_on,false) then return new; end if;");
  if (ownershipGuard < 0 || limitsShortcut < 0 || ownershipGuard > limitsShortcut) {
    throw new Error("Validação de titularidade deve ocorrer antes do atalho de limites desligados.");
  }
  for (const required of [
    "add column if not exists data_realizacao date",
    "set data_realizacao = data_vencimento",
    "create index if not exists transacoes_data_realizacao_idx",
    "comment on column public.transacoes.data_realizacao",
  ]) {
    if (!realization.toLowerCase().includes(required)) {
      throw new Error(`Migração data_realizacao incompleta: ${required}.`);
      }
  }
  for (const required of [
    "add column if not exists latency_ms integer",
    "add column if not exists error_code text",
    "ai_finalize_model_request_v2",
    "ai_monitor_health",
    "AI_SERVICE_ROLE_REQUIRED",
    "grant execute on function public.ai_monitor_health(integer)",
  ]) {
    if (!monitoring.includes(required)) {
      throw new Error(`Monitoramento seguro da IA incompleto: ${required}.`);
    }
  }
  if (/\b(prompt|response|message|description|financial_value|user_id)\s+(?:text|jsonb|numeric|uuid)\b/i.test(monitoring)) {
    throw new Error("A telemetria da IA nao pode criar colunas de conteudo financeiro ou conversa.");
  }
  if (!edge.includes('admin.rpc("ai_finalize_model_request_v2"')
      || !edge.includes("latencyMs: monitoringLatencyMs(requestStartedAt)")
      || !edge.includes("errorCode: providerErrorCode")) {
    throw new Error("A Edge nao finaliza status, latencia e erros pela telemetria v2.");
  }
  if (chat.includes("AsyncStorage.setItem") || chat.includes("localStorage")) {
    throw new Error("Conversa ou token de confirmacao nao podem ser persistidos em armazenamento comum.");
  }
  for (const required of [
    "SecureStore.setItemAsync",
    "SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY",
    "globalThis.sessionStorage",
    "migrateLegacyNativeStorage",
    "AsyncStorage.removeItem",
  ]) {
    if (!chat.includes(required)) throw new Error(`Migracao do armazenamento seguro incompleta: ${required}.`);
  }
}

try {
  const files = ["types.ts", "validation.ts", "validation.test.ts"]
    .map((file) => path.join(sourceRoot, file));
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    skipLibCheck: true,
    rootDir: sourceRoot,
    outDir: outputRoot,
  };
  const program = ts.createProgram(files, options);
  const emitResult = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

  if (diagnostics.length > 0) {
    const host = {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => projectRoot,
      getNewLine: () => os.EOL,
    };
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  }

  if (emitResult.emitSkipped || diagnostics.some((item) => item.category === ts.DiagnosticCategory.Error)) {
    process.exitCode = 1;
  } else {
    const { runFinanceAiValidationTests } = require(path.join(outputRoot, "validation.test.js"));
    runFinanceAiValidationTests();
    assertSameContract("FINANCE_AI_MUTATION_INTENTS", "DIRECT_ACTIONS");
    assertSameContract("FINANCE_AI_READ_INTENTS", "READ_INTENTS");
    assertSameContract("FINANCE_AI_NAVIGATION_INTENTS", "NAVIGATION_INTENTS");
    assertSqlSafetyGuards();
    process.stdout.write("Finance AI validation tests passed.\n");
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  fs.rmSync(outputRoot, { recursive: true, force: true });
}
