const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "lib", "password.ts"), "utf8");
const appLayoutSource = fs.readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-password-"));
const modulePath = path.join(tempDir, "password.cjs");
fs.writeFileSync(modulePath, output);
const { validatePassword } = require(modulePath);

const expect = (condition, message) => {
  if (!condition) throw new Error(message);
};

expect(validatePassword("Senha#123").valid, "Senha forte válida foi rejeitada.");
expect(validatePassword("Árvore#123").valid, "Letras acentuadas precisam ser reconhecidas.");
expect(!validatePassword("senha#123").valid, "Maiúscula precisa ser obrigatória.");
expect(!validatePassword("SENHA#123").valid, "Minúscula precisa ser obrigatória.");
expect(!validatePassword("SenhaForte#").valid, "Número precisa ser obrigatório.");
expect(!validatePassword("Senha 123").valid, "Espaço não pode contar como caractere especial.");
expect(!validatePassword("Se#1").valid, "O mínimo de oito caracteres precisa ser obrigatório.");

expect(
  /exchangeCodeForSession\(code\)[\s\S]*?\.then\(async[\s\S]*?url\.includes\("reset-password"\)[\s\S]*?await iniciarFluxoRecuperacaoSenha\(data\.user\?\.id\)/.test(appLayoutSource),
  "O deep link PKCE precisa gravar o fluxo de recuperação antes de abrir a tela de nova senha.",
);

// Link de recuperação "expirado" na hora: o link já abre /reset-password, e
// um router.replace para a mesma tela a recriava; a limpeza da instância
// antiga fazia signOut e derrubava a sessão recém-criada.
const resetSource = fs.readFileSync(path.join(root, "app", "reset-password.tsx"), "utf8");
const inicioFluxo = appLayoutSource.slice(
  appLayoutSource.indexOf("const iniciarFluxoRecuperacaoSenha"),
  appLayoutSource.indexOf("useEffect(", appLayoutSource.indexOf("const iniciarFluxoRecuperacaoSenha")),
).replace(/\/\/.*$/gm, "");
expect(!/router\.(replace|push|navigate)/.test(inicioFluxo), "Gravar o fluxo de recuperação não pode recriar a tela de nova senha.");
expect(
  !/return \(\) => \{[\s\S]{0,200}signOut/.test(resetSource),
  "A tela de nova senha não pode desconectar ao ser desmontada (a navegação também a recria).",
);
expect(/hardwareBackPress[\s\S]{0,120}voltarAoLogin/.test(resetSource), "O Voltar do Android precisa encerrar a sessão do link.");
expect(
  /segments\[0\] === "reset-password"\) return;[\s\S]{0,300}fluxoRecuperacaoVigente\(lerFluxoRecuperacaoSenha\(raw\), userId\)[\s\S]{0,120}router\.replace\("\/reset-password"/.test(appLayoutSource),
  "Com o fluxo de recuperação vigente, outras telas precisam devolver o usuário para a nova senha.",
);

const authFlowOutput = ts.transpileModule(fs.readFileSync(path.join(root, "lib", "auth-flow.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const authFlowPath = path.join(tempDir, "auth-flow.cjs");
fs.writeFileSync(authFlowPath, authFlowOutput);
const authFlow = require(authFlowPath);

expect(
  authFlow.erroNoLinkDeAutenticacao("meuappfinancas://reset-password?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired#error=access_denied&error_code=otp_expired")
    === "otp_expired Email link is invalid or has expired",
  "O erro devolvido pelo Supabase na query precisa ser lido.",
);
expect(
  authFlow.erroNoLinkDeAutenticacao("meuappfinancas://reset-password#error=access_denied&error_code=otp_expired&error_description=x") === "otp_expired x",
  "O erro devolvido no fragmento precisa ser lido.",
);
expect(authFlow.erroNoLinkDeAutenticacao("meuappfinancas://reset-password?code=abc") === null, "Link com código não é erro.");
expect(authFlow.erroNoLinkDeAutenticacao("meuappfinancas://reset-password#access_token=a&refresh_token=b&type=recovery") === null, "Link legado com tokens não é erro.");
expect(authFlow.motivoFalhaRecuperacao("otp_expired Email link is invalid or has expired") === "expirado", "otp_expired é link vencido/usado.");
expect(authFlow.motivoFalhaRecuperacao({ code: "flow_state_not_found", message: "invalid flow state, no valid flow state found" }) === "outro_aparelho", "Sem flow state o link foi aberto fora do app que o pediu.");
expect(authFlow.motivoFalhaRecuperacao({ message: "PKCE code verifier not found in storage." }) === "outro_aparelho", "Sem code_verifier o link foi aberto fora do app que o pediu.");
expect(authFlow.motivoFalhaRecuperacao({ name: "AuthRetryableFetchError", message: "Network request failed" }) === "sem_conexao", "Falha de rede não é link vencido.");
expect(authFlow.motivoFalhaRecuperacao({ message: "algo inesperado" }) === "desconhecido", "Erro desconhecido precisa de mensagem genérica.");
for (const motivo of ["expirado", "outro_aparelho", "sem_conexao", "desconhecido", null]) {
  expect(authFlow.mensagemFalhaRecuperacao(motivo).length > 20, `Mensagem ausente para ${motivo}.`);
}
const agora = Date.now();
expect(authFlow.fluxoRecuperacaoVigente({ userId: "u1", expiresAt: agora + 1000 }, "u1", agora), "Marcador do mesmo usuário e no prazo vale.");
expect(!authFlow.fluxoRecuperacaoVigente({ userId: "u1", expiresAt: agora + 1000 }, "u2", agora), "Marcador de outro usuário não vale.");
expect(!authFlow.fluxoRecuperacaoVigente({ userId: "u1", expiresAt: agora - 1 }, "u1", agora), "Marcador vencido não vale.");
expect(!authFlow.fluxoRecuperacaoVigente(null, "u1", agora), "Sem marcador não há fluxo.");
authFlow.registrarEstadoLinkRecuperacao({ etapa: "processando", desde: agora });
expect(authFlow.lerEstadoLinkRecuperacao()?.etapa === "processando", "Estado do link precisa ficar disponível para a tela.");
authFlow.registrarEstadoLinkRecuperacao(null);

// Senha vazada (HaveIBeenPwned): o SHA-1 em JS puro precisa bater com o do
// Node para qualquer texto, e a checagem só pode enviar o prefixo do hash.
const crypto = require("node:crypto");
const pwnedOutput = ts.transpileModule(
  fs.readFileSync(path.join(root, "lib", "pwned-password.ts"), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } },
).outputText;
const pwnedModulePath = path.join(tempDir, "pwned-password.cjs");
fs.writeFileSync(pwnedModulePath, pwnedOutput);
const { sha1Hex, checkPwnedPassword } = require(pwnedModulePath);

const nodeSha1 = (text) => crypto.createHash("sha1").update(text, "utf8").digest("hex");
for (const sample of ["", "abc", "password", "Senha#123", "Árvore#123", "日本語パスワード", "emoji 🔐💸 senha", "x".repeat(55), "y".repeat(56), "z".repeat(64), "w".repeat(1000)]) {
  expect(sha1Hex(sample) === nodeSha1(sample), `SHA-1 divergente do Node para ${JSON.stringify(sample.slice(0, 20))}.`);
}

const fakeFetch = (body, ok = true) => {
  const calls = [];
  const fn = async (url) => {
    calls.push(String(url));
    return { ok, text: async () => body };
  };
  fn.calls = calls;
  return fn;
};

(async () => {
  const hash = nodeSha1("Senha#123").toUpperCase();
  const leaked = fakeFetch(`0000000000000000000000000000000000A:1\r\n${hash.slice(5)}:17`);
  expect(await checkPwnedPassword("Senha#123", leaked) === "pwned", "Senha vazada não foi detectada.");
  expect(leaked.calls[0] === `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`, "Só o prefixo de 5 caracteres pode sair do aparelho.");
  expect(!leaked.calls[0].includes("Senha"), "A senha nunca pode ir na URL.");
  expect(await checkPwnedPassword("Senha#123", fakeFetch(`${hash.slice(5)}:0`)) === "safe", "Linha de preenchimento (contagem 0) não é vazamento.");
  expect(await checkPwnedPassword("Senha#123", fakeFetch("", false)) === "unknown", "API fora do ar não pode bloquear o usuário.");
  expect(await checkPwnedPassword("Senha#123", async () => { throw new Error("offline"); }) === "unknown", "Falha de rede não pode bloquear o usuário.");

  console.log("Password validation tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
