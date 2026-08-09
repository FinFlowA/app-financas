import type {
  OfflineActionType,
  OfflineQueueItem,
  OfflineQueueStatus,
} from "./offline-queue-core";

export type OfflineQueuePanelItem = Readonly<{
  id: string;
  actionType: OfflineActionType;
  actionLabel: string;
  status: OfflineQueueStatus;
  attempts: number;
  createdAt: string;
  failureMessage?: string;
}>;

export type OfflineQueuePanelSnapshot = Readonly<{
  queued: number;
  failed: number;
  items: readonly OfflineQueuePanelItem[];
}>;

const ACTION_LABELS = {
  create_account: "Criação de conta",
  create_category: "Criação de categoria",
  create_goal: "Criação de objetivo",
  create_card: "Criação de cartão",
  create_transaction: "Criação de lançamento",
  transfer_between_accounts: "Transferência entre contas",
  move_goal: "Movimentação de objetivo",
  create_card_purchase: "Compra no cartão",
  update_account: "Edição de conta",
  update_category: "Edição de categoria",
  update_goal: "Edição de objetivo",
  update_card: "Edição de cartão",
  update_transaction: "Edição de lançamento",
} as const satisfies Record<OfflineActionType, string>;

const FAILURE_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  OFFLINE_OPERATION_EXPIRED: "O prazo para sincronizar esta ação expirou.",
  OFFLINE_MAX_ATTEMPTS: "Não foi possível sincronizar após várias tentativas.",
  OFFLINE_SERVER_REJECTED: "O servidor recusou esta ação.",
  OFFLINE_RATE_LIMITED: "Muitas tentativas de sincronização. Tente novamente mais tarde.",
  OFFLINE_AUTH_REQUIRED: "Entre novamente na sua conta para sincronizar.",
  OFFLINE_AUTH_MISMATCH: "Entre novamente na mesma conta para sincronizar.",
  OFFLINE_VERSION_CONFLICT: "O item mudou em outro dispositivo. Revise a edição antes de tentar novamente.",
});

const GENERIC_FAILURE_MESSAGE = "Não foi possível sincronizar esta ação.";

function safeFailureMessage(errorCode: string | null): string {
  if (!errorCode) return GENERIC_FAILURE_MESSAGE;
  return FAILURE_MESSAGES[errorCode] ?? GENERIC_FAILURE_MESSAGE;
}

export function buildOfflineQueuePanelSnapshot(
  queueItems: readonly OfflineQueueItem[],
): OfflineQueuePanelSnapshot {
  const snapshot: { queued: number; failed: number; items: OfflineQueuePanelItem[] } = {
    queued: 0,
    failed: 0,
    items: [],
  };

  for (const item of queueItems) {
    if (item.status === "failed") snapshot.failed += 1;
    else snapshot.queued += 1;

    snapshot.items.push({
      id: item.id,
      actionType: item.actionType,
      actionLabel: ACTION_LABELS[item.actionType] ?? "Ação financeira",
      status: item.status,
      attempts: item.attempts,
      createdAt: item.createdAt,
      ...(item.status === "failed"
        ? { failureMessage: safeFailureMessage(item.lastErrorCode) }
        : {}),
    });
  }

  return snapshot;
}

export function canRemoveOfflineQueueItem(
  item: Pick<OfflineQueuePanelItem, "status">,
): boolean {
  return item.status === "failed";
}
