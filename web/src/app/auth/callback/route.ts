import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import {
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RECOVERY_COOKIE_NAME,
} from "@/lib/auth/constants";
import { createClient } from "@/lib/supabase/server";

type AuthFlow = "signup" | "recovery" | "email-change";

function safeFlow(value: string | null): AuthFlow | null {
  return value === "signup" || value === "recovery" || value === "email-change" ? value : null;
}

function errorRedirect(request: NextRequest, flow: AuthFlow | null): NextResponse {
  const url = new URL(flow === "recovery" ? "/esqueci-senha" : "/login", request.url);
  url.searchParams.set(flow === "recovery" ? "link_invalido" : "erro_confirmacao", "1");
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const flow = safeFlow(request.nextUrl.searchParams.get("flow"));
  if (!flow) return errorRedirect(request, null);

  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  if (!code && !tokenHash) return errorRedirect(request, flow);

  const supabase = await createClient();
  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: flow === "email-change" ? "email_change" : flow,
      });

  if (result.error) return errorRedirect(request, flow);

  if (flow === "recovery") {
    const cookieStore = await cookies();
    cookieStore.set(RECOVERY_COOKIE_NAME, "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
    });
    return NextResponse.redirect(new URL("/redefinir-senha", request.url));
  }

  return NextResponse.redirect(new URL(flow === "email-change" ? "/configuracoes?email_atualizado=1" : "/", request.url));
}
