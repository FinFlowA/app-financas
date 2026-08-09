import type { LocalDemoDatabase, LocalDemoRow } from "./fixtures";

export type LocalDemoError = {
  message: string;
  details: string;
  hint: string;
  code: string;
};

export type LocalDemoQueryResult<T = unknown> = {
  data: T | null;
  error: LocalDemoError | null;
  count: number | null;
  status: number;
  statusText: string;
};

type Operation = "select" | "insert" | "update" | "delete";
type Cardinality = "many" | "single" | "maybeSingle";
type Filter = (row: LocalDemoRow) => boolean;

type QueryContext = {
  database: LocalDemoDatabase;
  currentUserId: () => string | null;
};

function clone<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function error(code: string, message: string, details = ""): LocalDemoError {
  return { code, message, details, hint: "Modo local: nenhum dado remoto foi acessado." };
}

function isNumericBooleanPair(left: unknown, right: unknown): boolean {
  return (left === 1 && right === true)
    || (left === 0 && right === false)
    || (left === true && right === 1)
    || (left === false && right === 0);
}

function equivalent(left: unknown, right: unknown): boolean {
  if (Object.is(left, right) || isNumericBooleanPair(left, right)) return true;
  if (left instanceof Date && typeof right === "string") return left.toISOString() === right;
  if (right instanceof Date && typeof left === "string") return right.toISOString() === left;
  return false;
}

function compareValues(left: unknown, right: unknown): number {
  if (equivalent(left, right)) return 0;
  if (left === null || left === undefined) return -1;
  if (right === null || right === undefined) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right), "pt-BR", { numeric: true });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function postgresPattern(pattern: string, caseInsensitive: boolean): RegExp {
  let source = "";
  for (const character of pattern) {
    if (character === "%") source += ".*";
    else if (character === "_") source += ".";
    else source += escapeRegExp(character);
  }
  return new RegExp(`^${source}$`, caseInsensitive ? "iu" : "u");
}

