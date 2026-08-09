/* global __dirname */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const projectRoot = path.resolve(__dirname, "..");
const libRoot = path.join(projectRoot, "lib");
const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), "finflow-local-demo-tests-"));

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  const roots = [
    path.join(libRoot, "local-demo", "client.ts"),
    path.join(libRoot, "finance-ai", "validation.ts"),
    path.join(libRoot, "transaction-payments.ts"),
  ];
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    skipLibCheck: true,
    rootDir: libRoot,
    outDir: outputRoot,
    esModuleInterop: true,
  };
  const program = ts.createProgram(roots, options);
  const emitResult = program.emit();
  const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);
  const errors = diagnostics.filter((item) => item.category === ts.DiagnosticCategory.Error);
  if (emitResult.emitSkipped || errors.length > 0) {
    const host = {
      getCanonicalFileName: (fileName) => fileName,
      getCurrentDirectory: () => projectRoot,
      getNewLine: () => os.EOL,
    };
    process.stderr.write(ts.formatDiagnosticsWithColorAndContext(errors, host));
    throw new Error("O simulador local nao compilou para os testes de comportamento.");
  }

  const { createLocalDemoSupabaseClient } = require(path.join(outputRoot, "local-demo", "client.js"));
  const { parseFinanceAiHttpResponse } = require(path.join(outputRoot, "finance-ai", "validation.js"));
  const { normalizeTransactionPaymentHistory } = require(path.join(outputRoot, "transaction-payments.js"));
  const client = createLocalDemoSupabaseClient();

  async function invoke(body) {
    const result = await client.functions.invoke("finance-ai", { body });
    assert(!result.error, `Falha local inesperada: ${result.error?.message ?? "desconhecida"}`);
    const parsed = parseFinanceAiHttpResponse(result.data);
    assert(parsed.ok, `Envelope local invalido para ${JSON.stringify(body)}`);
    return result.data;
  }

  const initialTransactions = client.__localDemo.database.transacoes.length;
  const initialAccounts = client.__localDemo.database.contas.length;

  const rpcClient = createLocalDemoSupabaseClient();
  const legacyPaidSummary = await rpcClient.rpc("list_transaction_payment_summaries", { p_transaction_ids: [1] });
  assert(!legacyPaidSummary.error && legacyPaidSummary.data?.[0]?.paid_total === 6200, "O resumo local perdeu um lançamento concluído legado.");
  assert(legacyPaidSummary.data[0].payment_count === 0 && legacyPaidSummary.data[0].last_paid_transaction_id === 1, "Um lançamento legado sem comprovante foi apresentado como pagamento auditável.");
  const legacyPaidHistory = await rpcClient.rpc("get_transaction_payment_history", { p_transaction_id: 1 });
  assert(!legacyPaidHistory.error && legacyPaidHistory.data?.payments.length === 0, "O histórico local inventou um comprovante para um lançamento legado.");
  const legacyReopen = await rpcClient.rpc("reopen_transaction_completion", {
    p_transaction_id: 1,
    p_idempotency_key: "10000000-0000-4000-8000-000000000100",
  });
  assert(legacyReopen.error?.code === "TRANSACTION_NOT_COMPLETED", "Um lançamento legado sem comprovante pôde ser reaberto sem trilha auditável.");

  const firstPartial = await rpcClient.rpc("complete_transaction_with_partial", {
    p_transaction_id: 5,
    p_expected_value: 89.9,
    p_adjustment_type: "none",
    p_adjustment_value: 0,
    p_realized_value: 50,
    p_realization_date: "2026-08-08",
    p_idempotency_key: "10000000-0000-4000-8000-000000000101",
  });
  assert(!firstPartial.error && firstPartial.data?.ok === true, "A UI local nao conseguiu registrar o primeiro pagamento parcial.");
  assert(firstPartial.data.transaction_id === 5 && firstPartial.data.payment_transaction_id !== 5, "A primeira parcial nao preservou a raiz e o filho tecnico.");
  assert(firstPartial.data.remaining_transaction_id === null && firstPartial.data.remaining_value === 39.9, "A primeira parcial ainda usa o modelo antigo de saldo restante.");
  const rootRow = rpcClient.__localDemo.database.transacoes.find((row) => row.id === 5);
  const firstPaymentRow = rpcClient.__localDemo.database.transacoes.find((row) => row.id === firstPartial.data.payment_transaction_id);
  assert(rootRow?.status === "pendente" && rootRow.valor === 39.9 && rootRow.data_realizacao === null, "A raiz nao permaneceu pendente com o saldo restante.");
  assert(firstPaymentRow?.status === "paga" && firstPaymentRow.valor === 50 && firstPaymentRow.transacao_pai_id === 5, "O primeiro pagamento tecnico nao foi ligado a raiz.");

  const firstReplay = await rpcClient.rpc("complete_transaction_with_partial", {
    p_transaction_id: 5,
    p_expected_value: 89.9,
    p_adjustment_type: "none",
    p_adjustment_value: 0,
    p_realized_value: 50,
    p_realization_date: "2026-08-08",
    p_idempotency_key: "10000000-0000-4000-8000-000000000101",
  });
  assert(!firstReplay.error && firstReplay.data?.replayed === true, "Repetir a primeira parcial nao foi idempotente.");
  assert(rpcClient.__localDemo.database.transacoes.filter((row) => row.transacao_pai_id === 5).length === 1, "O replay criou um pagamento tecnico duplicado.");

  const completionConflict = await rpcClient.rpc("complete_transaction_with_partial", {
    p_transaction_id: 5,
    p_expected_value: 89.9,
    p_adjustment_type: "none",
    p_adjustment_value: 0,
    p_realized_value: 40,
    p_realization_date: "2026-08-08",
    p_idempotency_key: "10000000-0000-4000-8000-000000000101",
  });
  assert(completionConflict.error?.code === "TRANSACTION_COMPLETION_IDEMPOTENCY_CONFLICT", "A chave local repetida aceitou dados financeiros diferentes.");

  const secondPartial = await rpcClient.rpc("complete_transaction_with_partial", {
    p_transaction_id: 5,
    p_expected_value: 39.9,
    p_adjustment_type: "none",
    p_adjustment_value: 0,
    p_realized_value: 20,
    p_realization_date: "2026-08-07",
    p_idempotency_key: "10000000-0000-4000-8000-000000000102",
  });
  assert(!secondPartial.error && secondPartial.data?.paid_total === 70 && secondPartial.data?.remaining_value === 19.9, "A segunda parcial nao acumulou o total pago.");
  assert(rootRow?.status === "pendente" && rootRow.valor === 19.9, "A segunda parcial nao reduziu a mesma raiz.");
  const secondPaymentRow = rpcClient.__localDemo.database.transacoes.find((row) => row.id === secondPartial.data.payment_transaction_id);
  assert(secondPaymentRow?.transacao_pai_id === 5 && secondPaymentRow.valor === 20, "A segunda parcial nao criou o segundo filho tecnico.");

  const summaryAfterPartials = await rpcClient.rpc("list_transaction_payment_summaries", { p_transaction_ids: [5] });
  assert(!summaryAfterPartials.error && summaryAfterPartials.data?.length === 1, "O resumo local nao agrupou o agendamento.");
  assert(summaryAfterPartials.data[0].payment_count === 2 && summaryAfterPartials.data[0].paid_total === 70 && summaryAfterPartials.data[0].remaining_value === 19.9, "O resumo das duas parciais esta incorreto.");
  assert(summaryAfterPartials.data[0].technical_transaction_ids.length === 2 && summaryAfterPartials.data[0].total_value === 89.9, "O resumo nao separou filhos tecnicos sem dupla contagem.");
  const summaryRequestedByChild = await rpcClient.rpc("list_transaction_payment_summaries", {
    p_transaction_ids: [firstPaymentRow.id, 5],
  });
  assert(!summaryRequestedByChild.error && summaryRequestedByChild.data?.length === 1 && summaryRequestedByChild.data[0].root_transaction_id === 5, "Consultar um filho tecnico nao retornou somente o agrupamento raiz.");
  const historyRequestedByChild = await rpcClient.rpc("get_transaction_payment_history", {
    p_transaction_id: firstPaymentRow.id,
  });
  assert(!historyRequestedByChild.error && historyRequestedByChild.data?.summary.root_transaction_id === 5, "O detalhe de um filho tecnico nao foi normalizado para a raiz.");
  const visibleRows = rpcClient.__localDemo.database.transacoes.filter((row) => row.id === 5 || row.transacao_pai_id === 5).filter((row) => row.transacao_pai_id == null);
  assert(visibleRows.length === 1, "Mais de uma linha ficou visivel para o mesmo agendamento.");

  const finalPayment = await rpcClient.rpc("complete_transaction_with_partial", {
    p_transaction_id: 5,
    p_expected_value: 19.9,
    p_adjustment_type: "none",
    p_adjustment_value: 0,
    p_realized_value: 19.9,
    p_realization_date: "2026-08-08",
    p_idempotency_key: "10000000-0000-4000-8000-000000000103",
  });
  assert(!finalPayment.error && finalPayment.data?.is_fully_paid === true && finalPayment.data?.payment_transaction_id === 5, "A quitacao final nao usou a raiz como ultimo pagamento.");
  assert(finalPayment.data.paid_total === 89.9 && finalPayment.data.remaining_value === 0 && rootRow?.status === "paga" && rootRow.valor === 19.9, "A quitacao final nao fechou corretamente o agendamento.");

  const finalReplay = await rpcClient.rpc("complete_transaction_with_partial", {
    p_transaction_id: 5,
    p_expected_value: 19.9,
    p_adjustment_type: "none",
    p_adjustment_value: 0,
    p_realized_value: 19.9,
    p_realization_date: "2026-08-08",
    p_idempotency_key: "10000000-0000-4000-8000-000000000103",
  });
  assert(!finalReplay.error && finalReplay.data?.replayed === true, "O replay da quitacao final nao foi idempotente.");

  const reopenFinal = await rpcClient.rpc("reopen_transaction_completion", {
    p_transaction_id: 5,
    p_idempotency_key: "10000000-0000-4000-8000-000000000104",
  });
  assert(!reopenFinal.error && reopenFinal.data?.payment_id === finalPayment.data.payment_id, "A reabertura nao desfez a quitacao final.");
  assert(reopenFinal.data.paid_total === 70 && reopenFinal.data.remaining_value === 19.9 && rootRow?.status === "pendente", "Reabrir a quitacao alterou pagamentos anteriores.");

  const reopenFinalReplay = await rpcClient.rpc("reopen_transaction_completion", {
    p_transaction_id: 5,
    p_idempotency_key: "10000000-0000-4000-8000-000000000104",
  });
  assert(!reopenFinalReplay.error && reopenFinalReplay.data?.replayed === true, "Repetir a reabertura da quitacao nao foi idempotente.");

  const reopenLastPartial = await rpcClient.rpc("reopen_transaction_completion", {
    p_transaction_id: 5,
    p_idempotency_key: "10000000-0000-4000-8000-000000000105",
  });
  assert(!reopenLastPartial.error && reopenLastPartial.data?.payment_id === secondPartial.data.payment_id, "A segunda reabertura nao desfez somente a ultima parcial ativa.");
  assert(reopenLastPartial.data.paid_total === 50 && reopenLastPartial.data.remaining_value === 39.9 && rootRow?.valor === 39.9, "Estornar a ultima parcial alterou o primeiro pagamento.");
  assert(!rpcClient.__localDemo.database.transacoes.some((row) => row.id === secondPaymentRow?.id), "O filho tecnico da parcial estornada nao foi removido.");
  assert(rpcClient.__localDemo.database.transacoes.some((row) => row.id === firstPaymentRow?.id), "O primeiro pagamento foi removido indevidamente.");

  const paymentHistory = await rpcClient.rpc("get_transaction_payment_history", { p_transaction_id: 5 });
  assert(!paymentHistory.error && paymentHistory.data?.payments.length === 3, "O historico local nao preservou todos os pagamentos e estornos.");
  assert(paymentHistory.data.payments.filter((payment) => payment.active).length === 1, "O historico nao marcou corretamente os pagamentos ainda ativos.");
  assert(paymentHistory.data.summary.paid_total === 50 && paymentHistory.data.summary.remaining_value === 39.9, "O detalhe agrupado divergiu do resumo apos os estornos.");
  const normalizedPaymentHistory = normalizeTransactionPaymentHistory(paymentHistory.data, rootRow);
  assert(
    normalizedPaymentHistory.payments.map((payment) => `${payment.paymentSequence}:${payment.realizationDate}`).join(",")
      === "3:2026-08-08,2:2026-08-07,1:2026-08-08",
    "O detalhe nao priorizou a sequencia logica quando um pagamento foi informado com data retroativa.",
  );
  const groupedValue = rpcClient.__localDemo.database.transacoes
    .filter((row) => row.id === 5 || row.transacao_pai_id === 5)
    .reduce((total, row) => total + Number(row.valor), 0);
  assert(Math.abs(groupedValue - 89.9) < 0.005, "A raiz e seus pagamentos ativos causaram dupla contagem do valor agendado.");
  rootRow.valor = 34.9;
  const reopenFirstAfterEdit = await rpcClient.rpc("reopen_transaction_completion", {
    p_transaction_id: 5,
    p_idempotency_key: "10000000-0000-4000-8000-000000000106",
  });
  assert(!reopenFirstAfterEdit.error && reopenFirstAfterEdit.data?.paid_total === 0, "O último pagamento ativo não pôde ser estornado após editar o saldo restante.");
  assert(reopenFirstAfterEdit.data.remaining_value === 84.9 && rootRow.valor === 84.9, "O estorno não preservou a diferença aplicada ao saldo restante.");
  assert(!rpcClient.__localDemo.database.transacoes.some((row) => row.transacao_pai_id === 5), "O último filho técnico permaneceu após o estorno.");

  const partialAfterEveryReopen = await rpcClient.rpc("complete_transaction_with_partial", {
    p_transaction_id: 5,
    p_expected_value: 84.9,
    p_adjustment_type: "none",
    p_adjustment_value: 0,
    p_realized_value: 10,
    p_realization_date: "2026-08-06",
    p_idempotency_key: "10000000-0000-4000-8000-000000000107",
  });
  assert(!partialAfterEveryReopen.error && partialAfterEveryReopen.data?.remaining_value === 74.9, "Uma nova baixa após estornar todas as anteriores falhou.");
  const historyAfterEveryReopen = await rpcClient.rpc("get_transaction_payment_history", { p_transaction_id: 5 });
  const normalizedAfterEveryReopen = normalizeTransactionPaymentHistory(historyAfterEveryReopen.data, rootRow);
  assert(
    normalizedAfterEveryReopen.payments[0]?.paymentSequence === 4
      && normalizedAfterEveryReopen.payments[0]?.paymentId === partialAfterEveryReopen.data.payment_id,
    "A sequência foi reutilizada após estornar todos os pagamentos ou a nova baixa não apareceu no topo.",
  );

  const question = await invoke({ mode: "message", message: "Quais despesas tenho?" });
  assert(question.kind === "answer", "Uma pergunta sobre despesas nao pode virar proposta de escrita.");
  assert(client.__localDemo.database.transacoes.length === initialTransactions, "Uma consulta alterou as transacoes locais.");

  const notebookWithdrawal = await invoke({ mode: "message", message: "Retirei 1000 reais de notebook" });
  assert(notebookWithdrawal.kind === "clarify" && notebookWithdrawal.intent === "move_goal", "O nome do objetivo sem a palavra caixinha nao iniciou a retirada.");
  assert(notebookWithdrawal.missingFields?.[0] === "accountId", "A retirada do Notebook nao aproveitou operacao, objetivo, valor e data ja informados.");
  const notebookOverBalance = await invoke({ mode: "message", message: "Conta Principal", conversationId: notebookWithdrawal.conversationId });
  assert(notebookOverBalance.kind === "clarify" && notebookOverBalance.missingFields?.[0] === "value", "A retirada acima do saldo deveria pedir outro valor.");
  const notebookProposal = await invoke({ mode: "message", message: "500", conversationId: notebookWithdrawal.conversationId });
  assert(notebookProposal.kind === "proposal" && notebookProposal.intent === "move_goal", "A retirada do Notebook nao chegou a uma proposta apos corrigir o valor.");
  assert(notebookProposal.pendingAction.preview.summary.includes("Notebook") && notebookProposal.pendingAction.preview.summary.includes("500,00"), "A proposta nao preservou o objetivo ou o valor corrigido.");
  await invoke({ mode: "cancel", actionId: notebookProposal.pendingAction.id, conversationId: notebookProposal.conversationId });

  const fuzzyNotebookDeposit = await invoke({ mode: "message", message: "Guardei 50 reais no notebok" });
  assert(fuzzyNotebookDeposit.kind === "clarify" && fuzzyNotebookDeposit.intent === "move_goal", "Um pequeno erro no nome Notebook impediu a identificacao do objetivo.");
  assert(fuzzyNotebookDeposit.missingFields?.[0] === "accountId", "O objetivo digitado com erro nao foi resolvido de forma segura.");
  await invoke({ mode: "message", message: "cancelar", conversationId: fuzzyNotebookDeposit.conversationId });

  const genericWithdrawal = await invoke({ mode: "message", message: "fiz uma retirada" });
  assert(genericWithdrawal.kind === "clarify" && genericWithdrawal.intent === "move_goal", "Uma retirada em linguagem natural nao iniciou o fluxo de objetivo.");
  assert(genericWithdrawal.missingFields?.[0] === "goalId", "Uma retirada sem objetivo deve perguntar primeiro de qual objetivo retirar.");
  const cancelledCollection = await invoke({ mode: "message", message: "cancelar", conversationId: genericWithdrawal.conversationId });
  assert(cancelledCollection.kind === "answer", "Nao foi possivel cancelar a coleta da retirada generica.");

  const yearProjection = await invoke({ mode: "message", message: "Quanto terei ate o fim do ano?" });
  assert(yearProjection.kind === "answer" && yearProjection.intent === "financial_projection", "A pergunta de projecao ate o fim do ano nao foi reconhecida.");
  assert(yearProjection.message.includes("fim de 2026"), "A resposta de projecao anual nao refletiu o periodo solicitado.");
  assert(client.__localDemo.database.transacoes.length === initialTransactions, "As novas consultas e coletas alteraram dados antes da confirmacao.");

  const completeCreate = await invoke({
    mode: "message",
    message: "Crie uma despesa de R$ 85,90 chamada Mercado, na categoria Alimentacao, na Conta Principal, hoje, ja paga, unica",
    conversationId: question.conversationId,
  });
  assert(completeCreate.kind === "proposal", "Um pedido completo deve gerar uma proposta.");
  assert(client.__localDemo.database.transacoes.length === initialTransactions, "A proposta alterou dados antes da confirmacao.");

  const confirmed = await invoke({
    mode: "confirm",
    actionId: completeCreate.pendingAction.id,
    confirmationToken: completeCreate.pendingAction.confirmationToken,
    conversationId: completeCreate.conversationId,
  });
  assert(confirmed.kind === "executed", "A confirmacao nao executou a proposta local.");
  assert(client.__localDemo.database.transacoes.length === initialTransactions + 1, "A transacao confirmada nao foi criada.");
  const mercado = client.__localDemo.database.transacoes.find((row) => row.descricao === "Mercado");
  assert(mercado, "A transacao Mercado nao foi encontrada.");
  assert(Number(mercado.valor) === 85.9, "O valor em moeda brasileira foi interpretado incorretamente.");
  assert(mercado.status === "paga" && mercado.data_realizacao, "O status/data realizados nao foram preservados.");

  const replay = await invoke({
    mode: "confirm",
    actionId: completeCreate.pendingAction.id,
    confirmationToken: completeCreate.pendingAction.confirmationToken,
    conversationId: completeCreate.conversationId,
  });
  assert(replay.kind === "executed" && replay.result.replayed === true, "A confirmacao repetida nao foi tratada como replay.");
  assert(client.__localDemo.database.transacoes.length === initialTransactions + 1, "A confirmacao repetida duplicou a transacao.");

  const incomplete = await invoke({ mode: "message", message: "Crie uma receita", conversationId: completeCreate.conversationId });
  assert(incomplete.kind === "clarify", "Uma criacao incompleta deve perguntar o proximo campo.");
  assert(Array.isArray(incomplete.missingFields) && incomplete.missingFields.length === 1, "A IA local deve perguntar um campo por vez.");
  assert(client.__localDemo.database.transacoes.length === initialTransactions + 1, "A coleta incompleta criou uma transacao silenciosa.");

  const answers = {
    frequency: "unica",
    status: "Ja relizado",
    scheduledDate: "hoje",
    realizationDate: "hoje",
    description: "Freelance local",
    value: "R$ 1.200,00",
    accountId: "Conta Principal",
    categoryId: "Freelance",
  };
  let collected = incomplete;
  for (let step = 0; collected.kind === "clarify" && step < 12; step += 1) {
    const field = collected.missingFields[0];
    assert(answers[field], `O teste nao possui resposta para o campo local ${field}.`);
    collected = await invoke({ mode: "message", message: answers[field], conversationId: collected.conversationId });
  }
  assert(collected.kind === "proposal", "A coleta sequencial nao chegou a uma proposta completa.");
  await invoke({
    mode: "confirm",
    actionId: collected.pendingAction.id,
    confirmationToken: collected.pendingAction.confirmationToken,
    conversationId: collected.conversationId,
  });
  const freelance = client.__localDemo.database.transacoes.find((row) => row.descricao === "Freelance local");
  assert(freelance && Number(freelance.valor) === 1200 && freelance.tipo === "receita", "A coleta sequencial nao criou a receita informada.");

  let accountDraft = await invoke({ mode: "message", message: "Crie uma conta" });
  const accountAnswers = { name: "Banco Conversa", initialBalance: "1500", color: "azul" };
  for (let step = 0; accountDraft.kind === "clarify" && step < 5; step += 1) {
    const field = accountDraft.missingFields[0];
    assert(accountAnswers[field] !== undefined, `Campo inesperado ao criar conta: ${field}.`);
    accountDraft = await invoke({ mode: "message", message: accountAnswers[field], conversationId: accountDraft.conversationId });
  }
  assert(accountDraft.kind === "proposal", "A IA nao coletou nome, saldo inicial e cor antes da previa da conta.");
  assert(accountDraft.pendingAction.preview.summary.includes("1.500,00") && accountDraft.pendingAction.preview.summary.includes("#457B9D"), "A previa da conta nao mostrou saldo inicial e cor escolhidos.");
  await invoke({ mode: "cancel", actionId: accountDraft.pendingAction.id, conversationId: accountDraft.conversationId });

  let goalDraft = await invoke({ mode: "message", message: "Crie um objetivo" });
  const goalAnswers = {
    name: "Notebook novo",
    targetAmount: "2000",
    initialBalance: "250",
    targetDate: "31/12/2027",
    color: "roxo",
    icon: "notebook",
  };
  for (let step = 0; goalDraft.kind === "clarify" && step < 8; step += 1) {
    const field = goalDraft.missingFields[0];
    assert(goalAnswers[field] !== undefined, `Campo inesperado ao criar objetivo: ${field}.`);
    goalDraft = await invoke({ mode: "message", message: goalAnswers[field], conversationId: goalDraft.conversationId });
  }
  assert(goalDraft.kind === "proposal", "A IA nao coletou todos os campos visuais do objetivo antes da previa.");
  assert(goalDraft.pendingAction.preview.summary.includes("31/12/2027") && goalDraft.pendingAction.preview.summary.includes("250,00"), "A previa do objetivo nao mostrou prazo e saldo inicial.");
  await invoke({ mode: "cancel", actionId: goalDraft.pendingAction.id, conversationId: goalDraft.conversationId });

  const accountProposal = await invoke({
    mode: "message",
    message: "Crie uma conta chamada Banco Teste com saldo inicial de R$ 500 e cor azul",
  });
  assert(accountProposal.kind === "proposal", "A conta completa deve gerar proposta.");
  const cancelled = await invoke({ mode: "cancel", actionId: accountProposal.pendingAction.id, conversationId: accountProposal.conversationId });
  assert(cancelled.kind === "cancelled", "O cancelamento nao retornou o estado esperado.");
  assert(client.__localDemo.database.contas.length === initialAccounts, "Cancelar a proposta criou uma conta.");

  async function confirmCompleteCommand(message, expectedIntent) {
    const proposal = await invoke({ mode: "message", message });
    assert(proposal.kind === "proposal" && proposal.intent === expectedIntent, `Comando nao gerou ${expectedIntent}: ${message}`);
    return invoke({
      mode: "confirm",
      actionId: proposal.pendingAction.id,
      confirmationToken: proposal.pendingAction.confirmationToken,
      conversationId: proposal.conversationId,
    });
  }

  await confirmCompleteCommand("Crie uma categoria chamada Educacao para despesa, cor azul e icone escola", "create_category");
  assert(client.__localDemo.database.categorias.some((row) => row.nome === "Educacao" && row.tipo === "despesa"), "A categoria completa nao foi criada.");

  await confirmCompleteCommand("Crie um objetivo chamado Casa com meta de R$ 5.000, saldo inicial 0, prazo 31/12/2027, cor verde e icone casa", "create_goal");
  assert(client.__localDemo.database.caixinhas.some((row) => row.nome === "Casa" && Number(row.meta_valor) === 5000), "O objetivo completo nao foi criado.");

  await confirmCompleteCommand("Crie um cartao chamado Inter com limite de R$ 3.000, vencimento dia 10, fechamento dia 3 e cor azul", "create_card");
  assert(client.__localDemo.database.cartoes.some((row) => row.nome === "Inter" && Number(row.limite) === 3000), "O cartao completo nao foi criado.");

  await confirmCompleteCommand("Lance uma compra de R$ 120 chamada Livro no cartao FinFlow Visa, categoria Compras, hoje, unica", "create_card_purchase");
  assert(client.__localDemo.database.fatura_itens.some((row) => row.descricao === "Livro" && Number(row.valor) === 120), "A compra no cartao nao foi criada.");

  await confirmCompleteCommand("Transfira R$ 200 da Conta Principal para Carteira hoje, ja paga, unica, chamada Ajuste local", "transfer_between_accounts");
  assert(client.__localDemo.database.transacoes.some((row) => String(row.descricao).includes("Ajuste local") && String(row.descricao).includes("[Destino:2]")), "A transferencia nao foi criada com o destino correto.");

  await confirmCompleteCommand("Guarde R$ 100 no objetivo Reserva de emergencia pela Conta Principal hoje", "move_goal");
  const reserva = client.__localDemo.database.caixinhas.find((row) => String(row.nome).includes("Reserva"));
  assert(Number(reserva?.saldo_atual) === 6300, "O aporte nao atualizou o objetivo local.");

  await confirmCompleteCommand("Renomeie a categoria Lazer para Diversao", "update_category");
  assert(client.__localDemo.database.categorias.some((row) => row.nome === "Diversao"), "A edicao de categoria retornou sucesso sem alterar a memoria.");

  await confirmCompleteCommand("Altere o valor da meta do objetivo Viagem para R$ 4.000", "update_goal");
  const viagem = client.__localDemo.database.caixinhas.find((row) => row.nome === "Viagem");
  assert(Number(viagem?.meta_valor) === 4000, "A edicao de objetivo retornou sucesso sem alterar a meta.");

  const transactionUpdate = await confirmCompleteCommand("Altere o valor do lancamento Farmacia para R$ 95", "update_transaction");
  const farmaciaEditada = client.__localDemo.database.transacoes.find((row) => String(row.descricao).includes("Farm"));
  assert(Number(farmaciaEditada?.valor) === 95, `A edicao de lancamento retornou sucesso sem alterar o valor (atual: ${farmaciaEditada?.valor}; resultado: ${JSON.stringify(transactionUpdate.result.result)}).`);

  await confirmCompleteCommand("Altere o limite do cartao FinFlow Visa para R$ 4.500", "update_card");
  const visa = client.__localDemo.database.cartoes.find((row) => row.nome === "FinFlow Visa");
  assert(Number(visa?.limite) === 4500, "A edicao de cartao retornou sucesso sem alterar o limite.");

  await confirmCompleteCommand("Renomeie a compra Streaming no cartao FinFlow Visa para Musica", "update_card_purchase");
  assert(client.__localDemo.database.fatura_itens.some((row) => row.descricao === "Musica"), "A edicao de compra retornou sucesso sem alterar a descricao.");

  const transactionCountBeforeDelete = client.__localDemo.database.transacoes.length;
  await confirmCompleteCommand("Exclua o lancamento Netflix", "delete_transaction");
  assert(client.__localDemo.database.transacoes.length === transactionCountBeforeDelete - 1, "A exclusao de lancamento nao removeu o item local.");

  const purchaseCountBeforeDelete = client.__localDemo.database.fatura_itens.length;
  await confirmCompleteCommand("Exclua a compra Supermercado do cartao FinFlow Visa", "delete_card_purchase");
  assert(client.__localDemo.database.fatura_itens.length === purchaseCountBeforeDelete - 1, "A exclusao de compra nao removeu o item local.");

  await confirmCompleteCommand("Pague R$ 200 da fatura FinFlow Visa pela Conta Principal, pagamento parcial", "pay_invoice");
  const invoicePayment = client.__localDemo.database.transacoes.find((row) => String(row.descricao).includes("[PagFatura:"));
  assert(invoicePayment && Number(invoicePayment.valor) === 200, "O pagamento de fatura nao criou a movimentacao local.");

  await confirmCompleteCommand("Estorne o pagamento da fatura", "reverse_invoice_payment");
  assert(!client.__localDemo.database.transacoes.some((row) => String(row.descricao).includes("[PagFatura:")), "O estorno nao removeu o pagamento local.");

  await confirmCompleteCommand("Renomeie a Conta Principal para Principal Atual", "update_account");
  assert(client.__localDemo.database.contas.some((row) => row.nome === "Principal Atual"), "A edicao de conta retornou sucesso sem alterar o nome.");

  const aluguelInicio = await invoke({ mode: "message", message: "acabei de pgar o alugeul" });
  assert(
    aluguelInicio.kind === "clarify"
      && aluguelInicio.intent === "complete_transaction"
      && aluguelInicio.missingFields?.[0] === "realizedValue",
    "A baixa do Aluguel deve perguntar quanto foi efetivamente pago.",
  );
  const aluguelProposta = await invoke({
    mode: "message",
    message: "1450",
    conversationId: aluguelInicio.conversationId,
  });
  assert(aluguelProposta.kind === "proposal", "O valor integral do Aluguel nao gerou a proposta de baixa.");
  await invoke({
    mode: "confirm",
    actionId: aluguelProposta.pendingAction.id,
    confirmationToken: aluguelProposta.pendingAction.confirmationToken,
    conversationId: aluguelProposta.conversationId,
  });
  const aluguelPendente = client.__localDemo.database.transacoes.find((row) => row.id === 3);
  assert(aluguelPendente?.status === "paga" && aluguelPendente.data_realizacao === "2026-08-02", "A IA nao identificou e concluiu o Aluguel pendente com erros de digitacao.");

  const completeExisting = await invoke({ mode: "message", message: "Marque Farmacia como concluida hoje" });
  assert(
    completeExisting.kind === "clarify" && completeExisting.missingFields?.[0] === "realizedValue",
    "Concluir Farmacia deve perguntar o valor efetivamente pago.",
  );
  const partialProposal = await invoke({
    mode: "message",
    message: "50",
    conversationId: completeExisting.conversationId,
  });
  assert(partialProposal.kind === "proposal", "O pagamento parcial de Farmacia deve gerar uma proposta.");
  const firstAiPayment = await invoke({
    mode: "confirm",
    actionId: partialProposal.pendingAction.id,
    confirmationToken: partialProposal.pendingAction.confirmationToken,
    conversationId: partialProposal.conversationId,
  });
  const farmacia = client.__localDemo.database.transacoes.find((row) => row.id === 5);
  const primeiroPagamentoFarmacia = client.__localDemo.database.transacoes.find((row) => row.transacao_pai_id === 5);
  assert(farmacia?.status === "pendente" && Number(farmacia.valor) === 45, "A IA nao manteve Farmacia pendente com o saldo da primeira parcial.");
  assert(primeiroPagamentoFarmacia?.status === "paga" && Number(primeiroPagamentoFarmacia.valor) === 50, "A IA nao criou o primeiro pagamento tecnico de Farmacia.");
  assert(firstAiPayment.result.result.paid_total === 50 && firstAiPayment.result.result.remaining_value === 45, "O recibo da primeira parcial da IA esta incorreto.");

  const firstAiReplay = await invoke({
    mode: "confirm",
    actionId: partialProposal.pendingAction.id,
    confirmationToken: partialProposal.pendingAction.confirmationToken,
    conversationId: partialProposal.conversationId,
  });
  assert(firstAiReplay.result.replayed === true, "Confirmar novamente a parcial da IA nao foi idempotente.");
  assert(client.__localDemo.database.transacoes.filter((row) => row.transacao_pai_id === 5).length === 1, "O replay da IA duplicou o filho tecnico.");

  await confirmCompleteCommand("Altere o valor do lancamento Farmacia para R$ 40", "update_transaction");
  assert(Number(farmacia?.valor) === 40, "A IA bloqueou a edição individual do saldo restante.");
  assert(Number(primeiroPagamentoFarmacia?.valor) === 50 && primeiroPagamentoFarmacia?.status === "paga", "Editar o saldo restante alterou um pagamento já concluído.");
  const updatePaidSeries = await invoke({ mode: "message", message: "Altere o valor de toda a serie do lancamento Farmacia para 10 reais" });
  assert(updatePaidSeries.kind === "answer" && String(updatePaidSeries.message).includes("toda a série"), "A IA permitiu editar a série com pagamentos ativos.");
  assert(Number(farmacia?.valor) === 40, "A tentativa de editar a série alterou o saldo restante.");
  const deletePaidSchedule = await invoke({ mode: "message", message: "Exclua o lancamento Farmacia" });
  assert(deletePaidSchedule.kind === "answer" && String(deletePaidSchedule.message).includes("pagamentos concluídos"), "A IA permitiu excluir uma raiz com pagamentos ativos.");
  assert(client.__localDemo.database.transacoes.some((row) => row.id === 5) && client.__localDemo.database.transacoes.some((row) => row.id === primeiroPagamentoFarmacia?.id), "A tentativa bloqueada removeu a raiz ou o pagamento.");

  const secondAiStart = await invoke({ mode: "message", message: "Paguei mais 20 reais de Farmacia hoje" });
  assert(secondAiStart.kind === "proposal" && secondAiStart.intent === "complete_transaction", "A IA nao preparou a segunda parcial para a mesma raiz.");
  const secondAiPayment = await invoke({
    mode: "confirm",
    actionId: secondAiStart.pendingAction.id,
    confirmationToken: secondAiStart.pendingAction.confirmationToken,
    conversationId: secondAiStart.conversationId,
  });
  assert(secondAiPayment.result.result.paid_total === 70 && secondAiPayment.result.result.remaining_value === 20, "A IA nao acumulou duas parciais em Farmacia.");
  assert(farmacia?.status === "pendente" && Number(farmacia.valor) === 20, "A segunda parcial nao reduziu o saldo editado da raiz Farmacia.");
  const pagamentosFarmacia = client.__localDemo.database.transacoes.filter((row) => row.transacao_pai_id === 5);
  assert(pagamentosFarmacia.length === 2, "As duas parciais nao ficaram ligadas ao mesmo agendamento.");

  const finalAiStart = await invoke({ mode: "message", message: "Quitei os 20 reais restantes de Farmacia hoje" });
  assert(finalAiStart.kind === "proposal" && finalAiStart.intent === "complete_transaction", "A IA nao preparou a quitacao final de Farmacia.");
  const finalAiPayment = await invoke({
    mode: "confirm",
    actionId: finalAiStart.pendingAction.id,
    confirmationToken: finalAiStart.pendingAction.confirmationToken,
    conversationId: finalAiStart.conversationId,
  });
  assert(finalAiPayment.result.result.is_fully_paid === true && finalAiPayment.result.result.payment_transaction_id === 5, "A IA nao usou a raiz na quitacao final.");
  assert(finalAiPayment.result.result.paid_total === 90 && farmacia?.status === "paga" && Number(farmacia.valor) === 20, "A IA nao concluiu o total editado de Farmacia sem dupla contagem.");

  const reopenFarmacia = await invoke({ mode: "message", message: "Reabra Farmacia" });
  assert(
    reopenFarmacia.kind === "proposal" && reopenFarmacia.intent === "reopen_transaction",
    `Reabrir Farmacia deve gerar proposta: ${JSON.stringify(reopenFarmacia)}`,
  );
  const reopenFinalAi = await invoke({
    mode: "confirm",
    actionId: reopenFarmacia.pendingAction.id,
    confirmationToken: reopenFarmacia.pendingAction.confirmationToken,
    conversationId: reopenFarmacia.conversationId,
  });
  assert(reopenFinalAi.result.result.paid_total === 70 && reopenFinalAi.result.result.remaining_value === 20, "Reabrir Farmacia nao desfez somente a quitacao final.");
  assert(farmacia?.status === "pendente" && Number(farmacia.valor) === 20 && client.__localDemo.database.transacoes.filter((row) => row.transacao_pai_id === 5).length === 2, "Reabrir a quitacao alterou as parciais anteriores.");

  const reopenLastPartialAi = await invoke({ mode: "message", message: "Reabra Farmacia" });
  assert(reopenLastPartialAi.kind === "proposal" && reopenLastPartialAi.intent === "reopen_transaction", "A IA nao preparou o estorno da ultima parcial ativa.");
  const reopenedPartialAi = await invoke({
    mode: "confirm",
    actionId: reopenLastPartialAi.pendingAction.id,
    confirmationToken: reopenLastPartialAi.pendingAction.confirmationToken,
    conversationId: reopenLastPartialAi.conversationId,
  });
  assert(reopenedPartialAi.result.result.paid_total === 50 && reopenedPartialAi.result.result.remaining_value === 40, "A IA nao estornou somente a ultima parcial.");
  assert(farmacia?.status === "pendente" && Number(farmacia.valor) === 40 && client.__localDemo.database.transacoes.filter((row) => row.transacao_pai_id === 5).length === 1, "O estorno da ultima parcial removeu pagamentos anteriores.");
  const linhasVisiveisFarmacia = client.__localDemo.database.transacoes.filter((row) => (row.id === 5 || row.transacao_pai_id === 5) && row.transacao_pai_id == null);
  assert(linhasVisiveisFarmacia.length === 1, "Os filhos tecnicos da IA apareceriam como mais de um card.");
  const totalAgrupadoFarmacia = client.__localDemo.database.transacoes.filter((row) => row.id === 5 || row.transacao_pai_id === 5).reduce((total, row) => total + Number(row.valor), 0);
  assert(Math.abs(totalAgrupadoFarmacia - 90) < 0.005, "A IA causou dupla contagem no agendamento editado com pagamentos parciais.");

  const reopenFirstPartialAi = await invoke({ mode: "message", message: "Reabra Farmacia" });
  assert(reopenFirstPartialAi.kind === "proposal" && reopenFirstPartialAi.intent === "reopen_transaction", "A IA nao preparou o estorno do primeiro pagamento.");
  const reopenedFirstAi = await invoke({
    mode: "confirm",
    actionId: reopenFirstPartialAi.pendingAction.id,
    confirmationToken: reopenFirstPartialAi.pendingAction.confirmationToken,
    conversationId: reopenFirstPartialAi.conversationId,
  });
  assert(reopenedFirstAi.result.result.paid_total === 0 && reopenedFirstAi.result.result.remaining_value === 90, "O último estorno não preservou a edição individual do restante.");
  assert(Number(farmacia?.valor) === 90 && !client.__localDemo.database.transacoes.some((row) => row.transacao_pai_id === 5), "O último pagamento não foi removido mantendo o delta editado.");
  await confirmCompleteCommand("Exclua o lancamento Farmacia", "delete_transaction");
  assert(!client.__localDemo.database.transacoes.some((row) => row.id === 5), "A exclusão continuou bloqueada após estornar todos os pagamentos.");

  const internalStart = await invoke({ mode: "message", message: "Marque Reserva do mes como concluida hoje" });
  assert(
    internalStart.kind === "clarify"
      && internalStart.intent === "complete_transaction"
      && internalStart.missingFields?.[0] === "realizedValue",
    "Concluir uma transferencia interna deve perguntar o valor realizado.",
  );
  const internalPartial = await invoke({
    mode: "message",
    message: "100",
    conversationId: internalStart.conversationId,
  });
  assert(
    internalPartial.kind === "clarify"
      && internalPartial.intent === "complete_transaction"
      && internalPartial.missingFields?.[0] === "realizedValue",
    "Uma transferencia interna nao pode aceitar conclusao parcial.",
  );
  const internalProposal = await invoke({
    mode: "message",
    message: "300",
    conversationId: internalStart.conversationId,
  });
  assert(
    internalProposal.kind === "proposal" && internalProposal.intent === "complete_transaction",
    "O valor integral da transferencia interna deve gerar a proposta de conclusao.",
  );
  await invoke({
    mode: "confirm",
    actionId: internalProposal.pendingAction.id,
    confirmationToken: internalProposal.pendingAction.confirmationToken,
    conversationId: internalProposal.conversationId,
  });
  const reservaDoMes = client.__localDemo.database.transacoes.find((row) => row.id === 7);
  assert(
    reservaDoMes?.status === "paga" && Number(reservaDoMes.valor) === 300,
    "A transferencia interna integral nao foi concluida corretamente.",
  );
  assert(
    !client.__localDemo.database.transacoes.some((row) => String(row.descricao).includes("Reserva do mes (saldo restante)")),
    "A conclusao integral de transferencia interna nao pode criar saldo parcial.",
  );

  client.__localDemo.reset();
  const reservaAposReset = client.__localDemo.database.transacoes.find((row) => row.id === 7);
  assert(reservaAposReset, "O reset nao restaurou a transferencia ficticia usada no teste.");
  reservaAposReset.status = "paga";
  reservaAposReset.valor = 275;
  reservaAposReset.data_realizacao = "2026-08-02";
  const reopenAfterReset = await invoke({ mode: "message", message: "Reabra Reserva do mes" });
  assert(
    reopenAfterReset.kind === "proposal" && reopenAfterReset.intent === "reopen_transaction",
    "A transferencia simulada apos o reset nao gerou proposta de reabertura.",
  );
  await invoke({
    mode: "confirm",
    actionId: reopenAfterReset.pendingAction.id,
    confirmationToken: reopenAfterReset.pendingAction.confirmationToken,
    conversationId: reopenAfterReset.conversationId,
  });
  assert(
    reservaAposReset.status === "pendente" && Number(reservaAposReset.valor) === 275,
    "O reset manteve um recibo de conclusao antigo e contaminou o novo cenario.",
  );

  client.__localDemo.reset();
  assert(client.__localDemo.database.transacoes.length === initialTransactions, "O reset nao restaurou as transacoes ficticias.");
  assert(client.__localDemo.database.contas.length === initialAccounts, "O reset nao restaurou as contas ficticias.");
  assert(!client.__localDemo.database.transacoes.some((row) => row.descricao === "Mercado"), "O reset manteve uma alteracao do teste.");

  process.stdout.write("Local demo behavior tests passed.\n");
}

run()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    fs.rmSync(outputRoot, { recursive: true, force: true });
  });
