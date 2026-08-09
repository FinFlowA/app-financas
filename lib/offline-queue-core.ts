export const OFFLINE_ACTION_TYPES = [
  "create_account",
  "create_category",
  "create_goal",
  "create_card",
  "create_transaction",
  "transfer_between_accounts",
  "move_goal",
  "create_card_purchase",
  "update_account",
  "update_category",
  "update_goal",
  "update_card",
  "update_transaction",
] as const;

export type OfflineActionType = (typeof OFFLINE_ACTION_TYPES)[number];

export type OfflineQueueStatus = "queued" | "failed";

export type OfflineQueueItem = {
  version: 1;
  id: string;
  idempotencyKey: string;
  userId: string;
  actionType: OfflineActionType;
  payload: Record<string, unknown>;
  status: OfflineQueueStatus;
  attempts: number;
  createdAt: string;
  lastAttemptAt: string | null;
  lastErrorCode: string | null;
};

export type OfflineQueueStorage = {
  readIndex(userScope: string): Promise<string[]>;
  writeIndex(userScope: string, operationIds: string[]): Promise<void>;
  readPayload(userScope: string, operationId: string): Promise<string | null>;
  writePayload(userScope: string, operationId: string, value: string): Promise<void>;
  removePayload(userScope: string, operationId: string): Promise<void>;
};

export type OfflineExecutionRequest = Readonly<{
  idempotencyKey: string;
  userId: string;
  actionType: OfflineActionType;
  payload: Readonly<Record<string, unknown>>;
  createdAt: string;
}>;

export type OfflineExecutionResult =
  | { ok: true; replayed?: boolean }
  | { ok: false; retryable: boolean; errorCode: string };

export type OfflineExecutor = (
  request: OfflineExecutionRequest,
) => Promise<OfflineExecutionResult>;

export type OfflineSyncSummary = {
  processed: number;
  succeeded: number;
  retrying: number;
  failed: number;
  skipped: number;
  stoppedBecause: "none" | "auth_changed" | "retryable_failure";
};

export const DEFAULT_OFFLINE_QUEUE_LIMITS = Object.freeze({
  maxItems: 50,
  maxPayloadBytes: 8 * 1024,
  maxAttempts: 5,
  maxOperationsPerSync: 20,
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
});

type QueueLimits = typeof DEFAULT_OFFLINE_QUEUE_LIMITS;

type OfflineQueueDependencies = {
  storage: OfflineQueueStorage;
  getCurrentUserId: () => Promise<string | null>;
  randomUuid: () => string;
  now?: () => Date;
  limits?: Partial<QueueLimits>;
};

export type OfflineEnqueueInput = {
  actionType: OfflineActionType;
  payload: Record<string, unknown>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE_PATTERN = /^[A-Z0-9_:-]{1,80}$/;
const FORBIDDEN_PAYLOAD_KEYS = new Set([
  "accesstoken",
  "refreshtoken",
  "token",
  "jwt",
  "password",
  "senha",
  "authorization",
  "apikey",
  "secret",
  "session",
]);

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const symbol of value) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function normalizeKey(key: string): string {
  return key.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`OFFLINE_INVALID_${label}`);
}

function assertPayloadSafe(value: unknown, depth = 0, seen = new Set<unknown>()): void {
  if (depth > 12) throw new Error("OFFLINE_PAYLOAD_TOO_DEEP");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("OFFLINE_INVALID_PAYLOAD");
    }
    return;
  }
  if (typeof value !== "object") throw new Error("OFFLINE_INVALID_PAYLOAD");
  if (seen.has(value)) throw new Error("OFFLINE_INVALID_PAYLOAD");
  seen.add(value);
  if (Array.isArray(value)) {
    if (value.length > 250) throw new Error("OFFLINE_PAYLOAD_TOO_LARGE");
    for (const entry of value) assertPayloadSafe(entry, depth + 1, seen);
    seen.delete(value);
    return;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("OFFLINE_INVALID_PAYLOAD");
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new Error("OFFLINE_PAYLOAD_TOO_LARGE");
  for (const [key, entry] of entries) {
    if (FORBIDDEN_PAYLOAD_KEYS.has(normalizeKey(key))) {
      throw new Error("OFFLINE_SENSITIVE_DATA_FORBIDDEN");
    }
    assertPayloadSafe(entry, depth + 1, seen);
  }
  seen.delete(value);
}

