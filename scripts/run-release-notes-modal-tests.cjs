/* eslint-disable security/detect-non-literal-fs-filename */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const layout = fs.readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");

const updateTitle = layout.indexOf("Novidades no FinFlow");
assert.notEqual(updateTitle, -1, "Titulo do modal de atualizacao nao encontrado.");
const modalStart = layout.lastIndexOf("<FinFlowPopup", updateTitle);
assert.notEqual(modalStart, -1, "Popup de atualizacao nao encontrado em app/_layout.tsx.");

const nextModal = layout.indexOf("\n      <FinFlowPopup", modalStart + 1);
assert.notEqual(nextModal, -1, "Nao foi possivel delimitar o popup de atualizacao.");
const modal = layout.slice(modalStart, nextModal);

assert.match(
  layout,
  /\bScrollView\b/,
  "O modal precisa importar ScrollView para acomodar listas longas.",
);
assert.match(
  modal,
  /<ScrollView\b[\s\S]*?<\/ScrollView>/,
  "A lista de melhorias precisa ficar dentro de um ScrollView.",
);
assert.match(
  modal,
  /styles\.modalAtualizacaoCard/,
  "O card de novidades precisa de um estilo proprio com altura limitada.",
);
assert.match(
  layout,
  /modalAtualizacaoCard\s*:\s*\{[\s\S]*?maxHeight\s*:\s*["'](?:8[0-9]|9[0-5])%["'][\s\S]*?\}/,
  "O card de novidades precisa limitar a altura entre 80% e 95% da tela.",
);
assert.match(
  layout,
  /updateScroll\s*:\s*\{[\s\S]*?(?:flexShrink\s*:\s*1|maxHeight\s*:)[\s\S]*?\}/,
  "A area rolavel precisa poder encolher para preservar as acoes do modal.",
);

const scrollStart = modal.indexOf("<ScrollView");
const scrollEnd = modal.indexOf("</ScrollView>", scrollStart);
const continueAction = modal.indexOf("Continuar", scrollEnd);
const closeAction = modal.indexOf('accessibilityLabel="Fechar novidades"');
assert.ok(
  scrollStart >= 0 && scrollEnd > scrollStart && continueAction > scrollEnd,
  "O botao Continuar deve ficar fora da rolagem e permanecer sempre acessivel.",
);
assert.ok(
  closeAction >= 0 && closeAction < scrollStart,
  "O modal precisa oferecer uma acao de fechar acessivel sem depender da rolagem.",
);
assert.match(
  modal,
  /onRequestClose=\{\(\)\s*=>[\s\S]*?dispensarNovidades/,
  "O botao Voltar do Android tambem precisa dispensar a lista de novidades.",
);

// Atualizacao OTA silenciosa: nenhum aviso de "baixando" ou "reinicie para
// aplicar"; a versao baixada entra sozinha na proxima abertura ou na volta ao
// app depois de alguns minutos fora.
for (const texto of ["Aplicar agora", "Preparando atualização", "Atualização pronta", "Reinicie o FinFlow"]) {
  assert.ok(!layout.includes(texto), `O app nao deve mais exibir "${texto}".`);
}
assert.match(
  layout,
  /const resultado = await Updates\.fetchUpdateAsync\(\);\s*atualizacaoPronta = resultado\.isNew;/,
  "A atualizacao precisa ser baixada em segundo plano, sem abrir modal.",
);
assert.match(
  layout,
  /ficouFora[\s\S]{0,200}if \(atualizacaoPronta\) void Updates\.reloadAsync\(\);/,
  "A versao baixada deve ser aplicada sozinha ao voltar ao app depois de um tempo fora.",
);
assert.match(
  layout,
  /useState<"novidades" \| null>/,
  "O modal de atualizacao so pode mostrar as novidades da versao.",
);

console.log("Release notes modal tests passed.");
