/* eslint-disable security/detect-object-injection -- só índices numéricos internos do SHA-1, nunca chaves vindas do usuário */

/**
 * Verificação de senha vazada no HaveIBeenPwned (modelo k-anonymity).
 *
 * Substitui a "Leaked password protection" da Supabase, que só existe no
 * plano Pro. Só os 5 primeiros caracteres do SHA-1 da senha saem do aparelho;
 * a lista devolvida é comparada aqui, então nem a senha nem o hash completo
 * são enviados. Se a API estiver indisponível o resultado é "unknown" e o
 * fluxo segue: falha de terceiro não pode impedir alguém de trocar a senha.
 *
 * Roda no cliente e pode ser contornada chamando a API de Auth direto, mas
 * isso só enfraqueceria a conta de quem contorna.
 */

export const PWNED_PASSWORD_MESSAGE =
  "Esta senha já apareceu em vazamentos de dados públicos e pode ser descoberta por invasores. Escolha outra senha.";

export type PwnedPasswordStatus = "safe" | "pwned" | "unknown";

const RANGE_URL = "https://api.pwnedpasswords.com/range/";
const TIMEOUT_MS = 4000;

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code < 0x10000) {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return bytes;
}

/**
 * SHA-1 em JavaScript puro: o Hermes não tem crypto.subtle e o APK antigo
 * não inclui o expo-crypto. Usado apenas para o prefixo do k-anonymity,
 * nunca para guardar senha.
 */
export function sha1Hex(text: string): string {
  const bytes = utf8Bytes(text);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  bytes.push(
    (high >>> 24) & 0xff, (high >>> 16) & 0xff, (high >>> 8) & 0xff, high & 0xff,
    (bitLength >>> 24) & 0xff, (bitLength >>> 16) & 0xff, (bitLength >>> 8) & 0xff, bitLength & 0xff,
  );

  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;
  const words = new Array<number>(80);

  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const at = offset + i * 4;
      words[i] = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3];
    }
    for (let i = 16; i < 80; i++) {
      const mixed = words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16];
      words[i] = (mixed << 1) | (mixed >>> 31);
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    for (let i = 0; i < 80; i++) {
      let f: number;
      let k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + words[i]) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }
    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return [h0, h1, h2, h3, h4].map((value) => (value >>> 0).toString(16).padStart(8, "0")).join("");
}

export async function checkPwnedPassword(
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PwnedPasswordStatus> {
  const hash = sha1Hex(password).toUpperCase();
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timer = controller ? setTimeout(() => controller.abort(), TIMEOUT_MS) : null;

  try {
    // Add-Padding faz a resposta ter tamanho parecido para qualquer prefixo;
    // as linhas de preenchimento vêm com contagem 0.
    const response = await fetchImpl(`${RANGE_URL}${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: controller?.signal,
    });
    if (!response.ok) return "unknown";
    const body = await response.text();
    for (const line of body.split("\n")) {
      const [candidate, count] = line.trim().split(":");
      if (candidate === suffix && Number(count) > 0) return "pwned";
    }
    return "safe";
  } catch {
    return "unknown";
  } finally {
    if (timer) clearTimeout(timer);
  }
}
