import { DIRECT_ACTIONS, type ModelField, type ModelOutput } from "./contracts.ts";
import { enforceActionWorkflow } from "./workflow.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function proposal(intent: ModelOutput["intent"], data: ModelField[]): ModelOutput {
  return { kind: "propose_action", intent, message: "Revise.", missing_fields: [], data };
}

const CONTEXT = JSON.stringify({
  current_date: "2026-08-08",
  accounts: [{ id: 1, name: "Principal" }, { id: 2, name: "Carteira" }],
  categories: [{ id: 10, name: "Moradia", type: "despesa", active: true }],
  goals: [{ id: 20, name: "Notebook", active: true, can_move_money: true }],
  cards: [{ id: 30, name: "Visa", active: true }],
  relevant_transactions: [{ id: 40, description: "Aluguel", value: 1450, status: "pendente", category_id: 10, internal_transfer: false }],
  relevant_invoice_items: [{ id: 50, description: "Mercado", value: 200 }],
});

Deno.test("todas as acoes financeiras exigem coleta antes da proposta", () => {
  for (const intent of DIRECT_ACTIONS) {
    const output = enforceActionWorkflow(proposal(intent, []), {}, CONTEXT);
    assert(output.kind === "clarify", `${intent} nao pode pular a coleta de dados`);
    assert(output.missing_fields.length === 1, `${intent} deve perguntar somente um campo por vez`);
  }
});

Deno.test("modelo nao pode propor acao com identificador inventado", () => {
  const output = enforceActionWorkflow(proposal("move_goal", [
    { key: "operation", value: "resgatar" },
    { key: "goal_id", value: "999" },
    { key: "account_id", value: "1" },
    { key: "value", value: "100" },
  ]), {}, CONTEXT);
  assert(output.kind === "clarify", "ID fora do contexto deve voltar para esclarecimento");
  assert(output.missing_fields[0] === "goal_id", "deve pedir novamente o objetivo");
  assert(!output.data.some((field) => field.key === "goal_id"), "ID inventado nao pode permanecer no rascunho");
});

Deno.test("fluxo completo exige um unico campo por vez e preserva dados validos", () => {
  const output = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "despesa" },
    { key: "frequency", value: "unica" },
    { key: "status", value: "pendente" },
    { key: "scheduled_date", value: "2026-08-10" },
    { key: "description", value: "Energia" },
    { key: "value", value: "180" },
  ]), {}, CONTEXT);
  assert(output.kind === "clarify", "acao incompleta nao pode virar proposta");
  assert(output.missing_fields.length === 1 && output.missing_fields[0] === "account_id", "deve pedir somente a conta");
  assert(output.data.some((field) => field.key === "description" && field.value === "Energia"), "deve preservar o rascunho");
});

Deno.test("series ficam pendentes e nao aceitam data de realizacao inventada", () => {
  const output = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "despesa" }, { key: "frequency", value: "mensal" },
    { key: "status", value: "paga" }, { key: "realization_date", value: "2026-08-08" },
    { key: "scheduled_date", value: "2026-08-10" }, { key: "description", value: "Internet" },
    { key: "value", value: "100" }, { key: "account_id", value: "1" }, { key: "category_id", value: "10" },
    { key: "recurrence_count", value: "999" },
  ]), {}, CONTEXT);
  assert(output.kind === "propose_action", "serie completa deve gerar proposta");
  assert(output.data.some((field) => field.key === "status" && field.value === "pendente"), "serie deve ser pendente");
  assert(!output.data.some((field) => field.key === "realization_date"), "serie nao pode nascer realizada");
  assert(!output.data.some((field) => field.key === "recurrence_count"), "horizonte nao pode vir do modelo");
});

