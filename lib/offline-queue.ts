import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { supabase } from "./supabase";
import {
  createOfflineQueue,
  type OfflineExecutor,
  type OfflineQueueStorage,
} from "./offline-queue-core";

const INDEX_PREFIX = "@finflow:offline:index:v1:";
const PAYLOAD_PREFIX = "finflow.offline.v1";
const SECURE_CHUNK_MAX_BYTES = 1_400;
const MAX_SECURE_CHUNKS = 16;

type SecureManifest = { version: 1; revision: string; chunks: number };

function utf8Length(value: string): number {
  let length = 0;
  for (const symbol of value) {
    const codePoint = symbol.codePointAt(0) ?? 0;
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}

function splitSecureValue(value: string): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;
  for (const symbol of value) {
    const symbolBytes = utf8Length(symbol);
    if (current && currentBytes + symbolBytes > SECURE_CHUNK_MAX_BYTES) {
      chunks.push(current);
      current = "";
      currentBytes = 0;
    }
    current += symbol;
    currentBytes += symbolBytes;
  }
  if (current) chunks.push(current);
  if (chunks.length < 1 || chunks.length > MAX_SECURE_CHUNKS) {
    throw new Error("OFFLINE_SECURE_PAYLOAD_TOO_LARGE");
  }
  return chunks;
}

function payloadBase(userScope: string, operationId: string): string {
  return `${PAYLOAD_PREFIX}.${userScope}.${operationId}`;
}

function parseManifest(raw: string | null): SecureManifest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<SecureManifest>;
    if (
      value.version !== 1 || typeof value.revision !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(value.revision) ||
      !Number.isInteger(value.chunks) || (value.chunks ?? 0) < 1 || (value.chunks ?? 0) > MAX_SECURE_CHUNKS
    ) return null;
    return value as SecureManifest;
  } catch {
    return null;
  }
}

async function removeRevision(base: string, manifest: SecureManifest | null): Promise<void> {
  if (!manifest) return;
  await Promise.all(
    Array.from({ length: manifest.chunks }, (_, index) =>
      SecureStore.deleteItemAsync(`${base}.${manifest.revision}.${index}`).catch(() => undefined)),
  );
}

const nativeEncryptedStorage: OfflineQueueStorage = {
  async readIndex(userScope) {
    const raw = await AsyncStorage.getItem(`${INDEX_PREFIX}${userScope}`);
    if (!raw) return [];
    try {
      const value = JSON.parse(raw) as unknown;
      return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
    } catch {
      return [];
    }
  },
  async writeIndex(userScope, operationIds) {
    // Somente UUIDs opacos ficam no AsyncStorage; nenhum valor financeiro ou token.
    await AsyncStorage.setItem(`${INDEX_PREFIX}${userScope}`, JSON.stringify(operationIds));
  },
  async readPayload(userScope, operationId) {
    const base = payloadBase(userScope, operationId);
    const manifest = parseManifest(await SecureStore.getItemAsync(base));
    if (!manifest) return null;
    const values = await Promise.all(
      Array.from({ length: manifest.chunks }, (_, index) =>
        SecureStore.getItemAsync(`${base}.${manifest.revision}.${index}`)),
    );
    return values.some((value) => value === null) ? null : values.join("");
  },
  async writePayload(userScope, operationId, value) {
    const base = payloadBase(userScope, operationId);
    const previous = parseManifest(await SecureStore.getItemAsync(base));
    const revision = randomUUID().toLowerCase();
    const chunks = splitSecureValue(value);
    const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
    try {
      for (let index = 0; index < chunks.length; index += 1) {
        // Índice inteiro, gerado pelo laço e limitado por MAX_SECURE_CHUNKS.
        // eslint-disable-next-line security/detect-object-injection
        await SecureStore.setItemAsync(`${base}.${revision}.${index}`, chunks[index], options);
      }
      await SecureStore.setItemAsync(
        base,
        JSON.stringify({ version: 1, revision, chunks: chunks.length } satisfies SecureManifest),
        options,
      );
    } catch (error) {
      await removeRevision(base, { version: 1, revision, chunks: chunks.length });
      throw error;
    }
    await removeRevision(base, previous);
  },
  async removePayload(userScope, operationId) {
    const base = payloadBase(userScope, operationId);
    const manifest = parseManifest(await SecureStore.getItemAsync(base));
    await removeRevision(base, manifest);
    await SecureStore.deleteItemAsync(base);
  },
};

function createMemoryStorage(): OfflineQueueStorage {
  const indexes = new Map<string, string[]>();
  const payloads = new Map<string, string>();
  const payloadKey = (scope: string, id: string) => `${scope}:${id}`;
  return {
    async readIndex(scope) { return [...(indexes.get(scope) ?? [])]; },
    async writeIndex(scope, ids) { indexes.set(scope, [...ids]); },
    async readPayload(scope, id) { return payloads.get(payloadKey(scope, id)) ?? null; },
    async writePayload(scope, id, value) { payloads.set(payloadKey(scope, id), value); },
    async removePayload(scope, id) { payloads.delete(payloadKey(scope, id)); },
  };
}

const storage = Platform.OS === "web" ? createMemoryStorage() : nativeEncryptedStorage;

export const offlineQueue = createOfflineQueue({
  storage,
  randomUuid: () => randomUUID(),
  getCurrentUserId: async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.user.id ?? null;
  },
});

export const enfileirarAcaoOffline = offlineQueue.enqueue;
export const listarAcoesOffline = offlineQueue.list;
export const removerAcaoOffline = offlineQueue.remove;
export const removerAcaoOfflineFalha = offlineQueue.removeFailed;
export const limparAcoesOfflineDoUsuarioAtual = offlineQueue.clear;
export const limparAcoesOfflineDoUsuario = offlineQueue.clearForUser;
export const removerAcoesOfflineExpiradas = offlineQueue.pruneExpired;
export const sincronizarAcoesOffline = (executor: OfflineExecutor) => offlineQueue.sync(executor);
