const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const sourceRoots = ["app", "components"];

function listSourceFiles(relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  return fs.readdirSync(absoluteDir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(relativePath);
    return /\.(ts|tsx)$/.test(entry.name) ? [relativePath] : [];
  });
}

const nativeModalImports = [];
for (const file of sourceRoots.flatMap(listSourceFiles)) {
  if (file.replaceAll("\\", "/") === "components/FinFlowPopup.tsx") continue;
  const source = fs.readFileSync(path.join(root, file), "utf8");
  const reactNativeImports = source.matchAll(/import\s*\{([\s\S]*?)\}\s*from\s*["']react-native["']/g);
  for (const match of reactNativeImports) {
    const importedNames = match[1]
      .split(",")
      .map((name) => name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]);
    if (importedNames.includes("Modal")) nativeModalImports.push(file);
  }
}

if (nativeModalImports.length) {
  throw new Error(`Modais nativos encontrados em: ${nativeModalImports.join(", ")}`);
}

const layout = fs.readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");
const route = fs.readFileSync(path.join(root, "app", "flow-screen.tsx"), "utf8");
const flowScreen = fs.readFileSync(path.join(root, "components", "FinFlowScreen.tsx"), "utf8");
const home = fs.readFileSync(path.join(root, "app", "(tabs)", "index.tsx"), "utf8");
const settings = fs.readFileSync(path.join(root, "app", "(tabs)", "configuracoes.tsx"), "utf8");
const tabsLayout = fs.readFileSync(path.join(root, "app", "(tabs)", "_layout.tsx"), "utf8");
if (!layout.includes("<FinFlowScreenProvider>") || !layout.includes('name="flow-screen"')) {
  throw new Error("A rota global de fluxos não está registrada no layout raiz.");
}
if (!route.includes("FinFlowScreenPage")) {
  throw new Error("A página global de fluxos não está conectada ao Expo Router.");
}

if (!flowScreen.includes('from "react-native-safe-area-context"')) {
  throw new Error("As telas de fluxo precisam usar a SafeAreaView compativel com Android e iOS.");
}
if (!flowScreen.includes('edges={["top", "right", "bottom", "left"]}')) {
  throw new Error("As telas de fluxo precisam respeitar todas as areas seguras do aparelho.");
}
if (!home.includes('transactionForm: { flexGrow: 1') || !home.includes('marginTop: "auto"')) {
  throw new Error("A acao da tela de transacao precisa permanecer alinhada ao rodape.");
}
if (!settings.includes('notificationOptionsList: { flex: 1') || !settings.includes('offlineQueueList: { flex: 1')) {
  throw new Error("As acoes de notificacao e sincronizacao precisam permanecer alinhadas ao rodape.");
}
if (!tabsLayout.includes("useSafeAreaInsets") || !tabsLayout.includes("64 + bottomInset")) {
  throw new Error("A barra de abas precisa reservar a area de navegacao do aparelho.");
}
if (!home.includes("transactionFormRef.current?.scrollTo") || !home.includes("transactionValueYRef.current")) {
  throw new Error("O campo de valor da transacao precisa subir quando o teclado abrir.");
}

for (const tabFile of [home, settings,
  fs.readFileSync(path.join(root, "app", "(tabs)", "transacoes.tsx"), "utf8"),
  fs.readFileSync(path.join(root, "app", "(tabs)", "caixinhas.tsx"), "utf8"),
  fs.readFileSync(path.join(root, "app", "(tabs)", "relatorios.tsx"), "utf8"),
]) {
  if (!tabFile.includes("<RefreshControl")) {
    throw new Error("Todas as abas principais precisam oferecer atualizacao por gesto.");
  }
}

console.log("Flow screen navigation tests passed.");
