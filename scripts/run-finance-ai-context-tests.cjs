/* global __dirname */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(projectRoot, "supabase", "functions", "finance-ai");
const compilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  esModuleInterop: true,
};

function transpile(fileName) {
  const source = fs.readFileSync(path.join(sourceRoot, fileName), "utf8");
  const result = ts.transpileModule(source, { compilerOptions, fileName });
  const errors = result.diagnostics?.filter((item) => item.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length > 0) {
    throw new Error(ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => projectRoot,
      getNewLine: () => "\n",
    }));
  }
  return result.outputText;
}

function evaluateCommonJs(source, localRequire) {
  // security-check: allow-local-test-eval — executa somente o TypeScript local
  // recém-transpilado deste repositório; este arquivo não integra o bundle.
  const loaded = { exports: {} };
  const execute = new Function("module", "exports", "require", source);
  execute(loaded, loaded.exports, localRequire);
  return loaded.exports;
}

async function main() {
  const tests = [];
  const previousDeno = globalThis.Deno;
  globalThis.Deno = {
    test(name, fn) {
      tests.push({ name, fn });
    },
  };

  try {
    const guard = evaluateCommonJs(transpile("guard.ts"), require);
    const contracts = evaluateCommonJs(transpile("contracts.ts"), require);
    const prompt = evaluateCommonJs(transpile("prompt.ts"), require);
    const financeAiRequire = (request) => {
      if (request === "./guard.ts") return guard;
      if (request === "./contracts.ts") return contracts;
      if (request === "./prompt.ts") return prompt;
      return require(request);
    };
    const context = evaluateCommonJs(transpile("context.ts"), financeAiRequire);
    const provider = evaluateCommonJs(transpile("provider.ts"), financeAiRequire);
    const workflow = evaluateCommonJs(transpile("workflow.ts"), financeAiRequire);
    evaluateCommonJs(transpile("contracts_test.ts"), (request) => {
      if (request === "./contracts.ts") return contracts;
      return financeAiRequire(request);
    });
    evaluateCommonJs(transpile("context_test.ts"), (request) => {
      if (request === "./context.ts") return context;
      return financeAiRequire(request);
    });
    evaluateCommonJs(transpile("guard_test.ts"), financeAiRequire);
    evaluateCommonJs(transpile("guard_security_test.ts"), financeAiRequire);
    evaluateCommonJs(transpile("prompt_test.ts"), (request) => {
      if (request === "./prompt.ts") return prompt;
      return financeAiRequire(request);
    });
    evaluateCommonJs(transpile("provider_test.ts"), (request) => {
      if (request === "./provider.ts") return provider;
      return financeAiRequire(request);
    });
    evaluateCommonJs(transpile("workflow_test.ts"), (request) => {
      if (request === "./workflow.ts") return workflow;
      return financeAiRequire(request);
    });
    evaluateCommonJs(transpile("workflow_security_test.ts"), (request) => {
      if (request === "./workflow.ts") return workflow;
      if (request === "./contracts.ts") return contracts;
      return financeAiRequire(request);
    });

    for (const test of tests) {
      await test.fn();
      process.stdout.write(`ok - ${test.name}\n`);
    }
    process.stdout.write(`Finance AI context tests passed (${tests.length}).\n`);
  } finally {
    if (previousDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = previousDeno;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
