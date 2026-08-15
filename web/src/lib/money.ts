/** Converte `1234,56`, `1.234,56` ou `1234.56` para um valor em reais. */
export function parseMoney(value: FormDataEntryValue | string | number | null | undefined): number {
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value * 100) / 100 : Number.NaN;
  const raw = String(value ?? "").trim().replace(/\s|R\$/gi, "");
  if (!raw) return Number.NaN;

  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;

  if (lastComma > lastDot) {
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else if (lastDot > lastComma && lastComma >= 0) {
    normalized = raw.replace(/,/g, "");
  } else if (lastComma >= 0) {
    normalized = raw.replace(",", ".");
  } else if ((raw.match(/\./g) ?? []).length > 1) {
    const pieces = raw.split(".");
    const decimals = pieces.pop();
    normalized = `${pieces.join("")}.${decimals}`;
  }

  const parsed = Number(normalized.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : Number.NaN;
}

export function moneyIsPositive(value: number): boolean {
  return Number.isFinite(value) && value > 0 && value <= 999_999_999_999.99;
}
