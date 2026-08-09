import type { ModelField, ModelOutput } from "./contracts.ts";
import { enforceActionWorkflow, enforceCreateWorkflow } from "./workflow.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function proposal(intent: ModelOutput["intent"], data: ModelField[]): ModelOutput {
  return { kind: "propose_action", intent, message: "Revise.", missing_fields: [], data };
}

Deno.test("create_account exige um campo por vez e preserva o estado", () => {
  const first = enforceCreateWorkflow(proposal("create_account", [{ key: "name", value: "Nubank" }]), {});
  assert(first.kind === "clarify", "deveria esclarecer");
  assert(first.missing_fields.length === 1 && first.missing_fields[0] === "initial_balance", "deveria pedir saldo");
  assert(first.data.some((field) => field.key === "name" && field.value === "Nubank"), "deveria preservar o nome");

  const second = enforceCreateWorkflow(proposal("create_account", [{ key: "color", value: "#112233" }]), {
    __intent: "create_account", name: "Nubank", initial_balance: "0",
  });
  assert(second.kind === "propose_action", "deveria liberar proposta completa");
  assert(second.data.length === 3, "deveria reunir os três campos");
});

Deno.test("estado de outra intenção não contamina a criação", () => {
  const output = enforceCreateWorkflow(proposal("create_category", [{ key: "type", value: "despesa" }]), {
    __intent: "create_account", name: "Conta antiga", color: "#ffffff",
  });
  assert(output.kind === "clarify" && output.missing_fields[0] === "name", "deveria ignorar o rascunho incompatível");
  assert(!output.data.some((field) => field.key === "name"), "não deveria misturar o nome antigo");
});

Deno.test("create_goal aceita sem prazo, registra a resposta e remove o sentinela da RPC", () => {
  const output = enforceCreateWorkflow(proposal("create_goal", [
    { key: "name", value: "Reserva" }, { key: "target_amount", value: "10000" },
    { key: "initial_balance", value: "0" }, { key: "target_date", value: "sem prazo" },
    { key: "color", value: "#00aa88" }, { key: "icon", value: "savings" },
  ]), {});
  assert(output.kind === "propose_action", "sem prazo é uma resposta válida");
  assert(!output.data.some((field) => field.key === "target_date"), "sentinela não pode chegar à RPC");
});

Deno.test("create_category e create_card exigem todos os campos mínimos", () => {
  const category = enforceCreateWorkflow(proposal("create_category", [
    { key: "type", value: "receita" }, { key: "name", value: "Bônus" }, { key: "color", value: "#008800" },
  ]), {});
  assert(category.kind === "clarify" && category.missing_fields[0] === "icon", "categoria deve pedir ícone");

  const card = enforceCreateWorkflow(proposal("create_card", [
    { key: "name", value: "Visa" }, { key: "value", value: "5000" }, { key: "due_day", value: "10" },
  ]), {});
  assert(card.kind === "clarify" && card.missing_fields[0] === "closing_day", "cartão deve pedir fechamento antes da cor");
});

Deno.test("rascunho completo vira proposta mesmo se o modelo repetir uma pergunta", () => {
  const output = enforceCreateWorkflow({
    kind: "clarify", intent: "create_account", message: "Qual cor?", missing_fields: ["color"], data: [],
  }, {
    __intent: "create_account", name: "Nubank", initial_balance: "0", color: "#112233",
  });
  assert(output.kind === "propose_action", "o backend deve reconhecer o rascunho completo");
  assert(output.missing_fields.length === 0, "a proposta não pode manter campos ausentes");
});
