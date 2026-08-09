const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "lib", "password.ts"), "utf8");
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

console.log("Password validation tests passed.");
