import { IS_LOCAL_DEMO, supabase } from "./supabase";
import { getOptionalNetInfo, type OptionalNetInfoState } from "./optional-native-modules";
import {
  enfileirarAcaoOffline,
  limparAcoesOfflineDoUsuario,
  listarAcoesOffline,
  removerAcoesOfflineExpiradas,
  removerAcaoOfflineFalha,
  sincronizarAcoesOffline,
} from "./offline-queue";
import type {
  OfflineActionType,
  OfflineEnqueueInput,
  OfflineSyncSummary,
} from "./offline-queue-core";
import {
  buildOfflineQueuePanelSnapshot,
  canRemoveOfflineQueueItem,
  type OfflineQueuePanelSnapshot,
} from "./offline-queue-view";
import { createSupabaseOfflineExecutor } from "./offline-queue-supabase";
import {
  buildOfflineUpdateCommand,
  offlineQueueItemTargetsUpdate,
  type OfflineUpdateActionType,
  type OfflineUpdateCommand,
} from "./offline-update-core";

export type { OfflineQueuePanelItem, OfflineQueuePanelSnapshot } from "./offline-queue-view";
export type { OfflineUpdateActionType } from "./offline-update-core";
export type OfflineCreationActionType = Exclude<OfflineActionType, OfflineUpdateActionType>;

export const OFFLINE_SYNC_COMPLETED_EVENT = "finflow:offline-sync-completed";
export const OFFLINE_SAVED_MESSAGE =
  "Salvo no dispositivo. Sincronizaremos automaticamente quando a conexão voltar.";
export const OFFLINE_EDIT_SAVED_MESSAGE =
  "Alterações salvas no dispositivo. Sincronizaremos automaticamente quando a conexão voltar.";

export type OfflineActionResult =
  | { state: "synced" }
  | { state: "queued" }
  | { state: "uncertain" }
  | { state: "rejected"; errorCode: string };
export type OfflineCreationResult = OfflineActionResult;

const executor = createSupabaseOfflineExecutor(supabase);
let activeSync: { userId: string; promise: Promise<OfflineSyncSummary | null> } | null = null;
const activeUpdateTargets = new Map<string, Promise<OfflineActionResult>>();

export function conexaoPermiteSincronizacao(state: OptionalNetInfoState): boolean {
  return state.isConnected === true && state.isInternetReachable !== false;
}

async function canAttemptSync(): Promise<boolean> {
  if (IS_LOCAL_DEMO) return false;
  try {
    const netInfo = getOptionalNetInfo();
    // No APK 2.0 original o monitor nativo ainda nao existia. Nesse caso a
    // chamada idempotente ao servidor e a fonte confiavel sobre conectividade.
    if (!netInfo) return true;
    return conexaoPermiteSincronizacao(await netInfo.fetch());
  } catch {
    // Se o monitor nativo estiver temporariamente indisponível, a própria RPC
    // ainda falha de forma retryable e o item permanece idempotente na fila.
    return true;
  }
}

export async function dispositivoSemConexao(): Promise<boolean> {
  if (IS_LOCAL_DEMO) return false;
  try {
    const netInfo = getOptionalNetInfo();
    if (!netInfo) return false;
    return !conexaoPermiteSincronizacao(await netInfo.fetch());
  } catch {
    return false;
  }
}

async function salvarAcaoFinanceira(
  actionType: OfflineActionType,
  payload: Record<string, unknown>,
): Promise<OfflineActionResult> {
  const item = await enfileirarAcaoOffline({ actionType, payload } satisfies OfflineEnqueueInput);
  await sincronizarFilaFinanceiraOffline();
  const { data: currentSession } = await supabase.auth.getSession();
  if (currentSession.session?.user.id.toLowerCase() !== item.userId) {
    return { state: "uncertain" };
  }
  const pendingItem = (await listarAcoesOffline()).find((candidate) => candidate.id === item.id);
  if (!pendingItem) return { state: "synced" };
  if (pendingItem.status === "failed") {
    const errorCode = pendingItem.lastErrorCode ?? "OFFLINE_SERVER_REJECTED";
    // Esta tentativa aconteceu com a tela ainda aberta e o formulário intacto.
    // Removê-la permite que o usuário corrija e reenvie sem manter uma cópia
    // definitivamente rejeitada ocupando a fila.
    await removerAcaoOfflineFalha(pendingItem.id);
    return { state: "rejected", errorCode };
  }
  return { state: "queued" };
}

