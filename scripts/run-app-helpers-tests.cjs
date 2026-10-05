/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-require */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-app-helpers-"));

function carregar(relativo) {
  const saida = ts.transpileModule(fs.readFileSync(path.join(root, relativo), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const destino = path.join(tempDir, `${path.basename(relativo, ".ts")}.cjs`);
  fs.writeFileSync(destino, saida);
  return require(destino);
}

// Seletor com busca (contas, destino e categorias da nova transação).
const { filtrarOpcoesSeletor, normalizarBusca } = carregar("lib/seletor-busca.ts");
const opcoes = [
  { id: 1, titulo: "Café da manhã" },
  { id: 2, titulo: "Mercado" },
  { id: 3, titulo: "Conta Corrente Itaú", grupo: "Contas" },
  { id: 4, titulo: "Reserva de emergência", grupo: "Objetivos" },
];
assert.equal(normalizarBusca("  ÁÉÍ Ção "), "aei cao");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "").map((o) => o.id), [1, 2, 3, 4], "Busca vazia lista tudo.");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "cafe").map((o) => o.id), [1], "Busca ignora acentos.");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "MERC").map((o) => o.id), [2], "Busca ignora maiúsculas.");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "itau corrente").map((o) => o.id), [3], "Palavras em qualquer ordem.");
assert.deepEqual(filtrarOpcoesSeletor(opcoes, "reserva xyz"), [], "Todas as palavras precisam aparecer.");

// Círculo da cota de consultas ao Finn.
const { lerCotaConsultas, rotacoesAnel } = carregar("lib/cota-ia.ts");
assert.equal(lerCotaConsultas(null), null);
assert.equal(lerCotaConsultas({ model_limit: 0, model_remaining: 0 }), null, "Sem limite, sem círculo.");
assert.equal(lerCotaConsultas({ model_limit: "abc", model_remaining: 3 }), null);
assert.deepEqual(lerCotaConsultas({ model_limit: 20, model_remaining: 20 }), { restantes: 20, limite: 20, fracao: 1, nivel: "folgada" });
assert.equal(lerCotaConsultas({ model_limit: 20, model_remaining: 8 }).nivel, "atencao");
assert.equal(lerCotaConsultas({ model_limit: 20, model_remaining: 4 }).nivel, "critica");
assert.equal(lerCotaConsultas({ model_limit: 20, model_remaining: -3 }).restantes, 0, "Restantes nunca fica negativo.");
assert.equal(lerCotaConsultas({ model_limit: 20, model_remaining: 99 }).restantes, 20, "Restantes nunca passa do limite.");
assert.deepEqual(rotacoesAnel(0), { direita: -135, esquerda: null }, "Cota esgotada: anel vazio.");
assert.deepEqual(rotacoesAnel(0.5), { direita: 45, esquerda: null }, "Meia cota: metade direita cheia.");
assert.deepEqual(rotacoesAnel(1), { direita: 45, esquerda: 225 }, "Cota cheia: anel completo.");
assert.deepEqual(rotacoesAnel(2), rotacoesAnel(1), "Fração acima de 1 é limitada.");

// Lembretes de vencimento agendados com antecedência.
const lembretes = carregar("lib/lembretes-vencimento.ts");
const agora = new Date(2026, 9, 1, 10, 30); // 01/10/2026 10h30
const transacoes = [
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-10-01" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-10-02" },
  { status: "pendente", tipo: "receita", data_vencimento: "2026-10-02" },
  { status: "paga", tipo: "despesa", data_vencimento: "2026-10-03" },
  { status: "pendente", tipo: "transferencia", data_vencimento: "2026-10-04" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-10-20" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-12-20" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-09-30" },
  { status: "pendente", tipo: "despesa", data_vencimento: "" },
];
const grupos = lembretes.agruparVencimentosPorDia(transacoes, agora);
assert.deepEqual(
  grupos.map((g) => [g.dia.getDate(), g.dia.getMonth() + 1, g.despesas, g.receitas]),
  [[1, 10, 1, 0], [2, 10, 1, 1], [20, 10, 1, 0]],
  "Só pendentes de despesa/receita entre hoje e 30 dias.",
);
const agenda = lembretes.montarLembretesVencimento(transacoes, agora);
const descrever = (l) => `${l.quando.getDate()}/${l.quando.getMonth() + 1} ${l.quando.getHours()}h`;
assert.deepEqual(
  agenda.map(descrever),
  ["1/10 19h", "2/10 8h", "2/10 19h", "20/10 8h"],
  "Hoje só o que ainda vai acontecer; 19h só na primeira semana; dias seguintes agendados já.",
);
assert.equal(agenda[1].corpo, "Hoje vencem 1 despesa e 1 receita. Confira os detalhes no FinFlow.");
assert.equal(agenda[1].titulo, "Vencimentos de hoje");
assert.equal(agenda[0].corpo, "Ainda há 1 despesa com vencimento hoje. Caso já tenha sido resolvida, marque-a como concluída no FinFlow.");
const muitas = Array.from({ length: 40 }, (_, i) => {
  const dia = new Date(2026, 9, 2 + (i % 29));
  return { status: "pendente", tipo: "despesa", data_vencimento: `${dia.getFullYear()}-${String(dia.getMonth() + 1).padStart(2, "0")}-${String(dia.getDate()).padStart(2, "0")}` };
});
const agendaCheia = lembretes.montarLembretesVencimento(muitas, agora);
assert.equal(agendaCheia.length, lembretes.LIMITE_LEMBRETES_VENCIMENTO, "A agenda respeita o teto de lembretes.");
assert.ok(
  agendaCheia.every((l, i) => i === 0 || l.quando >= agendaCheia[i - 1].quando),
  "Os lembretes mais próximos têm prioridade.",
);
assert.deepEqual(lembretes.montarLembretesVencimento([], agora), []);

