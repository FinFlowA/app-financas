/**
 * Filtro (formato PostgREST `.or(...)`) das transações que a pessoa pode ver:
 * as próprias e as das contas visíveis para ela (próprias ou compartilhadas
 * por parceiro). Usado pelo site e pelo app.
 *
 * A regra de acesso do banco (RLS) já garante esse resultado; o filtro
 * explícito existe por desempenho. Sem ele, as consultas paginadas por id
 * faziam o banco percorrer a tabela de transações de TODOS os usuários a cada
 * abertura de tela (teste de carga de 02/10/2026, ver docs/TESTES.md). Com os
 * valores escritos na consulta, o banco usa os índices de user_id e conta_id,
 * e o tempo não cresce com o número de usuários.
 *
 * `contaIds` deve conter todas as contas que a pessoa enxerga (o resultado de
 * `contas.select("id")`, sem filtro de arquivadas), para o resultado ser o
 * mesmo da regra de acesso.
 */
const FORMATO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function filtroTransacoesVisiveis(userId: string, contaIds: readonly (number | string)[]): string {
  if (!FORMATO_UUID.test(userId)) throw new Error("Usuário inválido para consultar transações.");
  const ids = [...new Set(contaIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0))];
  return ids.length > 0 ? `user_id.eq.${userId},conta_id.in.(${ids.join(",")})` : `user_id.eq.${userId}`;
}
