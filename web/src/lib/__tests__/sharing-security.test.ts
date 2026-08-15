import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "../supabase/migrations/20260815000200_secure_resource_sharing.sql"),
  "utf8",
);
const accountActions = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/contas/actions.ts"),
  "utf8",
);
const accountManager = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/contas/account-manager.tsx"),
  "utf8",
);
const goalActions = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/objetivos/actions.ts"),
  "utf8",
);
const goalManager = readFileSync(
  resolve(process.cwd(), "src/app/(dashboard)/objetivos/objetivos-manager.tsx"),
  "utf8",
);

describe("compartilhamento financeiro seguro", () => {
  it("exige titular, parceria aceita e versão otimista", () => {
    expect(migration).toContain("caller uuid := auth.uid()");
    expect(migration).toMatch(/c\.id = p_resource_id and c\.user_id = caller/);
    expect(migration).toMatch(/g\.id = p_resource_id and g\.user_id = caller/);
    expect(migration).toContain("p.status = 'aceito'");
    expect(migration).toContain("current_version is distinct from p_expected_version");
    expect(migration).toContain("FINFLOW_RESOURCE_ARCHIVED");
  });

  it("é idempotente, bloqueia corridas e não concede acesso anônimo", () => {
    expect(migration).toContain("private.offline_action_receipts");
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("for share");
    expect(migration).toContain("for update");
    expect(migration).toMatch(/revoke all on function public\.set_financial_resource_sharing[\s\S]*?from public, anon, authenticated/);
    expect(migration).toMatch(/grant execute on function public\.set_financial_resource_sharing[\s\S]*?to authenticated/);
    expect(migration).not.toContain("service_role");
  });

  it("impõe uma única parceria aceita com locks ordenados por participante", () => {
    expect(migration).toContain("FINFLOW_DUPLICATE_ACCEPTED_PARTNERSHIP");
    expect(migration).toContain("finflow_lock_participants");
    expect(migration).toMatch(/p_first::text <= p_second::text/);
    expect(migration).toContain("FINFLOW_PARTNERSHIP_ALREADY_ACTIVE");
    expect(migration).toMatch(/before insert or update of status, solicitante_id, convidado_id/i);
  });

  it("mantém o update legado, mas valida e privatiza recursos arquivados atomicamente", () => {
    expect(migration).toContain("finflow_enforce_resource_sharing");
    expect(migration).toContain("FINFLOW_EXACTLY_ONE_ACCEPTED_PARTNERSHIP_REQUIRED");
    expect(migration).toContain("new.compartilhado := false");
    expect(migration).toMatch(/contas_partner_select[\s\S]*?not coalesce\(arquivado, false\)/);
    expect(migration).toMatch(/caixinhas_partner_update[\s\S]*?not coalesce\(arquivado, false\)/);
    expect(migration).not.toMatch(/revoke\s+update\s*\([^)]*compartilhado/i);
  });

  it("usa o advisory lock canônico antes do lock da parceria e do recurso", () => {
    const canonical = migration.indexOf("'finflow:partnership:' || partnership_id::text");
    const lockedPartnership = migration.indexOf("where p.id = partnership_id", canonical);
    const lockedResource = migration.indexOf("where c.id = p_resource_id", lockedPartnership);
    expect(canonical).toBeGreaterThan(0);
    expect(lockedPartnership).toBeGreaterThan(canonical);
    expect(lockedResource).toBeGreaterThan(lockedPartnership);
  });

  it("não confia no formulário para descompartilhar antes de arquivar", () => {
    expect(accountActions).not.toContain('formString(formData, "was_shared")');
    expect(goalActions).not.toContain('formString(formData, "was_shared")');
    expect(accountManager).not.toContain('name="was_shared"');
    expect(goalManager).not.toContain('name="was_shared"');
  });

  it("renova a chave idempotente do compartilhamento de objetivo após a versão mudar", () => {
    expect(goalManager).toContain("sharing-${objetivo.id}-${objetivo.version}-${objetivo.compartilhado}");
  });
});
