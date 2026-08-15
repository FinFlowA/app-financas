#!/usr/bin/env node
/* global __dirname, Buffer */
/* eslint-disable security/detect-non-literal-fs-filename -- todos os caminhos são derivados de raízes fixas deste repositório */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoots = ["app", "components", "constants", "docs", "hooks", "lib", "scripts", "supabase", "web"];
const rootFiles = ["app.json", "package.json", ".env.example", "eas.json", "metro.config.js"];
const allowedExtensions = new Set([".ts", ".tsx", ".js", ".cjs", ".mjs", ".json", ".sql", ".toml", ".md", ".html"]);
const ignoredNames = new Set(["node_modules", ".git", ".expo", ".next", ".codex-tmp-local-demo"]);
const ignoredPrefixes = ["dist", ".codex-work"];

const findings = [];

function declaredPlpgsqlVariables(body) {
  const declaration = body.match(/^\s*declare\b([\s\S]*?)^\s*begin\b/imu)?.[1] ?? "";
  const variables = new Set();

  for (const line of declaration.split(/\r?\n/u)) {
    const match = line.match(/^\s*([a-z_][a-z0-9_]*)\s+(?:constant\s+)?[a-z_][a-z0-9_.]*(?:%rowtype|%type|\[\])?/iu);
    if (match) variables.add(match[1].toLowerCase());
  }

  return variables;
}

