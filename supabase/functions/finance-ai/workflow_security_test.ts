import { DIRECT_ACTIONS, type ModelField, type ModelOutput } from "./contracts.ts";
import { enforceActionWorkflow, resolveDeterministicContinuation, resolveReferencedFollowup } from "./workflow.ts";

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
  goals: [{ id: 20, name: "Notebook", active: true, can_move_money: true, balance: 2000 }],
  cards: [{ id: 30, name: "Visa", active: true }],
  relevant_transactions: [{ id: 40, description: "Aluguel", value: 1450, status: "pendente", category_id: 10, internal_transfer: false }],
  relevant_invoice_items: [{ id: 50, description: "Mercado", value: 200, installment: "1/1" }],
  invoice_summaries: [{ card_id: 30, invoice_month: "2026-08", open: 500 }],
});

const COMPLETE_ACTION_FIXTURES: Record<(typeof DIRECT_ACTIONS)[number], ModelField[]> = {
  create_account: [{ key: "name", value: "Reserva" }, { key: "initial_balance", value: "0" }, { key: "color", value: "#457B9D" }],
  update_account: [{ key: "account_id", value: "1" }, { key: "field", value: "name" }, { key: "new_value", value: "Principal nova" }],
  archive_account: [{ key: "account_id", value: "1" }],
  delete_account: [{ key: "account_id", value: "1" }],
  reactivate_account: [{ key: "account_id", value: "1" }],
  create_category: [{ key: "type", value: "despesa" }, { key: "name", value: "Casa" }, { key: "color", value: "#2A9D8F" }, { key: "icon", value: "home" }],
  update_category: [{ key: "category_id", value: "10" }, { key: "field", value: "name" }, { key: "new_value", value: "Moradia fixa" }],
  archive_category: [{ key: "category_id", value: "10" }],
  delete_category: [{ key: "category_id", value: "10" }],
  reactivate_category: [{ key: "category_id", value: "10" }],
  create_goal: [{ key: "name", value: "Viagem" }, { key: "target_amount", value: "5000" }, { key: "initial_balance", value: "0" }, { key: "target_date", value: "2027-01-10" }, { key: "color", value: "#2A9D8F" }, { key: "icon", value: "savings" }],
  update_goal: [{ key: "goal_id", value: "20" }, { key: "field", value: "target_amount" }, { key: "new_value", value: "6000" }],
  archive_goal: [{ key: "goal_id", value: "20" }],
  delete_goal: [{ key: "goal_id", value: "20" }],
  reactivate_goal: [{ key: "goal_id", value: "20" }],
  move_goal: [{ key: "operation", value: "resgatar" }, { key: "goal_id", value: "20" }, { key: "value", value: "100" }, { key: "account_id", value: "1" }],
  create_transaction: [{ key: "type", value: "despesa" }, { key: "frequency", value: "unica" }, { key: "status", value: "pendente" }, { key: "scheduled_date", value: "2026-08-10" }, { key: "description", value: "Energia" }, { key: "value", value: "180" }, { key: "account_id", value: "1" }, { key: "category_id", value: "10" }],
  update_transaction: [{ key: "transaction_id", value: "40" }, { key: "field", value: "description" }, { key: "new_value", value: "Aluguel casa" }],
  delete_transaction: [{ key: "transaction_id", value: "40" }],
  complete_transaction: [{ key: "transaction_id", value: "40" }, { key: "realization_date", value: "2026-08-08" }, { key: "realized_value", value: "1450" }],
  reopen_transaction: [{ key: "transaction_id", value: "40" }],
  transfer_between_accounts: [{ key: "frequency", value: "unica" }, { key: "status", value: "pendente" }, { key: "scheduled_date", value: "2026-08-10" }, { key: "description", value: "Reserva" }, { key: "value", value: "100" }, { key: "account_id", value: "1" }, { key: "destination_account_id", value: "2" }],
  create_card: [{ key: "name", value: "Master" }, { key: "value", value: "4000" }, { key: "due_day", value: "10" }, { key: "closing_day", value: "3" }, { key: "color", value: "#457B9D" }],
  update_card: [{ key: "card_id", value: "30" }, { key: "field", value: "value" }, { key: "new_value", value: "6000" }],
  archive_card: [{ key: "card_id", value: "30" }],
  delete_card: [{ key: "card_id", value: "30" }],
  reactivate_card: [{ key: "card_id", value: "30" }],
  create_card_purchase: [{ key: "card_id", value: "30" }, { key: "category_id", value: "10" }, { key: "description", value: "Mercado" }, { key: "value", value: "200" }, { key: "purchase_date", value: "2026-08-08" }, { key: "frequency", value: "unica" }],
  update_card_purchase: [{ key: "purchase_id", value: "50" }, { key: "field", value: "description" }, { key: "new_value", value: "Mercado mensal" }],
  delete_card_purchase: [{ key: "purchase_id", value: "50" }],
  pay_invoice: [{ key: "card_id", value: "30" }, { key: "invoice_month", value: "2026-08" }, { key: "account_id", value: "1" }, { key: "payment_amount", value: "500" }],
  reverse_invoice_payment: [{ key: "transaction_id", value: "40" }],
};

