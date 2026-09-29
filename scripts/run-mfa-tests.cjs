// Testes da verificação em duas etapas do app (lib/mfa.ts).
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const output = ts.transpileModule(fs.readFileSync(path.join(root, "lib", "mfa.ts"), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const modulePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "finflow-mfa-")), "mfa.cjs");
fs.writeFileSync(modulePath, output);
const mfa = require(modulePath);

const token = (claims) => `cabecalho.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.assinatura`;
const comMfa = { factors: [{ status: "verified" }] };

// Decodificação local do token (sem atob, compatível com o APK antigo).
assert.equal(mfa.sessionAssuranceLevel(token({ aal: "aal2", nome: "João Ção 🔐" })), "aal2");
assert.equal(mfa.sessionAssuranceLevel(token({ aal: "aal1" })), "aal1");
assert.equal(mfa.sessionAssuranceLevel(token({})), null);
assert.equal(mfa.sessionAssuranceLevel("token-ilegivel"), null);
assert.equal(mfa.sessionAssuranceLevel(undefined), null);

// Sessão retida na tela do código só quando há fator verificado sem AAL2.
assert.equal(mfa.sessaoAguardandoMfa({ user: comMfa, access_token: token({ aal: "aal1" }) }), true);
assert.equal(mfa.sessaoAguardandoMfa({ user: comMfa, access_token: token({}) }), true);
assert.equal(mfa.sessaoAguardandoMfa({ user: comMfa, access_token: token({ aal: "aal2" }) }), false);
assert.equal(mfa.sessaoAguardandoMfa({ user: { factors: [] }, access_token: token({ aal: "aal1" }) }), false);
assert.equal(mfa.sessaoAguardandoMfa({ user: { factors: [{ status: "unverified" }] }, access_token: token({ aal: "aal1" }) }), false);
assert.equal(mfa.sessaoAguardandoMfa(null), false);

assert.equal(mfa.normalizeTotpCode("12 34 56"), "123456");
assert.equal(mfa.normalizeTotpCode("12345"), null);

function fakeClient({ totp = [{ id: "fator-1" }], verify = () => ({ error: null }) } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      mfa: {
        listFactors: async () => ({ data: { totp, all: totp }, error: null }),
        challengeAndVerify: async ({ factorId, code }) => {
          calls.push(factorId);
          return verify(factorId, code);
        },
      },
    },
  };
}

// Reautenticação: a reavaliação da sessão só roda ao encerrar um fluxo ativo.
let reavaliacoes = 0;
const remover = mfa.registrarReavaliacaoMfa(() => { reavaliacoes += 1; });
mfa.definirReautenticacao(false);
assert.equal(reavaliacoes, 0, "encerrar sem fluxo ativo não reavalia");
mfa.definirReautenticacao(true);
assert.equal(mfa.reautenticacaoAtiva(), true);
mfa.definirReautenticacao(false);
assert.equal(mfa.reautenticacaoAtiva(), false);
assert.equal(reavaliacoes, 1, "desistir ou concluir reavalia a sessão");
remover();
mfa.definirReautenticacao(true);
mfa.definirReautenticacao(false);
assert.equal(reavaliacoes, 1, "callback removido não é chamado");

(async () => {
  const doisAutenticadores = fakeClient({
    totp: [{ id: "celular" }, { id: "reserva" }],
    verify: (factorId) => ({ error: factorId === "reserva" ? null : { status: 422 } }),
  });
  assert.equal(await mfa.verifyTotpCode(doisAutenticadores, "123456"), "ok");
  assert.deepEqual(doisAutenticadores.calls, ["celular", "reserva"]);

  const semChamada = fakeClient();
  assert.equal(await mfa.verifyTotpCode(semChamada, "12"), "invalid");
  assert.equal(semChamada.calls.length, 0, "código incompleto não chega ao servidor");
  assert.equal(await mfa.verifyTotpCode(fakeClient({ verify: () => ({ error: { status: 422 } }) }), "123456"), "invalid");
  assert.equal(await mfa.verifyTotpCode(fakeClient({ verify: () => ({ error: { status: 429 } }) }), "123456"), "rate_limited");
  assert.equal(await mfa.verifyTotpCode(fakeClient({ totp: [] }), "123456"), "no_factor");

  console.log("MFA tests passed.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
