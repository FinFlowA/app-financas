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
if (!layout.includes("<FinFlowScreenProvider>") || !layout.includes('name="flow-screen"')) {
  throw new Error("A rota global de fluxos não está registrada no layout raiz.");
}
if (!route.includes("FinFlowScreenPage")) {
  throw new Error("A página global de fluxos não está conectada ao Expo Router.");
}

console.log("Flow screen navigation tests passed.");
