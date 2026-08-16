/* global __dirname */
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
// Arquivos fixos do proprio repositorio; nenhum caminho vem de entrada externa.
const sql = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260808001100_atomic_partial_transaction_completion.sql"),
  "utf8",
);
const referenceGuard = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260808001000_harden_external_edges.sql"),
  "utf8",
);
const aiCore = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260802000100_secure_finance_ai.sql"),
  "utf8",
);
const aiCompletion = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260808001500_unify_ai_transaction_completion.sql"),
  "utf8",
);
const groupedPayments = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260808001600_group_partial_transaction_payments.sql"),
  "utf8",
);
const partnershipDissolution = fs.readFileSync(
  path.join(root, "supabase", "migrations", "20260731000400_partnership_dissolution_summary.sql"),
  "utf8",
);
const screen = fs.readFileSync(path.join(root, "app", "(tabs)", "transacoes.tsx"), "utf8");
const homeScreen = fs.readFileSync(path.join(root, "app", "(tabs)", "index.tsx"), "utf8");
const paymentHelpers = fs.readFileSync(path.join(root, "lib", "transaction-payments.ts"), "utf8");

const failures = [];
const expect = (condition, message) => {
  if (!condition) failures.push(message);
};
const includes = (source, value, message) => expect(source.includes(value), message);
const matches = (source, pattern, message) => expect(pattern.test(source), message);

matches(sql, /^\s*--[\s\S]*\bbegin;[\s\S]*commit;\s*$/i, "Migracao nao esta protegida por transacao.");
expect((sql.match(/\$\$/g) || []).length % 2 === 0, "Delimitadores de funcoes SQL estao desequilibrados.");
includes(sql, "create or replace function public.complete_transaction_with_partial", "RPC atomica de conclusao ausente.");
includes(sql, "create or replace function public.reopen_transaction_completion", "RPC atomica de reabertura ausente.");
expect(
  (sql.match(/hashtextextended\('finflow:transaction:' \|\| p_transaction_id::text, 73117\)/g) || []).length === 2,
  "Conclusao e reabertura precisam usar a mesma trava por transacao.",
);
matches(
  sql,
  /p_expected_value is null[\s\S]*p_realized_value is null[\s\S]*p_idempotency_key is null/,
  "Validacao explicita de parametros nulos ausente.",
);
matches(
  sql,
  /complete_transaction_with_partial[\s\S]*private\.ai_lock_account\(caller, transaction_row\.conta_id, false, true\)[\s\S]*private\.ai_assert_transaction\(caller, p_transaction_id\)/,
  "Conclusao nao trava e revalida a conta ativa e a transacao apos a trava.",
);
matches(
  sql,
  /reopen_transaction_completion[\s\S]*private\.ai_lock_account\(caller, transaction_row\.conta_id, false, false\)[\s\S]*private\.ai_assert_transaction\(caller, p_transaction_id\)/,
  "Reabertura nao trava e revalida a conta e a transacao apos a trava.",
);
includes(sql, "transaction_completion_receipts_active_transaction_idx", "Indice idempotente do recibo ativo ausente.");
includes(sql, "existing.reopened_at is not null", "Replay de conclusao reaberta nao e invalidado.");
includes(sql, "TRANSACTION_COMPLETION_STATE_CONFLICT", "Replay nao valida o estado financeiro atual.");
includes(sql, "child.descricao is not distinct from existing.remaining_description", "Replay nao valida integralmente o saldo restante.");
matches(
  sql,
  /p_realization_date <= transaction_row\.data_vencimento[\s\S]*adjustment_type <> 'none'/,
  "Servidor nao limita juros/desconto a realizacoes posteriores ao vencimento.",
);
includes(sql, "restored_value := completion.expected_value", "Reabertura nao restaura o valor originalmente agendado.");
includes(sql, "transaction_row.conta_id is distinct from completion.account_id", "Reabertura nao detecta troca concorrente de conta.");
includes(sql, "delete from public.transacoes\n      where id = completion.remaining_transaction_id", "Saldo parcial nao e removido atomicamente.");
includes(sql, "set reopened_at = clock_timestamp(), reopened_by = caller", "Recibo de conclusao nao e invalidado na reabertura.");
includes(sql, "create or replace function private.cleanup_transaction_completion_receipts", "Rotina global de retencao ausente.");
includes(sql, "finflow-transaction-receipt-retention", "Agendamento global de retencao ausente.");
matches(
  sql,
  /create policy "transacoes_accessible_update"[\s\S]*c\.user_id = \(select auth\.uid\(\)\)[\s\S]*public\.is_parceiro/,
  "RLS de transacoes nao permite dono da conta ou parceiro.",
);

