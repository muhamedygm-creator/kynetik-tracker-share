import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const TYPES: EmailOtpType[] = ["email", "magiclink", "invite", "signup", "recovery", "email_change"];

/**
 * Uses the one-time sign-in token. POST only: the email link opens /auth/confirm, which asks for a tap
 * first, so email scanners that pre-open links (Outlook Safe Links and the like) can't use the token up.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "") as EmailOtpType;
  const code = String(form.get("code") ?? "");
  const nextParam = String(form.get("next") ?? "/board");
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/board";

  const supabase = await createClient();
  let ok = false;
  if (tokenHash && TYPES.includes(type)) ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  else if (code) ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  return NextResponse.redirect(new URL(ok ? next : "/login?error=link", request.nextUrl.origin), 303);
}