Deno.test("todas as acoes financeiras exigem coleta antes da proposta", () => {
  for (const intent of DIRECT_ACTIONS) {
    const output = enforceActionWorkflow(proposal(intent, []), {}, CONTEXT);
    assert(output.kind === "clarify", `${intent} nao pode pular a coleta de dados`);
    assert(output.missing_fields.length === 1, `${intent} deve perguntar somente um campo por vez`);
  }
});

Deno.test("simula as 32 funcionalidades de escrita ate a previa sem executar dados reais", () => {
  assert(Object.keys(COMPLETE_ACTION_FIXTURES).length === DIRECT_ACTIONS.length, "a matriz precisa cobrir todas as acoes");
  for (const intent of DIRECT_ACTIONS) {
    const output = enforceActionWorkflow(proposal(intent, COMPLETE_ACTION_FIXTURES[intent]), {}, CONTEXT);
    assert(output.kind === "propose_action", `${intent} deveria chegar a previa, mas retornou ${output.kind}: ${output.missing_fields.join(",")}`);
    assert(output.intent === intent, `${intent} nao pode mudar de intencao`);
    assert(output.missing_fields.length === 0, `${intent} nao pode manter campo ausente na previa`);
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

Deno.test("resolve nomes naturais unicos sem expor ou inventar identificadores", () => {
  const output = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "despesa" }, { key: "frequency", value: "unica" },
    { key: "status", value: "pendente" }, { key: "scheduled_date", value: "2026-08-10" },
    { key: "description", value: "Almoço" }, { key: "value", value: "50" },
    { key: "account_id", value: "Carteira" }, { key: "category_id", value: "Moradia" },
  ]), {}, CONTEXT);
  assert(output.kind === "propose_action", "nomes unicos deveriam resolver a proposta");
  assert(output.data.some((field) => field.key === "account_id" && field.value === "2"), "conta deveria ser resolvida pelo nome");
  assert(output.data.some((field) => field.key === "category_id" && field.value === "10"), "categoria deveria ser resolvida pelo nome");
});

Deno.test("modelo pode interpretar sem inventar conta ou categoria", () => {
  const output = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "despesa" }, { key: "frequency", value: "unica" },
    { key: "status", value: "paga" }, { key: "scheduled_date", value: "2026-08-08" },
    { key: "description", value: "Almoço" }, { key: "value", value: "50" },
    { key: "account_id", value: "2" }, { key: "category_id", value: "10" },
  ]), {}, CONTEXT, "Crie uma despesa de 50 reais de almoço para hoje");
  assert(output.kind === "clarify", "escolhas omitidas precisam ser perguntadas");
  assert(output.missing_fields[0] === "account_id", "conta deve continuar sendo uma escolha explicita");
  assert(output.data.some((field) => field.key === "frequency" && field.value === "unica"), "interpretacao de frequencia deve persistir");
  assert(output.data.some((field) => field.key === "status" && field.value === "paga"), "interpretacao de status deve persistir");
  for (const key of ["account_id", "category_id"]) {
    assert(!output.data.some((field) => field.key === key), `${key} inventado nao pode persistir no rascunho`);
  }
});

