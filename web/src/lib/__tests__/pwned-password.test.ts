import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { checkPwnedPassword } = await import("../auth/pwned-password");

function rangeResponse(lines: string[], ok = true) {
  return vi.fn(async () => new Response(lines.join("\r\n"), { status: ok ? 200 : 503 }));
}

function suffixOf(password: string) {
  return createHash("sha1").update(password, "utf8").digest("hex").toUpperCase().slice(5);
}

describe("checagem de senha vazada (HaveIBeenPwned k-anonymity)", () => {
  it("envia só o prefixo de 5 caracteres do SHA-1, nunca a senha", async () => {
    const fetchMock = rangeResponse([]);
    await checkPwnedPassword("Senha#123", fetchMock as unknown as typeof fetch);
    const url = String((fetchMock.mock.calls[0] as unknown[])[0]);
    const prefix = createHash("sha1").update("Senha#123").digest("hex").toUpperCase().slice(0, 5);
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${prefix}`);
    expect(url).not.toContain("Senha");
  });

  it("detecta senha presente na lista", async () => {
    const fetchMock = rangeResponse(["0000000000000000000000000000000000A:3", `${suffixOf("Senha#123")}:42`]);
    expect(await checkPwnedPassword("Senha#123", fetchMock as unknown as typeof fetch)).toBe("pwned");
  });

  it("ignora linhas de preenchimento (contagem 0)", async () => {
    const fetchMock = rangeResponse([`${suffixOf("Senha#123")}:0`]);
    expect(await checkPwnedPassword("Senha#123", fetchMock as unknown as typeof fetch)).toBe("safe");
  });

  it("não bloqueia quando a API falha ou está fora do ar", async () => {
    expect(await checkPwnedPassword("Senha#123", rangeResponse([], false) as unknown as typeof fetch)).toBe("unknown");
    const failing = vi.fn(async () => { throw new Error("offline"); });
    expect(await checkPwnedPassword("Senha#123", failing as unknown as typeof fetch)).toBe("unknown");
  });
});