function clonePayload(payload: Record<string, unknown>, maxPayloadBytes: number): Record<string, unknown> {
  assertPayloadSafe(payload);
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    throw new Error("OFFLINE_INVALID_PAYLOAD");
  }
  if (utf8ByteLength(serialized) > maxPayloadBytes) {
    throw new Error("OFFLINE_PAYLOAD_TOO_LARGE");
  }
  return JSON.parse(serialized) as Record<string, unknown>;
}

function isActionType(value: unknown): value is OfflineActionType {
  return typeof value === "string" && (OFFLINE_ACTION_TYPES as readonly string[]).includes(value);
}

function isStoredItem(value: unknown): value is OfflineQueueItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<OfflineQueueItem>;
  return (
    item.version === 1 &&
    typeof item.id === "string" && UUID_PATTERN.test(item.id) &&
    typeof item.idempotencyKey === "string" && UUID_PATTERN.test(item.idempotencyKey) &&
    typeof item.userId === "string" && UUID_PATTERN.test(item.userId) &&
    isActionType(item.actionType) &&
    !!item.payload && typeof item.payload === "object" && !Array.isArray(item.payload) &&
    (item.status === "queued" || item.status === "failed") &&
    Number.isInteger(item.attempts) && (item.attempts ?? -1) >= 0 &&
    typeof item.createdAt === "string" &&
    (item.lastAttemptAt === null || typeof item.lastAttemptAt === "string") &&
    (item.lastErrorCode === null || typeof item.lastErrorCode === "string")
  );
}

function normalizeErrorCode(value: unknown): string {
  if (typeof value !== "string") return "OFFLINE_EXECUTOR_ERROR";
  const normalized = value.trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, "_").slice(0, 80);
  return ERROR_CODE_PATTERN.test(normalized) ? normalized : "OFFLINE_EXECUTOR_ERROR";
}

function uniqueValidIds(ids: string[], maxItems: number): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (!UUID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= maxItems) break;
  }
  return result;
}

