export type StatementEntry = {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "receita" | "despesa";
  sourceId: string | null;
};

const MAX_ENTRIES = 5_000;
const DATE_KEYS = ["data", "date", "dtmovimento", "data movimento", "data lancamento", "data lançamento"];
const DESCRIPTION_KEYS = ["descricao", "descrição", "historico", "histórico", "memo", "lancamento", "lançamento", "detalhes"];
const AMOUNT_KEYS = ["valor", "amount", "valor lancamento", "valor lançamento"];
const CREDIT_KEYS = ["credito", "crédito", "credit", "entrada"];
const DEBIT_KEYS = ["debito", "débito", "debit", "saida", "saída"];
const ID_KEYS = ["id", "fitid", "documento", "numero documento", "número documento", "referencia", "referência"];

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ");
}

function findColumn(headers: string[], aliases: string[]): number {
  const wanted = new Set(aliases.map(normalized));
  return headers.findIndex((header) => wanted.has(normalized(header)));
}

function parseCsvRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(field.trim()); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field.trim()); field = "";
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function delimiterFor(header: string): string {
  const candidates = [";", ",", "\t"];
  return candidates.sort((a, b) => header.split(b).length - header.split(a).length)[0];
}

export function parseStatementMoney(input: string): number | null {
  const raw = input.trim().replace(/R\$|\s/g, "");
  if (!raw) return null;
  const negative = /^\(.*\)$/.test(raw) || raw.startsWith("-");
  const unsigned = raw.replace(/[()+-]/g, "");
  const lastComma = unsigned.lastIndexOf(",");
  const lastDot = unsigned.lastIndexOf(".");
  let normalizedNumber = unsigned;
  if (lastComma > lastDot) normalizedNumber = unsigned.replace(/\./g, "").replace(",", ".");
  else if (lastDot > lastComma && lastComma >= 0) normalizedNumber = unsigned.replace(/,/g, "");
  else if (lastComma >= 0) normalizedNumber = unsigned.replace(/\./g, "").replace(",", ".");
  else if ((unsigned.match(/\./g) ?? []).length > 1) normalizedNumber = unsigned.replace(/\./g, "");
  const value = Number(normalizedNumber);
  if (!Number.isFinite(value) || value === 0) return null;
  return Math.round((negative ? -value : value) * 100) / 100;
}

export function parseStatementDate(input: string): string | null {
  const value = input.trim().slice(0, 10);
  let year: number; let month: number; let day: number;
  let match = value.match(/^(\d{4})[-/]([01]?\d)[-/]([0-3]?\d)$/);
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = value.match(/^([0-3]?\d)[-/]([01]?\d)[-/](\d{4})$/);
    if (!match) return null;
    day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function finalizeEntries(entries: Omit<StatementEntry, "id">[]): StatementEntry[] {
  const occurrences = new Map<string, number>();
  return entries.slice(0, MAX_ENTRIES).map((entry) => {
    const base = `${entry.sourceId ?? ""}|${entry.date}|${entry.amount.toFixed(2)}|${normalized(entry.description)}`;
    const occurrence = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occurrence);
    return { ...entry, id: `${base}|${occurrence}` };
  });
}

export function parseCsvStatement(text: string): StatementEntry[] {
  const clean = text.replace(/^\uFEFF/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const rows = parseCsvRows(clean, delimiterFor(firstLine));
  if (rows.length < 2) throw new Error("O CSV não possui lançamentos.");
  const headers = rows[0];
  const dateIndex = findColumn(headers, DATE_KEYS);
  const descriptionIndex = findColumn(headers, DESCRIPTION_KEYS);
  const amountIndex = findColumn(headers, AMOUNT_KEYS);
  const creditIndex = findColumn(headers, CREDIT_KEYS);
  const debitIndex = findColumn(headers, DEBIT_KEYS);
  const idIndex = findColumn(headers, ID_KEYS);
  if (dateIndex < 0 || descriptionIndex < 0 || (amountIndex < 0 && creditIndex < 0 && debitIndex < 0)) {
    throw new Error("Não reconhecemos as colunas de data, descrição e valor deste CSV.");
  }
  const entries: Omit<StatementEntry, "id">[] = [];
  for (const row of rows.slice(1)) {
    const date = parseStatementDate(row[dateIndex] ?? "");
    const description = (row[descriptionIndex] ?? "").trim().slice(0, 180);
    let amount = amountIndex >= 0 ? parseStatementMoney(row[amountIndex] ?? "") : null;
    if (amount === null && creditIndex >= 0) amount = parseStatementMoney(row[creditIndex] ?? "");
    if (amount === null && debitIndex >= 0) {
      const debit = parseStatementMoney(row[debitIndex] ?? "");
      amount = debit === null ? null : -Math.abs(debit);
    }
    if (!date || !description || amount === null) continue;
    entries.push({ date, description, amount: Math.abs(amount), type: amount > 0 ? "receita" : "despesa", sourceId: idIndex >= 0 ? (row[idIndex] ?? "").trim().slice(0, 100) || null : null });
  }
  if (!entries.length) throw new Error("Nenhum lançamento válido foi encontrado no CSV.");
  return finalizeEntries(entries);
}

const OFX_TAG_PATTERNS = {
  DTPOSTED: /<DTPOSTED>\s*([^<\r\n]+)/i,
  TRNAMT: /<TRNAMT>\s*([^<\r\n]+)/i,
  MEMO: /<MEMO>\s*([^<\r\n]+)/i,
  NAME: /<NAME>\s*([^<\r\n]+)/i,
  FITID: /<FITID>\s*([^<\r\n]+)/i,
} as const;

function ofxValue(block: string, tag: keyof typeof OFX_TAG_PATTERNS): string {
  return block.match(OFX_TAG_PATTERNS[tag])?.[1]?.trim() ?? "";
}

export function parseOfxStatement(text: string): StatementEntry[] {
  const blocks = text.match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>))/gi) ?? [];
  const entries: Omit<StatementEntry, "id">[] = [];
  for (const block of blocks) {
    const rawDate = ofxValue(block, "DTPOSTED").slice(0, 8);
    const date = rawDate.length === 8 ? parseStatementDate(`${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`) : null;
    const amount = parseStatementMoney(ofxValue(block, "TRNAMT"));
    const description = (ofxValue(block, "MEMO") || ofxValue(block, "NAME") || "Movimentação bancária").replace(/&amp;/gi, "&").slice(0, 180);
    if (!date || amount === null) continue;
    entries.push({ date, description, amount: Math.abs(amount), type: amount > 0 ? "receita" : "despesa", sourceId: ofxValue(block, "FITID").slice(0, 100) || null });
  }
  if (!entries.length) throw new Error("Nenhum lançamento válido foi encontrado no OFX.");
  return finalizeEntries(entries);
}

export function parseBankStatement(name: string, text: string): StatementEntry[] {
  const extension = name.toLocaleLowerCase("pt-BR").split(".").pop();
  if (extension === "ofx" || /<OFX>|<STMTTRN>/i.test(text)) return parseOfxStatement(text);
  if (extension === "csv" || extension === "txt") return parseCsvStatement(text);
  throw new Error("Formato não suportado. Exporte seu extrato em CSV ou OFX.");
}

export async function statementFingerprint(accountId: number, entry: StatementEntry): Promise<string> {
  const data = new TextEncoder().encode(`finflow:v1:${accountId}:${entry.id}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
