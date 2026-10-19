"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isCompanyEmail } from "@/lib/company";
import { env } from "@/lib/env";

export type LoginState = { ok?: boolean; error?: string; email?: string };

export async function sendMagicLink(_: LoginState, form: FormData): Promise<LoginState> {
  const parsed = z.email().safeParse(String(form.get("email") ?? "").trim());
  if (!parsed.success) return { error: "Enter a valid email address." };
  const next = String(form.get("next") ?? "/board");
  // Outside addresses can never get in, so no email is sent; the answer stays the same (no probing).
  if (!isCompanyEmail(parsed.data)) return { ok: true, email: parsed.data };
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data,
    options: {
      shouldCreateUser: false, // invite-only (D6)
      emailRedirectTo: `${env.siteUrl()}/auth/confirm?next=${encodeURIComponent(next.startsWith("/") ? next : "/board")}`,
    },
  });
  // Same answer whether or not the address is invited, so the form can't be used to probe for accounts.
  if (error && !/signups not allowed|user not found/i.test(error.message)) {
    return { error: "Couldn't send the link right now. Try again in a minute." };
  }
  return { ok: true, email: parsed.data };
}

/**
 * Sign in with Microsoft (Entra ID, the company's Microsoft 365 accounts). Still invite-only: a Microsoft
 * account with no invitation gets an account but no profile, so it lands on /no-access (D6).
 */
export async function signInWithMicrosoft(form: FormData): Promise<void> {
  const nextParam = String(form.get("next") ?? "/board");
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/board";
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const origin = host ? `${(h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https")).split(",")[0]}://${host.split(",")[0]}` : env.siteUrl();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: { scopes: "email openid profile", redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error || !data.url) redirect("/login?error=microsoft");
  redirect(data.url);
}

/** Whether Microsoft sign-in is switched on in Supabase (so the button never leads to an error page). */
export async function microsoftEnabled(): Promise<boolean> {
  try {
    const r = await fetch(`${env.supabaseUrl()}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey() }, next: { revalidate: 60 } });
    if (!r.ok) return false;
    const s = (await r.json()) as { external?: Record<string, boolean> };
    return !!s.external?.azure;
  } catch {
    return false;
  }
}