// Modo demonstração local: a Home pagina as transações com range() (como o
// PostgREST, índices inclusivos). Sem isso a Home do demo não carregava.
const testeDemo = (async () => {
  const { createLocalDemoQueryBuilder } = carregar("lib/local-demo/query-builder.ts");
  const banco = { transacoes: Array.from({ length: 7 }, (_, i) => ({ id: i + 1 })) };
  const pagina = (de, ate) => createLocalDemoQueryBuilder(banco, "transacoes", () => null)
    .select("id").order("id", { ascending: true }).range(de, ate);
  assert.deepEqual((await pagina(0, 2)).data.map((t) => t.id), [1, 2, 3], "Primeira página do range.");
  assert.deepEqual((await pagina(3, 5)).data.map((t) => t.id), [4, 5, 6], "Página do meio do range.");
  assert.deepEqual((await pagina(6, 8)).data.map((t) => t.id), [7], "Última página incompleta encerra a paginação.");
})();

// Avisos de atraso: sempre agendados (9h), nunca disparados na abertura.
const pendentes = [
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-09-28" },
  { status: "pendente", tipo: "receita", data_vencimento: "2026-09-30" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-10-01" },
  { status: "pendente", tipo: "despesa", data_vencimento: "2026-10-05" },
  { status: "paga", tipo: "despesa", data_vencimento: "2026-09-29" },
];
const quando = (l) => `${l.quando.getDate()}/${l.quando.getMonth() + 1} ${l.quando.getHours()}h`;
const depoisDas9 = lembretes.montarLembretesAtraso(pendentes, new Date(2026, 9, 1, 10, 30));
assert.deepEqual(depoisDas9.map(quando), ["2/10 9h", "6/10 9h"], "Depois das 9h: aviso na manhã seguinte e 'venceu ontem' no dia seguinte a cada vencimento.");
assert.equal(depoisDas9[0].corpo, "Você tem 2 despesas e 1 receita vencidas que ainda não foram concluídas. Confira no FinFlow.");
assert.equal(depoisDas9[1].corpo, "Ontem venceu 1 despesa, que ainda está pendente. Caso já tenha sido resolvida, marque-a como concluída no FinFlow.");
const antesDas9 = lembretes.montarLembretesAtraso(pendentes, new Date(2026, 9, 1, 7, 0));
assert.deepEqual(antesDas9.map(quando), ["1/10 9h", "2/10 9h", "6/10 9h"], "Antes das 9h: o primeiro aviso sai no mesmo dia.");
assert.match(antesDas9[0].corpo, /^Você tem 1 despesa e 1 receita vencidas que ainda não foram concluídas/);
assert.deepEqual(lembretes.montarLembretesAtraso([], new Date(2026, 9, 1, 10, 30)), []);

// Prazo do objetivo: sem valores em reais, só a % que falta e a data.
const objetivo = { nome: "Viagem", meta_valor: 1000, saldo_atual: 250, data_prazo: "2026-12-20" };
assert.deepEqual(lembretes.mensagemPrazoObjetivo(objetivo, 7), { titulo: "O prazo do seu objetivo termina em 7 dias", corpo: 'Ainda faltam 75% da meta de "Viagem", com prazo até 20/12/2026.' });
assert.equal(lembretes.mensagemPrazoObjetivo(objetivo, 1).titulo, "O prazo do seu objetivo termina amanhã");
assert.equal(lembretes.mensagemPrazoObjetivo(objetivo, 0).titulo, "O prazo do seu objetivo termina hoje");
assert.match(lembretes.mensagemPrazoObjetivo({ ...objetivo, saldo_atual: 996 }, 3).corpo, /Ainda falta 1% da meta/, "Com qualquer valor faltando, nunca 'faltam 0%'.");
assert.ok(!/R\$/.test(lembretes.mensagemPrazoObjetivo(objetivo, 7).corpo), "O aviso do objetivo não mostra valores.");

// Limite do cartão, como a tela de Cartões calcula.
const itensCartao = [
  { cartao_id: 1, mes_fatura: "2026-10", pago: false, descricao: "Mercado", valor: 100 },
  { cartao_id: 1, mes_fatura: "2026-11", pago: false, descricao: "Parcela 2/3", valor: "50" },
  { cartao_id: 1, mes_fatura: "2026-11", pago: false, descricao: "Streaming (Fixa)", valor: 30 },
  { cartao_id: 1, mes_fatura: "2026-10", pago: false, descricao: "Streaming (Fixa)", valor: 30 },
  { cartao_id: 1, mes_fatura: "2026-09", pago: false, descricao: "Antiga", valor: 999 },
  { cartao_id: 1, mes_fatura: "2026-10", pago: true, descricao: "Paga", valor: 999 },
  { cartao_id: 2, mes_fatura: "2026-10", pago: false, descricao: "Outro cartão", valor: 999 },
];
assert.equal(lembretes.limiteUsadoDoCartao(itensCartao, 1, "2026-10"), 180);

// Aviso de limite do cartão: só porcentagens, sem valores em reais.
assert.deepEqual(lembretes.mensagemLimiteCartao({ nome: "Nubank", limite: 2000, limite_usado: 1700 }), { titulo: "Cartão Nubank com 85% do limite usado", corpo: "Ainda restam 15% do limite disponível." });
assert.equal(lembretes.mensagemLimiteCartao({ nome: "Nubank", limite: 2000, limite_usado: 1975 }).corpo, "Ainda resta 1% do limite disponível.");
assert.equal(lembretes.mensagemLimiteCartao({ nome: "Nubank", limite: 2000, limite_usado: 1995 }).corpo, "Não há mais limite disponível neste cartão.", "Nunca promete limite que não existe.");
assert.equal(lembretes.mensagemLimiteCartao({ nome: "Nubank", limite: 2000, limite_usado: 2300 }).titulo, "Cartão Nubank com 115% do limite usado");
assert.ok(!/R$/.test(JSON.stringify(lembretes.mensagemLimiteCartao({ nome: "Nubank", limite: 2000, limite_usado: 1700 }))), "O aviso do limite não mostra valores.");

const semEmoji = /\p{Extended_Pictographic}/u;
for (const arquivo of ["lib/notifications.ts", "lib/lembretes-vencimento.ts"]) {
  assert.ok(!semEmoji.test(fs.readFileSync(path.join(root, arquivo), "utf8")), `As notificações não podem ter emojis (${arquivo}).`);
}

const notificacoes = fs.readFileSync(path.join(root, "lib", "notifications.ts"), "utf8");
// Textos naturais, sem travessão ("—") em títulos e mensagens.
const linhasDosTextos = [
  ...notificacoes.split(/\r?\n/),
  ...fs.readFileSync(path.join(root, "lib", "lembretes-vencimento.ts"), "utf8").split(/\r?\n/),
];
for (const linha of linhasDosTextos) {
  if (/\b(title|body|titulo|corpo)\b\s*[:?]/.test(linha)) assert.ok(!linha.includes("—"), `Notificação com travessão: ${linha.trim()}`);
}
for (const l of [...agenda, ...depoisDas9, ...antesDas9]) assert.ok(!`${l.titulo} ${l.corpo}`.includes("—"), "Notificação com travessão.");
// Nada dispara segundos depois de abrir o app: tudo vai para horários fixos.
assert.ok(!/gatilhoIntervalo\(\d\)/.test(notificacoes), "Nenhuma notificação pode disparar logo após abrir o app.");
assert.ok(!fs.readFileSync(path.join(root, "app", "_layout.tsx"), "utf8").includes("exibirEventoObrigatorioLocal("),
  "Abrir o app não pode transformar avisos de parceria em notificação (eles aparecem dentro do app).");
assert.match(fs.readFileSync(path.join(root, "app", "(tabs)", "cartoes.tsx"), "utf8"), /cancelarLembretesDaFatura\(cartaoAberto\.id, mesPagamento\)/,
  "Pagar a fatura pelo app precisa cancelar os lembretes de vencimento dela.");
assert.match(notificacoes, /montarLembretesAtraso\(transacoes, agora\)/, "Os avisos de atraso precisam ser agendados.");
assert.match(
  notificacoes,
  /montarLembretesVencimento\(transacoes, agora\)/,
  "A agenda completa precisa agendar os próximos dias, não só o dia em que o app foi aberto.",
);

// Periodicidade e edição de datas de séries (mesma regra do banco).
const recorrencia = carregar("lib/transacoes.ts");
const dataIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
assert.equal(dataIso(recorrencia.adicionarRecorrencia(new Date(2031, 0, 1), 2, "semanal")), "2031-01-15");
assert.equal(dataIso(recorrencia.adicionarRecorrencia(new Date(2031, 0, 31), 1, "mensal")), "2031-02-28");
assert.equal(recorrencia.sufixoRecorrencia("mensal"), "(Fixa)");
assert.equal(recorrencia.sufixoRecorrencia("semanal"), "(Fixa semanal)");
assert.ok(recorrencia.isRecorrenciaFixa("Café (Fixa semanal) [Serie:abc123]"), "A fixa semanal é reconhecida como série fixa.");
assert.equal(recorrencia.descricaoBaseRecorrencia("Café (Fixa semanal) [Serie:abc123]"), "Café");
assert.equal(
  recorrencia.substituirDescricaoBase("Café (Fixa semanal) [Serie:abc123]", "Cafezinho"),
  "Cafezinho (Fixa semanal) [Serie:abc123]",
  "Trocar a descrição mantém o rótulo da série.",
);
// Parcelas semanais: o intervalo não está na descrição, vem da distância entre os itens.
assert.equal(recorrencia.serieTemIntervaloCurto("Aula (2/4) [Serie:x]", ["2031-01-01", "2031-01-08", "2031-01-15"], "2031-01-08"), true);
assert.equal(recorrencia.serieTemIntervaloCurto("Café (Fixa semanal) [Serie:x]", [], "2031-04-01"), true);
assert.equal(recorrencia.serieTemIntervaloCurto("Geladeira (2/3) [Serie:x]", ["2031-01-31", "2031-02-28", "2031-03-31"], "2031-02-28"), false,
  "Parcelas mensais (mesmo em fevereiro) não são série curta.");
assert.equal(recorrencia.novaDataItemSerie("2031-03-30", "2031-04-01", "2031-04-03", true), "2031-04-01", "Na série curta todos andam os mesmos dias.");
assert.equal(recorrencia.novaDataItemSerie("2031-03-31", "2031-02-28", "2031-02-10", false), "2031-03-10", "Na mensal, cada item fica no seu mês, no novo dia.");
assert.equal(recorrencia.novaDataItemSerie("2031-02-15", "2031-01-31", "2031-01-31", false), "2031-02-15", "Sem mudar a data, nenhum item muda.");
assert.equal(recorrencia.novaDataItemSerie("2031-02-15", "2031-01-10", "2031-01-31", false), "2031-02-28", "O novo dia respeita o fim do mês.");
// A edição de série no Histórico usa a regra (antes, a semanal ia toda para o mesmo dia do mês).
assert.match(fs.readFileSync(path.join(root, "app", "(tabs)", "transacoes.tsx"), "utf8"), /novaDataItemSerie\(item\.data_vencimento \|\| dataFormatada, transacaoEditando\.data_vencimento, dataFormatada, intervaloCurto\)/);
// O formulário do app oferece semanal, mensal e anual (sem diária) e envia a periodicidade das parcelas.
const telaInicio = fs.readFileSync(path.join(root, "app", "(tabs)", "index.tsx"), "utf8");
assert.match(telaInicio, /\(\["semanal", "mensal", "anual"\] as const\)/);
assert.match(telaInicio, /payload\.installment_frequency = frequenciaParcelada/);
assert.doesNotMatch(telaInicio, /"diaria"/, "Não existe repetição diária.");

testeDemo.then(
  () => console.log("App helper tests passed."),
  (erro) => {
    console.error(erro);
    process.exit(1);
  },
);
