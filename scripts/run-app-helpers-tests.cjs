/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-require */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-app-helpers-"));

function carregar(relativo) {
  const saida = ts.transpileModule(fs.readFileSync(path.join(root, relativo), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const destino = path.join(tempDir, `${path.basename(relativo, ".ts")}.cjs`);
  fs.writeFileSync(destino, saida);
  return require(destino);
}

// Seletor com busca (contas, destino e categorias da nova transação).
const { filtrarOpcoesSeletor, normalizarBusca } = carregar("lib/seletor-busca.ts");
const opcoes = [
  { id: 1, titulo: "Café da manhã" },
  { id: 2, titulo: "Mercado" },
  { id: 3, titulo: "Conta Corrente Itaú", grupo: "Contas" },
  { id: 4, titulo: "Reserva de emergência", grupo: "Objetivos" },
];
assert.equal(normalizarBusca("  ÁÉÍ Ção "), "aei cao");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "").map((o) => o.id), [1, 2, 3, 4], "Busca vazia lista tudo.");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "cafe").map((o) => o.id), [1], "Busca ignora acentos.");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "MERC").map((o) => o.id), [2], "Busca ignora maiúsculas.");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "itau corrente").map((o) => o.id), [3], "Palavras em qualquer ordem.");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "reserva xyz"), [], "Todas as palavras precisam aparecer.");

// Círculo da cota de consultas ao Finn.
const { lerCotaConsultas, rotacoesAnel } = carregar("lib/cota-ia.ts");
assert.equal(lerCotaConsultas(null), null);
assert.equal(lerCotaConsultas({ model_limit: 0, model_remaining: 0 }), null, "Sem limite, sem círculo.");
assert.equal(lerCotaConsultas({ model_limit: "abc", model_remaining: 3 }), null);
assert.deepEqual(lerCotaConsultas({ model_limit: 20, model_remaining: 20 }), { restantes: 20, limite: 20, fracao: 1, nivel: "folgada" });
assert.equal(lerCotaConsultas({ model_limit: 20, model_remaining: 8 }).nivel, "atencao");
assert.equal(lerCotaConsultas({ model_limit: 20, model_remaining: 4 }).nivel, "critica");
assert.equal(lerCotaConsultas({ model_limit: 20, model_remaining: -3 }).restantes, 0, "Restantes nunca fica negativo.");
assert.equal(lerCotaConsultas({ model_limit: 20, model_remaining: 99 }).restantes, 20, "Restantes nunca passa do limite.");
assert.deepEqual(rotacoesAnel(0), { direita: -135, esquerda: null }, "Cota esgotada: anel vazio.");
assert.deepEqual(rotacoesAnel(0.5), { direita: 45, esquerda: null }, "Meia cota: metade direita cheia.");
assert.deepEqual(rotacoesAnel(1), { direita: 45, esquerda: 225 }, "Cota cheia: anel completo.");
assert.deepEqual(rotacoesAnel(2), rotacoesAnel(1), "Fração acima de 1 é limitada.");

// Lembretes de vencimento agendados com antecedência.
const lembretes = carregar("lib/lembretes-vencimento.ts");
const agora = new Date(2026, 9, 1, 10, 30); // 01/10/2026 10h30
const transacoes = [
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-10-01" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-10-02" },
  { status: "pendente", tipo: "receita", data_vencimento: "2026-10-02" },
  { status: "paga", tipo: "despesa", data_vencimento: "2026-10-03" },
  { status: "pendente", tipo: "transferencia", data_vencimento: "2026-10-04" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-10-20" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-12-20" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-09-30" },
  { status: "pendente", tipo: "despesa", data_vencimento: "" },
];
const grupos = lembretes.agruparVencimentosPorDia(transacoes, agora);
assert.deepEqual(
  grupos.map((g) => [g.dia.getDate(), g.dia.getMonth() + 1, g.despesas, g.receitas]),
  [[1, 10, 1, 0], [2, 10, 1, 1], [20, 10, 1, 0]],
  "Só pendentes de despesa/receita entre hoje e 30 dias.",
);
const agenda = lembretes.montarLembretesVencimento(transacoes, agora);
const descrever = (l) => `${l.quando.getDate()}/${l.quando.getMonth() + 1} ${l.quando.getHours()}h`;
assert.deepEqual(
  agenda.map(descrever),
  ["1/10 19h", "2/10 8h", "2/10 19h", "20/10 8h"],
  "Hoje só o que ainda vai acontecer; 19h só na primeira semana; dias seguintes agendados já.",
);
assert.match(agenda[1].corpo, /1 despesa e 1 receita vencendo hoje/);
assert.match(agenda[0].corpo, /Se já pagou/);
const muitas = Array.from({ length: 40 }, (_, i) => {
  const dia = new Date(2026, 9, 2 + (i % 29));
  return { status: "pendente", tipo: "despesa", data_vencimento: `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}` };
});
const agendaCheia = lembretes.montarLembretesVencimento(muitas, agora);
assert.equal(agendaCheia.length, lembretes.LIMITE_LEMBRETES_VENCIMENTO, "A agenda respeita o teto de lembretes.");
assert.ok(
  agendaCheia.every((l, i) => i === 0 || l.quando >= agendaCheia[i - 1].quando),
  "Os lembretes mais próximos têm prioridade.",
);
assert.deepEqual(lembretes.montarLembretesVencimento([], agora), []);

const notificacoes = fs.readFileSync(path.join(root, "lib", "notifications.ts"), "utf8");
assert.match(
  notificacoes,
  /montarLembretesVencimento\(transacoes, agora\)/,
  "A agenda completa precisa agendar os próximos dias, não só o dia em que o app foi aberto.",
);

console.log("App helper tests passed.");
