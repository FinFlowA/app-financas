const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-history-order-"));
const carregarModuloTs = (nome) => {
  const source = fs.readFileSync(path.join(root, "lib", `${nome}.ts`), "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const modulePath = path.join(tempDir, `${nome}.cjs`);
  fs.writeFileSync(modulePath, output);
  return require(modulePath);
};

const { compararHistoricoPorData, dataVencimentoFaturaHistorico } = carregarModuloTs("history-order");
const {
  adicionarVinculoSaldoParcial,
  descricaoVisivel,
  getIdSaldoParcial,
  getParcelaRecorrencia,
  removerVinculoSaldoParcial,
} = carregarModuloTs("transacoes");
const {
  normalizeTransactionPaymentHistory,
  normalizeTransactionPaymentSummaries,
  shouldShowTransactionPaymentBreakdown,
} = carregarModuloTs("transaction-payments");

const hoje = new Date(2026, 7, 8);
const itens = [
  { id: 1, data: "2026-08-01" },
  { id: 2, data: "2026-08-07" },
  { id: 3, data: "2026-08-08" },
  { id: 4, data: "2026-08-09" },
  { id: 5, data: "2026-08-10" },
  { id: 6, data: "data-invalida" },
  { id: 7, data: "2026-08-08" },
].sort((a, b) => compararHistoricoPorData(a, b, hoje));

const ids = itens.map((item) => item.id);
const esperado = [7, 3, 4, 5, 2, 1, 6];
if (JSON.stringify(ids) !== JSON.stringify(esperado)) {
  throw new Error(`Ordenação inesperada: ${JSON.stringify(ids)}; esperado ${JSON.stringify(esperado)}`);
}

if (dataVencimentoFaturaHistorico("2026-02", 31) !== "2026-02-28") {
  throw new Error("O vencimento da fatura não foi limitado ao último dia do mês.");
}
if (dataVencimentoFaturaHistorico("2028-02", 31) !== "2028-02-29") {
  throw new Error("O vencimento da fatura não respeitou o ano bissexto.");
}

const historicoComFatura = [
  { id: 10, data: "2026-08-07", origem: "transacao" },
  { id: 11, data: dataVencimentoFaturaHistorico("2026-08", 8), origem: "fatura" },
  { id: 12, data: "2026-08-09", origem: "transacao-futura" },
].sort((a, b) => compararHistoricoPorData(a, b, hoje));
if (historicoComFatura.map((item) => item.origem).join(",") !== "fatura,transacao-futura,transacao") {
  throw new Error("Faturas e transações não compartilham a mesma ordem cronológica.");
}

const descricaoOriginal = "Notebook (2/12) [Serie:serie-notebook]";
const descricaoParcial = adicionarVinculoSaldoParcial(descricaoOriginal, 987);
if (getIdSaldoParcial(descricaoParcial) !== 987) throw new Error("Vínculo do saldo parcial não foi identificado.");
if (descricaoVisivel(descricaoParcial) !== "Notebook (2/12)") throw new Error("Metadado parcial vazou na descrição visível.");
const parcela = getParcelaRecorrencia(descricaoParcial);
if (parcela?.atual !== 2 || parcela.total !== 12) throw new Error("A parcela original deixou de ser reconhecida.");
if (removerVinculoSaldoParcial(descricaoParcial) !== descricaoOriginal) throw new Error("Vínculo parcial não foi removido corretamente.");

const raiz = {
  id: 40,
  valor: 40,
  status: "pendente",
  data_vencimento: "2026-08-10",
  data_realizacao: null,
};
const resumos = normalizeTransactionPaymentSummaries([{
  root_transaction_id: "40",
  display_transaction_id: 40,
  current_pending_transaction_id: 40,
  last_paid_transaction_id: 42,
  technical_transaction_ids: [40, 41, 42],
  total_value: "100.00",
  paid_total: "60.00",
  remaining_value: "40.00",
  is_fully_paid: false,
  payment_count: 2,
  scheduled_date: "2026-08-10",
  last_realization_date: "2026-08-08",
}], [raiz]);
const resumo = resumos.get(40);
if (!resumo || resumo.totalValue !== 100 || resumo.paidTotal !== 60 || resumo.remainingValue !== 40) {
  throw new Error("Payment summary did not preserve total, paid and remaining values.");
}
if (!shouldShowTransactionPaymentBreakdown(resumo)) {
  throw new Error("Partial payment card was not marked for its breakdown.");
}
const historicoPagamentos = normalizeTransactionPaymentHistory({
  summary: {
    root_transaction_id: 40,
    display_transaction_id: 40,
    current_pending_transaction_id: 40,
    last_paid_transaction_id: 42,
    technical_transaction_ids: [40, 41, 42],
    total_value: 100,
    paid_total: 60,
    remaining_value: 40,
    is_fully_paid: false,
    payment_count: 2,
    scheduled_date: "2026-08-10",
    last_realization_date: "2026-08-08",
  },
  payments: [
    { payment_id: "p1", transaction_id: 41, value: 25, realization_date: "2026-08-04", active: true, adjustment_type: "none", adjustment_value: 0 },
    { payment_id: "p2", transaction_id: 42, value: 35, realization_date: "2026-08-08", active: true, adjustment_type: "none", adjustment_value: 0 },
  ],
}, raiz);
if (historicoPagamentos.payments.map((payment) => payment.paymentId).join(",") !== "p2,p1") {
  throw new Error("Payment history is not sorted newest first.");
}

const screen = fs.readFileSync(path.join(root, "app", "(tabs)", "transacoes.tsx"), "utf8");
for (const fragment of [
  "transacao.transacao_pai_id == null",
  "list_transaction_payment_summaries",
  "get_transaction_payment_history",
  "resumoPagamento.totalValue",
  "resumoPagamento.paidTotal",
  "resumoPagamento.remainingValue",
  "Estornar \u00faltimo pagamento",
]) {
  if (!screen.includes(fragment)) throw new Error(`Missing history payment integration: ${fragment}`);
}

console.log("History order tests passed.");