function findUndeclaredPlpgsqlLoopVariables(sql) {
  const problems = [];
  const bodyPattern = /\$\$([\s\S]*?)\$\$/gu;
  let bodyMatch;

  while ((bodyMatch = bodyPattern.exec(sql)) !== null) {
    const body = bodyMatch[1];
    if (!/^\s*(?:declare|begin)\b/iu.test(body)) continue;

    const declared = declaredPlpgsqlVariables(body);
    const bodyStartLine = sql.slice(0, bodyMatch.index).split(/\r?\n/u).length;
    const loopPatterns = [
      /^\s*foreach\s+([a-z_][a-z0-9_]*)\s+in\s+array\b/gimu,
      /^\s*for\s+([a-z_][a-z0-9_]*(?:\s*,\s*[a-z_][a-z0-9_]*)*)\s+in\s*(?=(?:select|execute|with)\b|\(\s*(?:select|with)\b)/gimu,
    ];

    for (const pattern of loopPatterns) {
      let loopMatch;
      while ((loopMatch = pattern.exec(body)) !== null) {
        const line = bodyStartLine + body.slice(0, loopMatch.index).split(/\r?\n/u).length - 1;
        for (const variable of loopMatch[1].split(",").map((name) => name.trim().toLowerCase())) {
          if (!declared.has(variable)) problems.push({ variable, line });
        }
      }
    }
  }

  return problems;
}

function findInvalidPostgresNulExpressions(sql) {
  const problems = [];
  const patterns = [
    { pattern: /\bchr\s*\(\s*0\s*\)/giu, message: "chr(0) nao pode ser materializado como text no PostgreSQL." },
    { pattern: /\bU&\s*'(?:''|[^'])*\\(?:0000|\+000000)(?:''|[^'])*'/giu, message: "Literal Unicode NUL nao e aceito em text no PostgreSQL." },
    { pattern: /\bE\s*'(?:''|[^'])*\\(?:000|x00|u0000|U00000000)(?:''|[^'])*'/giu, message: "Literal escapado com NUL nao e aceito em text no PostgreSQL." },
    {
      pattern: /\bconvert_from\s*\(\s*(?:decode\s*\(\s*'00'\s*,\s*'hex'\s*\)|'(?:\\x)?00'\s*::\s*bytea)/giu,
      message: "Conversao de byte NUL para text nao e aceita no PostgreSQL.",
    },
    { pattern: /\u0000/gu, message: "Byte NUL real encontrado no arquivo SQL." },
  ];

  for (const { pattern, message } of patterns) {
    let match;
    while ((match = pattern.exec(sql)) !== null) {
      problems.push({
        line: sql.slice(0, match.index).split(/\r?\n/u).length,
        message,
      });
    }
  }

  return problems;
}

function report(level, file, line, message) {
  findings.push({ level, file: file.replaceAll("\\", "/"), line, message });
}

const postgresNulScannerFixtures = [
  "select chr(0);",
  "select U&'\\0000';",
  "select E'\\000';",
  "select convert_from(decode('00','hex'),'UTF8');",
  `select '${String.fromCharCode(0)}';`,
];
if (postgresNulScannerFixtures.some((fixture) => findInvalidPostgresNulExpressions(fixture).length === 0)) {
  report("ERROR", "scripts/security-check.cjs", 1, "A regressao interna do detector PostgreSQL NUL falhou.");
}

function collect(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) return [];
  const stat = fs.statSync(absolutePath);
  if (stat.isFile()) return [relativePath];

  const output = [];
  for (const entry of fs.readdirSync(absolutePath, { withFileTypes: true })) {
    if (ignoredNames.has(entry.name) || ignoredPrefixes.some((prefix) => entry.name.startsWith(prefix))) continue;
    const child = path.join(relativePath, entry.name);
    if (entry.isDirectory()) output.push(...collect(child));
    else if (allowedExtensions.has(path.extname(entry.name))) output.push(child);
  }
  return output;
}

const files = [...new Set([...sourceRoots.flatMap(collect), ...rootFiles.filter((file) => fs.existsSync(path.join(root, file)))])];

const migrationsDirectory = path.join(root, "supabase", "migrations");
if (fs.existsSync(migrationsDirectory)) {
  const versions = new Map();
  for (const migrationName of fs.readdirSync(migrationsDirectory)) {
    const version = migrationName.match(/^(\d+)_/)?.[1];
    if (!version) continue;
    const previous = versions.get(version);
    if (previous) {
      report(
        "ERROR",
        path.join("supabase", "migrations", migrationName),
        1,
        `Versao de migration duplicada com ${previous}: ${version}.`,
      );
    } else {
      versions.set(version, migrationName);
    }

    const migrationPath = path.join(migrationsDirectory, migrationName);
    if (fs.statSync(migrationPath).isFile()) {
      const migrationSql = fs.readFileSync(migrationPath, "utf8");
      if (/\bjsonb_object_length\s*\(/u.test(migrationSql)) {
        report(
          "ERROR",
          path.join("supabase", "migrations", migrationName),
          1,
          "jsonb_object_length nao existe no PostgreSQL; conte jsonb_object_keys de forma explicita.",
        );
      }
      for (const problem of findUndeclaredPlpgsqlLoopVariables(migrationSql)) {
        report(
          "ERROR",
          path.join("supabase", "migrations", migrationName),
          problem.line,
          `Variavel de loop PL/pgSQL nao declarada: ${problem.variable}.`,
        );
      }
      for (const problem of findInvalidPostgresNulExpressions(migrationSql)) {
        report(
          "ERROR",
          path.join("supabase", "migrations", migrationName),
          problem.line,
          problem.message,
        );
      }
    }
  }
}

// Defesa em profundidade do pipeline: assets versionados precisam ser PNG real
// e não podem redirecionar o bundler para conteúdo externo por link simbólico.
const assetRoot = path.join(root, "assets");
if (fs.existsSync(assetRoot)) {
  const pending = [assetRoot];
  const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        report("ERROR", path.relative(root, absolute), 1, "Links simbólicos não são permitidos nos assets.");
        continue;
      }
      if (entry.isDirectory()) {
        pending.push(absolute);
        continue;
      }
      const relative = path.relative(root, absolute);
      if (path.extname(entry.name).toLowerCase() !== ".png") {
        report("ERROR", relative, 1, "Formato de imagem não permitido nos assets; use PNG validado.");
        continue;
      }
      const header = Buffer.alloc(8);
      const descriptor = fs.openSync(absolute, "r");
      const bytesRead = fs.readSync(descriptor, header, 0, header.length, 0);
      fs.closeSync(descriptor);
      if (bytesRead !== pngSignature.length || !header.equals(pngSignature)) {
        report("ERROR", relative, 1, "Arquivo com extensão PNG não possui assinatura PNG válida.");
      }
    }
  }
}

const secretPatterns = [
  [/(?:^|[^A-Za-z0-9_])sb_secret_[A-Za-z0-9_-]{20,}/, "chave secreta do Supabase"],
  [/(?:^|[^A-Za-z0-9_])gsk_[A-Za-z0-9_-]{24,}/, "chave da Groq"],
  [/(?:^|[^A-Za-z0-9_])xkeysib-[A-Za-z0-9_-]{20,}/, "chave da Brevo"],
  [/(?:^|[^A-Za-z0-9_])sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/, "chave de provedor de IA"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "chave privada"],
  [/\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\b/, "JWT gravado no repositório"],
];

