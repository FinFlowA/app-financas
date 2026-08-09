/* global __dirname */
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-require */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "lib", "optional-native-modules.ts"), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-native-compat-"));
const modulePath = path.join(tempDir, "optional-native-modules.cjs");
fs.writeFileSync(modulePath, output);

const blockedModules = new Set([
  "expo-secure-store",
  "@react-native-community/netinfo",
  "expo-screen-capture",
  "expo-crypto",
]);
const blockedLoadAttempts = [];

const otaApplicationFiles = [
  path.join(root, "app", "_layout.tsx"),
  path.join(root, "app", "chat-ia.tsx"),
  path.join(root, "app", "(tabs)", "transacoes.tsx"),
  path.join(root, "lib", "notifications.ts"),
  path.join(root, "lib", "offline-queue.ts"),
  path.join(root, "lib", "offline-sync.ts"),
  path.join(root, "lib", "supabase.ts"),
];
const staticNativeImport = /^import[^;]+from\s+["'](?:expo-secure-store|expo-screen-capture|expo-crypto|@react-native-community\/netinfo)["'];?/mu;
for (const applicationFile of otaApplicationFiles) {
  const applicationSource = fs.readFileSync(applicationFile, "utf8");
  assert.doesNotMatch(
    applicationSource,
    staticNativeImport,
    `${path.relative(root, applicationFile)} nao pode carregar modulo ausente durante o bootstrap`,
  );
}

const originalLoad = Module._load;
Module._load = function loadWithoutNewNativeModules(request, parent, isMain) {
  if (request === "expo-updates") return { runtimeVersion: "2.0.0" };
  if (request === "react-native") return { Platform: { OS: "android" } };
  if (blockedModules.has(request)) {
    blockedLoadAttempts.push(request);
    throw new Error(`Native module unavailable: ${request}`);
  }
  return originalLoad.call(this, request, parent, isMain);
};

async function run() {
  try {
    const compat = require(modulePath);
    assert.equal(compat.getOptionalSecureStore(), null);
    assert.equal(compat.getOptionalNetInfo(), null);
    assert.equal(compat.getOptionalScreenCapture(), null);
    assert.equal(compat.getOptionalExpoCrypto(), null);
    assert.deepEqual(
      blockedLoadAttempts,
      [],
      "o runtime nativo 2.0.0 nao pode sequer solicitar pacotes ausentes",
    );

    const firstId = compat.randomUuidCompat();
    const secondId = compat.randomUuidCompat();
    assert.match(firstId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.notEqual(firstId, secondId);

    const firstDigest = await compat.digestForLocalDeduplication("agenda-a");
    const repeatedDigest = await compat.digestForLocalDeduplication("agenda-a");
    const otherDigest = await compat.digestForLocalDeduplication("agenda-b");
    assert.equal(firstDigest, repeatedDigest);
    assert.notEqual(firstDigest, otherDigest);
    assert.match(firstDigest, /^[0-9a-f]{32}$/i);
    assert.deepEqual(
      blockedLoadAttempts,
      [],
      "os fallbacks tambem nao podem carregar pacotes nativos no runtime 2.0.0",
    );
  } finally {
    Module._load = originalLoad;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("Native compatibility tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
