const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "lib", "utils.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-money-input-"));
const modulePath = path.join(tempDir, "utils.cjs");
fs.writeFileSync(modulePath, output);

const {
  MAX_MONEY_VALUE,
  formatarEntradaMoeda,
  valorDaEntradaMoeda,
} = require(modulePath);

const expectEqual = (actual, expected, message) => {
  if (!Object.is(actual, expected)) {
    throw new Error(`${message}: recebido ${JSON.stringify(actual)}, esperado ${JSON.stringify(expected)}`);
  }
};

expectEqual(formatarEntradaMoeda("1"), "0,01", "Primeiro digito deve representar um centavo");
expectEqual(formatarEntradaMoeda("123456"), "1.234,56", "Mascara monetaria progressiva incorreta");
expectEqual(valorDaEntradaMoeda("1.234,56"), 1234.56, "Conversao em reais incorreta");
expectEqual(valorDaEntradaMoeda("12,345"), 12.35, "Valor precisa ser arredondado para centavos");
expectEqual(valorDaEntradaMoeda("nao-e-valor"), 0, "Entrada invalida deve falhar fechada");
expectEqual(valorDaEntradaMoeda("999.999.999.999,99"), MAX_MONEY_VALUE, "Limite monetario valido foi rejeitado");
expectEqual(valorDaEntradaMoeda("1.000.000.000.000,00"), 0, "Valor acima do limite deve ser rejeitado");
expectEqual(formatarEntradaMoeda("999999999999999999999"), "999.999.999.999,99", "Mascara deve limitar o tamanho da entrada");

console.log("Money input tests passed.");
