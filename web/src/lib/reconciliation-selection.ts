/**
 * Lançamentos escolhidos no rascunho de uma linha do extrato, na conciliação
 * com lançamento existente.
 *
 * O rascunho fica guardado na sessão e pode ser anterior a uma conciliação ou
 * a uma mudança do lançamento; nesse caso ele aponta para ids que já não são
 * candidatos. Só os ids presentes em `candidates` contam: sem esse filtro o
 * seletor mostrava "1 lançamento selecionado" com R$ 0,00 e nenhum item
 * marcado, e o botão de confirmar enviava um id que o servidor recusava.
 */
type SelectionDraft = { transactionId: number | null; transactionIds?: number[] };

export function selectedTransactionIds(draft: SelectionDraft, candidates: readonly { id: number }[]): number[] {
  const ids = draft.transactionIds?.length ? draft.transactionIds : draft.transactionId ? [draft.transactionId] : [];
  return ids.filter((id) => candidates.some((candidate) => candidate.id === id));
}
