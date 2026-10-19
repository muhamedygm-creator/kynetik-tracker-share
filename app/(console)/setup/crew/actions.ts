"use server";
import { z } from "zod";
import { UserError, context, formObj, run, updateRow, type ActionResult } from "@/lib/actions/common";
import { PHOTO_BUCKET, PHOTO_MAX_BYTES } from "@/lib/photos";

const PersonForm = z.object({
  id: z.string().optional(),
  version: z.coerce.number().optional(),
  name: z.string().trim().min(1, "A crew member needs a name."),
  departmentId: z.string(),
  costClass: z.enum(["production", "admin"]),
  employment: z.enum(["full_time", "project_based"]).default("full_time"),
  contractFrom: z.string().optional(),
  contractTo: z.string().optional(),
  phone: z.string().max(40).optional(),
  skills: z.string().max(300).optional(),
  notes: z.string().max(2000).optional(),
  projectIds: z.string().optional(),
  baseSalary: z.string().optional(),
  loadingPct: z.string().optional(),
  costVersion: z.coerce.number().optional(),
});

export async function savePerson(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const parsed = PersonForm.safeParse(formObj(form));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const f = parsed.data;
    const day = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
    const from = f.employment === "project_based" ? day(f.contractFrom) : null;
    const to = f.employment === "project_based" ? day(f.contractTo) : null;
    if (from && to && to < from) throw new UserError("The contract can't end before it starts.");
    const projectIds = f.employment === "project_based" ? (f.projectIds ?? "").split(",").filter((x) => c.world.builds.some((b) => b.project.id === x)) : [];
    const row = {
      name: f.name, department_id: f.departmentId || null, cost_class: f.costClass,
      employment: f.employment, contract_from: from, contract_to: to, project_ids: projectIds,
      phone: (f.phone ?? "").trim(), skills: (f.skills ?? "").trim(), notes: (f.notes ?? "").trim(),
    };
    let id = f.id;
    if (id) {
      await updateRow(c.supabase, "people", id, f.version, row);
    } else {
      const { data, error } = await c.supabase.from("people").insert(row).select("id").single();
      if (error) throw new Error(error.message);
      id = data.id as string;
    }
    // Pay fields: Owner and Supervisors (AM-20). RLS refuses them for anyone else regardless of this check.
    if (c.viewer.seesSalary && f.baseSalary !== undefined) {
      const salary = Number(f.baseSalary || 0);
      const loading = f.loadingPct === "" || f.loadingPct === undefined ? null : Number(f.loadingPct);
      if (!(salary >= 0) || (loading !== null && !(loading >= 0))) throw new UserError("Salary and loading can't be negative.");
      const { error } = await c.supabase.from("people_cost").upsert({ person_id: id, base_salary: salary, loading_pct: loading }, { onConflict: "person_id" });
      if (error) throw new Error(error.message);
    }
    return { ok: f.id ? "Crew member saved." : "Crew member added." };
  });
}

/**
 * AM-20: set Active / Inactive, delete (to Deleted accounts; nothing is erased) or restore. Open part steps and
 * queue tasks move to `moveTo`; without one, part steps are left unassigned (queue tasks stay on the hidden queue).
 */
export async function setPersonStatus(personId: string, status: "active" | "inactive" | "deleted" | "restored", moveTo: string | null): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const { data, error } = await c.supabase.rpc("set_person_status", { p_person: personId, p_status: status, p_move_to: moveTo });
    if (error) throw new Error(error.message);
    const moved = (data as { part_steps: number; queue_tasks: number } | null) ?? { part_steps: 0, queue_tasks: 0 };
    const n = moved.part_steps + moved.queue_tasks;
    const done = { active: "Set active.", inactive: "Set inactive.", deleted: "Moved to Deleted accounts. Everything they did is kept.", restored: "Restored." }[status];
    return { ok: n ? `${done} ${n} open ${n === 1 ? "task" : "tasks"} ${moveTo ? "moved" : "left unassigned"}.` : done };
  });
}

/** Square-cropped JPEG from the browser (≤ 1 MB) → private Storage bucket. */
export async function uploadPhoto(personId: string, version: number, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const file = form.get("photo");
    if (!(file instanceof File) || !file.size) throw new UserError("Choose a photo.");
    if (file.size > PHOTO_MAX_BYTES) throw new UserError("That photo is over 1 MB after cropping. Try a smaller one.");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new UserError("Use a JPEG, PNG or WebP photo.");
    const person = c.world.people.find((p) => p.id === personId);
    if (!person) throw new UserError("That crew member no longer exists.");
    const path = `${personId}/${Date.now()}.jpg`;
    const { error } = await c.supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw new UserError(`Photo upload failed: ${error.message}`);
    await updateRow(c.supabase, "people", personId, version, { photo_path: path });
    if (person.photoPath) await c.supabase.storage.from(PHOTO_BUCKET).remove([person.photoPath]).catch(() => undefined);
    return { ok: "Photo saved." };
  });
}

export async function removePhoto(personId: string, version: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const person = c.world.people.find((p) => p.id === personId);
    await updateRow(c.supabase, "people", personId, version, { photo_path: null });
    if (person?.photoPath) await c.supabase.storage.from(PHOTO_BUCKET).remove([person.photoPath]).catch(() => undefined);
    return { ok: "Photo removed." };
  });
}
