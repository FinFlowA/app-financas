import { NextResponse, type NextRequest } from "next/server";
import { callbackUrl, getAppOrigin } from "@/lib/auth/origin";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("provider") !== "google") {
    return NextResponse.redirect(new URL("/login?erro_oauth=1", await getAppOrigin()), 302);
  }

  const origin = await getAppOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: callbackUrl(origin, "oauth"),
    },
  });

  if (error || !data.url) {
    return NextResponse.redirect(new URL("/login?erro_oauth=1", origin), 302);
  }
  return NextResponse.redirect(data.url, 302);
}