Deno.test("interpretacao natural do modelo e aceita sem roteiro redundante", () => {
  const output = enforceActionWorkflow({
    kind: "clarify", intent: "create_transaction", message: "Quando foi esse gasto com lanche?",
    missing_fields: ["scheduled_date"],
    data: [{ key: "type", value: "despesa" }, { key: "frequency", value: "unica" },
      { key: "status", value: "paga" }, { key: "description", value: "Lanche" }, { key: "value", value: "70" }],
  }, {}, CONTEXT, "Gastei 70 reais em um lanche");
  assert(output.kind === "clarify", "a coleta ainda precisa continuar");
  assert(output.data.some((field) => field.key === "type" && field.value === "despesa"), "gastei deve significar despesa");
  assert(output.data.some((field) => field.key === "frequency" && field.value === "unica"), "passado singular deve significar unica");
  assert(output.data.some((field) => field.key === "status" && field.value === "paga"), "gastei deve significar realizada");
  assert(output.missing_fields[0] === "scheduled_date", "a próxima dúvida real deve ser a data");
  assert(output.message === "Quando foi esse gasto com lanche?", "a pergunta natural do modelo deve ser preservada");
});

Deno.test("passado singular infere despesa unica realizada sem perguntar frequencia", () => {
  const output = enforceActionWorkflow({
    kind: "clarify", intent: "create_transaction", message: "Qual frequencia?",
    missing_fields: ["frequency"], data: [
      { key: "description", value: "Lanche" }, { key: "value", value: "70" },
    ],
  }, {}, CONTEXT, "Gastei 70 reais em um lanche");
  assert(output.data.some((field) => field.key === "type" && field.value === "despesa"), "gastei deve inferir despesa");
  assert(output.data.some((field) => field.key === "frequency" && field.value === "unica"), "gastei deve inferir frequencia unica");
  assert(output.data.some((field) => field.key === "status" && field.value === "paga"), "gastei deve inferir realizado");
  assert(output.missing_fields[0] !== "frequency", "nao deve perguntar frequencia obvia");
});

Deno.test("resposta curta com nome exato da conta nao depende do provedor", () => {
  const output = resolveDeterministicContinuation({
    __intent: "create_transaction", type: "despesa", frequency: "unica", status: "paga",
    scheduled_date: "2026-09-17", realization_date: "2026-09-17", description: "Lanche", value: "70",
  }, CONTEXT, "Carteira");
  assert(output?.kind === "clarify", "deve continuar o formulário localmente");
  assert(output.data.some((field) => field.key === "account_id" && field.value === "2"), "deve resolver a conta Carteira");
  assert(output.missing_fields[0] === "category_id", "deve avançar para categoria");
  assert(output.message === "Em qual categoria deseja colocar Lanche?", "deve contextualizar a próxima pergunta");
});

Deno.test("resposta com prefixo natural resolve a conta pelo nome", () => {
  const output = resolveDeterministicContinuation({
    __intent: "create_transaction", type: "despesa", frequency: "unica", status: "paga",
    scheduled_date: "2026-09-17", realization_date: "2026-09-17", description: "Lanche", value: "70",
  }, CONTEXT, "Conta carteira");
  assert(output?.data.some((field) => field.key === "account_id" && field.value === "2"), "deve resolver Conta carteira");
});

Deno.test("pergunta tecnica por ID vira pergunta pelo nome visivel", () => {
  const output = enforceActionWorkflow({
    kind: "clarify", intent: "create_transaction", message: "Qual o ID da conta Carteira?",
    missing_fields: ["account_id"], data: [
      { key: "type", value: "despesa" }, { key: "frequency", value: "unica" },
      { key: "status", value: "paga" }, { key: "scheduled_date", value: "2026-09-17" },
      { key: "description", value: "Lanche" }, { key: "value", value: "70" },
    ],
  }, {}, CONTEXT, "Gastei 70 reais em um lanche");
  assert(!/\bid\b/i.test(output.message), "nunca deve pedir ID ao usuario");
  assert(output.message.includes("De qual conta"), "deve perguntar pela conta visivel");
});