export async function salvarCriacaoFinanceira(
  actionType: OfflineCreationActionType,
  payload: Record<string, unknown>,
): Promise<OfflineCreationResult> {
  return salvarAcaoFinanceira(actionType, payload);
}

export async function salvarEdicaoFinanceira(
  actionType: OfflineUpdateActionType,
  resourceId: number,
  expectedVersion: number,
  changes: Record<string, unknown>,
): Promise<OfflineActionResult> {
  let command: OfflineUpdateCommand;
  try {
    command = buildOfflineUpdateCommand(actionType, resourceId, expectedVersion, changes);
  } catch (error) {
    return {
      state: "rejected",
      errorCode: error instanceof Error ? error.message : "OFFLINE_INVALID_UPDATE_CHANGES",
    };
  }

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = data.session?.user.id.toLowerCase();
  if (!userId) return { state: "rejected", errorCode: "OFFLINE_AUTH_REQUIRED" };
  const targetKey = `${userId}:${command.actionType}:${command.resourceId}`;
  const active = activeUpdateTargets.get(targetKey);
  if (active) return active;

  const promise = (async (): Promise<OfflineActionResult> => {
    await removerAcoesOfflineExpiradas();
    const existing = (await listarAcoesOffline()).some((item) =>
      offlineQueueItemTargetsUpdate(item, command));
    if (existing) return { state: "rejected", errorCode: "OFFLINE_UPDATE_ALREADY_PENDING" };
    return salvarAcaoFinanceira(command.actionType, command.payload);
  })();
  activeUpdateTargets.set(targetKey, promise);
  try {
    return await promise;
  } finally {
    if (activeUpdateTargets.get(targetKey) === promise) activeUpdateTargets.delete(targetKey);
  }
}

export function mensagemFalhaEdicaoOffline(errorCode: string): string {
  if (errorCode === "OFFLINE_VERSION_CONFLICT") {
    return "Este item foi alterado em outro dispositivo. Nada foi sobrescrito; atualize os dados e refaça a edição.";
  }
  if (errorCode === "OFFLINE_UPDATE_ALREADY_PENDING") {
    return "Já existe uma edição deste item aguardando sincronização. Sincronize ou revise a pendência em Ajustes.";
  }
  if (errorCode === "OFFLINE_EXPECTED_VERSION_REQUIRED") {
    return "A versão segura deste item ainda não está disponível. Atualize os dados e tente novamente.";
  }
  return "A edição foi recusada com segurança. Atualize os dados, revise os campos e tente novamente.";
}

export async function sincronizarFilaFinanceiraOffline(): Promise<OfflineSyncSummary | null> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  const userId = data.session?.user.id.toLowerCase();
  if (!userId) return null;

  if (activeSync) {
    if (activeSync.userId === userId) return activeSync.promise;
    await activeSync.promise.catch(() => null);
    return sincronizarFilaFinanceiraOffline();
  }

  const promise = (async () => {
    const expired = await removerAcoesOfflineExpiradas();
    if (!(await canAttemptSync())) {
      return expired > 0 ? {
        processed: 0,
        succeeded: 0,
        retrying: 0,
        failed: expired,
        skipped: 0,
        stoppedBecause: "none" as const,
      } : null;
    }
    const summary = await sincronizarAcoesOffline(executor);
    return expired > 0 ? { ...summary, failed: summary.failed + expired } : summary;
  })();
  activeSync = { userId, promise };
  try {
    return await promise;
  } finally {
    if (activeSync?.promise === promise) activeSync = null;
  }
}

export async function obterResumoFilaFinanceiraOffline(): Promise<OfflineQueuePanelSnapshot> {
  await removerAcoesOfflineExpiradas();
  return buildOfflineQueuePanelSnapshot(await listarAcoesOffline());
}

export async function removerItemFalhoDaFilaFinanceira(itemId: string): Promise<boolean> {
  const item = (await listarAcoesOffline()).find((candidate) => candidate.id === itemId);
  if (!item || !canRemoveOfflineQueueItem(item)) return false;
  return removerAcaoOfflineFalha(item.id);
}

export async function limparFilaFinanceiraDoUsuario(userId: string | null | undefined): Promise<void> {
  if (!userId) return;
  await limparAcoesOfflineDoUsuario(userId);
}
