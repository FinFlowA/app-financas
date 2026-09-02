import {
  createLocalDemoFixtures,
  createLocalDemoSession,
  createLocalDemoUser,
  LOCAL_DEMO_PARTNER_ID,
  type LocalDemoDatabase,
  type LocalDemoRow,
  type LocalDemoSession,
  type LocalDemoUser,
} from "./fixtures";
import { createLocalDemoOperationalFinanceAi } from "./finance-ai-operational";
import { createLocalDemoQueryBuilder } from "./query-builder";

type LocalError = { message: string; code: string; details?: string; hint?: string };
type AuthEvent = "INITIAL_SESSION" | "SIGNED_IN" | "SIGNED_OUT" | "USER_UPDATED" | "PASSWORD_RECOVERY";
type AuthListener = (event: AuthEvent, session: LocalDemoSession | null) => void;
type CompletionAdjustment = "none" | "interest" | "discount";
type LocalPaymentReceipt = {
  paymentId: string;
  requestId: string;
  rootTransactionId: number;
  paymentTransactionId: number;
  expectedValue: number;
  adjustmentType: CompletionAdjustment;
  adjustmentValue: number;
  totalDue: number;
  realizedValue: number;
  remainingValue: number;
  originalDescription: string;
  paymentDescription: string;
  realizationDate: string;
  createdAt: string;
  sequence: number;
  usedRootAsPayment: boolean;
  result: Record<string, unknown>;
  reopened: boolean;
  reopenedAt: string | null;
};
type LocalPaymentReopenReceipt = {
  requestId: string;
  rootTransactionId: number;
  result: Record<string, unknown>;
};

const ok = <T>(data: T) => ({ data, error: null as LocalError | null });
const failure = (code: string, message: string) => ({
  data: null,
  error: { code, message, details: "", hint: "Disponível somente fora do modo local." } satisfies LocalError,
});

function nextId(rows: LocalDemoRow[]): number {
  return rows.reduce((maximum, row) => Math.max(maximum, typeof row.id === "number" ? row.id : 0), 0) + 1;
}