Deno.test("conclusao usa valor esperado do contexto e exige valor realizado", () => {
  const incomplete = enforceActionWorkflow(proposal("complete_transaction", [
    { key: "transaction_id", value: "40" }, { key: "realization_date", value: "2026-08-08" },
  ]), {}, CONTEXT);
  assert(incomplete.kind === "clarify" && incomplete.missing_fields[0] === "realized_value", "conclusao deve perguntar quanto foi pago ou recebido");
  assert(incomplete.data.some((field) => field.key === "expected_value" && field.value === "1450"), "valor esperado deve vir do contexto, nao do modelo");

  const output = enforceActionWorkflow(proposal("complete_transaction", [
    { key: "transaction_id", value: "40" }, { key: "realization_date", value: "2026-08-08" },
    { key: "realized_value", value: "1000" },
  ]), {}, CONTEXT);
  assert(output.kind === "propose_action", "conclusao identificada deve virar proposta");
  assert(output.data.some((field) => field.key === "expected_value" && field.value === "1450"), "valor esperado deve vir do contexto, nao do modelo");
  assert(output.data.some((field) => field.key === "realized_value" && field.value === "1000"), "pagamento parcial deve permanecer na proposta");
});

Deno.test("movimentacao de objetivo recebe apenas defaults deterministas", () => {
  const output = enforceActionWorkflow(proposal("move_goal", [
    { key: "operation", value: "resgatar" }, { key: "goal_id", value: "20" },
    { key: "account_id", value: "1" }, { key: "value", value: "1000" },
  ]), {}, CONTEXT);
  assert(output.kind === "propose_action", "movimentacao completa deve gerar proposta");
  assert(output.data.some((field) => field.key === "realization_date" && field.value === "2026-08-08"), "data deve vir do contexto");
  assert(output.data.some((field) => field.key === "description" && field.value === "Resgate do objetivo"), "descricao deve ser canonica");
});

Deno.test("bloqueia origem e destino iguais antes de criar a proposta", () => {
  const output = enforceActionWorkflow(proposal("transfer_between_accounts", [
    { key: "frequency", value: "unica" }, { key: "status", value: "pendente" },
    { key: "scheduled_date", value: "2026-08-10" }, { key: "description", value: "Ajuste" },
    { key: "value", value: "100" }, { key: "account_id", value: "1" },
    { key: "destination_account_id", value: "1" },
  ]), {}, CONTEXT);
  assert(output.kind === "clarify" && output.missing_fields[0] === "destination_account_id", "destino igual deve ser recusado");
});

Deno.test("bloqueia categoria de tipo oposto antes da proposta", () => {
  const output = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "receita" }, { key: "frequency", value: "unica" },
    { key: "status", value: "pendente" }, { key: "scheduled_date", value: "2026-08-10" },
    { key: "description", value: "Bonus" }, { key: "value", value: "100" },
    { key: "account_id", value: "1" }, { key: "category_id", value: "10" },
  ]), {}, CONTEXT);
  assert(output.kind === "clarify" && output.missing_fields[0] === "category_id", "categoria incompatível deve ser recusada");
});

Deno.test("remove campos que nao pertencem ao contrato da acao", () => {
  const output = enforceActionWorkflow(proposal("move_goal", [
    { key: "operation", value: "guardar" }, { key: "goal_id", value: "20" },
    { key: "account_id", value: "1" }, { key: "value", value: "100" },
    { key: "card_id", value: "30" }, { key: "recurrence_count", value: "999" },
  ]), {}, CONTEXT);
  assert(output.kind === "propose_action", "acao valida deve continuar proponivel");
  assert(!output.data.some((field) => field.key === "card_id" || field.key === "recurrence_count"), "campo estranho nao pode chegar ao RPC");
});

Deno.test("modelo nao pode trocar a intencao de um rascunho ativo", () => {
  const output = enforceActionWorkflow(proposal("delete_account", [{ key: "account_id", value: "1" }]), {
    __intent: "move_goal",
    operation: "resgatar",
    goal_id: "20",
    value: "100",
  }, CONTEXT);
  assert(output.intent === "move_goal", "rascunho ativo foi substituido por outra acao");
  assert(output.kind === "clarify" && output.missing_fields[0] === "account_id", "deve continuar a coleta original");
});
