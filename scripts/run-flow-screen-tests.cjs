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
if (!flowScreen.includes("routeOpenRef") || !flowScreen.includes('router.push("/flow-screen")')) {
  throw new Error("Os fluxos devem compartilhar uma unica rota para nao acumular telas vazias.");
}
if (!flowScreen.includes("closeAndNavigate") || !flowScreen.includes("pendingDestinationRef")) {
  throw new Error("A navegacao iniciada em um fluxo deve aguardar a rota fechar por completo.");
}
// Telas que abrem fluxos só podem depender das funções de navegação: se o
// contexto delas mudar a cada registro de conteúdo, a tela se redesenha,
// registra um conteúdo novo e entra em laço enquanto o fluxo está aberto.
const registryMemo = flowScreen.match(/useMemo<FlowRegistry>\([\s\S]*?\), \[([^\]]*)\]\)/)?.[1] ?? "";
if (!flowScreen.includes("FlowEntriesContext") || !registryMemo || /\bentries\b/.test(registryMemo)) {
  throw new Error("As funcoes dos fluxos precisam ficar num contexto estavel, separado dos fluxos abertos.");
}
if (flowScreen.includes('pathname: "/flow-screen", params: { id }')) {
  throw new Error("Cada modal nao pode criar sua propria rota /flow-screen.");
}
if (/setModalNotificacoesHome\(false\);\s*router\.(?:push|replace)/s.test(home)) {
  throw new Error("Avisos nao podem fechar e navegar no mesmo evento; isso disputa a pilha de rotas.");
}
if (!home.includes("navigateFromFlow({ pathname: \"/(tabs)/transacoes\", params: { filtroPeriodo: \"atrasados\" }")) {
  throw new Error("O aviso de vencidos deve fechar o fluxo antes de trocar de aba.");
}
// O sino e a central "Avisos financeiros" saíram da Home (os avisos chegam
// pelas notificações do aparelho).
if (home.includes("Avisos financeiros") || home.includes("setModalNotificacoesHome")) {
  throw new Error("A Home nao deve voltar a ter o botao de notificacoes.");
}
if (!home.includes('transactionForm: { flexGrow: 1') || !home.includes('marginTop: "auto"')) {
  throw new Error("A acao da tela de transacao precisa permanecer alinhada ao rodape.");
}
if (!home.includes('categoryOptionsGrid: { flexDirection: "row", flexWrap: "wrap"')) {
  throw new Error("As cores e os icones da nova categoria precisam quebrar linha em telas estreitas.");
}
const newCategoryFlow = home.match(/\{\/\* MODAL NOVA CATEGORIA \*\/\}([\s\S]*?)\{\/\* MODAL RESUMO DO MÊS \*\/\}/)?.[1] ?? "";
if (!newCategoryFlow.includes("styles.categoryOptionsGrid") || /<ScrollView\s+horizontal/.test(newCategoryFlow)) {
  throw new Error("A tela de nova categoria nao pode cortar opcoes em uma lista horizontal.");
}
if (!settings.includes('notificationOptionsList: { flex: 1') || !settings.includes('offlineQueueList: { flex: 1')) {
  throw new Error("As acoes de notificacao e sincronizacao precisam permanecer alinhadas ao rodape.");
}
if (!tabsLayout.includes("useSafeAreaInsets") || !tabsLayout.includes("FLOATING_BAR_HEIGHT + bottomInset + FLOATING_BAR_GAP")) {
  throw new Error("A barra de abas precisa reservar a area de navegacao do aparelho.");
}
// O FinFlowScreen estica a raiz e o primeiro filho dela até a tela cheia. Se
// outra camada (como o ajuste do teclado) ficar entre a raiz e a folha, a
// folha fica com a altura natural no fim de uma página escura e cortada.
if (!/<View ref=\{transactionOverlayRef\}[^>]*>\s*<View style=\{\[styles\.transactionSheet/.test(home)) {
  throw new Error("A folha da nova transacao precisa ser o primeiro filho da raiz do fluxo.");
}
// Campos da transação (valor e número de parcelas) sobem acima do teclado:
// a área mede a sobreposição real do teclado e o campo focado é rolado até
// ficar visível (hooks/use-teclado.ts).
if (!home.includes("useCampoFocadoVisivel(transactionFormRef")
  || !home.includes("onScroll={onScrollTransacao}")
  || (home.match(/mostrarCampoTransacaoAcimaDoTeclado\(320\)/g) ?? []).length < 2
  || !home.includes("useSobreposicaoTeclado(")) {
  throw new Error("Os campos de valor e de parcelas da transacao precisam subir quando o teclado abrir.");
}

// Cabeçalhos coloridos do Início e dos Cartões usam as mesmas ondas animadas.
const cardsScreen = fs.readFileSync(path.join(root, "app", "(tabs)", "cartoes.tsx"), "utf8");
if (!home.includes("<OndasCabecalho />") || !cardsScreen.includes("<OndasCabecalho />")) {
  throw new Error("Os cabecalhos do Inicio e dos Cartoes precisam das ondas animadas.");
}
// A lista de conta/categoria surge (fundo escurece e a folha sobe) em vez de
// aparecer de uma vez, e some com o movimento inverso.
const selector = fs.readFileSync(path.join(root, "components", "SeletorLista.tsx"), "utf8");
if (!selector.includes("Animated.timing(entrada") || !selector.includes('animationType="none"') || !/opacity: entrada/.test(selector)) {
  throw new Error("A lista de selecao precisa animar a entrada e a saida.");
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
