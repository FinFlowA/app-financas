export type PaginatedQueryError = {
  message: string;
  code?: string;
};

export type PaginatedQueryResult<T> = {
  data: T[] | null;
  error: PaginatedQueryError | null;
};

const DEFAULT_PAGE_SIZE = 1_000;
const MAX_PAGES = 100;

/**
 * Lê todas as páginas de uma consulta PostgREST sem depender do teto padrão
 * de linhas do projeto. Se o volume ultrapassar o limite defensivo, falha
 * fechado em vez de apresentar um saldo parcial como se fosse completo.
 */
export async function fetchAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PaginatedQueryResult<T>>,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<PaginatedQueryResult<T>> {
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > DEFAULT_PAGE_SIZE) {
    return { data: null, error: { message: "FINFLOW_INVALID_PAGE_SIZE" } };
  }

  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * pageSize;
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const pageRows = result.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return { data: rows, error: null };
  }

  return { data: null, error: { message: "FINFLOW_QUERY_TOO_LARGE" } };
}
