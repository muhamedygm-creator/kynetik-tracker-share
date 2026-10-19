import "server-only";
import { revalidatePath } from "next/cache";
import { MSG } from "@/domain/messages";
import { localToUtc, type LocalDT } from "@/domain/time";
import { requireViewer, type Role } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { createClient } from "@/lib/supabase/server";

/** Shared plumbing for console server actions: role check, world, time edges, error mapping, versioned writes. */
export type ActionResult = { ok?: string; error?: string; id?: string };

/** A refusal meant for the user, shown as-is. */
export class UserError extends Error {}

export type DB = Awaited<ReturnType<typeof createClient>>;

export async function context(roles: Role[] = ["owner", "supervisor"]) {
  const viewer = await requireViewer(roles);
  const supabase = await createClient();
  const world = await loadWorld(viewer);
  const tz = world.settings.calendar.timezone;
  const U = (x: LocalDT | null | undefined) => (x ? localToUtc(x, tz) : null);
  return { viewer, supabase, world, U };
}
export type Ctx = Awaited<ReturnType<typeof context>>;

export async function run(fn: () => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    const r = await fn();
    revalidatePath("/", "layout");
    return r ?? { ok: "Saved." };
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    if (e && typeof e === "object" && "digest" in e) throw e; // redirect()
    const msg = (e as Error)?.message ?? "";
    if (/row-level security|permission denied/i.test(msg)) return { error: "Read-only access. Ask the Owner for Supervisor access to make changes." };
    if (/projects_serial_key/.test(msg)) return { error: "Another build already uses that serial." };
    if (/queue_tasks_person_id_position_key/.test(msg)) return { error: "Someone else reordered this queue at the same moment — try again." };
    if (/departments_key_key/.test(msg)) return { error: "Another department already uses that key." };
    return { error: msg || "Couldn't save. Check the connection and try again." };
  }
}

/** Versioned row update: zero rows → someone else saved first. */
export async function updateRow(db: DB, table: string, id: string, version: number | undefined, patch: Record<string, unknown>) {
  let q = db.from(table).update(patch).eq("id", id);
  if (version !== undefined) q = q.eq("version", version);
  const { data, error } = await q.select("id");
  if (error) throw new Error(error.message);
  if (!data?.length) throw new UserError(MSG.staleWrite);
}

export const formObj = (f: FormData) => Object.fromEntries([...f.entries()].filter(([, v]) => typeof v === "string").map(([k, v]) => [k, String(v)]));
