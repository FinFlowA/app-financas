/* eslint-disable security/detect-non-literal-fs-filename */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const layout = fs.readFileSync(path.join(root, "app", "_layout.tsx"), "utf8");

const updateTitle = layout.indexOf("Novidades no FinFlow");
assert.notEqual(updateTitle, -1, "Titulo do modal de atualizacao nao encontrado.");
const modalStart = layout.lastIndexOf("<Modal", updateTitle);
assert.notEqual(modalStart, -1, "Modal de atualizacao nao encontrado em app/_layout.tsx.");

const nextModal = layout.indexOf("\n      <Modal", modalStart + 1);
assert.notEqual(nextModal, -1, "Nao foi possivel delimitar o modal de atualizacao.");
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

assert.ok(
  modal.includes("Aplicar agora") && modal.indexOf("Aplicar agora") < scrollStart,
  "A acao Aplicar agora deve continuar acessivel no estado de atualizacao pronta.",
);

console.log("Release notes modal tests passed.");
