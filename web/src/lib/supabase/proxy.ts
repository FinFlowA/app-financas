import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isMfaPending, MFA_CHALLENGE_ROUTE } from "@/lib/auth/mfa";
import { hardenAuthCookie } from "@/lib/auth/pkce-cookies";

const PUBLIC_ROUTES = new Set([
  "/login",
  "/cadastro",
  "/esqueci-senha",
  "/redefinir-senha",
  "/auth/callback",
  "/auth/oauth",
  "/termos",
  "/privacidade",
  "/manifest.webmanifest",
  "/icon",
  "/sw.js",
]);

const AUTH_ENTRY_ROUTES = new Set(["/login", "/cadastro", "/esqueci-senha"]);

function trustedAppUrl(pathname: string) {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const origin = new URL(configuredOrigin).origin;
  return new URL(pathname, origin);
}

// Estas rotas não dependem da sessão. Liberá-las antes de criar o cliente
// evita uma validação remota de autenticação para documentos legais e
// recursos estáticos usados logo na primeira abertura do site/PWA.
const PUBLIC_PASSTHROUGH_ROUTES = new Set([
  "/api/paddle/webhook",
  "/auth/callback",
  "/auth/oauth",
  "/redefinir-senha",
  "/termos",
  "/privacidade",
  "/manifest.webmanifest",
  "/icon",
  "/apple-icon",
  "/sw.js",
]);

/** Renova a sessão do Supabase a cada navegação e protege as rotas
 * autenticadas. Chamado pelo proxy.ts na raiz do projeto. */
export async function updateSession(request: NextRequest, requestHeaders = request.headers) {
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PASSTHROUGH_ROUTES.has(pathname)) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request: { headers: requestHeaders } });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, hardenAuthCookie(name, options)),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  if (!user && !isPublicRoute) {
    return NextResponse.redirect(trustedAppUrl("/login"));
  }

  if (user && AUTH_ENTRY_ROUTES.has(pathname)) {
    return NextResponse.redirect(trustedAppUrl("/"));
  }

  // Verificação em duas etapas: quem ativou MFA e ainda não digitou o código
  // nesta sessão só acessa a tela do código (o banco também recusa os dados).
  if (user) {
    const mfaPending = await isMfaPending(supabase, user);
    const target = mfaPending && pathname !== MFA_CHALLENGE_ROUTE
      ? MFA_CHALLENGE_ROUTE
      : !mfaPending && pathname === MFA_CHALLENGE_ROUTE ? "/" : null;
    if (target) {
      const redirect = NextResponse.redirect(trustedAppUrl(target));
      supabaseResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
      return redirect;
    }
  }

  const googleNeedsPassword = user?.app_metadata?.provider === "google"
    && user.user_metadata?.senha_definida !== true;
  if (googleNeedsPassword && pathname !== "/definir-senha") {
    return NextResponse.redirect(trustedAppUrl("/definir-senha"));
  }

  return supabaseResponse;
}