for (const file of files) {
  const content = fs.readFileSync(path.join(root, file), "utf8");
  const lines = content.split(/\r?\n/);
  const isSecurityFixture = /(?:^|[\\/])(?:guard|workflow_security)_test\.ts$/.test(file);
  const isScannerItself = file.replaceAll("\\", "/") === "scripts/security-check.cjs";
  const allowsLocalTestEval = file.replaceAll("\\", "/") === "scripts/run-finance-ai-context-tests.cjs"
    && content.includes("security-check: allow-local-test-eval");
  lines.forEach((line, index) => {
    if (!isSecurityFixture) {
      for (const [pattern, label] of secretPatterns) {
        if (pattern.test(line)) report("ERROR", file, index + 1, `Possível ${label} hardcoded.`);
      }
    }

    if (/process\.env\.EXPO_PUBLIC_[A-Z0-9_]*(?:SECRET|SERVICE_ROLE|PRIVATE|PASSWORD)/.test(line)) {
      report("ERROR", file, index + 1, "Segredo referenciado por variável EXPO_PUBLIC_, que é embutida no aplicativo.");
    }
    if (/\bstorage\s*:\s*AsyncStorage\b/.test(line) && file.replaceAll("\\", "/").endsWith("lib/supabase.ts")) {
      report("ERROR", file, index + 1, "Sessão de autenticação ainda usa AsyncStorage em texto simples.");
    }
    if (!isScannerItself && !allowsLocalTestEval && /\b(?:eval|new Function)\s*\(/.test(line)) {
      report("WARN", file, index + 1, "Execução dinâmica de código exige revisão manual.");
    }
    if (!isScannerItself && /dangerouslySetInnerHTML/.test(line)) {
      report("WARN", file, index + 1, "HTML inserido diretamente exige sanitização contra XSS.");
    }
    const httpMatch = line.match(/http:\/\/[^\s"'`)]+/i);
    if (httpMatch && !/^http:\/\/(?:localhost|127\.0\.0\.1|10\.|192\.168\.)/i.test(httpMatch[0])) {
      report("WARN", file, index + 1, `Endpoint sem TLS: ${httpMatch[0]}`);
    }
  });
}

function requireText(file, expected, message) {
  const absolute = path.join(root, file);
  const content = fs.existsSync(absolute) ? fs.readFileSync(absolute, "utf8") : "";
  if (!content.includes(expected)) report("ERROR", file, 1, message);
}

requireText(
  "supabase/config.toml",
  "[functions.finance-ai]\nverify_jwt = true",
  "A Edge Function financeira precisa exigir JWT.",
);
requireText(
  "supabase/functions/send-auth-sms/index.ts",
  "new Webhook(webhookSecret()).verify",
  "O hook público de SMS precisa validar a assinatura do Supabase.",
);
requireText(
  "supabase/migrations/20260731000100_harden_core_rls.sql",
  "revoke all on table public.%I from anon",
  "A migração de RLS precisa revogar acesso anônimo às tabelas financeiras.",
);

requireText(
  "supabase/migrations/20260808001100_atomic_partial_transaction_completion.sql",
  "create or replace function public.complete_transaction_with_partial",
  "A conclusão parcial precisa ser atômica no banco.",
);
requireText(
  "supabase/migrations/20260808001100_atomic_partial_transaction_completion.sql",
  "create or replace function public.reopen_transaction_completion",
  "A reabertura de uma conclusão parcial precisa ser atômica no banco.",
);
requireText(
  "app/(tabs)/transacoes.tsx",
  '"complete_transaction_with_partial"',
  "O cliente precisa usar a conclusão parcial atômica.",
);
requireText(
  "app/_layout.tsx",
  "preventScreenCaptureAsync",
  "O aplicativo precisa proteger os dados financeiros na tela de aplicativos recentes.",
);
requireText(
  "app/_layout.tsx",
  "enableAppSwitcherProtectionAsync",
  "No iOS, o aplicativo precisa ocultar os dados no seletor de aplicativos.",
);
requireText(
  "app/_layout.tsx",
  "disableAppSwitcherProtectionAsync",
  "A protecao do seletor de aplicativos iOS precisa ser removida apenas fora da sessao.",
);
requireText(
  "app/_layout.tsx",
  "const deveProtegerAgora = Boolean(usuarioSessaoRef.current)",
  "A protecao de tela precisa reconciliar chamadas assincronas durante a troca de sessao.",
);
requireText(
  "app.json",
  '"allowBackup": false',
  "O build Android financeiro nao deve permitir backup dos dados locais do aplicativo.",
);
requireText(
  "metro.config.js",
  "const config = getDefaultConfig(__dirname);",
  "O Metro precisa partir da configuracao padrao do Expo para nao remover extensoes obrigatorias.",
);
requireText(
  "metro.config.js",
  'config.resolver.assetExts.includes("wasm")',
  "O Metro precisa preservar o suporte WASM usado pelo expo-sqlite.",
);
requireText(
  "lib/supabase.ts",
  'requireOptionalNativeModule<ExpoSecureStoreNativeModule>("ExpoSecureStore")',
  "A sessão precisa detectar o cofre nativo sem impedir a inicialização do APK 2.0 original.",
);
requireText(
  "lib/supabase.ts",
  "nativeSecureStore.setValueWithKeyAsync",
  "Builds com SecureStore precisam armazenar a sessão no cofre criptografado do sistema.",
);
requireText(
  "lib/supabase.ts",
  "if (!nativeSecureStore) return AsyncStorage.getItem(key);",
  "O APK 2.0 original precisa preservar a sessão legada quando o módulo nativo não existe.",
);
requireText(
  "lib/notifications.ts",
  "geracaoAgendaNotificacoes += 1",
  "O logout precisa invalidar qualquer reagendamento de notificação que ainda esteja em andamento.",
);
requireText(
  "lib/notifications.ts",
  "geracaoSessaoNotificacoes += 1",
  "O logout precisa invalidar avisos obrigatorios que ainda estejam em andamento.",
);

requireText(
  "lib/notifications.ts",
  "sessaoDepoisDoAgendamento.session?.user.id !== userId",
  "Cada aviso precisa revalidar a sessao depois de ser agendado para fechar a corrida com o logout.",
);
const notificationSource = fs.readFileSync(path.join(root, "lib", "notifications.ts"), "utf8");
if ((notificationSource.match(/cancelAllScheduledNotificationsAsync\(\)/g) || []).length !== 1) {
  report(
    "ERROR",
    "lib/notifications.ts",
    1,
    "Cancelamento global de notificacoes deve existir somente no logout; agendas opcionais preservam eventos obrigatorios.",
  );
}
if (!notificationSource.includes("const gatilhoIntervalo") || !notificationSource.includes("...(channelId ? { channelId } : {})")) {
  report(
    "ERROR",
    "lib/notifications.ts",
    1,
    "Lembretes Android precisam usar o canal FinFlow no gatilho nativo.",
  );
}
if (
  !notificationSource.includes('ANDROID_NOTIFICATION_CHANNEL_ID = "finflow-private-v2"')
  || !notificationSource.includes("lockscreenVisibility: Notif.AndroidNotificationVisibility.PRIVATE")
) {
  report(
    "ERROR",
    "lib/notifications.ts",
    1,
    "O canal Android deve ocultar conteudo financeiro na tela bloqueada.",
  );
}
requireText(
  "supabase/config.toml",
  "secure_password_change = true",
  "A configuracao de Auth precisa exigir reautenticacao para troca de senha.",
);
requireText(
  "app/seguranca.tsx",
  "current_password: verifiedPasswordRef.current",
  "Alteracoes sensiveis precisam enviar a senha atual para validacao no Auth.",
);
requireText(
  "supabase/migrations/20260808001200_require_eligible_financial_profile.sql",
  "FINFLOW_PROFILE_REQUIRED",
  "O banco precisa impedir escrita financeira sem idade e aceite legal validos.",
);
requireText(
  "supabase/migrations/20260808001200_require_eligible_financial_profile.sql",
  "'fatura_itens', 'compras_cartao'",
  "Compras do cartao tambem precisam respeitar idade e aceite legal.",
);
requireText(
  "supabase/migrations/20260808001300_money_bounds.sql",
  "abs(%I) <= 999999999999.99",
  "O banco precisa limitar valores monetarios e sua precisao.",
);

const sorted = findings.sort((a, b) => a.level.localeCompare(b.level) || a.file.localeCompare(b.file) || a.line - b.line);
if (sorted.length === 0) {
  console.log("Security check: nenhum segredo ou padrão crítico encontrado.");
  process.exit(0);
}

for (const finding of sorted) {
  console.log(`${finding.level} ${finding.file}:${finding.line} - ${finding.message}`);
}
const errors = sorted.filter((finding) => finding.level === "ERROR").length;
const warnings = sorted.length - errors;
console.log(`Security check: ${errors} erro(s), ${warnings} aviso(s).`);
process.exit(errors > 0 ? 1 : 0);
