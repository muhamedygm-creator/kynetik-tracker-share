"use server";
import { z } from "zod";
import { GamificationSettings } from "@/domain/settings";
import { UserError, context, formObj, run, updateRow, type ActionResult } from "@/lib/actions/common";

const DeptForm = z.object({
  id: z.string().optional(),
  version: z.coerce.number().optional(),
  name: z.string().trim().min(1, "A department needs a name."),
  colour: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Pick a colour."),
  emoji: z.string().trim().max(16),
  sort: z.coerce.number().int(),
});

const keyFrom = (name: string) =>
  name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^(\d)/, "d$1") || "dept";

export async function saveDepartment(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const parsed = DeptForm.safeParse(formObj(form));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const f = parsed.data;
    const row = { name: f.name, colour: f.colour, emoji: f.emoji, sort: f.sort };
    if (f.id) await updateRow(c.supabase, "departments", f.id, f.version, row);
    else {
      let key = keyFrom(f.name);
      if (c.world.departments.some((d) => d.key === key)) key = `${key}-${c.world.departments.length + 1}`;
      const { error } = await c.supabase.from("departments").insert({ ...row, key });
      if (error) throw new Error(error.message);
    }
    return { ok: "Department saved." };
  });
}

/** Deleting a department leaves its people "unassigned" and its displays without a department. */
export async function deleteDepartment(id: string, version: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const { data, error } = await c.supabase.from("departments").delete().eq("id", id).eq("version", version).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserError("Someone else changed this — reload and try again.");
    return { ok: "Department deleted." };
  });
}

export async function saveGamification(json: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    let value: unknown;
    try { value = JSON.parse(json); } catch { throw new UserError("Couldn't read the settings."); }
    const parsed = GamificationSettings.safeParse(value);
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const { error } = await c.supabase.from("settings").upsert({ key: "gamification", value: parsed.data }, { onConflict: "key" });
    if (error) throw new Error(error.message);
    return { ok: "Gamification settings saved." };
  });
}

// ───────────── TV notices (Owner and supervisors) ─────────────
const NoticeForm = z.object({
  id: z.string().optional(),
  version: z.coerce.number().optional(),
  departmentId: z.string(),
  icon: z.string().trim().max(16),
  title: z.string().trim().min(1, "Write the notice."),
  detail: z.string().trim().max(200),
  dailyAt: z.string().regex(/^(\d{2}:\d{2})?$/, "Pick a time or leave it empty."),
  startsOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
  endsOn: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
});

export async function saveNotice(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const parsed = NoticeForm.safeParse(formObj(form));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const f = parsed.data;
    if (f.startsOn && f.endsOn && f.endsOn < f.startsOn) throw new UserError("The last day is before the first day.");
    const row = {
      department_id: f.departmentId || null, icon: f.icon || "📢", title: f.title, detail: f.detail,
      daily_at: f.dailyAt || null, starts_on: f.startsOn || null, ends_on: f.endsOn || null,
    };
    if (f.id) await updateRow(c.supabase, "notices", f.id, f.version, row);
    else {
      const { error } = await c.supabase.from("notices").insert(row);
      if (error) throw new Error(error.message);
    }
    return { ok: "Notice saved. The TVs show it within seconds." };
  });
}

export async function toggleNotice(id: string, version: number, active: boolean): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    await updateRow(c.supabase, "notices", id, version, { active });
    return { ok: active ? "Notice on." : "Notice off." };
  });
}

export async function deleteNotice(id: string, version: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const { data, error } = await c.supabase.from("notices").delete().eq("id", id).eq("version", version).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserError("Someone else changed this — reload and try again.");
    return { ok: "Notice deleted." };
  });
}
