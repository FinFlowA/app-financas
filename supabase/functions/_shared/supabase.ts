import { createClient } from "npm:@supabase/supabase-js@2.111.0";

function required(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing server secret: ${name}`);
  return value;
}

export function adminClient() {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function authenticatedClient(req: Request) {
  const authorization = req.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) throw new Error("UNAUTHORIZED");

  return createClient(required("SUPABASE_URL"), required("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type UserWithFactors = { factors?: { status?: string }[] | null };

/** Lê o claim `aal` de um token cuja assinatura o Auth já validou (getUser). */
function tokenAssuranceLevel(authorization: string): string | null {
  const payload = authorization.replace(/^Bearer\s+/i, "").split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const claims = JSON.parse(atob(padded));
    return typeof claims?.aal === "string" ? claims.aal : null;
  } catch {
    return null;
  }
}

/**
 * Quem ativou a verificação em duas etapas só age depois de digitar o código
 * (sessão AAL2). As Edge Functions agem pelo usuário com a service_role, que
 * não passa pela checagem do banco (finflow_guard.enforce_mfa), então
 * precisam conferir aqui. Chame só depois de getUser() ter validado o token.
 */
export function mfaSatisfied(user: UserWithFactors, authorization: string): boolean {
  const hasVerifiedFactor = (user.factors ?? []).some((factor) => factor?.status === "verified");
  return !hasVerifiedFactor || tokenAssuranceLevel(authorization) === "aal2";
}

export async function authenticatedUser(req: Request) {
  const client = authenticatedClient(req);
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("UNAUTHORIZED");
  if (!mfaSatisfied(data.user, req.headers.get("Authorization") ?? "")) throw new Error("MFA_REQUIRED");
  return data.user;
}

export function serverSecret(name: string) {
  return required(name);
}