includes(referenceGuard, "category_row.tipo in (new.tipo, 'ambos')", "Categoria do tipo ambos foi rejeitada em transacoes.");
includes(referenceGuard, "category_row.tipo in ('despesa', 'ambos')", "Categoria do tipo ambos foi rejeitada em faturas.");
includes(referenceGuard, "old.status = 'paga'", "Lancamento legado sem categoria nao pode ser recuperado para edicao.");

includes(screen, '"complete_transaction_with_partial"', "Tela nao usa a RPC de conclusao.");
includes(screen, '"reopen_transaction_completion"', "Tela nao usa a RPC de reabertura.");
expect(!screen.includes("rpcAindaNaoAplicada"), "Fallback inseguro ainda esta identificado na tela.");
includes(screen, 'erroAtomico?.code === "PGRST202"', "Tela nao falha fechada quando a RPC de conclusao esta ausente.");
includes(screen, 'erroReabertura?.code === "PGRST202"', "Tela nao falha fechada quando a RPC de reabertura esta ausente.");
includes(screen, "resultadoAtomico.remaining_value", "Toast nao usa o saldo restante devolvido pelo servidor.");
includes(screen, "Este lançamento antigo está sem categoria", "Conclusao de legado sem categoria nao orienta a edicao.");
includes(screen, "<SafeAreaView style={styles.realizationModalOverlay}", "Modal de realizacao nao respeita a area segura do aparelho.");
includes(screen, "contentContainerStyle={styles.realizationModalScrollContent}", "Modal de realizacao nao oferece rolagem centralizada em telas pequenas.");
matches(screen, /realizationModalScrollContent:\s*\{[\s\S]*?flexGrow:\s*1[\s\S]*?justifyContent:\s*"center"/, "Conteudo do modal de realizacao pode ficar fora da tela com o teclado aberto.");
matches(screen, /Platform\.OS === "web"[\s\S]*?React\.createElement\("input", \{[\s\S]*?type: "date"/, "Web nao oferece um seletor de data HTML acessivel no modal de realizacao.");
matches(screen, /Platform\.OS !== "web" && mostrarDataRealizacao[\s\S]*?<DateTimePicker/, "Seletor nativo de data nao foi preservado no Android e iOS.");
matches(
  screen,
  /chaveDataLocal\(novaData\) <= transacaoConfirmar\.data_vencimento[\s\S]*setAjusteTipo\("nenhum"\)[\s\S]*setAjusteValor\(""\)/,
  "Alterar a data para antes do vencimento nao limpa o ajuste antigo.",
);

includes(aiCore, "'transaction_id','realization_date','expected_value','realized_value','interest_value','interest_percent'", "Prepare da IA nao aceita realized_value.");
includes(aiCore, "required:=array['transaction_id','realization_date','expected_value','realized_value']", "Prepare da IA nao exige realized_value.");
includes(aiCompletion, "public.complete_transaction_with_partial(", "IA nao usa a RPC canonica de conclusao.");
includes(aiCompletion, "public.reopen_transaction_completion(", "IA nao usa a RPC canonica de reabertura.");
matches(aiCompletion, /complete_transaction_with_partial\([\s\S]*pending_action_id[\s\S]*\)/, "Pending action nao e chave idempotente da conclusao.");
matches(aiCompletion, /raw_adjustment>0[\s\S]*adjustment_type:='interest'[\s\S]*raw_adjustment<0[\s\S]*adjustment_type:='discount'/, "Juros e desconto nao sao mapeados para o contrato canonico.");
includes(aiCompletion, "realized_value<>expected_value", "Movimento interno ainda permite baixa parcial.");
includes(aiCore, "create or replace function private.ai_lock_partnership_access", "Trava canonica de parceria ausente.");
matches(
  aiCore,
  /ai_lock_partnership_access[\s\S]*hashtextextended\('finflow:partnership:'\|\|partnership_id::text,73119\)[\s\S]*for share;/,
  "Parceria nao usa a trava advisory canonica nem fica protegida contra update/delete.",
);
matches(
  aiCore,
  /if action_name='create_transaction' then[\s\S]*ai_lock_account\(caller,\(payload->>'account_id'\)::bigint,false,true\)[\s\S]*ai_lock_category\(caller,\(payload->>'category_id'\)::bigint,db_type,true\)/,
  "Criacao de lancamento nao trava conta ativa e categoria compativel.",
);
matches(
  aiCore,
  /if \(payload->>'account_id'\)::bigint < \(payload->>'destination_account_id'\)::bigint then[\s\S]*ai_lock_account\(caller,\(payload->>'account_id'\)::bigint,false,true\)[\s\S]*ai_lock_account\(caller,\(payload->>'destination_account_id'\)::bigint,false,true\)/,
  "Transferencia nao trava origem e destino ativos em ordem deterministica.",
);
matches(
  aiCore,
  /for series_row in[\s\S]*order by t\.data_vencimento,t\.id for update[\s\S]*ai_lock_account\(caller,series_row\.conta_id,false,false\)[\s\S]*ai_assert_transaction\(caller,series_row\.id\)[\s\S]*update public\.transacoes/,
  "Edicao coletiva nao revalida cada lancamento e conta sob lock.",
);
matches(
  aiCore,
  /if action_name='delete_transaction' then[\s\S]*for series_row in[\s\S]*order by t\.id for update[\s\S]*ai_lock_account\(caller,series_row\.conta_id,false,false\)[\s\S]*ai_assert_transaction\(caller,series_row\.id\)[\s\S]*delete from public\.transacoes where id=series_row\.id/,
  "Exclusao coletiva nao revalida cada lancamento e conta antes do DML.",
);
matches(
  aiCore,
  /if action_name='create_card_purchase' then[\s\S]*ai_lock_card\(caller,\(payload->>'card_id'\)::bigint,true\)[\s\S]*ai_lock_category\(caller,\(payload->>'category_id'\)::bigint,'despesa',true\)/,
  "Compra no cartao nao trava cartao ativo e categoria de despesa.",
);
includes(aiCore, "perform private.ai_lock_goal(caller,goal_id,false,true);", "Ajuste de objetivo nao revalida objetivo ativo sob lock.");
matches(aiCore, /if action_name='pay_invoice'[\s\S]*private\.ai_lock_account\(caller,\(payload->>'account_id'\)::bigint,false,true\)/, "Pagamento de fatura nao trava/revalida a conta.");
matches(aiCore, /if action_name='reverse_invoice_payment'[\s\S]*where id=payment_tx_id and user_id=caller for update/, "Estorno da IA nao restringe a transacao ao titular.");
includes(partnershipDissolution, "'finflow:partnership:' || p_parceria_id::TEXT, 73119", "Dissolucao nao compartilha a trava advisory da IA.");

matches(groupedPayments, /^\s*--[\s\S]*\bbegin;[\s\S]*commit;\s*$/i, "Migracao de pagamentos agrupados nao esta transacional.");
const legacyIndexDrop = groupedPayments.indexOf("drop index if exists private.transaction_completion_receipts_active_transaction_idx");
for (const lock of [
  "lock table public.transacoes in share row exclusive mode",
  "lock table private.transaction_completion_receipts in share row exclusive mode",
  "lock table private.transaction_reopen_receipts in share row exclusive mode",
]) {
  const lockPosition = groupedPayments.indexOf(lock);
  expect(lockPosition >= 0 && lockPosition < legacyIndexDrop, `Lock ${lock} precisa anteceder a remocao da unicidade legada.`);
}
includes(groupedPayments, "add column if not exists transacao_pai_id bigint", "Vinculo tecnico pai/filho ausente.");
matches(groupedPayments, /foreign key \(transacao_pai_id\)[\s\S]*on delete restrict/, "FK do agendamento raiz precisa impedir exclusao com pagamentos.");
includes(groupedPayments, 'on public.transacoes as restrictive for insert to authenticated', "RLS nao impede criacao direta de filhos tecnicos.");
includes(groupedPayments, 'on public.transacoes as restrictive for update to authenticated', "RLS nao impede edicao direta de filhos tecnicos.");
includes(groupedPayments, 'on public.transacoes as restrictive for delete to authenticated', "RLS nao impede exclusao direta de filhos tecnicos.");
matches(groupedPayments, /ai_assert_transaction[\s\S]*t\.transacao_pai_id is null/, "A IA ainda pode operar um pagamento tecnico como agendamento.");
matches(groupedPayments, /ai_assert_transaction[\s\S]*c\.user_id=caller[\s\S]*public\.is_parceiro\(c\.user_id,caller\)/, "Dono da conta compartilhada nao acessa lancamento criado pelo parceiro.");
includes(groupedPayments, "TRANSACTION_PAYMENT_LEDGER_RPC_REQUIRED", "Edicao REST do raiz com ledger nao e bloqueada.");
includes(groupedPayments, "TRANSACTION_HAS_PAYMENT_HISTORY", "Exclusao do raiz com historico nao e bloqueada.");
matches(groupedPayments, /finflow_transaction_has_payment_history[\s\S]*r\.reopened_at is null/, "Historico estornado ainda bloqueia editar ou excluir o agendamento.");
expect(!groupedPayments.includes("FINFLOW_LEGACY_PARTIAL_PAYMENTS_REQUIRE_ASSISTED_CONVERSION"), "Migracao ainda aborta toda cadeia parcial legada em vez de converte-la.");
includes(groupedPayments, "create temporary table finflow_legacy_payment_chain_nodes", "Conversao nao materializa a topologia legada.");
matches(groupedPayments, /with recursive[\s\S]*visited_transactions[\s\S]*chain_depth<1000/, "Conversao legada nao detecta/limita ciclos de forma deterministica.");
for (const invariant of [
  "FINFLOW_LEGACY_PARTIAL_LEDGER_STATE_INCOMPLETE",
  "FINFLOW_LEGACY_PARTIAL_DUPLICATE_ACTIVE_TRANSACTION",
  "FINFLOW_LEGACY_PARTIAL_BRANCH_OR_DUPLICATE",
  "FINFLOW_LEGACY_PARTIAL_HISTORICAL_CYCLE_OR_ORPHAN",
  "FINFLOW_LEGACY_PARTIAL_HISTORICAL_ROOT_AMBIGUOUS",
  "FINFLOW_LEGACY_PARTIAL_ACTIVE_LINEAGE_DISCONNECTED",
  "FINFLOW_LEGACY_ACTIVE_RECEIPT_STATE_CHANGED",
  "FINFLOW_LEGACY_PARTIAL_CYCLE_OR_ORPHAN_RECEIPTS",
  "FINFLOW_LEGACY_PARTIAL_RECEIPT_IN_MULTIPLE_CHAINS",
  "FINFLOW_LEGACY_PARTIAL_TRANSACTION_IN_MULTIPLE_CHAINS",
  "FINFLOW_LEGACY_PARTIAL_PAID_STATE_CHANGED",
  "FINFLOW_LEGACY_PARTIAL_CHAIN_METADATA_CHANGED",
  "FINFLOW_LEGACY_PARTIAL_TERMINAL_STATE_CHANGED",
  "FINFLOW_LEGACY_PARTIAL_UNEXPECTED_INVOICE_REFERENCE",
]) includes(groupedPayments, invariant, `Preflight legado nao falha fechado para ${invariant}.`);
matches(groupedPayments, /Somente depois de todo o preflight concluido ocorre a primeira mutacao[\s\S]*for chain_root in/, "Conversao legada inicia mutacoes antes do preflight completo.");
includes(groupedPayments, "create temporary table finflow_legacy_payment_receipts", "Conversao nao separa recibos 011 do ledger ja canonico em uma reaplicacao.");
matches(groupedPayments, /join pg_temp\.finflow_legacy_payment_receipts legacy on legacy\.id=r\.id[\s\S]*where r\.reopened_at is null[\s\S]*group by r\.transaction_id/, "Preflight legado ainda acusa recibos canonicos em uma reaplicacao.");
includes(groupedPayments, "create temporary table finflow_legacy_payment_lineage_nodes", "Conversao nao reconstrui a linhagem historica profunda.");
matches(groupedPayments, /update private\.transaction_completion_receipts historical[\s\S]*from pg_temp\.finflow_legacy_payment_lineage_receipts mapped[\s\S]*historical\.reopened_at is not null/, "Recibos reabertos profundos nao sao remapeados sem corromper a cadeia ativa.");
matches(groupedPayments, /update private\.transaction_reopen_receipts reopen[\s\S]*from private\.transaction_completion_receipts completion[\s\S]*join pg_temp\.finflow_legacy_payment_receipts legacy/, "Historicos de reabertura fora da cadeia ativa nao sao remapeados globalmente.");
matches(groupedPayments, /if terminal_is_paid then[\s\S]*set tipo=terminal_row\.tipo,[\s\S]*valor=terminal_row\.valor,[\s\S]*data_vencimento=terminal_row\.data_vencimento,[\s\S]*categoria_id=terminal_row\.categoria_id,[\s\S]*conta_id=terminal_row\.conta_id[\s\S]*else[\s\S]*set tipo=terminal_row\.tipo,[\s\S]*descricao=terminal_row\.descricao/, "Conversao nao preserva integralmente o estado atual do terminal no mesmo raiz.");
matches(groupedPayments, /chain_node\.chain_depth=1[\s\S]*insert into public\.transacoes\([\s\S]*transacao_pai_id[\s\S]*chain_root\.root_transaction_id/, "Conversao nao cria a primeira baixa tecnica ligada ao raiz.");
matches(groupedPayments, /set root_transaction_id=mapped\.root_transaction_id,[\s\S]*payment_transaction_id=mapped\.original_transaction_id,[\s\S]*transaction_id=mapped\.root_transaction_id/, "Conversao nao preserva o ID fisico auditavel dos recibos reabertos.");
includes(groupedPayments, "payment_transaction_id=coalesce(payment_transaction_id,transaction_id)", "Backfill descarta o identificador historico de recibos reabertos.");
matches(groupedPayments, /row_number\(\) over\(\s*partition by r\.root_transaction_id\s*order by r\.created_at,r\.id\s*\)/, "Backfill nao resequencia todo o historico por raiz.");
includes(groupedPayments, "transaction_completion_receipts_root_sequence_idx", "Banco nao impede sequencias duplicadas dentro da mesma raiz.");
matches(groupedPayments, /select coalesce\(sum\(r\.realized_value\),0\)\s*into paid_before[\s\S]*where r\.root_transaction_id=p_transaction_id and r\.reopened_at is null;[\s\S]*select coalesce\(max\(r\.payment_sequence\),0\)\+1\s*into payment_sequence[\s\S]*where r\.root_transaction_id=p_transaction_id;/, "Nova baixa nao separa soma ativa da sequencia monotona global.");
expect((groupedPayments.match(/paid_total numeric\(20,2\)/g) || []).length >= 2, "Somatorios de pagamentos ainda podem estourar numeric(14,2).");
includes(groupedPayments, "cumulative_paid numeric(20,2)", "Conversao legada ainda pode estourar ao acumular varias baixas validas.");
includes(groupedPayments, "TRANSACTION_TOTAL_DUE_OUT_OF_RANGE", "RPC nao rejeita total com juros fora do limite monetario antes do INSERT.");
includes(groupedPayments, "validate constraint transacoes_payment_child_not_self", "Constraint pai/filho permanece NOT VALID apos a conversao.");
includes(groupedPayments, "create or replace function private.finflow_authorize_payment_child_write", "Autorizacao transacional da baixa tecnica ausente.");
includes(groupedPayments, "'finflow.payment_child_root_id',p_root_transaction_id::text,true", "Autorizacao da baixa nao e limitada a transacao corrente.");
matches(groupedPayments, /revoke all on function private\.finflow_authorize_payment_child_write\(uuid,bigint\)[\s\S]*from public,anon,authenticated/, "Cliente consegue abrir a autorizacao tecnica diretamente.");
includes(groupedPayments, "create or replace function public.enforce_finflow_plan_limit", "Trigger de plano nao foi adaptado aos pagamentos agrupados.");
matches(groupedPayments, /tg_op='UPDATE'[\s\S]*new\.user_id is distinct from old\.user_id[\s\S]*invalid resource owner/, "UPDATE compartilhado permite trocar o titular.");
matches(groupedPayments, /shared_update_allowed:=exists\([\s\S]*c\.id=old\.conta_id[\s\S]*public\.is_parceiro[\s\S]*c\.id=new\.conta_id/, "UPDATE compartilhado nao valida acesso as contas antiga e nova.");
matches(groupedPayments, /tg_op='INSERT' and new\.transacao_pai_id is not null[\s\S]*current_setting\([\s\S]*payment_root_setting::bigint<>new\.transacao_pai_id[\s\S]*parent_row\.status<>'pendente'/, "INSERT tecnico nao exige flag e raiz pendente correspondentes.");
matches(groupedPayments, /new\.user_id is distinct from parent_row\.user_id[\s\S]*new\.conta_id is distinct from parent_row\.conta_id[\s\S]*new\.status is distinct from 'paga'/, "INSERT tecnico nao revalida titular, conta e estado pago.");
matches(groupedPayments, /if tg_table_name='transacoes' and new\.transacao_pai_id is not null then\s*return new;/, "Filho tecnico ainda consome franquia mensal.");
expect((groupedPayments.match(/and transacao_pai_id is null/g) || []).length >= 2, "Contagem mensal ainda inclui filhos tecnicos.");
matches(groupedPayments, /finflow_authorize_payment_child_write\(caller,root_row\.id\)[\s\S]*insert into public\.transacoes\([\s\S]*transacao_pai_id[\s\S]*set_config\('finflow\.payment_child_root_id','',true\)/, "RPC nao abre e fecha a autorizacao ao redor do INSERT tecnico.");
matches(groupedPayments, /finflow_guard_transaction_payment_group\(\)[\s\S]*security invoker/, "Guard de pagamentos deixou de distinguir REST direto de RPC SECURITY DEFINER.");
includes(groupedPayments, "create or replace function public.complete_transaction_with_partial", "RPC agrupada de pagamento ausente.");
matches(groupedPayments, /insert into public\.transacoes\([\s\S]*transacao_pai_id[\s\S]*root_row\.id[\s\S]*update public\.transacoes[\s\S]*set valor=remaining_value,status='pendente'/, "Baixa parcial nao cria filho pago e reduz o mesmo agendamento.");
matches(groupedPayments, /else[\s\S]*payment_transaction_id := root_row\.id;[\s\S]*set valor=realized_value,status='paga'/, "Ultima baixa nao usa o proprio agendamento raiz.");
includes(groupedPayments, "'remaining_transaction_id',null", "Contrato legado ainda anuncia outro agendamento de saldo.");
includes(groupedPayments, "extensions.gen_random_uuid()", "UUID do pagamento nao esta qualificado com search_path vazio.");
includes(groupedPayments, "create or replace function public.reverse_transaction_payment", "RPC de estorno individual ausente.");
matches(groupedPayments, /order by r\.payment_sequence desc,r\.created_at desc,r\.id desc[\s\S]*TRANSACTION_PAYMENT_NOT_LATEST/, "Estorno nao restringe a reversao ao ultimo pagamento ativo.");
includes(groupedPayments, "root_row.valor+completion.expected_value-completion.remaining_value", "Estorno nao preserva a edicao individual do saldo restante.");
includes(groupedPayments, "TRANSACTION_REOPEN_RESTORED_VALUE_INVALID", "Estorno nao valida o saldo restaurado.");
includes(groupedPayments, "create or replace function public.reopen_transaction_completion", "Alias canonico de reabertura ausente.");
includes(groupedPayments, "create or replace function public.list_transaction_payment_summaries", "Resumo em lote dos pagamentos ausente.");
for (const field of [
  "root_transaction_id", "display_transaction_id", "current_pending_transaction_id",
  "last_paid_transaction_id", "technical_transaction_ids", "total_value", "paid_total",
  "remaining_value", "is_fully_paid", "payment_count", "scheduled_date", "last_realization_date",
]) includes(groupedPayments, field, `Campo ${field} ausente no resumo em lote.`);
includes(groupedPayments, "create or replace function public.get_transaction_payment_history", "Historico detalhado de pagamentos ausente.");
includes(groupedPayments, "'payment_sequence',r.payment_sequence", "Historico nao expoe a sequencia logica do pagamento.");
matches(groupedPayments, /'ok',true,'summary',summary_value,'payments',payments_value/, "Historico nao retorna summary e payments no contrato combinado.");
includes(groupedPayments, "AI_TRANSACTION_PAYMENT_LEDGER_REQUIRES_REOPEN", "Executor generico da IA ainda altera raiz com pagamentos.");
includes(groupedPayments, "AI_TRANSACTION_PARTIAL_REMAINDER_IS_INDIVIDUAL", "IA ainda permite editar em serie um saldo parcialmente realizado.");
includes(homeScreen, "transacao_pai_id?: number | null;", "Home nao tipa o vinculo tecnico dos pagamentos.");
includes(homeScreen, "status, transacao_pai_id\")", "Consulta da Home nao seleciona o vinculo tecnico dos pagamentos.");
matches(homeScreen, /const lancsMes = transacoes\.filter\(\(t\) =>[\s\S]*t\.transacao_pai_id == null[\s\S]*startsWith\(mesStr\)[\s\S]*\)\.length;/, "Pre-check visual da franquia ainda conta pagamentos tecnicos.");
includes(paymentHelpers, "paymentSequence: positiveId(item.payment_sequence) ?? 0", "Cliente nao normaliza a sequencia logica do pagamento.");
includes(paymentHelpers, "b.paymentSequence - a.paymentSequence", "Detalhe nao ordena pagamentos pela sequencia logica decrescente.");
includes(paymentHelpers, "summary.isFullyPaid ? summary.totalValue : summary.remainingValue", "Card nao prioriza o saldo pendente como valor principal.");
matches(screen, /fmtReais\(valoresCardPagamento\.primaryValue\)[\s\S]*?Realizado: \{fmtReais\(valoresCardPagamento\.realizedValue\)\}/, "Card parcial nao exibe saldo pendente em destaque e realizado abaixo.");
expect(!screen.includes("Restante: {fmtReais(resumoPagamento.remainingValue)}"), "Card parcial ainda repete o saldo restante na linha secundaria.");

const statusStart = screen.indexOf("const aplicarStatus = async");
const statusEnd = screen.indexOf("const alternarStatus = async", statusStart);
const statusBlock = statusStart >= 0 && statusEnd > statusStart ? screen.slice(statusStart, statusEnd) : "";
expect(statusBlock.length > 0, "Nao foi possivel localizar aplicarStatus.");
expect(!statusBlock.includes('from("transacoes").insert'), "Aplicar status ainda cria saldo parcial manualmente.");
expect(!statusBlock.includes("saldoRestanteCriadoId"), "Rollback manual inseguro ainda existe.");

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}

console.log("Transaction completion contract tests passed.");