function scalar(raw: string, example: unknown): unknown {
  const value = raw.trim();
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (typeof example === "number" && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value.replace(/^"|"$/g, "");
}

function splitConditions(expression: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      parts.push(expression.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(expression.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function conditionFromPostgrest(expression: string): Filter {
  const firstDot = expression.indexOf(".");
  const secondDot = expression.indexOf(".", firstDot + 1);
  if (firstDot < 1 || secondDot < 0) return () => false;
  const column = expression.slice(0, firstDot);
  const operator = expression.slice(firstDot + 1, secondDot);
  const raw = expression.slice(secondDot + 1);
  return (row) => {
    const current = row[column];
    const expected = scalar(raw, current);
    if (operator === "eq") return equivalent(current, expected);
    if (operator === "neq") return !equivalent(current, expected);
    if (operator === "gt") return compareValues(current, expected) > 0;
    if (operator === "gte") return compareValues(current, expected) >= 0;
    if (operator === "lt") return compareValues(current, expected) < 0;
    if (operator === "lte") return compareValues(current, expected) <= 0;
    if (operator === "is") return equivalent(current, expected);
    if (operator === "like") return postgresPattern(raw, false).test(String(current ?? ""));
    if (operator === "ilike") return postgresPattern(raw, true).test(String(current ?? ""));
    if (operator === "in") {
      const list = raw.replace(/^\(|\)$/g, "").split(",").map((item) => scalar(item, current));
      return list.some((item) => equivalent(current, item));
    }
    return false;
  };
}

function selectedColumns(columns?: string): string[] | null {
  if (!columns || columns.trim() === "" || columns.trim() === "*") return null;
  return columns
    .split(",")
    .map((column) => column.trim())
    .filter((column) => column && !column.includes("(") && column !== "*")
    .map((column) => column.includes(":") ? column.split(":")[0].trim() : column);
}

function project(row: LocalDemoRow, columns?: string): LocalDemoRow {
  const selected = selectedColumns(columns);
  if (!selected) return clone(row);
  return selected.reduce<LocalDemoRow>((result, column) => {
    result[column] = clone(row[column]);
    return result;
  }, {});
}

function nextId(rows: LocalDemoRow[]): number {
  return rows.reduce((maximum, row) => {
    const id = typeof row.id === "number" ? row.id : 0;
    return Math.max(maximum, id);
  }, 0) + 1;
}

function withTableDefaults(table: string, row: LocalDemoRow, userId: string | null): LocalDemoRow {
  const now = new Date().toISOString();
  const defaults: LocalDemoRow = { criado_em: now };
  if (userId && row.user_id === undefined) defaults.user_id = userId;
  if (table === "categorias") Object.assign(defaults, { ativa: 1, cor: "#6C7D77", icone: "more-horiz", bloqueado_plano: false });
  if (table === "contas") Object.assign(defaults, { saldo_inicial: 0, cor: "#2A9D8F", compartilhado: false, arquivado: false, bloqueado_plano: false });
  if (table === "caixinhas") Object.assign(defaults, { saldo_atual: 0, meta_valor: 0, cor: "#2A9D8F", icone: "savings", compartilhado: false, arquivado: false, bloqueado_plano: false });
  if (table === "cartoes") Object.assign(defaults, { limite: 0, cor: "#457B9D", ativo: true, bloqueado_plano: false });
  if (table === "fatura_itens") Object.assign(defaults, { parcela_atual: 1, total_parcelas: 1, grupo_parcela_id: null, categoria_id: null, pago: false });
  if (table === "transacoes") Object.assign(defaults, { categoria_id: null, status: "pendente", data_realizacao: null });
  if (table === "notificacoes_sistema") Object.assign(defaults, { criada_em: now, lida_em: null, dados: {} });
  return { ...defaults, ...row };
}

/** Implementação em memória do encadeamento PostgREST usado pelo aplicativo. */
export class LocalDemoQueryBuilder implements PromiseLike<LocalDemoQueryResult<unknown>> {
  private operation: Operation = "select";
  private columns = "*";
  private selectOptions: { count?: "exact" | "planned" | "estimated"; head?: boolean } = {};
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean; nullsFirst?: boolean }[] = [];
  private rowLimit: number | null = null;
  private cardinality: Cardinality = "many";
  private values: LocalDemoRow[] = [];
  private returnRows = false;
  private execution: Promise<LocalDemoQueryResult<unknown>> | null = null;

  constructor(
    private readonly context: QueryContext,
    private readonly table: string,
  ) {}

  select(columns = "*", options: { count?: "exact" | "planned" | "estimated"; head?: boolean } = {}): this {
    this.columns = columns;
    this.selectOptions = options;
    if (this.operation !== "select") this.returnRows = true;
    return this;
  }

  insert(values: LocalDemoRow | LocalDemoRow[], options?: { count?: "exact" }): this {
    this.operation = "insert";
    this.values = clone(Array.isArray(values) ? values : [values]);
    if (options?.count) this.selectOptions.count = options.count;
    return this;
  }

  update(values: LocalDemoRow, options?: { count?: "exact" }): this {
    this.operation = "update";
    this.values = [clone(values)];
    if (options?.count) this.selectOptions.count = options.count;
    return this;
  }

  delete(options?: { count?: "exact" }): this {
    this.operation = "delete";
    if (options?.count) this.selectOptions.count = options.count;
    return this;
  }

  upsert(values: LocalDemoRow | LocalDemoRow[], options?: { onConflict?: string; count?: "exact" }): this {
    const incoming = Array.isArray(values) ? values : [values];
    const conflictColumn = options?.onConflict?.split(",")[0]?.trim() || "id";
    const rows = this.context.database[this.table] ?? (this.context.database[this.table] = []);
    for (const value of incoming) {
      const match = rows.find((row) => value[conflictColumn] !== undefined && equivalent(row[conflictColumn], value[conflictColumn]));
      if (match) Object.assign(match, clone(value));
      else rows.push(withTableDefaults(this.table, { id: nextId(rows), ...clone(value) }, this.context.currentUserId()));
    }
    this.operation = "select";
    this.filters.push((row) => incoming.some((value) => equivalent(row[conflictColumn], value[conflictColumn])));
    if (options?.count) this.selectOptions.count = options.count;
    return this;
  }

  eq(column: string, value: unknown): this { this.filters.push((row) => equivalent(row[column], value)); return this; }
  neq(column: string, value: unknown): this { this.filters.push((row) => !equivalent(row[column], value)); return this; }
  gt(column: string, value: unknown): this { this.filters.push((row) => compareValues(row[column], value) > 0); return this; }
  gte(column: string, value: unknown): this { this.filters.push((row) => compareValues(row[column], value) >= 0); return this; }
  lt(column: string, value: unknown): this { this.filters.push((row) => compareValues(row[column], value) < 0); return this; }
  lte(column: string, value: unknown): this { this.filters.push((row) => compareValues(row[column], value) <= 0); return this; }
  like(column: string, pattern: string): this { const matcher = postgresPattern(pattern, false); this.filters.push((row) => matcher.test(String(row[column] ?? ""))); return this; }
  ilike(column: string, pattern: string): this { const matcher = postgresPattern(pattern, true); this.filters.push((row) => matcher.test(String(row[column] ?? ""))); return this; }
  in(column: string, values: readonly unknown[]): this { this.filters.push((row) => values.some((value) => equivalent(row[column], value))); return this; }
  is(column: string, value: unknown): this { this.filters.push((row) => equivalent(row[column], value)); return this; }
  match(query: LocalDemoRow): this { Object.entries(query).forEach(([column, value]) => this.eq(column, value)); return this; }

  or(expression: string): this {
    const alternatives = splitConditions(expression).map(conditionFromPostgrest);
    this.filters.push((row) => alternatives.some((filter) => filter(row)));
    return this;
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this.orders.push({ column, ascending: options.ascending !== false, nullsFirst: options.nullsFirst });
    return this;
  }

  limit(value: number): this { this.rowLimit = Math.max(0, Math.trunc(value)); return this; }
  single(): this { this.cardinality = "single"; this.returnRows = true; return this; }
  maybeSingle(): this { this.cardinality = "maybeSingle"; this.returnRows = true; return this; }

  private matchingRows(rows: LocalDemoRow[]): LocalDemoRow[] {
    const filtered = rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.orders.length > 0) {
      filtered.sort((left, right) => {
        for (const order of this.orders) {
          const leftValue = left[order.column];
          const rightValue = right[order.column];
          if ((leftValue === null || leftValue === undefined) !== (rightValue === null || rightValue === undefined)) {
            const nullResult = leftValue === null || leftValue === undefined ? -1 : 1;
            return order.nullsFirst === false ? -nullResult : nullResult;
          }
          const result = compareValues(leftValue, rightValue);
          if (result !== 0) return order.ascending ? result : -result;
        }
        return 0;
      });
    }
    return this.rowLimit === null ? filtered : filtered.slice(0, this.rowLimit);
  }

  private async run(): Promise<LocalDemoQueryResult<unknown>> {
    const tableRows = this.context.database[this.table] ?? (this.context.database[this.table] = []);
    let affected: LocalDemoRow[];

    if (this.operation === "insert") {
      affected = this.values.map((value) => {
        const providedId = typeof value.id === "number" ? value.id : nextId(tableRows);
        const inserted = withTableDefaults(this.table, { id: providedId, ...value }, this.context.currentUserId());
        tableRows.push(inserted);
        return inserted;
      });
    } else if (this.operation === "update") {
      affected = this.matchingRows(tableRows);
      for (const row of affected) {
        for (const [key, value] of Object.entries(this.values[0] ?? {})) {
          if (value !== undefined) row[key] = clone(value);
        }
      }
    } else if (this.operation === "delete") {
      affected = this.matchingRows(tableRows);
      const selected = new Set(affected);
      this.context.database[this.table] = tableRows.filter((row) => !selected.has(row));
    } else {
      affected = this.matchingRows(tableRows);
    }

    const count = this.selectOptions.count ? affected.length : null;
    if (this.selectOptions.head) {
      return { data: null, error: null, count, status: 200, statusText: "OK (local demo)" };
    }

    const shouldReturnRows = this.operation === "select" || this.returnRows;
    const projected = affected.map((row) => project(row, this.columns));
    if (!shouldReturnRows) {
      return { data: null, error: null, count, status: 204, statusText: "No Content (local demo)" };
    }

    if (this.cardinality === "single") {
      if (projected.length !== 1) {
        return {
          data: null,
          error: error("PGRST116", "JSON object requested, multiple (or no) rows returned", `Rows: ${projected.length}`),
          count,
          status: 406,
          statusText: "Not Acceptable (local demo)",
        };
      }
      return { data: projected[0], error: null, count, status: 200, statusText: "OK (local demo)" };
    }
    if (this.cardinality === "maybeSingle") {
      if (projected.length > 1) {
        return {
          data: null,
          error: error("PGRST116", "JSON object requested, multiple rows returned", `Rows: ${projected.length}`),
          count,
          status: 406,
          statusText: "Not Acceptable (local demo)",
        };
      }
      return { data: projected[0] ?? null, error: null, count, status: 200, statusText: "OK (local demo)" };
    }
    return { data: projected, error: null, count, status: 200, statusText: "OK (local demo)" };
  }

  then<TResult1 = LocalDemoQueryResult<unknown>, TResult2 = never>(
    onfulfilled?: ((value: LocalDemoQueryResult<unknown>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    if (!this.execution) this.execution = this.run();
    return this.execution.then(onfulfilled ?? undefined, onrejected ?? undefined);
  }
}

export function createLocalDemoQueryBuilder(
  database: LocalDemoDatabase,
  table: string,
  currentUserId: () => string | null,
): LocalDemoQueryBuilder {
  return new LocalDemoQueryBuilder({ database, currentUserId }, table);
}
