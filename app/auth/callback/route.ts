import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Return from Microsoft sign-in (OAuth, PKCE). The code is exchanged at once: unlike an emailed link it is
 * never pre-opened by a mail scanner, and it only works in the browser that started the sign-in.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const nextParam = searchParams.get("next") ?? "/board";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/board";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL("/login?error=microsoft", origin));
}
