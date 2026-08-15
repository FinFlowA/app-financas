import { describe, expect, it } from "vitest";
import {
  evaluateFinancialNotificationEvents,
  markNotificationAsShown,
  notificationWasShown,
  parseWebNotificationPreferences,
  readWebNotificationPreferences,
  saveWebNotificationPreferences,
  WEB_NOTIFICATION_DEFAULTS,
} from "../web-notifications";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { values.set(key, value); },
    values,
  };
}

describe("preferências de notificações web", () => {
  it("normaliza valores desconhecidos e separa as preferências por usuário", () => {
    const storage = memoryStorage();
    const custom = parseWebNotificationPreferences({ overdue: false, today: "não" });
    expect(custom.overdue).toBe(false);
    expect(custom.today).toBe(true);

    saveWebNotificationPreferences(storage, "usuario-a", custom);
    expect(readWebNotificationPreferences(storage, "usuario-a").overdue).toBe(false);
    expect(readWebNotificationPreferences(storage, "usuario-b")).toEqual(WEB_NOTIFICATION_DEFAULTS);
  });

  it("deduplica por usuário, evento e dia sem persistir o conteúdo financeiro", () => {
    const storage = memoryStorage();
    expect(notificationWasShown(storage, "u1", "transactions-overdue", "2026-08-15")).toBe(false);
    markNotificationAsShown(storage, "u1", "transactions-overdue", "2026-08-15");
    expect(notificationWasShown(storage, "u1", "transactions-overdue", "2026-08-15")).toBe(true);
    expect(notificationWasShown(storage, "u2", "transactions-overdue", "2026-08-15")).toBe(false);
    expect(notificationWasShown(storage, "u1", "transactions-overdue", "2026-08-16")).toBe(false);
    expect([...storage.values.values()]).toEqual(["1"]);
  });
});

describe("regras de notificações financeiras web", () => {
  it("gera exatamente os seis tipos nos marcos configurados", () => {
    const events = evaluateFinancialNotificationEvents({
      today: "2026-08-15",
      preferences: { ...WEB_NOTIFICATION_DEFAULTS },
      transactions: [
        { id: 1, status: "pendente", tipo: "despesa", data_vencimento: "2026-08-14" },
        { id: 2, status: "pendente", tipo: "receita", data_vencimento: "2026-08-15" },
      ],
      cards: [{ id: 7, nome: "FinFlow Visa", limite: 1_000, dia_vencimento: 18, dia_fechamento: 17, ativo: true }],
      invoiceItems: [{ cartao_id: 7, mes_fatura: "2026-08", valor: 900, pago: false, descricao: "Notebook 1/2" }],
      goals: [{ id: 9, nome: "Reserva", meta_valor: 2_000, saldo_atual: 500, data_prazo: "2026-09-14" }],
    });

    expect(events.map((event) => event.key)).toEqual(expect.arrayContaining([
      "transactions-overdue",
      "transactions-today",
      "card-7-closing-2026-08-2",
      "card-7-due-2026-08-3",
      "card-7-limit-over-80",
      "goal-9-deadline-2026-09-14-30",
    ]));
    expect(events).toHaveLength(6);
  });

  it("só avisa vencimento quando a fatura possui saldo pendente", () => {
    const base = {
      today: "2026-08-15",
      preferences: { ...WEB_NOTIFICATION_DEFAULTS, invoiceClosing: false, cardLimit: false },
      transactions: [],
      cards: [{ id: 3, nome: "Cartão", limite: 1_000, dia_vencimento: 18, dia_fechamento: 10, ativo: true }],
      goals: [],
    };
    const paid = evaluateFinancialNotificationEvents({
      ...base,
      invoiceItems: [{ cartao_id: 3, mes_fatura: "2026-08", valor: 100, pago: true }],
    });
    const zeroed = evaluateFinancialNotificationEvents({
      ...base,
      invoiceItems: [
        { cartao_id: 3, mes_fatura: "2026-08", valor: 100, pago: false },
        { cartao_id: 3, mes_fatura: "2026-08", valor: -100, pago: false },
      ],
    });
    expect(paid).toEqual([]);
    expect(zeroed).toEqual([]);
  });

  it("respeita o último dia de meses menores e ignora objetivos concluídos", () => {
    const events = evaluateFinancialNotificationEvents({
      today: "2026-02-26",
      preferences: { ...WEB_NOTIFICATION_DEFAULTS, overdue: false, today: false, invoiceDue: false, cardLimit: false },
      transactions: [],
      cards: [{ id: 4, nome: "Cartão 31", limite: 500, dia_vencimento: 31, dia_fechamento: 31, ativo: true }],
      invoiceItems: [],
      goals: [{ id: 8, nome: "Concluído", meta_valor: 100, saldo_atual: 100, data_prazo: "2026-02-26" }],
    });
    expect(events.map((event) => event.key)).toEqual(["card-4-closing-2026-02-2"]);
  });

  it("não produz eventos desativados ou fora dos marcos", () => {
    const events = evaluateFinancialNotificationEvents({
      today: "2026-08-15",
      preferences: {
        overdue: false,
        today: false,
        invoiceClosing: false,
        invoiceDue: false,
        cardLimit: false,
        goalDeadline: false,
      },
      transactions: [{ id: 1, status: "pendente", tipo: "despesa", data_vencimento: "2026-08-14" }],
      cards: [{ id: 1, nome: "Cartão", limite: 100, dia_vencimento: 18, dia_fechamento: 17, ativo: true }],
      invoiceItems: [{ cartao_id: 1, mes_fatura: "2026-08", valor: 99, pago: false }],
      goals: [{ id: 1, nome: "Meta", meta_valor: 100, saldo_atual: 0, data_prazo: "2026-08-15" }],
    });
    expect(events).toEqual([]);
  });
});
