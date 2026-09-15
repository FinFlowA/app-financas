const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "supabase", "migrations", "20260915000200_finflow_plan_matrix.sql"), "utf8");
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(/smart' then 150 else 40/.test(migration), "O limite mensal do Pro deve ser 150.");
expect(/smart' then 3 else 1/.test(migration), "O limite de objetivos do Pro deve ser 3.");
expect(migration.includes("finflow_enforce_shared_account_capacity"), "A conta compartilhada precisa validar a vaga do parceiro.");
expect(migration.includes("private.finflow_account_usage"), "Contas compartilhadas precisam contar no uso de ambos.");
expect(!/update\s+public\.billing_settings[\s\S]*limits_enabled\s*=\s*true/i.test(migration), "A migration local não pode ativar os limites.");
expect(!/update\s+public\.billing_settings[\s\S]*billing_enabled\s*=\s*true/i.test(migration), "A migration local não pode ativar cobranças.");
if (failures.length) { console.error(failures.join("\n")); process.exit(1); }
console.log("Matriz de planos validada sem ativar cobrança ou limites.");
