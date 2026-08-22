const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};

const migration = read("supabase/migrations/20260822000100_fix_atomic_account_deletion.sql");
const appSettings = read("app/(tabs)/configuracoes.tsx");
const appLogin = read("app/login.tsx");
const webSettings = read("web/src/app/(dashboard)/configuracoes/actions.ts");
const authActions = read("web/src/lib/auth/actions.ts");
const authDiagnostics = read("web/src/lib/auth/safe-errors.ts");
const atomicCompletionCore = read("supabase/migrations/20260808001100_atomic_partial_transaction_completion.sql");
const paymentCore = read("supabase/migrations/20260808001600_group_partial_transaction_payments.sql");
const invoiceCore = read("supabase/migrations/20260802000100_secure_finance_ai.sql");

expect(
  /^\s*--[\s\S]*\bbegin;[\s\S]*commit;\s*$/i.test(migration),
  "A migration de exclusao precisa ser atomica.",
);
expect(
  migration.includes("create or replace function public.delete_user()"),
  "A migration precisa substituir public.delete_user().",
);
expect(
  (migration.match(/alter column user_id drop not null/g) || []).length === 2,
  "Os atores de conclusao e reabertura precisam aceitar NULL apos excluir a conta.",
);
expect(
  /transaction_completion_receipts_user_id_fkey[\s\S]*foreign key \(user_id\)[\s\S]*references auth\.users\(id\) on delete set null/i.test(migration),
  "A FK do ator da conclusao precisa anonimizar com ON DELETE SET NULL.",
);
expect(
  /transaction_reopen_receipts_user_id_fkey[\s\S]*foreign key \(user_id\)[\s\S]*references auth\.users\(id\) on delete set null/i.test(migration),
  "A FK do ator da reabertura precisa anonimizar com ON DELETE SET NULL.",
);
expect(
  /pg_constraint[\s\S]*confrelid = 'auth\.users'::pg_catalog\.regclass[\s\S]*conkey = array\[actor_attnum\]::smallint\[\]/i.test(migration),
  "A migration precisa remover qualquer FK historica CASCADE do ator antes de criar SET NULL.",
);

const stepUp = migration.indexOf("AUTH_STEP_UP_REQUIRED");
const partnershipGuard = migration.indexOf("ACCOUNT_PARTNERSHIP_PENDING");
const dissolutionGuard = migration.indexOf("ACCOUNT_DISSOLUTION_PENDING");
const subscriptionGuard = migration.indexOf("ACCOUNT_SUBSCRIPTION_ACTIVE");
const identityLock = migration.indexOf("from auth.users u");
const firstDelete = migration.indexOf("delete from private.transaction_reopen_receipts");
expect(stepUp >= 0 && firstDelete > stepUp, "O step-up deve ocorrer antes de qualquer DELETE.");
expect(
  partnershipGuard > stepUp && dissolutionGuard > partnershipGuard && subscriptionGuard > dissolutionGuard,
  "Parcerias, decisoes de dissolucao e assinaturas precisam ser bloqueadas no servidor antes da exclusao.",
);
expect(
  identityLock > subscriptionGuard,
  "Os bloqueios de negocio devem falhar antes dos locks destrutivos.",
);
expect(identityLock > stepUp && identityLock < firstDelete, "A identidade deve ser bloqueada somente depois do step-up e antes da limpeza.");
expect(
  migration.includes("from public.transacoes t")
    && migration.includes("from public.cartoes c")
    && migration.includes("for update;"),
  "Transacoes e cartoes precisam ser bloqueados antes de limpar seus ledgers.",
);

// Inventario das travas que motivam a ordem da nova migration. Se uma migration
// anterior mudar o contrato, este teste obriga a revisar delete_user junto.
expect(
  (atomicCompletionCore.match(/user_id uuid not null references auth\.users\(id\) on delete cascade/g) || []).length >= 2
    && atomicCompletionCore.includes("completion_receipt_id uuid references private.transaction_completion_receipts(id) on delete set null"),
  "O teste nao encontrou as FKs originais dos receipts de conclusao/reabertura.",
);
expect(
  paymentCore.includes("create trigger finflow_guard_transaction_payment_group")
    && paymentCore.includes("public.finflow_transaction_has_payment_history(old.id)"),
  "O teste nao encontrou o trigger que protege raizes com historico de pagamentos.",
);
expect(
  invoiceCore.includes("create trigger ai_cartoes_protect_active_invoice_ledger")
    && invoiceCore.includes("private.ai_invoice_payment_ledger"),
  "O teste nao encontrou o ledger privado que protege pagamentos de fatura.",
);