function today(): string {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function invoiceMonthFromMarker(description: unknown): { cardId: number; month: string } | null {
  const match = String(description ?? "").match(/\[PagFatura:(\d+):(\d{4}-\d{2}):/);
  return match ? { cardId: Number(match[1]), month: match[2] } : null;
}

function money(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : Number.NaN;
}

function sameMoney(left: unknown, right: unknown): boolean {
  const normalizedLeft = money(left);
  const normalizedRight = money(right);
  return Number.isFinite(normalizedLeft)
    && Number.isFinite(normalizedRight)
    && Math.abs(normalizedLeft - normalizedRight) < 0.005;
}

/**
 * Cliente compatível somente com a superfície usada pelo FinFlow web.
 * Não contém transporte HTTP, persistência, chave ou fallback remoto.
 */
export function createLocalDemoSupabaseClient() {
  const database: LocalDemoDatabase = createLocalDemoFixtures();
  let user: LocalDemoUser | null = createLocalDemoUser();
  let session: LocalDemoSession | null = createLocalDemoSession(user);
  let paymentIdSequence = 1;
  const listeners = new Set<AuthListener>();
  const paymentReceiptsByRequest = new Map<string, LocalPaymentReceipt>();
  const paymentReceiptsByRoot = new Map<number, LocalPaymentReceipt[]>();
  const paymentReopenReceiptsByRequest = new Map<string, LocalPaymentReopenReceipt>();
  const financeAi = createLocalDemoOperationalFinanceAi({
    database,
    currentUser: () => user,
  });

  const emit = (event: AuthEvent) => {
    for (const listener of listeners) queueMicrotask(() => listener(event, session));
  };

  const resetDatabase = () => {
    const freshDatabase = createLocalDemoFixtures();
    for (const table of Object.keys(database)) Reflect.deleteProperty(database, table);
    Object.assign(database, freshDatabase);
    paymentIdSequence = 1;
    paymentReceiptsByRequest.clear();
    paymentReceiptsByRoot.clear();
    paymentReopenReceiptsByRequest.clear();
  };

  const nextPaymentId = () => `70000000-0000-4000-8000-${String(paymentIdSequence++).padStart(12, "0")}`;
  const nextPaymentSequenceFor = (rootTransactionId: number) => (
    (paymentReceiptsByRoot.get(rootTransactionId) ?? [])
      .reduce((highest, receipt) => Math.max(highest, receipt.sequence), 0) + 1
  );
  const activePaymentsFor = (rootTransactionId: number) =>
    (paymentReceiptsByRoot.get(rootTransactionId) ?? [])
      .filter((receipt) => !receipt.reopened)
      .sort((left, right) => left.sequence - right.sequence);
  const paidTotalFor = (rootTransactionId: number) => money(
    activePaymentsFor(rootTransactionId)
      .reduce((total, receipt) => total + receipt.realizedValue, 0),
  );
  const rootTransactionIdFor = (transactionId: number): number | null => {
    const transaction = (database.transacoes ?? []).find((row) => Number(row.id) === transactionId);
    if (!transaction) return null;
    const parentId = Number(transaction.transacao_pai_id);
    return Number.isInteger(parentId) && parentId > 0 ? parentId : transactionId;
  };
  const paymentSummaryFor = (rootTransactionId: number): Record<string, unknown> | null => {
    const rows = database.transacoes ?? [];
    const root = rows.find((row) => Number(row.id) === rootTransactionId
      && (row.transacao_pai_id === null || row.transacao_pai_id === undefined));
    if (!root) return null;

    const receipts = activePaymentsFor(rootTransactionId);
    const lastReceipt = receipts[receipts.length - 1] ?? null;
    const legacyPaid = receipts.length === 0 && root.status === "paga";
    const paidTotal = legacyPaid ? money(root.valor) : paidTotalFor(rootTransactionId);
    const remainingValue = root.status === "pendente" ? money(root.valor) : 0;
    const isFullyPaid = root.status === "paga";
    const technicalTransactionIds = receipts
      .filter((receipt) => !receipt.usedRootAsPayment)
      .map((receipt) => receipt.paymentTransactionId);

    return {
      root_transaction_id: rootTransactionId,
      display_transaction_id: rootTransactionId,
      current_pending_transaction_id: isFullyPaid ? null : rootTransactionId,
      last_paid_transaction_id: lastReceipt?.paymentTransactionId ?? (legacyPaid ? rootTransactionId : null),
      technical_transaction_ids: technicalTransactionIds,
      total_value: money(paidTotal + remainingValue),
      paid_total: paidTotal,
      remaining_value: remainingValue,
      is_fully_paid: isFullyPaid,
      payment_count: receipts.length,
      scheduled_date: root.data_vencimento ?? null,
      last_realization_date: lastReceipt?.realizationDate ?? (legacyPaid ? root.data_realizacao ?? null : null),
    };
  };

  const rpc = async (name: string, params: Record<string, unknown> = {}) => {
    if (name === "get_my_entitlement") {
      return ok({
        plan: "premium",
        subscription_status: "demo",
        billing_cycle: null,
        provider: null,
        access_until: null,
        billing_enabled: false,
        limits_enabled: false,
      });
    }
    if (name === "get_minhas_decisoes_caixinha" || name === "get_meu_resumo_dissolucao" || name === "get_minhas_decisoes_conta_dissolucao") {
      return ok([]);
    }
    if (name === "confirmar_resumo_dissolucao" || name === "resolver_decisao_conta_dissolucao" || name === "resolver_decisao_caixinha" || name === "iniciar_dissolucao_parceria") {
      return ok(true);
    }
    if (name === "marcar_notificacao_sistema_lida") {
      const target = (database.notificacoes_sistema ?? []).find((row) => row.id === params.p_id);
      if (target) target.lida_em = new Date().toISOString();
      return ok(true);
    }
    if (name === "get_user_name") {
      return ok(params.user_id === LOCAL_DEMO_PARTNER_ID ? "Parceiro Demo" : "Gabriel Demo");
    }
    if (name === "list_transaction_payment_summaries") {
      const requestedIds = Array.isArray(params.p_transaction_ids)
        ? params.p_transaction_ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [];
      const rootTransactionIds = [...new Set(requestedIds
        .map((transactionId) => rootTransactionIdFor(transactionId))
        .filter((transactionId): transactionId is number => transactionId !== null))];
      return ok(rootTransactionIds
        .map((rootTransactionId) => paymentSummaryFor(rootTransactionId))
        .filter((summary): summary is Record<string, unknown> => summary !== null));
    }
    if (name === "get_transaction_payment_history") {
      const rootTransactionId = rootTransactionIdFor(Number(params.p_transaction_id));
      if (rootTransactionId === null) return failure("TRANSACTION_NOT_FOUND", "Lançamento local não encontrado.");
      const summary = paymentSummaryFor(rootTransactionId);
      if (!summary) return failure("TRANSACTION_NOT_FOUND", "Lançamento local não encontrado.");
      const payments = (paymentReceiptsByRoot.get(rootTransactionId) ?? [])
        .slice()
        .sort((left, right) => left.sequence - right.sequence)
        .map((receipt) => ({
          payment_id: receipt.paymentId,
          payment_sequence: receipt.sequence,
          transaction_id: receipt.paymentTransactionId,
          value: receipt.realizedValue,
          realization_date: receipt.realizationDate,
          adjustment_type: receipt.adjustmentType,
          adjustment_value: receipt.adjustmentValue,
          active: !receipt.reopened,
          reopened_at: receipt.reopenedAt,
          created_at: receipt.createdAt,
        }));
      return ok({ ok: true, summary, payments });
    }
    if (name === "complete_transaction_with_partial") {
      if (!user) return failure("TRANSACTION_AUTH_REQUIRED", "Entre novamente para concluir o lançamento.");

      const rootTransactionId = Number(params.p_transaction_id);
      const expectedValue = money(params.p_expected_value);
      const adjustmentType = String(params.p_adjustment_type ?? "none") as CompletionAdjustment;
      const adjustmentValue = money(params.p_adjustment_value ?? 0);
      const realizedValue = money(params.p_realized_value);
      const realizationDate = String(params.p_realization_date ?? "");
      const requestId = String(params.p_idempotency_key ?? "");
      const totalDue = adjustmentType === "interest"
        ? money(expectedValue + adjustmentValue)
        : adjustmentType === "discount"
          ? money(expectedValue - adjustmentValue)
          : expectedValue;

      if (!Number.isInteger(rootTransactionId) || rootTransactionId <= 0
        || !Number.isFinite(expectedValue) || expectedValue <= 0
        || !Number.isFinite(realizedValue) || realizedValue <= 0
        || !/^\d{4}-\d{2}-\d{2}$/u.test(realizationDate) || realizationDate > today()
        || requestId.length === 0) {
        return failure("TRANSACTION_COMPLETION_INVALID", "Os dados da realização local são inválidos.");
      }
      if (!(["none", "interest", "discount"] as string[]).includes(adjustmentType)
        || !Number.isFinite(adjustmentValue) || adjustmentValue < 0
        || (adjustmentType === "none" && adjustmentValue !== 0)
        || (adjustmentType === "interest" && (adjustmentValue <= 0 || adjustmentValue > expectedValue))
        || (adjustmentType === "discount" && (adjustmentValue <= 0 || adjustmentValue >= expectedValue))) {
        return failure("TRANSACTION_ADJUSTMENT_INVALID", "O ajuste informado é inválido.");
      }

      const rows = database.transacoes ?? (database.transacoes = []);
      const root = rows.find((row) => Number(row.id) === rootTransactionId);
      if (!root) return failure("TRANSACTION_NOT_FOUND", "Lançamento local não encontrado.");

      const replay = paymentReceiptsByRequest.get(requestId);
      if (replay) {
        const sameRequest = replay.rootTransactionId === rootTransactionId
          && sameMoney(replay.expectedValue, expectedValue)
          && replay.adjustmentType === adjustmentType
          && sameMoney(replay.adjustmentValue, adjustmentValue)
          && sameMoney(replay.totalDue, totalDue)
          && sameMoney(replay.realizedValue, realizedValue)
          && replay.realizationDate === realizationDate;
        if (!sameRequest) return failure("TRANSACTION_COMPLETION_IDEMPOTENCY_CONFLICT", "Esta confirmação já foi usada com outros dados.");
        if (replay.reopened) return failure("TRANSACTION_COMPLETION_ALREADY_REOPENED", "Este pagamento já foi reaberto.");
        const payment = rows.find((row) => Number(row.id) === replay.paymentTransactionId);
        if (!payment || payment.status !== "paga" || !sameMoney(payment.valor, replay.realizedValue)
          || payment.data_realizacao !== replay.realizationDate) {
          return failure("TRANSACTION_COMPLETION_STATE_CONFLICT", "O pagamento mudou desde a confirmação.");
        }
        return ok({ ...replay.result, replayed: true });
      }

      if (root.transacao_pai_id !== null && root.transacao_pai_id !== undefined) {
        return failure("TRANSACTION_PAYMENT_CHILD_NOT_PAYABLE", "Conclua o agendamento principal, não um pagamento técnico.");
      }
      if (root.status !== "pendente") return failure("TRANSACTION_ALREADY_COMPLETED", "O lançamento já está concluído.");
      if (!sameMoney(root.valor, expectedValue)) return failure("TRANSACTION_VALUE_CHANGED", "O valor pendente do lançamento foi alterado.");
      const description = String(root.descricao ?? "");
      if (!(root.tipo === "receita" || root.tipo === "despesa")
        || root.categoria_id === null || description.startsWith("[Transf.] ")
        || /\[(?:Destino:|Objetivo:|PagFatura:)/u.test(description)) {
        return failure("TRANSACTION_PARTIAL_NOT_SUPPORTED", "Este tipo de lançamento não aceita baixa parcial.");
      }
      const account = (database.contas ?? []).find((row) => row.id === root.conta_id);
      if (!account || account.arquivado === true) return failure("TRANSACTION_ACCOUNT_ARCHIVED", "Reative a conta antes de concluir.");
      if (realizedValue > totalDue) return failure("TRANSACTION_REALIZED_VALUE_TOO_HIGH", "O valor realizado supera o total devido.");

      const remainingValue = money(totalDue - realizedValue);
      const sequence = nextPaymentSequenceFor(rootTransactionId);
      const paymentId = nextPaymentId();
      const createdAt = new Date().toISOString();
      const usedRootAsPayment = sameMoney(remainingValue, 0);
      let paymentTransactionId = rootTransactionId;

      if (usedRootAsPayment) {
        root.status = "paga";
        root.valor = realizedValue;
        root.data_realizacao = realizationDate;
      } else {
        paymentTransactionId = nextId(rows);
        rows.push({
          id: paymentTransactionId,
          user_id: root.user_id,
          conta_id: root.conta_id,
          categoria_id: root.categoria_id,
          tipo: root.tipo,
          valor: realizedValue,
          descricao: description,
          data_vencimento: root.data_vencimento,
          data_realizacao: realizationDate,
          status: "paga",
          criado_em: createdAt,
          transacao_pai_id: rootTransactionId,
        });
        root.valor = remainingValue;
        root.status = "pendente";
        root.data_realizacao = null;
      }

      const paidTotal = money(paidTotalFor(rootTransactionId) + realizedValue);
      const result: Record<string, unknown> = {
        ok: true,
        replayed: false,
        payment_id: paymentId,
        transaction_id: rootTransactionId,
        payment_transaction_id: paymentTransactionId,
        expected_value: expectedValue,
        adjustment_type: adjustmentType,
        adjustment_value: adjustmentValue,
        total_due: totalDue,
        realized_value: realizedValue,
        paid_total: paidTotal,
        remaining_value: remainingValue,
        remaining_transaction_id: null,
        realization_date: realizationDate,
        status: usedRootAsPayment ? "paga" : "pendente",
        is_fully_paid: usedRootAsPayment,
        simulated: true,
      };
      const receipt: LocalPaymentReceipt = {
        paymentId,
        requestId,
        rootTransactionId,
        paymentTransactionId,
        expectedValue,
        adjustmentType,
        adjustmentValue,
        totalDue,
        realizedValue,
        remainingValue,
        originalDescription: description,
        paymentDescription: description,
        realizationDate,
        createdAt,
        sequence,
        usedRootAsPayment,
        result,
        reopened: false,
        reopenedAt: null,
      };
      paymentReceiptsByRequest.set(requestId, receipt);
      paymentReceiptsByRoot.set(rootTransactionId, [
        ...(paymentReceiptsByRoot.get(rootTransactionId) ?? []),
        receipt,
      ]);
      return ok(result);
    }
    if (name === "reopen_transaction_completion") {
      if (!user) return failure("TRANSACTION_AUTH_REQUIRED", "Entre novamente para reabrir o lançamento.");
      const rootTransactionId = Number(params.p_transaction_id);
      const requestId = String(params.p_idempotency_key ?? "");
      if (!Number.isInteger(rootTransactionId) || rootTransactionId <= 0 || requestId.length === 0) {
        return failure("TRANSACTION_REOPEN_INVALID", "Os dados da reabertura local são inválidos.");
      }

      const rows = database.transacoes ?? (database.transacoes = []);
      const root = rows.find((row) => Number(row.id) === rootTransactionId
        && (row.transacao_pai_id === null || row.transacao_pai_id === undefined));
      if (!root) return failure("TRANSACTION_NOT_FOUND", "Lançamento principal local não encontrado.");

      const replay = paymentReopenReceiptsByRequest.get(requestId);
      if (replay) {
        if (replay.rootTransactionId !== rootTransactionId) {
          return failure("TRANSACTION_REOPEN_IDEMPOTENCY_CONFLICT", "Esta reabertura já foi usada para outro lançamento.");
        }
        return ok({ ...replay.result, replayed: true });
      }

      const description = String(root.descricao ?? "");
      if (!(root.tipo === "receita" || root.tipo === "despesa")
        || description.startsWith("[Transf.] ") || /\[(?:Destino:|Objetivo:|PagFatura:)/u.test(description)) {
        return failure("TRANSACTION_REOPEN_NOT_SUPPORTED", "Este tipo de lançamento não pode ser reaberto por esta ação.");
      }

      const activePayments = activePaymentsFor(rootTransactionId);
      const completion = activePayments[activePayments.length - 1];
      let restoredValue: number;
      let reopenedPaymentId: string | null = null;
      let reopenedPaymentTransactionId: number | null = null;

      if (completion) {
        reopenedPaymentId = completion.paymentId;
        reopenedPaymentTransactionId = completion.paymentTransactionId;
        if (completion.usedRootAsPayment) {
          if (root.status !== "paga" || !sameMoney(root.valor, completion.realizedValue)
            || root.data_realizacao !== completion.realizationDate) {
            return failure("TRANSACTION_REOPEN_STATE_CONFLICT", "O lançamento mudou desde o último pagamento.");
          }
          restoredValue = completion.expectedValue;
        } else {
          if (root.status !== "pendente" || root.data_realizacao !== null) {
            return failure("TRANSACTION_REOPEN_STATE_CONFLICT", "O saldo pendente mudou desde o último pagamento.");
          }
          const payment = rows.find((row) => Number(row.id) === completion.paymentTransactionId);
          if (!payment || Number(payment.transacao_pai_id) !== rootTransactionId
            || payment.status !== "paga" || !sameMoney(payment.valor, completion.realizedValue)
            || payment.data_realizacao !== completion.realizationDate
            || String(payment.descricao ?? "") !== completion.paymentDescription) {
            return failure("TRANSACTION_REOPEN_PAYMENT_CHANGED", "O último pagamento mudou e não pode ser desfeito automaticamente.");
          }
          rows.splice(rows.indexOf(payment), 1);
          restoredValue = money(Number(root.valor) + completion.expectedValue - completion.remainingValue);
          if (!Number.isFinite(restoredValue) || restoredValue <= 0 || Math.abs(restoredValue) > 999_999_999_999.99) {
            return failure("TRANSACTION_REOPEN_RESTORED_VALUE_INVALID", "O saldo editado não permite estornar este pagamento com segurança.");
          }
        }
        completion.reopened = true;
        completion.reopenedAt = new Date().toISOString();
      } else return failure("TRANSACTION_NOT_COMPLETED", "O lançamento não possui pagamento auditável ativo para reabrir.");

      root.status = "pendente";
      root.data_realizacao = null;
      root.valor = restoredValue;
      const paidTotal = paidTotalFor(rootTransactionId);
      const result: Record<string, unknown> = {
        ok: true,
        replayed: false,
        transaction_id: rootTransactionId,
        payment_id: reopenedPaymentId,
        reopened_payment_transaction_id: reopenedPaymentTransactionId,
        restored_value: restoredValue,
        paid_total: paidTotal,
        remaining_value: restoredValue,
        status: "pendente",
        is_fully_paid: false,
        simulated: true,
      };
      paymentReopenReceiptsByRequest.set(requestId, { requestId, rootTransactionId, result });
      return ok(result);
    }
    if (name === "delete_user") {
      resetDatabase();
      user = null;
      session = null;
      emit("SIGNED_OUT");
      return ok(true);
    }
    if (name === "finance_pay_invoice") {
      const cardId = Number(params.p_card_id);
      const month = String(params.p_invoice_month ?? "");
      const accountId = Number(params.p_account_id);
      const payment = Number(params.p_payment_amount);
      if (!Number.isFinite(payment) || payment <= 0) return failure("AI_INVALID_PAYMENT_AMOUNT", "Informe um valor válido.");
      const items = (database.fatura_itens ?? []).filter((row) => row.cartao_id === cardId && row.mes_fatura === month && row.pago !== true);
      const total = items.reduce((sum, row) => sum + Number(row.valor ?? 0), 0);
      if (payment > total + 0.005) return failure("AI_PAYMENT_ABOVE_INVOICE", "O pagamento ultrapassa a fatura local.");
      const mode = payment >= total - 0.005 ? "total" : "parcial";
      if (mode === "total") items.forEach((row) => { row.pago = true; });
      const rows = database.transacoes ?? (database.transacoes = []);
      const transaction = {
        id: nextId(rows), user_id: user?.id, conta_id: accountId, categoria_id: null,
        tipo: "despesa", valor: payment, status: "paga", data_vencimento: today(),
        data_realizacao: today(), criado_em: new Date().toISOString(),
        descricao: `Pagamento da fatura [PagFatura:${cardId}:${month}:${mode}]`,
      };
      rows.push(transaction);
      return ok({ ok: true, transaction_id: transaction.id, paid_amount: payment, open_amount: Math.max(0, total - payment), simulated: true });
    }
    if (name === "finance_reverse_invoice_payment") {
      const transactionId = Number(params.p_transaction_id);
      const rows = database.transacoes ?? [];
      const index = rows.findIndex((row) => row.id === transactionId);
      if (index < 0) return failure("FINANCE_INVOICE_PAYMENT_NOT_FOUND", "Pagamento local não encontrado.");
      const marker = invoiceMonthFromMarker(rows[index].descricao);
      if (!marker) return failure("AI_NOT_AN_INVOICE_PAYMENT", "O lançamento não é um pagamento de fatura.");
      (database.fatura_itens ?? []).forEach((row) => {
        if (row.cartao_id === marker.cardId && row.mes_fatura === marker.month) row.pago = false;
      });
      rows.splice(index, 1);
      return ok({ ok: true, transaction_id: transactionId, reversed: true, simulated: true });
    }
    return failure("LOCAL_DEMO_RPC_NOT_IMPLEMENTED", `A RPC ${name} não é necessária neste cenário local.`);
  };

  const client = {
    from(table: string) {
      return createLocalDemoQueryBuilder(database, table, () => user?.id ?? null);
    },
    rpc,
    functions: {
      async invoke(name: string, options?: { body?: unknown }) {
        if (name === "finance-ai") return ok(await financeAi.invoke(options?.body));
        if (name === "sync-subscription") return ok({ synced: false, localDemo: true });
        if (name === "cancel-subscription") return ok({ cancelled: false, accessUntil: null, localDemo: true });
        return failure("LOCAL_DEMO_EXTERNAL_FUNCTION_DISABLED", "Integrações externas estão desativadas no modo local.");
      },
    },
    auth: {
      async getSession() { return ok({ session }); },
      async getUser() { return ok({ user }); },
      onAuthStateChange(listener: AuthListener) {
        listeners.add(listener);
        queueMicrotask(() => listener("INITIAL_SESSION", session));
        return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } };
      },
      async updateUser(attributes: { email?: string; phone?: string; password?: string; data?: Record<string, unknown> }) {
        if (!user) return failure("LOCAL_DEMO_NO_SESSION", "Sessão local encerrada.");
        user = {
          ...user,
          ...(attributes.email ? { email: attributes.email } : {}),
          ...(attributes.phone ? { phone: attributes.phone } : {}),
          user_metadata: { ...user.user_metadata, ...(attributes.data ?? {}) },
          updated_at: new Date().toISOString(),
        };
        session = session ? { ...session, user } : createLocalDemoSession(user);
        emit("USER_UPDATED");
        return ok({ user });
      },
      async refreshSession() {
        if (!user) return failure("LOCAL_DEMO_NO_SESSION", "Sessão local encerrada.");
        session = createLocalDemoSession(user);
        return ok({ session, user });
      },
      async signOut() {
        session = null;
        emit("SIGNED_OUT");
        return ok(null);
      },
      async signInWithPassword(credentials: { email?: string }) {
        user = { ...createLocalDemoUser(), ...(credentials.email ? { email: credentials.email } : {}) };
        session = createLocalDemoSession(user);
        emit("SIGNED_IN");
        return ok({ user, session });
      },
      async signUp(credentials: { email?: string; phone?: string; options?: { data?: Record<string, unknown> } }) {
        user = {
          ...createLocalDemoUser(),
          ...(credentials.email ? { email: credentials.email } : {}),
          ...(credentials.phone ? { phone: credentials.phone } : {}),
          user_metadata: { ...createLocalDemoUser().user_metadata, ...(credentials.options?.data ?? {}) },
        };
        session = createLocalDemoSession(user);
        emit("SIGNED_IN");
        return ok({ user, session });
      },
      async resetPasswordForEmail() { return ok({}); },
      async resend() { return ok({}); },
      async verifyOtp() {
        if (!user) user = createLocalDemoUser();
        session = createLocalDemoSession(user);
        return ok({ user, session });
      },
      async exchangeCodeForSession() {
        if (!user) user = createLocalDemoUser();
        session = createLocalDemoSession(user);
        return ok({ user, session });
      },
      async setSession() {
        if (!user) user = createLocalDemoUser();
        session = createLocalDemoSession(user);
        emit("SIGNED_IN");
        return ok({ user, session });
      },
    },
    channel() {
      throw new Error("LOCAL_DEMO_REALTIME_DISABLED");
    },
    __localDemo: {
      get database() { return database; },
      reset() {
        resetDatabase();
        user = createLocalDemoUser();
        session = createLocalDemoSession(user);
        financeAi.reset();
        emit("SIGNED_IN");
      },
    },
  };

  return client;
}

export type LocalDemoSupabaseClient = ReturnType<typeof createLocalDemoSupabaseClient>;
