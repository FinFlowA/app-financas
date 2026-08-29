import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RECOVERY_COOKIE_NAME,
} from "@/lib/auth/constants";
import { getAppOrigin } from "@/lib/auth/origin";
import { createClient } from "@/lib/supabase/server";

type AuthFlow = "signup" | "recovery" | "email-change" | "oauth";

function safeFlow(value: string | null): AuthFlow | null {
  return value === "signup" || value === "recovery" || value === "email-change" || value === "oauth"
    ? value
    : null;
}

function errorRedirect(origin: string, flow: AuthFlow | null): NextResponse {
  const url = new URL(flow === "recovery" ? "/esqueci-senha" : "/login", origin);
  const param =
    flow === "recovery" ? "link_invalido" : flow === "oauth" ? "erro_oauth" : "erro_confirmacao";
  url.searchParams.set(param, "1");
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const origin = await getAppOrigin();
  const flow = safeFlow(request.nextUrl.searchParams.get("flow"));
  if (!flow) return errorRedirect(origin, null);

  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!code && !tokenHash) return errorRedirect(origin, flow);
  if (flow === "oauth" && !code) return errorRedirect(origin, flow);

  const supabase = await createClient();
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: flow === "email-change" ? "email_change" : (flow as "signup" | "recovery"),
      });

  if (result.error) return errorRedirect(origin, flow);

  if (flow === "oauth") {
    // getUser valida o JWT no servidor de autenticação; não confie apenas na
    // sessão/cookie retornada pelo navegador para liberar dados financeiros.
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user?.email || !userData.user.email_confirmed_at) {
      await supabase.auth.signOut({ scope: "local" });
      return errorRedirect(origin, flow);
    }

    // Primeiro acesso via Google: nunca passou pelo cadastro por senha, que é
    // quem normalmente liga essa flag. Sem isso, quem entra pelo Google nunca
    // veria o tutorial guiado.
    if (userData.user.user_metadata?.tutorial_pendente === undefined) {
      await supabase.auth.updateUser({
        data: { ...userData.user.user_metadata, tutorial_pendente: true },
      });
    }
  }

  if (flow === "recovery") {
    const cookieStore = await cookies();
    cookieStore.set(RECOVERY_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
    });
    return NextResponse.redirect(new URL("/redefinir-senha", origin));
  }

  return NextResponse.redirect(new URL(flow === "email-change" ? "/configuracoes?email_atualizado=1" : "/", origin));
}
