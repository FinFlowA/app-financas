const BRAZIL_COUNTRY_CODE = "55";
const BRAZIL_MOBILE_REGEX = /^[1-9]{2}9\d{8}$/;

export function telefoneBrasilE164(value: string): string | null {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith(BRAZIL_COUNTRY_CODE) && digits.length === 13) {
    digits = digits.slice(BRAZIL_COUNTRY_CODE.length);
  }

  if (!BRAZIL_MOBILE_REGEX.test(digits)) return null;
  return `+${BRAZIL_COUNTRY_CODE}${digits}`;
}

export function formatarTelefoneBrasil(value: string): string {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith(BRAZIL_COUNTRY_CODE) && digits.length >= 12) {
    digits = digits.slice(BRAZIL_COUNTRY_CODE.length);
  }
  digits = digits.slice(0, 11);

  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) {
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

export function telefoneMascarado(value: string): string {
  const formatted = formatarTelefoneBrasil(value);
  const digits = formatted.replace(/\D/g, "");
  if (digits.length !== 11) return formatted;
  return `(${digits.slice(0, 2)}) *****-${digits.slice(-4)}`;
}
