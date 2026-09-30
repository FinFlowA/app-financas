import { describe, expect, it, vi } from "vitest";
import { hasVerifiedFactor, isMfaPending, normalizeTotpCode, verifyTotpCode } from "../auth/mfa";

type VerifyResult = { error: { status?: number } | null };

function fakeClient({
  currentLevel = "aal1",
  totp = [{ id: "fator-1" }],
  verify = () => ({ error: null }),
}: {
  currentLevel?: string | null;
  totp?: { id: string }[];
  verify?: (factorId: string, code: string) => VerifyResult;
} = {}) {
  const challengeAndVerify = vi.fn(async ({ factorId, code }: { factorId: string; code: string }) => verify(factorId, code));
  const client = {
    auth: {
      mfa: {
        getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel }, error: null })),
        listFactors: vi.fn(async () => ({ data: { totp, all: totp }, error: null })),
        challengeAndVerify,
      },
    },
  };
  return { client: client as never, challengeAndVerify };
}

const verifiedUser = { factors: [{ status: "verified" }] } as never;
const userWithoutMfa = { factors: [] } as never;

describe("verificação em duas etapas", () => {
  it("só considera MFA ativo com fator verificado", () => {
    expect(hasVerifiedFactor(verifiedUser)).toBe(true);
    expect(hasVerifiedFactor(userWithoutMfa)).toBe(false);
    expect(hasVerifiedFactor({ factors: [{ status: "unverified" }] } as never)).toBe(false);
    expect(hasVerifiedFactor(null)).toBe(false);
  });

  it("marca como pendente só quem tem MFA e ainda não digitou o código", async () => {
    expect(await isMfaPending(fakeClient({ currentLevel: "aal1" }).client, verifiedUser)).toBe(true);
    expect(await isMfaPending(fakeClient({ currentLevel: "aal2" }).client, verifiedUser)).toBe(false);
    expect(await isMfaPending(fakeClient({ currentLevel: "aal1" }).client, userWithoutMfa)).toBe(false);
  });

  it("aceita só códigos de 6 dígitos", () => {
    expect(normalizeTotpCode("123 456")).toBe("123456");
    expect(normalizeTotpCode("12345")).toBeNull();
    expect(normalizeTotpCode("1234567")).toBeNull();
    expect(normalizeTotpCode("abcdef")).toBeNull();
  });

  it("confere o código em cada autenticador até um aceitar", async () => {
    const { client, challengeAndVerify } = fakeClient({
      totp: [{ id: "celular" }, { id: "reserva" }],
      verify: (factorId) => ({ error: factorId === "reserva" ? null : { status: 422 } }),
    });
    expect(await verifyTotpCode(client, "123456")).toBe("ok");
    expect(challengeAndVerify).toHaveBeenCalledTimes(2);
  });

  it("recusa código errado, formato inválido, excesso de tentativas e conta sem autenticador", async () => {
    expect(await verifyTotpCode(fakeClient({ verify: () => ({ error: { status: 422 } }) }).client, "123456")).toBe("invalid");
    const { client, challengeAndVerify } = fakeClient();
    expect(await verifyTotpCode(client, "12")).toBe("invalid");
    expect(challengeAndVerify).not.toHaveBeenCalled();
    expect(await verifyTotpCode(fakeClient({ verify: () => ({ error: { status: 429 } }) }).client, "123456")).toBe("rate_limited");
    expect(await verifyTotpCode(fakeClient({ totp: [] }).client, "123456")).toBe("no_factor");
  });
});