const reopenReceiptDelete = migration.indexOf("delete from private.transaction_reopen_receipts");
const completionReceiptDelete = migration.indexOf("delete from private.transaction_completion_receipts");
const invoiceLedgerDelete = migration.indexOf("delete from private.ai_invoice_payment_ledger");
const childDelete = migration.indexOf("and transacao_pai_id is not null");
const rootDelete = migration.indexOf("and transacao_pai_id is null", childDelete + 1);
const invoiceItemDelete = migration.indexOf("delete from public.fatura_itens");
const cardDelete = migration.indexOf("delete from public.cartoes");
const authDelete = migration.indexOf("delete from auth.users where id = uid");
const reopenReceiptDeleteSql = migration.slice(reopenReceiptDelete, completionReceiptDelete);
const completionReceiptDeleteSql = migration.slice(completionReceiptDelete, invoiceLedgerDelete);
expect(reopenReceiptDelete >= 0, "A migration nao remove recibos de reabertura.");
expect(
  completionReceiptDelete > reopenReceiptDelete,
  "Recibos de reabertura devem ser removidos antes dos recibos de conclusao.",
);
expect(
  invoiceLedgerDelete > completionReceiptDelete && invoiceLedgerDelete < childDelete,
  "Ledgers privados precisam ser removidos antes das transacoes.",
);
expect(
  /delete from private\.transaction_reopen_receipts[\s\S]*completion_receipt_id[\s\S]*transaction_user_id = uid[\s\S]*root_transaction_id[\s\S]*payment_transaction_id[\s\S]*remaining_transaction_id/i.test(migration),
  "A limpeza de reaberturas nao cobre recibos relacionados pertencentes a outro ator.",
);
expect(
  /delete from private\.transaction_completion_receipts[\s\S]*completion\.transaction_user_id = uid[\s\S]*completion\.transaction_id[\s\S]*completion\.root_transaction_id[\s\S]*completion\.payment_transaction_id[\s\S]*completion\.remaining_transaction_id/i.test(migration),
  "A limpeza de conclusoes nao cobre formatos legado e agrupado do ledger.",
);
expect(
  !reopenReceiptDeleteSql.includes("reopen.user_id = uid")
    && !reopenReceiptDeleteSql.includes("completion.user_id = uid"),
  "Excluir o ator nao pode apagar uma reabertura pertencente ao lancamento do parceiro.",
);
expect(
  !completionReceiptDeleteSql.includes("completion.user_id = uid"),
  "Excluir o ator nao pode apagar o ledger financeiro pertencente ao parceiro.",
);
expect(
  /delete from private\.ai_invoice_payment_ledger[\s\S]*ledger\.user_id = uid[\s\S]*ledger\.card_id[\s\S]*ledger\.payment_transaction_id/i.test(migration),
  "A limpeza do ledger de fatura nao cobre ator, cartao e transacao de pagamento.",
);
expect(childDelete >= 0, "A migration nao remove pagamentos-filhos explicitamente.");
expect(rootDelete > childDelete, "Pagamentos-filhos devem ser removidos antes das transacoes-raiz.");
expect(invoiceItemDelete > rootDelete, "Itens de fatura devem ser removidos depois dos ledgers e transacoes.");
expect(cardDelete > invoiceItemDelete, "Itens de fatura devem ser removidos antes dos cartoes.");
expect(authDelete > rootDelete, "auth.users so pode ser removido depois dos dados financeiros.");
for (const table of [
  "fatura_itens",
  "cartoes",
  "caixinhas",
  "contas",
  "categorias",
  "chat_historico",
  "feedbacks",
  "parcerias",
]) {
  expect(
    migration.includes(`delete from public.${table}`),
    `A limpeza explicita da tabela legada ${table} esta ausente.`,
  );
}
expect(
  migration.includes("revoke all on function public.delete_user() from public, anon")
    && migration.includes("grant execute on function public.delete_user() to authenticated"),
  "As permissoes defensivas de delete_user nao foram preservadas.",
);

// Cenario de parceria que motivou a FK SET NULL: Gabriel executou uma baixa
// no lancamento de Luis. Excluir Gabriel deve anonimizar o ator, nao apagar o
// recibo; ja um recibo do lancamento do proprio Gabriel deve ser removido.
const deletingUser = "gabriel";
const ownedTransactionIds = new Set([10, 11]);
const receiptFixtures = [
  { id: "self", userId: "gabriel", transactionUserId: "gabriel", ids: [10] },
  { id: "partner-actor", userId: "gabriel", transactionUserId: "luis", ids: [20] },
  { id: "partner-executed", userId: "luis", transactionUserId: "gabriel", ids: [11] },
];
const belongsToDeletedFinancialOwner = (receipt) => (
  receipt.transactionUserId === deletingUser
  || receipt.ids.some((id) => ownedTransactionIds.has(id))
);
const removedReceipts = receiptFixtures.filter(belongsToDeletedFinancialOwner).map((receipt) => receipt.id);
const anonymizedReceipts = receiptFixtures
  .filter((receipt) => !belongsToDeletedFinancialOwner(receipt) && receipt.userId === deletingUser)
  .map((receipt) => receipt.id);
