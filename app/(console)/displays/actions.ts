"use server";
import { z } from "zod";
import { UserError, context, formObj, run, updateRow, type ActionResult } from "@/lib/actions/common";
import { headers } from "next/headers";
import { env } from "@/lib/env";
import { hashDisplayToken, newDisplayToken } from "@/lib/display/token";

const DisplayForm = z.object({
  id: z.string().optional(),
  version: z.coerce.number().optional(),
  name: z.string().trim().min(1, "Name the display, e.g. \"Paint bay TV\"."),
  departmentId: z.string().min(1, "Pick the department this TV shows."),
  leaderboardMode: z.enum(["side", "rotate", "off"]),
  confetti: z.string().optional(),
});

/**
 * The TV link is built from the address the Owner is using right now (production, a preview or
 * localhost), so it always opens the same app. NEXT_PUBLIC_SITE_URL is only the fallback.
 */
async function siteOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return env.siteUrl().replace(/\/+$/, "");
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return `${proto.split(",")[0]}://${host.split(",")[0]}`;
}

/** Default rotation for an employee display (seconds per screen). */
const SCREENS = [
  { type: "employeeDay", seconds: 40, enabled: true },
  { type: "leaderboard", seconds: 20, enabled: true },
];

export async function saveDisplay(_: ActionResult & { link?: string }, form: FormData): Promise<ActionResult & { link?: string }> {
  let link: string | undefined;
  const r = await run(async () => {
    const c = await context(["owner"]);
    const parsed = DisplayForm.safeParse(formObj(form));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const f = parsed.data;
    const row = { name: f.name, department_id: f.departmentId, leaderboard_mode: f.leaderboardMode, confetti: f.confetti === "on" };
    if (f.id) {
      await updateRow(c.supabase, "displays", f.id, f.version, row);
      return { ok: "Display saved." };
    }
    const token = newDisplayToken();
    const { error } = await c.supabase.from("displays").insert({ ...row, token_hash: hashDisplayToken(token), screens: SCREENS, created_by: c.viewer.userId });
    if (error) throw new Error(error.message);
    link = `${await siteOrigin()}/display/${token}`;
    return { ok: "Display created. Copy the link now: it is shown only once." };
  });
  return { ...r, link };
}

export async function revokeDisplay(id: string, version: number, revoke: boolean): Promise<ActionResult> {
  return run(async () => {
    const c = await context(["owner"]);
    await updateRow(c.supabase, "displays", id, version, { revoked_at: revoke ? new Date().toISOString() : null });
    return { ok: revoke ? "Link revoked. The TV stops updating within seconds." : "Link restored." };
  });
}

export async function deleteDisplay(id: string, version: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context(["owner"]);
    const { data, error } = await c.supabase.from("displays").delete().eq("id", id).eq("version", version).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserError("Someone else changed this — reload and try again.");
    return { ok: "Display deleted." };
  });
}

/** A new secret for an existing TV (lost link). The old link stops working at the TV's next refresh. */
export async function newDisplayLink(id: string, version: number): Promise<ActionResult & { link?: string }> {
  let link: string | undefined;
  const r = await run(async () => {
    const c = await context(["owner"]);
    const token = newDisplayToken();
    await updateRow(c.supabase, "displays", id, version, { token_hash: hashDisplayToken(token), revoked_at: null });
    link = `${await siteOrigin()}/display/${token}`;
    return { ok: "New link made. The old link no longer works. Copy this one now: it is shown only once." };
  });
  return { ...r, link };
}
