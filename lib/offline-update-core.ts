import type { OfflineActionType, OfflineQueueItem } from "./offline-queue-core";

export const OFFLINE_UPDATE_ACTION_TYPES = [
  "update_account",
  "update_category",
  "update_goal",
  "update_card",
  "update_transaction",
] as const satisfies readonly OfflineActionType[];

export type OfflineUpdateActionType = (typeof OFFLINE_UPDATE_ACTION_TYPES)[number];

const UPDATE_CONTRACT = {
  update_account: {
    resourceIdKey: "account_id",
    fields: new Set(["name", "initial_balance", "color"]),
  },
  update_category: {
    resourceIdKey: "category_id",
    fields: new Set(["name", "color", "icon"]),
  },
  update_goal: {
    resourceIdKey: "goal_id",
    fields: new Set(["name", "target_amount", "color", "icon", "target_date"]),
  },
  update_card: {
    resourceIdKey: "card_id",
    fields: new Set(["name", "value", "color", "due_day", "closing_day"]),
  },
  update_transaction: {
    resourceIdKey: "transaction_id",
    fields: new Set(["description", "value", "scheduled_date", "account_id", "category_id"]),
  },
} as const satisfies Record<OfflineUpdateActionType, {
  resourceIdKey: string;
  fields: ReadonlySet<string>;
}>;

export type OfflineUpdateCommand = Readonly<{
  actionType: OfflineUpdateActionType;
  payload: Record<string, unknown>;
  resourceIdKey: string;
  resourceId: number;
}>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertPositiveSafeInteger(value: number, errorCode: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(errorCode);
}

export function isOfflineUpdateActionType(value: OfflineActionType): value is OfflineUpdateActionType {
  return (OFFLINE_UPDATE_ACTION_TYPES as readonly string[]).includes(value);
}

export function buildOfflineUpdateCommand(
  actionType: OfflineUpdateActionType,
  resourceId: number,
  expectedVersion: number,
  changes: Record<string, unknown>,
): OfflineUpdateCommand {
  assertPositiveSafeInteger(resourceId, "OFFLINE_INVALID_RESOURCE_ID");
  assertPositiveSafeInteger(expectedVersion, "OFFLINE_EXPECTED_VERSION_REQUIRED");
  if (!isPlainObject(changes)) throw new Error("OFFLINE_INVALID_UPDATE_CHANGES");

  const contract = UPDATE_CONTRACT[actionType];
  const entries = Object.entries(changes);
  if (entries.length < 1 || entries.length > contract.fields.size) {
    throw new Error("OFFLINE_INVALID_UPDATE_CHANGES");
  }
  for (const [field, value] of entries) {
    if (!contract.fields.has(field) || value === undefined) {
      throw new Error("OFFLINE_UNSUPPORTED_UPDATE_FIELD");
    }
  }

  return {
    actionType,
    resourceIdKey: contract.resourceIdKey,
    resourceId,
    payload: {
      [contract.resourceIdKey]: resourceId,
      expected_version: expectedVersion,
      changes: Object.fromEntries(entries),
    },
  };
}

export function offlineQueueItemTargetsUpdate(
  item: Pick<OfflineQueueItem, "actionType" | "payload">,
  command: Pick<OfflineUpdateCommand, "actionType" | "resourceIdKey" | "resourceId">,
): boolean {
  return item.actionType === command.actionType
    && item.payload[command.resourceIdKey] === command.resourceId;
}