expect(
  removedReceipts.includes("self") && removedReceipts.includes("partner-executed"),
  "Recibos das transacoes do usuario excluido precisam ser removidos, independentemente do ator.",
);
expect(
  !removedReceipts.includes("partner-actor") && anonymizedReceipts.includes("partner-actor"),
  "Uma baixa feita pelo usuario no lancamento do parceiro deve sobreviver com ator anonimizado.",
);

function functionSlice(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start >= 0 && end > start, `Nao foi possivel isolar ${startMarker}.`);
  return start >= 0 && end > start ? source.slice(start, end) : "";
}

const appDeletion = functionSlice(
  appSettings,
  "const confirmarSenhaEApagarConta = async () =>",
  "const enviarFeedback = async () =>",
);
const appReauth = appDeletion.indexOf("signInWithPassword");
const appRpc = appDeletion.indexOf('rpc("delete_user")');
expect(appReauth >= 0 && appRpc > appReauth, "O app deve reautenticar antes da RPC.");
expect(
  !/\.from\(["'][^"']+["']\)\.delete\(/.test(appDeletion),
  "O app voltou a apagar tabelas antes da RPC atomica.",
);
expect(
  appDeletion.includes("mensagemSeguraErroExclusao(erroDeletar)"),
  "O app precisa traduzir erros de exclusao sem expor detalhes internos.",
);
expect(
  appDeletion.includes('from("parcerias")')
    && appDeletion.includes('from("subscriptions")')
    && appDeletion.includes('rpc("get_minhas_decisoes_conta_dissolucao")')
    && appDeletion.includes('rpc("get_minhas_decisoes_caixinha")'),
  "O app precisa validar parceria, assinatura e decisoes antes da RPC destrutiva.",
);

const webDeletion = functionSlice(
  webSettings,
  "export async function deleteAccountAction",
  "redirect(\"/login?conta=excluida\")",
);
const webReauth = webDeletion.indexOf("signInWithPassword");
const webRpc = webDeletion.indexOf('rpc("delete_user")');
expect(webReauth >= 0 && webRpc > webReauth, "O site deve reautenticar antes da RPC.");
expect(
  !/\.from\(["'](?:transacoes|contas|categorias|caixinhas|cartoes|fatura_itens)["']\)\.delete\(/.test(webDeletion),
  "O site nao pode fazer exclusao financeira parcial antes da RPC.",
);
expect(
  webSettings.includes("accountDeletionFailure(error)"),
  "O site precisa traduzir falhas seguras da RPC.",
);

// Contrato de cadastro: valida apenas estrutura e diagnostico. Este teste nao
// chama Supabase, nao envia e-mail e nao cria usuario real.
expect(
  authActions.includes('emailRedirectTo: callbackUrl(origin, "signup")'),
  "O cadastro precisa manter o callback de confirmacao validado.",
);
expect(
  authActions.includes('logSafeAuthFailure("signup", error)')
    && authActions.includes("safeSignupErrorMessage(error)"),
  "Falhas do cadastro precisam de diagnostico seguro e mensagem orientativa.",
);
expect(
  authDiagnostics.includes('console.warn("[finflow-auth-failure]", { operation, code, status })'),
  "O diagnostico de cadastro precisa registrar somente operacao, codigo e status.",
);
expect(
  !/console\.warn\([^\n]*(email|password|senha|message|formData)/i.test(authDiagnostics),
  "O diagnostico de cadastro nao pode registrar PII, senha ou mensagem bruta.",
);
expect(
  appLogin.includes("mensagemSeguraErroCadastro(error)")
    && appLogin.includes('titulo: "Não foi possível criar a conta"'),
  "O cadastro mobile precisa tratar falhas com mensagem segura e orientativa.",
);
const mobileSignup = functionSlice(
  appLogin,
  "async function signUpWithEmail()",
  "async function recuperarSenha()",
);
expect(
  /try\s*\{[\s\S]*supabase\.auth\.signUp[\s\S]*\}\s*catch[\s\S]*\}\s*finally\s*\{[\s\S]*setLoading\(false\)/.test(mobileSignup),
  "O cadastro mobile precisa encerrar o loading mesmo em falha de rede.",
);

if (failures.length) {
  console.error("Falhas nos contratos de cadastro/exclusao:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  "Contratos validados: step-up, locks, ledgers cross-user anonimizados, filhos->raizes, sem deletes parciais e cadastro sem PII.",
);