Deno.test("lancamento realizado usa a mesma data salvo escolha explicita", () => {
  const sameDate = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "despesa" }, { key: "frequency", value: "unica" }, { key: "status", value: "paga" },
    { key: "scheduled_date", value: "2026-09-17" }, { key: "description", value: "Lanche" }, { key: "value", value: "70" },
    { key: "account_id", value: "2" }, { key: "category_id", value: "10" },
  ]), {}, CONTEXT, "Gastei 70 reais em um lanche hoje na Carteira, categoria Moradia");
  assert(sameDate.data.some((field) => field.key === "realization_date" && field.value === "2026-09-17"), "data realizada deve copiar a agendada");

  const differentDates = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "despesa" }, { key: "frequency", value: "unica" }, { key: "status", value: "paga" },
    { key: "scheduled_date", value: "2026-09-16" }, { key: "realization_date", value: "2026-09-17" },
    { key: "description", value: "Lanche" }, { key: "value", value: "70" },
    { key: "account_id", value: "2" }, { key: "category_id", value: "10" },
  ]), {}, CONTEXT, "Estava agendado para ontem, mas realizei hoje; Carteira, categoria Moradia");
  assert(differentDates.data.some((field) => field.key === "realization_date" && field.value === "2026-09-17"), "datas explicitamente diferentes devem ser preservadas");
});

Deno.test("categoria explicitamente nomeada pelo usuario pode ser resolvida", () => {
  const output = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "despesa" }, { key: "frequency", value: "unica" },
    { key: "status", value: "pendente" }, { key: "scheduled_date", value: "2026-08-10" },
    { key: "description", value: "Aluguel" }, { key: "value", value: "1450" },
    { key: "account_id", value: "Carteira" }, { key: "category_id", value: "Moradia" },
  ]), {}, CONTEXT, "Despesa unica pendente de aluguel na Carteira, categoria Moradia");
  assert(output.kind === "propose_action", "escolhas expressas devem chegar a previa");
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

Deno.test("descricao de lancamento nunca pode ser inventada pelo modelo", () => {
  const output = enforceActionWorkflow(proposal("create_transaction", [
    { key: "type", value: "receita" }, { key: "frequency", value: "unica" },
    { key: "status", value: "paga" }, { key: "scheduled_date", value: "2026-08-08" },
    { key: "description", value: "Ganhos" }, { key: "value", value: "50" },
    { key: "account_id", value: "2" }, { key: "category_id", value: "10" },
  ]), {}, CONTEXT, "Ganhei 50 reais hoje na Carteira");
  assert(output.kind === "clarify", "descricao ausente deve impedir a proposta");
  assert(output.missing_fields[0] === "description", "deve perguntar a descricao ao usuario");
  assert(!output.data.some((field) => field.key === "description"), "descricao inventada nao pode permanecer no rascunho");
});

Deno.test("pedido natural pode referenciar o lancamento acabado de criar", () => {
  const output = resolveReferencedFollowup(
    { __last_transaction_id: "40" },
    "Apague esse lancamento dos 50 reais, lancei errado.",
  );
  assert(output?.kind === "propose_action" && output.intent === "delete_transaction", "deve propor a exclusao do ultimo lancamento");
  assert(output.data.some((field) => field.key === "transaction_id" && field.value === "40"), "deve usar internamente o ID salvo");
});

Deno.test("nao confunde uma exclusao especifica com referencia ao ultimo lancamento", () => {
  const output = resolveReferencedFollowup({ __last_transaction_id: "40" }, "Apague o aluguel de agosto");
  assert(output === null, "sem pronome ou referencia temporal deve deixar a IA identificar o item correto");
});
