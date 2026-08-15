import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_ROUTES = new Set([
  "/login",
  "/cadastro",
  "/esqueci-senha",
  "/redefinir-senha",
  "/auth/callback",
  "/termos",
  "/privacidade",
  "/manifest.webmanifest",
  "/icon",
  "/sw.js",
]);

const AUTH_ENTRY_ROUTES = new Set(["/login", "/cadastro", "/esqueci-senha"]);

// Estas rotas não dependem da sessão. Liberá-las antes de criar o cliente
// evita uma validação remota de autenticação para documentos legais e
// recursos estáticos usados logo na primeira abertura do site/PWA.
const PUBLIC_PASSTHROUGH_ROUTES = new Set([
  "/auth/callback",
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
export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PASSTHROUGH_ROUTES.has(pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

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
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: { user } } = await supabase.auth.getUser();
  const isPublicRoute = PUBLIC_ROUTES.has(pathname);

  if (!user && !isPublicRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && AUTH_ENTRY_ROUTES.has(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