export function createOfflineQueue(dependencies: OfflineQueueDependencies) {
  const now = dependencies.now ?? (() => new Date());
  const limits: QueueLimits = {
    ...DEFAULT_OFFLINE_QUEUE_LIMITS,
    ...(dependencies.limits ?? {}),
  };
  let operationChain: Promise<void> = Promise.resolve();

  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = operationChain.then(task, task);
    operationChain = run.then(() => undefined, () => undefined);
    return run;
  }

  if (
    !Number.isInteger(limits.maxItems) || limits.maxItems < 1 || limits.maxItems > 200 ||
    !Number.isInteger(limits.maxPayloadBytes) || limits.maxPayloadBytes < 128 || limits.maxPayloadBytes > 64 * 1024 ||
    !Number.isInteger(limits.maxAttempts) || limits.maxAttempts < 1 || limits.maxAttempts > 20 ||
    !Number.isInteger(limits.maxOperationsPerSync) || limits.maxOperationsPerSync < 1 || limits.maxOperationsPerSync > limits.maxItems ||
    !Number.isFinite(limits.maxAgeMs) || limits.maxAgeMs < 60_000
  ) {
    throw new Error("OFFLINE_INVALID_LIMITS");
  }

  async function currentUserId(): Promise<string> {
    const value = await dependencies.getCurrentUserId();
    if (!value) throw new Error("OFFLINE_AUTH_REQUIRED");
    assertUuid(value, "USER");
    return value.toLowerCase();
  }

  async function readIds(userId: string): Promise<string[]> {
    return uniqueValidIds(await dependencies.storage.readIndex(userId), limits.maxItems);
  }

  async function removeStored(userId: string, operationId: string, ids?: string[]): Promise<void> {
    await dependencies.storage.removePayload(userId, operationId);
    const currentIds = ids ?? await readIds(userId);
    await dependencies.storage.writeIndex(userId, currentIds.filter((id) => id !== operationId));
  }

  async function readItemsFor(userId: string): Promise<OfflineQueueItem[]> {
    const ids = await readIds(userId);
    const items: OfflineQueueItem[] = [];
    const retainedIds: string[] = [];
    for (const id of ids) {
      const raw = await dependencies.storage.readPayload(userId, id);
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!isStoredItem(parsed) || parsed.id !== id || parsed.userId.toLowerCase() !== userId) {
          await dependencies.storage.removePayload(userId, id);
          continue;
        }
        assertPayloadSafe(parsed.payload);
        items.push(parsed);
        retainedIds.push(id);
      } catch {
        await dependencies.storage.removePayload(userId, id);
      }
    }
    if (retainedIds.length !== ids.length) {
      await dependencies.storage.writeIndex(userId, retainedIds);
    }
    return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async function enqueue(input: OfflineEnqueueInput): Promise<OfflineQueueItem> {
    const userId = await currentUserId();
    if (!isActionType(input.actionType)) throw new Error("OFFLINE_UNSUPPORTED_ACTION");
    const payload = clonePayload(input.payload, limits.maxPayloadBytes);
    const ids = await readIds(userId);
    if (ids.length >= limits.maxItems) throw new Error("OFFLINE_QUEUE_FULL");
    const id = dependencies.randomUuid().toLowerCase();
    const idempotencyKey = dependencies.randomUuid().toLowerCase();
    assertUuid(id, "OPERATION_ID");
    assertUuid(idempotencyKey, "IDEMPOTENCY_KEY");
    if (ids.includes(id)) throw new Error("OFFLINE_DUPLICATE_OPERATION_ID");
    const item: OfflineQueueItem = {
      version: 1,
      id,
      idempotencyKey,
      userId,
      actionType: input.actionType,
      payload,
      status: "queued",
      attempts: 0,
      createdAt: now().toISOString(),
      lastAttemptAt: null,
      lastErrorCode: null,
    };
    await dependencies.storage.writePayload(userId, id, JSON.stringify(item));
    try {
      await dependencies.storage.writeIndex(userId, [...ids, id]);
    } catch (error) {
      await dependencies.storage.removePayload(userId, id);
      throw error;
    }
    return JSON.parse(JSON.stringify(item)) as OfflineQueueItem;
  }

  async function list(): Promise<OfflineQueueItem[]> {
    const userId = await currentUserId();
    return (await readItemsFor(userId)).map((item) => JSON.parse(JSON.stringify(item)) as OfflineQueueItem);
  }

  async function remove(operationId: string): Promise<void> {
    assertUuid(operationId, "OPERATION_ID");
    const userId = await currentUserId();
    await removeStored(userId, operationId.toLowerCase());
  }

  async function removeFailed(operationId: string): Promise<boolean> {
    assertUuid(operationId, "OPERATION_ID");
    const userId = await currentUserId();
    const normalizedId = operationId.toLowerCase();
    const item = (await readItemsFor(userId)).find((candidate) => candidate.id === normalizedId);
    if (!item || item.status !== "failed") return false;
    await removeStored(userId, normalizedId);
    return true;
  }

  async function clear(): Promise<void> {
    const userId = await currentUserId();
    await clearForUser(userId);
  }

  async function clearForUser(userId: string): Promise<void> {
    assertUuid(userId, "USER");
    const normalizedUserId = userId.toLowerCase();
    const ids = await readIds(normalizedUserId);
    for (const id of ids) await dependencies.storage.removePayload(normalizedUserId, id);
    await dependencies.storage.writeIndex(normalizedUserId, []);
  }

  async function pruneExpired(): Promise<number> {
    const userId = await currentUserId();
    const items = await readItemsFor(userId);
    let removed = 0;
    for (const item of items) {
      const ageMs = now().getTime() - Date.parse(item.createdAt);
      if (Number.isFinite(ageMs) && ageMs <= limits.maxAgeMs) continue;
      await removeStored(userId, item.id);
      removed += 1;
    }
    return removed;
  }

  async function sync(executor: OfflineExecutor): Promise<OfflineSyncSummary> {
    const boundUserId = await currentUserId();
    const items = await readItemsFor(boundUserId);
    const summary: OfflineSyncSummary = {
      processed: 0,
      succeeded: 0,
      retrying: 0,
      failed: 0,
      skipped: 0,
      stoppedBecause: "none",
    };
    for (const [itemIndex, item] of items.entries()) {
      if (summary.processed >= limits.maxOperationsPerSync) {
        summary.skipped += items.length - itemIndex;
        break;
      }
      const authenticatedUserId = await currentUserId().catch(() => null);
      if (authenticatedUserId !== boundUserId || item.userId.toLowerCase() !== boundUserId) {
        summary.stoppedBecause = "auth_changed";
        break;
      }
      const ageMs = now().getTime() - Date.parse(item.createdAt);
      if (!Number.isFinite(ageMs) || ageMs > limits.maxAgeMs) {
        // O prazo de retenção também vale para falhas terminais: depois de 30
        // dias, os dados financeiros deixam o armazenamento local cifrado.
        await removeStored(boundUserId, item.id);
        summary.failed += 1;
        continue;
      }
      if (item.status === "failed" || item.attempts >= limits.maxAttempts) {
        if (item.status !== "failed") {
          item.status = "failed";
          item.lastErrorCode = "OFFLINE_MAX_ATTEMPTS";
          await dependencies.storage.writePayload(boundUserId, item.id, JSON.stringify(item));
        }
        summary.skipped += 1;
        continue;
      }
      item.attempts += 1;
      item.lastAttemptAt = now().toISOString();
      item.lastErrorCode = null;
      await dependencies.storage.writePayload(boundUserId, item.id, JSON.stringify(item));
      summary.processed += 1;

      let result: OfflineExecutionResult;
      try {
        result = await executor({
          idempotencyKey: item.idempotencyKey,
          userId: item.userId,
          actionType: item.actionType,
          payload: JSON.parse(JSON.stringify(item.payload)) as Record<string, unknown>,
          createdAt: item.createdAt,
        });
      } catch {
        result = { ok: false, retryable: true, errorCode: "OFFLINE_NETWORK_ERROR" };
      }

      const userAfterExecution = await currentUserId().catch(() => null);
      if (userAfterExecution !== boundUserId) {
        // O servidor também recebe o usuário esperado e rejeita a chamada se a
        // sessão mudou. Mantemos o item: um sucesso ambíguo será deduplicado
        // pela mesma chave quando o proprietário entrar novamente.
        summary.stoppedBecause = "auth_changed";
        break;
      }

      if (result.ok) {
        await removeStored(boundUserId, item.id);
        summary.succeeded += 1;
        continue;
      }

      item.lastErrorCode = normalizeErrorCode(result.errorCode);
      if (!result.retryable || item.attempts >= limits.maxAttempts) {
        item.status = "failed";
        await dependencies.storage.writePayload(boundUserId, item.id, JSON.stringify(item));
        summary.failed += 1;
        continue;
      }
      await dependencies.storage.writePayload(boundUserId, item.id, JSON.stringify(item));
      summary.retrying += 1;
      summary.stoppedBecause = "retryable_failure";
      break;
    }
    return summary;
  }

  return {
    enqueue: (input: OfflineEnqueueInput) => exclusive(() => enqueue(input)),
    list: () => exclusive(list),
    remove: (operationId: string) => exclusive(() => remove(operationId)),
    removeFailed: (operationId: string) => exclusive(() => removeFailed(operationId)),
    clear: () => exclusive(clear),
    clearForUser: (userId: string) => exclusive(() => clearForUser(userId)),
    pruneExpired: () => exclusive(pruneExpired),
    sync: (executor: OfflineExecutor) => exclusive(() => sync(executor)),
    limits: Object.freeze({ ...limits }),
  };
}
