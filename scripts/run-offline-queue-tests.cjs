/* global __dirname */
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-require */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-offline-queue-"));
const source = fs.readFileSync(path.join(root, "lib", "offline-queue-core.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modulePath = path.join(tempDir, "offline-queue-core.cjs");
fs.writeFileSync(modulePath, output);
const { createOfflineQueue } = require(modulePath);

const viewSource = fs.readFileSync(path.join(root, "lib", "offline-queue-view.ts"), "utf8");
const viewOutput = ts.transpileModule(viewSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const viewModulePath = path.join(tempDir, "offline-queue-view.cjs");
fs.writeFileSync(viewModulePath, viewOutput);
const {
  buildOfflineQueuePanelSnapshot,
  canRemoveOfflineQueueItem,
} = require(viewModulePath);

const updateSource = fs.readFileSync(path.join(root, "lib", "offline-update-core.ts"), "utf8");
const updateOutput = ts.transpileModule(updateSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const updateModulePath = path.join(tempDir, "offline-update-core.js");
fs.writeFileSync(updateModulePath, updateOutput);
const {
  buildOfflineUpdateCommand,
  offlineQueueItemTargetsUpdate,
} = require(updateModulePath);

const executorSource = fs.readFileSync(path.join(root, "lib", "offline-queue-supabase.ts"), "utf8");
const executorOutput = ts.transpileModule(executorSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const executorModulePath = path.join(tempDir, "offline-queue-supabase.cjs");
fs.writeFileSync(executorModulePath, executorOutput);
const { createSupabaseOfflineExecutor } = require(executorModulePath);

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "20000000-0000-4000-8000-000000000002";

function uuid(index) {
  return `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function makeStorage() {
  const indexes = new Map();
  const payloads = new Map();
  const key = (scope, id) => `${scope}:${id}`;
  return {
    indexes,
    payloads,
    async readIndex(scope) { return [...(indexes.get(scope) ?? [])]; },
    async writeIndex(scope, ids) { indexes.set(scope, [...ids]); },
    async readPayload(scope, id) { return payloads.get(key(scope, id)) ?? null; },
    async writePayload(scope, id, value) { payloads.set(key(scope, id), value); },
    async removePayload(scope, id) { payloads.delete(key(scope, id)); },
  };
}

function makeQueue(options = {}) {
  let currentUser = USER_A;
  let id = 1;
  let nowMs = Date.parse("2026-08-08T12:00:00.000Z");
  const storage = options.storage ?? makeStorage();
  const queue = createOfflineQueue({
    storage,
    getCurrentUserId: async () => currentUser,
    randomUuid: () => uuid(id++),
    now: () => new Date(nowMs),
    limits: options.limits,
  });
  return {
    queue,
    storage,
    setUser(value) { currentUser = value; },
    advance(ms) { nowMs += ms; },
  };
}

async function expectRejectsCode(task, code) {
  await assert.rejects(task, (error) => error instanceof Error && error.message === code);
}

async function run() {
  const executionRequest = {
    idempotencyKey: uuid(900),
    userId: USER_A,
    actionType: "create_account",
    payload: { name: "Conta" },
    createdAt: "2026-08-08T12:00:00.000Z",
  };
  const authNetworkExecutor = createSupabaseOfflineExecutor({
    auth: { getUser: async () => ({ data: { user: null }, error: { message: "Failed to fetch" } }) },
  });
  assert.deepEqual(await authNetworkExecutor(executionRequest), {
    ok: false, retryable: true, errorCode: "OFFLINE_NETWORK_ERROR",
  });
  const rpcNetworkExecutor = createSupabaseOfflineExecutor({
    auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
    rpc: async () => ({ data: null, error: { code: "08006", message: "connection failure" } }),
  });
  assert.deepEqual(await rpcNetworkExecutor(executionRequest), {
    ok: false, retryable: true, errorCode: "08006",
  });
  const domainFailureExecutor = createSupabaseOfflineExecutor({
    auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
    rpc: async () => ({ data: null, error: { code: "P0001", message: "AI_LIMIT_BELOW_USED" } }),
  });
  assert.deepEqual(await domainFailureExecutor(executionRequest), {
    ok: false, retryable: false, errorCode: "AI_LIMIT_BELOW_USED",
  });

  let optimisticRpcName;
  let optimisticRpcPayload;
  const optimisticExecutor = createSupabaseOfflineExecutor({
    auth: { getUser: async () => ({ data: { user: { id: USER_A } }, error: null }) },
    rpc: async (name, payload) => {
      optimisticRpcName = name;
      optimisticRpcPayload = payload;
      return { data: { ok: true, replayed: false }, error: null };
    },
  });
  const optimisticRequest = {
    ...executionRequest,
    actionType: "update_account",
    payload: { account_id: 77, expected_version: 3, changes: { name: "Conta revisada" } },
  };
  assert.deepEqual(await optimisticExecutor(optimisticRequest), { ok: true, replayed: false });
  assert.equal(optimisticRpcName, "execute_offline_optimistic_update");
  assert.equal(optimisticRpcPayload.p_payload.expected_version, 3);

  const context = makeQueue();
  const first = await context.queue.enqueue({
    actionType: "create_transaction",
    payload: { description: "Mercado", value: 42.9, status: "pendente" },
  });
  assert.equal(first.userId, USER_A);
  assert.notEqual(first.id, first.idempotencyKey);
  assert.deepEqual(context.storage.indexes.get(USER_A), [first.id]);
  assert(!JSON.stringify(context.storage.indexes).includes("Mercado"), "O índice opaco vazou dados financeiros.");
  assert.equal((await context.queue.list())[0].payload.value, 42.9);

  context.setUser(USER_B);
  assert.deepEqual(await context.queue.list(), [], "Uma sessão não pode enumerar a fila de outra.");
  context.setUser(USER_A);

  await expectRejectsCode(
    () => context.queue.enqueue({ actionType: "create_account", payload: { name: "X", refresh_token: "jwt" } }),
    "OFFLINE_SENSITIVE_DATA_FORBIDDEN",
  );
  await expectRejectsCode(
    () => context.queue.enqueue({ actionType: "delete_account", payload: {} }),
    "OFFLINE_UNSUPPORTED_ACTION",
  );

  const updateCommand = buildOfflineUpdateCommand(
    "update_account",
    77,
    3,
    { name: "Conta revisada", color: "#2A9D8F" },
  );
  assert.deepEqual(updateCommand.payload, {
    account_id: 77,
    expected_version: 3,
    changes: { name: "Conta revisada", color: "#2A9D8F" },
  });
  assert.equal(offlineQueueItemTargetsUpdate({
    actionType: "update_account",
    payload: updateCommand.payload,
  }, updateCommand), true);
  assert.equal(offlineQueueItemTargetsUpdate({
    actionType: "update_account",
    payload: { ...updateCommand.payload, account_id: 78 },
  }, updateCommand), false);
  for (const [actionType, resourceKey, changes] of [
    ["update_category", "category_id", { icon: "home" }],
    ["update_goal", "goal_id", { target_date: null }],
    ["update_card", "card_id", { due_day: 12 }],
    ["update_transaction", "transaction_id", { scheduled_date: "2026-08-12" }],
  ]) {
    const command = buildOfflineUpdateCommand(actionType, 88, 4, changes);
    assert.equal(command.resourceIdKey, resourceKey);
    assert.equal(command.payload[resourceKey], 88);
    assert.equal(command.payload.expected_version, 4);
  }
  await expectRejectsCode(
    async () => buildOfflineUpdateCommand("update_account", 77, 0, { name: "X" }),
    "OFFLINE_EXPECTED_VERSION_REQUIRED",
  );
  await expectRejectsCode(
    async () => buildOfflineUpdateCommand("update_account", 77, 3, { compartilhado: true }),
    "OFFLINE_UNSUPPORTED_UPDATE_FIELD",
  );
  await expectRejectsCode(
    async () => buildOfflineUpdateCommand("update_transaction", 77, 3, { status: "paga" }),
    "OFFLINE_UNSUPPORTED_UPDATE_FIELD",
  );

  const conflictingUpdate = makeQueue();
  await conflictingUpdate.queue.enqueue(updateCommand);
  const conflictSummary = await conflictingUpdate.queue.sync(async () => ({
    ok: false,
    retryable: false,
    errorCode: "OFFLINE_VERSION_CONFLICT",
  }));
  assert.equal(conflictSummary.failed, 1);
  const conflictedItem = (await conflictingUpdate.queue.list())[0];
  assert.equal(conflictedItem.status, "failed");
  assert.equal(conflictedItem.lastErrorCode, "OFFLINE_VERSION_CONFLICT");
  assert.equal(
    buildOfflineQueuePanelSnapshot([conflictedItem]).items[0].failureMessage,
    "O item mudou em outro dispositivo. Revise a edição antes de tentar novamente.",
  );

  let received;
  const firstSync = await context.queue.sync(async (request) => {
    received = request;
    throw new TypeError("network details must not be persisted");
  });
  assert.equal(firstSync.retrying, 1);
  assert.equal(firstSync.stoppedBecause, "retryable_failure");
  assert.equal(received.userId, USER_A);
  assert.equal(received.idempotencyKey, first.idempotencyKey);
  const afterRetry = (await context.queue.list())[0];
  assert.equal(afterRetry.attempts, 1);
  assert.equal(afterRetry.lastErrorCode, "OFFLINE_NETWORK_ERROR");
  assert(!JSON.stringify(afterRetry).includes("network details"), "Detalhes internos do erro foram persistidos.");

  const success = await context.queue.sync(async () => ({ ok: true }));
  assert.equal(success.succeeded, 1);
  assert.deepEqual(await context.queue.list(), []);

  const authRace = await context.queue.enqueue({
    actionType: "create_account",
    payload: { name: "Conta offline", initial_balance: 0 },
  });
  const raced = await context.queue.sync(async () => {
    context.setUser(USER_B);
    return { ok: true };
  });
  assert.equal(raced.stoppedBecause, "auth_changed");
  context.setUser(USER_A);
  assert.equal((await context.queue.list())[0].id, authRace.id, "Sucesso ambíguo deve aguardar replay idempotente.");
  await context.queue.sync(async () => ({ ok: true, replayed: true }));

  const limited = makeQueue({ limits: { maxItems: 2, maxOperationsPerSync: 2, maxPayloadBytes: 256 } });
  await limited.queue.enqueue({ actionType: "create_account", payload: { name: "A" } });
  await limited.queue.enqueue({ actionType: "create_account", payload: { name: "B" } });
  await expectRejectsCode(
    () => limited.queue.enqueue({ actionType: "create_account", payload: { name: "C" } }),
    "OFFLINE_QUEUE_FULL",
  );

  const payloadLimited = makeQueue({ limits: { maxItems: 2, maxOperationsPerSync: 2, maxPayloadBytes: 128 } });
  await expectRejectsCode(
    () => payloadLimited.queue.enqueue({ actionType: "create_account", payload: { name: "X".repeat(200) } }),
    "OFFLINE_PAYLOAD_TOO_LARGE",
  );

  const removable = makeQueue();
  const removableA = await removable.queue.enqueue({ actionType: "create_account", payload: { name: "A" } });
  const removableB = await removable.queue.enqueue({ actionType: "create_account", payload: { name: "B" } });
  assert.equal(await removable.queue.removeFailed(removableB.id), false,
    "Um item que ainda aguarda sincronização não pode ser descartado pelo painel.");
  await removable.queue.remove(removableA.id);
  assert.equal((await removable.queue.list()).length, 1);
  await removable.queue.clear();
  assert.deepEqual(await removable.queue.list(), []);

  const explicitCleanupIsolation = makeQueue();
  await explicitCleanupIsolation.queue.enqueue({ actionType: "create_account", payload: { name: "Usuário A" } });
  explicitCleanupIsolation.setUser(USER_B);
  await explicitCleanupIsolation.queue.enqueue({ actionType: "create_account", payload: { name: "Usuário B" } });
  await explicitCleanupIsolation.queue.clearForUser(USER_A);
  assert.deepEqual(explicitCleanupIsolation.storage.indexes.get(USER_A), [], "Limpeza explícita deve atingir somente o usuário indicado.");
  assert.equal((await explicitCleanupIsolation.queue.list()).length, 1, "Limpeza explícita não pode afetar outra sessão.");

  const failures = makeQueue({ limits: { maxItems: 2, maxOperationsPerSync: 2, maxAttempts: 2 } });
  await failures.queue.enqueue({ actionType: "create_account", payload: { name: "Falha" } });
  await failures.queue.sync(async () => ({ ok: false, retryable: true, errorCode: "temporary detail with spaces" }));
  const finalFailure = await failures.queue.sync(async () => ({ ok: false, retryable: true, errorCode: "timeout" }));
  assert.equal(finalFailure.failed, 1);
  const failedItem = (await failures.queue.list())[0];
  assert.equal(failedItem.status, "failed");
  assert.equal(failedItem.attempts, 2);
  assert.equal(failedItem.lastErrorCode, "TIMEOUT");
  assert.equal(await failures.queue.removeFailed(failedItem.id), true,
    "Uma falha definitiva pode ser removida individualmente após confirmação da UI.");
  assert.deepEqual(await failures.queue.list(), []);

  const allActionTypes = [
    ["create_account", "Criação de conta"],
    ["create_category", "Criação de categoria"],
    ["create_goal", "Criação de objetivo"],
    ["create_card", "Criação de cartão"],
    ["create_transaction", "Criação de lançamento"],
    ["transfer_between_accounts", "Transferência entre contas"],
    ["move_goal", "Movimentação de objetivo"],
    ["create_card_purchase", "Compra no cartão"],
    ["update_account", "Edição de conta"],
    ["update_category", "Edição de categoria"],
    ["update_goal", "Edição de objetivo"],
    ["update_card", "Edição de cartão"],
    ["update_transaction", "Edição de lançamento"],
  ];
  const panelInput = allActionTypes.map(([actionType], index) => ({
    version: 1,
    id: uuid(800 + index),
    idempotencyKey: uuid(850 + index),
    userId: USER_A,
    actionType,
    payload: {
      description: "Descrição financeira ultrassecreta",
      value: 987654.32,
      account_id: 7654321,
      destination_account_id: 7654322,
      category_id: 7654323,
      goal_id: 7654324,
      card_id: 7654325,
    },
    status: index === 0 || index === 7 ? "failed" : "queued",
    attempts: index,
    createdAt: `2026-08-08T12:${String(index).padStart(2, "0")}:00.000Z`,
    lastAttemptAt: null,
    lastErrorCode: index === 0 ? "OFFLINE_OPERATION_EXPIRED" : index === 7 ? "RAW_PRIVATE_DATABASE_ERROR_7654326" : null,
  }));
  const panelSnapshot = buildOfflineQueuePanelSnapshot(panelInput);
  assert.equal(panelSnapshot.queued, 11);
  assert.equal(panelSnapshot.failed, 2);
  assert.deepEqual(
    panelSnapshot.items.map((item) => [item.actionType, item.actionLabel]),
    allActionTypes,
    "Todos os tipos offline devem usar rótulos PT-BR allowlisted.",
  );
  assert.equal(canRemoveOfflineQueueItem(panelSnapshot.items[0]), true);
  assert.equal(canRemoveOfflineQueueItem(panelSnapshot.items[1]), false);
  assert.equal(panelSnapshot.items[0].failureMessage, "O prazo para sincronizar esta ação expirou.");
  assert.equal(panelSnapshot.items[7].failureMessage, "Não foi possível sincronizar esta ação.");
  assert.deepEqual(buildOfflineQueuePanelSnapshot([]), { queued: 0, failed: 0, items: [] });

  const panelJson = JSON.stringify(panelSnapshot);
  for (const forbiddenValue of [
    "Descrição financeira ultrassecreta",
    "987654.32",
    "7654321",
    "7654322",
    "7654323",
    "7654324",
    "7654325",
    "7654326",
    USER_A,
    panelInput[0].idempotencyKey,
    "RAW_PRIVATE_DATABASE_ERROR",
    "OFFLINE_OPERATION_EXPIRED",
  ]) {
    assert(!panelJson.includes(forbiddenValue), `DTO do painel vazou dado interno: ${forbiddenValue}`);
  }
  assert.deepEqual(
    Object.keys(panelSnapshot.items[0]).sort(),
    ["actionLabel", "actionType", "attempts", "createdAt", "failureMessage", "id", "status"].sort(),
    "DTO do painel deve manter somente os campos públicos previstos.",
  );
  assert.deepEqual(
    Object.keys(panelSnapshot.items[1]).sort(),
    ["actionLabel", "actionType", "attempts", "createdAt", "id", "status"].sort(),
    "Item pendente não deve incluir mensagem de falha.",
  );

  const expired = makeQueue();
  await expired.queue.enqueue({ actionType: "create_account", payload: { name: "Expirada" } });
  expired.advance(31 * 24 * 60 * 60 * 1000);
  let expiredWasExecuted = false;
  const expiredSummary = await expired.queue.sync(async () => {
    expiredWasExecuted = true;
    return { ok: true };
  });
  assert.equal(expiredWasExecuted, false, "Ação expirada não pode chegar ao executor.");
  assert.equal(expiredSummary.failed, 1);
  assert.deepEqual(await expired.queue.list(), [], "Dados financeiros expirados devem sair do armazenamento local.");

  const expiredWithoutNetwork = makeQueue();
  await expiredWithoutNetwork.queue.enqueue({ actionType: "create_account", payload: { name: "Expirada offline" } });
  expiredWithoutNetwork.advance(31 * 24 * 60 * 60 * 1000);
  assert.equal(await expiredWithoutNetwork.queue.pruneExpired(), 1);
  assert.deepEqual(await expiredWithoutNetwork.queue.list(), [], "Expiração local não pode depender de rede.");

  const tamperedStorage = makeStorage();
  const tampered = makeQueue({ storage: tamperedStorage });
  const operationId = uuid(700);
  tamperedStorage.indexes.set(USER_A, [operationId]);
  tamperedStorage.payloads.set(`${USER_A}:${operationId}`, JSON.stringify({
    ...first,
    id: operationId,
    idempotencyKey: uuid(701),
    userId: USER_B,
  }));
  assert.deepEqual(await tampered.queue.list(), [], "Payload trocado entre usuários deve falhar fechado.");
  assert.equal(tamperedStorage.payloads.size, 0);

  const adapterSource = fs.readFileSync(path.join(root, "lib", "offline-queue.ts"), "utf8");
  assert.match(adapterSource, /Platform\.OS === "web" \? createMemoryStorage\(\) : nativeEncryptedStorage/);
  assert.match(adapterSource, /SecureStore\.setItemAsync/);
  assert.match(adapterSource, /AsyncStorage\.setItem\(`\$\{INDEX_PREFIX\}\$\{userScope\}`, JSON\.stringify\(operationIds\)\)/);
  assert.doesNotMatch(adapterSource, /AsyncStorage\.setItem\([^\n]+value/);

  const syncSource = fs.readFileSync(path.join(root, "lib", "offline-sync.ts"), "utf8");
  assert.match(syncSource, /Salvo no dispositivo\. Sincronizaremos automaticamente quando a conexão voltar\./);
  assert.match(syncSource, /IS_LOCAL_DEMO/);
  assert.match(syncSource, /sincronizarAcoesOffline\(executor\)/);
  assert.match(syncSource, /if \(!item \|\| !canRemoveOfflineQueueItem\(item\)\) return false/,
    "A camada de serviço deve impedir a remoção de itens que ainda aguardam sincronização.");

  const layoutSource = fs.readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");
  assert.match(layoutSource, /NetInfo\.addEventListener/);
  assert.match(layoutSource, /estado === "active"/);
  assert.doesNotMatch(layoutSource, /limparFilaFinanceiraDoUsuario/,
    "Logout comum deve preservar a fila segregada para o próximo login do mesmo usuário.");
  const settingsSource = fs.readFileSync(path.join(root, "app", "(tabs)", "configuracoes.tsx"), "utf8");
  assert.match(settingsSource, /limparFilaFinanceiraDoUsuario\(meuId\)/,
    "Exclusão explícita da conta deve remover sua fila local.");
  const panelStart = settingsSource.indexOf("{modalFilaOfflineVisivel && (");
  const panelEnd = settingsSource.indexOf("{modalPreferenciasNotificacoes && (", panelStart);
  assert(panelStart >= 0 && panelEnd > panelStart, "O modal da fila offline deve existir em Ajustes.");
  const panelSource = settingsSource.slice(panelStart, panelEnd);
  assert.match(panelSource, /Sincronizar agora/);
  assert.match(panelSource, /resumoFilaOffline\.queued/);
  assert.match(panelSource, /resumoFilaOffline\.failed/);
  assert.match(panelSource, /confirmarRemocaoItemOffline\(item\)/);
  assert.match(settingsSource, /Esta ação local será descartada e não chegará ao servidor/,
    "Remover uma falha exige confirmação destrutiva explícita.");
  assert.doesNotMatch(panelSource, /payload|lastErrorCode|idempotencyKey|userId/,
    "O painel não pode acessar nem renderizar dados internos da fila.");
  assert.doesNotMatch(panelSource, /Limpar tudo|limparAcoesOfflineDoUsuarioAtual/,
    "O painel não pode oferecer limpeza total silenciosa.");

  const creationSources = [
    path.join(root, "app", "(tabs)", "index.tsx"),
    path.join(root, "app", "(tabs)", "caixinhas.tsx"),
    path.join(root, "app", "(tabs)", "cartoes.tsx"),
  ].map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const actionType of [
    "create_account",
    "create_category",
    "create_goal",
    "create_card",
    "create_transaction",
    "transfer_between_accounts",
    "move_goal",
    "create_card_purchase",
  ]) {
    assert.match(creationSources, new RegExp(`salvarCriacaoFinanceira\\("${actionType}"`));
  }
  assert.doesNotMatch(creationSources, /salvarCriacaoFinanceira\("(?:update|delete|complete|reopen|pay|reverse)_/);

  const updateSources = [
    path.join(root, "app", "(tabs)", "index.tsx"),
    path.join(root, "app", "(tabs)", "caixinhas.tsx"),
    path.join(root, "app", "(tabs)", "cartoes.tsx"),
    path.join(root, "app", "(tabs)", "transacoes.tsx"),
  ].map((file) => fs.readFileSync(file, "utf8")).join("\n");
  for (const actionType of [
    "update_account",
    "update_category",
    "update_goal",
    "update_card",
    "update_transaction",
  ]) {
    assert.match(updateSources, new RegExp(`salvarEdicaoFinanceira\\(\\s*"${actionType}"`));
  }
  assert.doesNotMatch(updateSources, /salvarEdicaoFinanceira\("(?:delete|complete|reopen|pay|reverse)_/,
    "Mutações com efeitos destrutivos ou de saldo não podem entrar na fila de edição genérica.");

  const migration = fs.readFileSync(
    path.join(root, "supabase", "migrations", "20260808000100_secure_offline_action_receipts.sql"),
    "utf8",
  );
  assert.match(migration, /caller is distinct from p_expected_user_id/);
  assert.match(migration, /p_client_created_at < pg_catalog\.clock_timestamp\(\) - interval '30 days'/);
  assert.match(migration, /unique \(user_id, idempotency_key\)/);
  assert.match(migration, /private\.ai_prepare_action/);
  assert.match(migration, /private\.ai_execute_financial_action/);
  assert.doesNotMatch(migration.match(/array\[[\s\S]*?\]::text\[\]/)?.[0] ?? "", /update_|delete_|pay_invoice|complete_transaction/);

  const updateMigration = fs.readFileSync(
    path.join(root, "supabase", "migrations", "20260808001400_offline_optimistic_updates.sql"),
    "utf8",
  );
  for (const table of ["contas", "categorias", "caixinhas", "cartoes", "transacoes"]) {
    assert.match(updateMigration, new RegExp(`alter table public\\.${table}[\\s\\S]*?add column if not exists version bigint`));
    assert.match(updateMigration, new RegExp(`before insert or update on public\\.${table}`));
  }
  assert.match(updateMigration, /new\.version := old\.version \+ 1/);
  assert.match(updateMigration, /new\.updated_at := clock_timestamp\(\)/);
  assert.doesNotMatch(updateMigration, /jsonb_object_length/);
  assert.match(
    updateMigration,
    /select count\(\*\) into change_count\s+from pg_catalog\.jsonb_object_keys\(raw_payload->'changes'\)/,
  );
  assert.match(updateMigration, /for update;[\s\S]*?current_version is distinct from expected_version/,
    "A versão deve ser comparada somente depois do lock da linha.");
  assert.match(
    updateMigration,
    /from public\.transacoes t\s+where t\.id=resource_id and t\.user_id=caller for update/,
    "Edições offline de lançamento devem bloquear somente uma linha do próprio usuário.",
  );
  assert.match(updateMigration, /message='OFFLINE_VERSION_CONFLICT'/);
  assert.match(updateMigration, /private\.offline_action_receipts/);
  assert.match(updateMigration, /existing\.payload_hash<>request_hash/);
  assert.match(updateMigration, /execute_offline_optimistic_update/);
  const optimisticAllowlist = updateMigration.match(/p_action_type=any\(array\[[\s\S]*?\]::text\[\]\)/)?.[0] ?? "";
  for (const actionType of ["update_account", "update_category", "update_goal", "update_card", "update_transaction"]) {
    assert.match(optimisticAllowlist, new RegExp(`'${actionType}'`));
  }
  assert.doesNotMatch(optimisticAllowlist, /delete_|archive_|complete_|reopen_|pay_|reverse_/);

  console.log("Offline queue security tests passed.");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
