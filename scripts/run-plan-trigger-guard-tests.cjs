const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(
    root,
    "supabase",
    "migrations",
    "20260816000100_guard_plan_trigger_table_fields.sql",
  ),
  "utf8",
);

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

expect(
  /^\s*--[\s\S]*\bbegin;[\s\S]*commit;\s*$/i.test(migration),
  "A migration precisa ser atomica.",
);
expect(
  (migration.match(/\$\$/g) || []).length === 2,
  "A funcao do trigger precisa ter delimitadores equilibrados.",
);
expect(
  migration.includes("create or replace function public.enforce_finflow_plan_limit()"),
  "A migration nao substitui o trigger de limite afetado.",
);

const functionSql = migration.slice(
  migration.indexOf("create or replace function public.enforce_finflow_plan_limit()"),
);
const transactionGuard = functionSql.indexOf("if tg_table_name = 'transacoes' then");
const firstTransactionOnlyField = functionSql.indexOf("new.transacao_pai_id");
const commonLimitLogic = functionSql.indexOf("select limits_enabled into limits_on");
expect(transactionGuard >= 0, "A guarda externa da tabela transacoes esta ausente.");
expect(
  firstTransactionOnlyField > transactionGuard,
  "Um campo exclusivo de transacoes e acessado antes da guarda externa.",
);
expect(
  commonLimitLogic > firstTransactionOnlyField,
  "A guarda de filhos precisa terminar antes da logica comum de limites.",
);
expect(
  !/tg_table_name\s*=\s*'transacoes'\s+and\s+(?:new|old)\.transacao_pai_id/i.test(functionSql),
  "A expressao insegura voltou: TG_TABLE_NAME e campo de record no mesmo AND.",
);

for (const table of ["contas", "categorias", "caixinhas", "cartoes"]) {
  expect(
    migration.includes(`tg_table_name = '${table}'`),
    `A regressao estrutural nao cobre o caminho de ${table}.`,
  );
}

expect(
  migration.includes("elsif not privileged_execution\n     and new.user_id is distinct from actor_id then"),
  "As tabelas sem campos de transacao perderam a validacao de propriedade.",
);
expect(
  migration.includes("revoke all on function public.enforce_finflow_plan_limit()"),
  "As permissoes defensivas do trigger nao foram preservadas.",
);

if (failures.length) {
  console.error("Falhas no teste estrutural do trigger de planos:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "Trigger de planos validado: campos de transacoes isolados e caminhos de contas, categorias, caixinhas e cartoes preservados.",
);
