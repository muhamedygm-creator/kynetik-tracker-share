import { createHash, randomBytes } from "node:crypto";
import type { Page } from "@playwright/test";

export const env = {
  supabase: process.env.E2E_SUPABASE_URL ?? "",
  key: process.env.E2E_SERVICE_ROLE_KEY ?? "",
  owner: process.env.E2E_OWNER_EMAIL ?? "",
};
export const configured = !!(env.supabase && env.key && env.owner);

const headers = () => ({ apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json" });

/** Service-role REST call (test setup only). */
export async function rest(path: string, init: RequestInit = {}) {
  const r = await fetch(`${env.supabase}/rest/v1/${path}`, { ...init, headers: { ...headers(), Prefer: "return=representation", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${path}: ${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
}

/** Sign in without email: generate a magic-link token with the admin API and open /auth/confirm. */
export async function signIn(page: Page, email = env.owner, next = "/board") {
  const r = await fetch(`${env.supabase}/auth/v1/admin/generate_link`, { method: "POST", headers: headers(), body: JSON.stringify({ type: "magiclink", email }) });
  const link = await r.json();
  const hash = link.hashed_token ?? link.properties?.hashed_token;
  await page.goto(`/auth/confirm?token_hash=${hash}&type=magiclink&next=${encodeURIComponent(next)}`);
  await page.getByRole("button", { name: "Continue to the Build Tracker" }).click();
  await page.waitForURL(new RegExp(next.replace(/\//g, "\\/")));
}

/** Create a display link directly (the token is shown once in the UI, so tests mint their own). */
export async function makeDisplay(departmentId: string) {
  const token = randomBytes(24).toString("base64url");
  await rest("displays", { method: "POST", body: JSON.stringify({ name: `e2e ${Date.now()}`, token_hash: createHash("sha256").update(token).digest("hex"), department_id: departmentId, leaderboard_mode: "off" }) });
  return token;
}
