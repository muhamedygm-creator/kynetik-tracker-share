"use server";
/**
 * Per-employee task queue (Phase 3.5). Admin-side only: employees never change it.
 * Positions are fractional keys, so a reorder writes only the moved row.
 */
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { allItems, conflictMessage, describeItem, findTechConflict } from "@/domain/conflicts";
import { fmtDT } from "@/domain/format";
import { MSG } from "@/domain/messages";
import { applyQueueStatus, byPosition, checkStart, durationH, parseDuration, type QueueTask } from "@/domain/queue";
import type { ItemStatus } from "@/domain/types";
import { applyStatus, validateWorkItem } from "@/domain/work";
import { allocate } from "@/lib/actions/allocate";
import { UserError, context, formObj, run, updateRow, type ActionResult, type Ctx } from "@/lib/actions/common";
import type { QueueRow } from "@/lib/data/world";

const personQueue = (c: Ctx, personId: string, exceptId?: string) =>
  c.world.queue.filter((t) => t.personId === personId && t.id !== exceptId).sort(byPosition);

function mustTask(c: Ctx, id: string) {
  const t = c.world.queue.find((x) => x.id === id);
  if (!t) throw new UserError("That task no longer exists. Reload the page.");
  return t;
}

const nameOf = (c: Ctx, id: string) => c.world.people.find((p) => p.id === id)?.name ?? "This person";

const TaskForm = z.object({
  id: z.string().optional(),
  version: z.coerce.number().optional(),
  personId: z.string().min(1, "Pick an employee."),
  title: z.string().trim().min(1, "Give the task a title."),
  durValue: z.string().trim().min(1, "Give the task a duration, e.g. 2h 30m."),
  durUnit: z.enum(["hours", "days"]),
  link: z.string(), // "" | workItemId | "p:<projectId>" | "s:<stageId>"
  notes: z.string(),
  colour: z.string().regex(/^(#[0-9A-Fa-f]{6})?$/),
  fixedStart: z.string(),
});

/** Resolve the optional link to build / stage / part-step ids. */
function resolveLink(c: Ctx, link: string) {
  if (!link) return { project_id: null, stage_id: null, work_item_id: null };
  for (const b of c.world.builds) {
    const p = b.project;
    if (link === `p:${p.id}`) return { project_id: p.id, stage_id: null, work_item_id: null };
    const st = p.stages.find((s) => link === `s:${s.id}`);
    if (st) return { project_id: p.id, stage_id: st.id, work_item_id: null };
    const w = p.work.find((x) => x.id === link);
    if (w) return { project_id: p.id, stage_id: w.stageId, work_item_id: w.id };
  }
  throw new UserError("That build link no longer exists. Pick it again.");
}

export async function saveQueueTask(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const parsed = TaskForm.safeParse(formObj(form));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const f = parsed.data;
    const durValue = f.durUnit === "hours" ? parseDuration(f.durValue) : Number(f.durValue.replace(",", "."));
    if (durValue === null || !(durValue > 0) || (f.durUnit === "days" && durValue > 50)) {
      throw new UserError(f.durUnit === "hours" ? "Type the duration as hours and minutes, e.g. 2h 30m, 90m or 1.5 (at least 5 minutes)." : "Type the number of days, e.g. 2 or 1.5.");
    }
    const row = {
      title: f.title, dur_value: durValue, dur_unit: f.durUnit, notes: f.notes, colour: f.colour || null,
      fixed_start: c.U(f.fixedStart || null), ...resolveLink(c, f.link),
    };
    if (f.id) {
      const t = mustTask(c, f.id);
      if (t.personId !== f.personId) throw new UserError("Move the task to another employee by dragging it.");
      await updateRow(c.supabase, "queue_tasks", f.id, f.version, row);
      await allocate(c, row.work_item_id, durationH({ durValue, durUnit: f.durUnit }, c.world.cal.dayHours));
      return { ok: "Task saved." };
    }
    const last = personQueue(c, f.personId).at(-1);
    const { error } = await c.supabase.from("queue_tasks").insert({
      ...row, person_id: f.personId, position: generateKeyBetween(last?.position ?? null, null), created_by: c.viewer.userId,
    });
    if (error) throw new Error(error.message);
    await allocate(c, row.work_item_id, durationH({ durValue, durUnit: f.durUnit }, c.world.cal.dayHours));
    return { ok: `Task added to ${nameOf(c, f.personId)}'s queue.` };
  });
}

export async function duplicateQueueTask(id: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    const q = personQueue(c, t.personId);
    const next = q[q.findIndex((x) => x.id === id) + 1];
    const { error } = await c.supabase.from("queue_tasks").insert({
      person_id: t.personId, title: t.title, dur_value: t.durValue, dur_unit: t.durUnit, notes: t.notes, colour: t.colour,
      project_id: t.projectId, stage_id: t.stageId, work_item_id: null, // a part-step belongs to one task
      position: generateKeyBetween(t.position, next?.position ?? null), created_by: c.viewer.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: "Task duplicated." };
  });
}

export async function deleteQueueTask(id: string, version: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const { data, error } = await c.supabase.from("queue_tasks").delete().eq("id", id).eq("version", version).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserError(MSG.staleWrite);
    return { ok: "Task deleted." };
  });
}

/**
 * Drag & drop: put the task between two neighbours (ids in the target queue, either may be null),
 * optionally in another employee's queue.
 */
export async function moveQueueTask(id: string, version: number, toPersonId: string, beforeId: string | null, afterId: string | null): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    const target = personQueue(c, toPersonId, id);
    const lo = afterId ? target.find((x) => x.id === afterId)?.position ?? target.at(-1)?.position ?? null : null;
    const hi = beforeId ? target.find((x) => x.id === beforeId)?.position ?? null : null;
    let position: string;
    try {
      position = generateKeyBetween(lo, hi);
    } catch {
      position = generateKeyBetween(target.at(-1)?.position ?? null, null); // neighbours moved meanwhile: append
    }
    const patch: Record<string, unknown> = { position };
    if (toPersonId !== t.personId) {
      patch.person_id = toPersonId;
      if (t.status === "doing") {
        const refusal = checkStart(nameOf(c, toPersonId), target as QueueTask[], id, c.world.now);
        if (refusal) throw new UserError(refusal);
      }
      if (t.workItemId) await reassignLinkedItem(c, t, toPersonId);
    }
    await updateRow(c.supabase, "queue_tasks", id, version, patch);
    return { ok: toPersonId === t.personId ? "Queue reordered." : `Moved to ${nameOf(c, toPersonId)}.` };
  });
}

export async function moveQueueTaskToTop(id: string, version: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    const first = personQueue(c, t.personId, id)[0];
    await updateRow(c.supabase, "queue_tasks", id, version, { position: generateKeyBetween(null, first?.position ?? null) });
    return { ok: "Moved to the top." };
  });
}

/** Keyboard alternative to dragging: one place up or down. */
export async function nudgeQueueTask(id: string, version: number, dir: -1 | 1): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    const q = personQueue(c, t.personId);
    const i = q.findIndex((x) => x.id === id);
    const j = i + dir;
    if (j < 0 || j >= q.length) return { ok: "Already there." };
    const [lo, hi] = dir === -1 ? [q[j - 1]?.position ?? null, q[j].position] : [q[j].position, q[j + 1]?.position ?? null];
    await updateRow(c.supabase, "queue_tasks", id, version, { position: generateKeyBetween(lo, hi) });
    return { ok: dir === -1 ? "Moved up." : "Moved down." };
  });
}

/** Keep a linked part-step's technician in step with the queue it sits in. */
async function reassignLinkedItem(c: Ctx, t: QueueRow, personId: string) {
  const ref = allItems(c.world.builds.map((b) => b.project)).find((r) => r.item.id === t.workItemId);
  if (!ref) return;
  const next = { ...ref.item, tech: personId };
  const world = allItems(c.world.builds.map((b) => b.project)).filter((r) => r.item.id !== next.id);
  const conflict = findTechConflict({ project: ref.project, item: next }, world, c.world.settings.booking.techMode, c.world.now);
  if (conflict) throw new UserError(conflictMessage(conflict, c.world.people));
  await updateRow(c.supabase, "work_items", ref.item.id, c.world.versions[ref.item.id], { tech_id: personId });
}

/**
 * Status from the admin side. One task in progress per person (§9); a linked part-step shares the
 * status (D10) and goes through the v1 part-step rules.
 */
export async function setQueueStatus(id: string, version: number, status: ItemStatus): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    const now = c.world.now;
    const person = nameOf(c, t.personId);
    const items = allItems(c.world.builds.map((b) => b.project));
    const linked = t.workItemId ? items.find((r) => r.item.id === t.workItemId) : undefined;

    if (status === "doing") {
      const refusal = checkStart(person, personQueue(c, t.personId) as QueueTask[], id, now);
      if (refusal) throw new UserError(refusal);
      // A part-step already open for this person blocks unrelated work (stage mode allows the same stage).
      const open = items.find((r) => r.item.tech === t.personId && r.item.status === "doing" && r.item.id !== t.workItemId &&
        !(c.world.settings.booking.techMode === "stage" && linked && r.project.id === linked.project.id && r.item.stageId === linked.item.stageId));
      if (open && !linked) {
        const d = describeItem(open);
        throw new UserError(MSG.techBlocked(person, d.serial, d.stage, d.part, open.item.start ? fmtDT(open.item.start) : fmtDT(now), "now"));
      }
    }

    // New workflow (AM-07): Done on a part step means "submit for QC"; the task stays In Progress until approved.
    if (linked && c.world.builds.some((b) => b.project.id === linked.project.id && b.project.gated) && status === "done") {
      if (linked.item.status !== "doing") throw new UserError("Start the step first: only a step In Progress can be submitted for QC.");
      const { error } = await c.supabase.rpc("submit_qc", { p_item: linked.item.id });
      if (error) throw new Error(error.message);
      return { ok: "Submitted for QC. It counts as done once an admin approves it." };
    }

    const next = applyQueueStatus(t as QueueTask, status, now);
    if (linked) {
      let w = applyStatus({ ...linked.item, tech: t.personId }, status, now);
      if (status === "doing" && linked.item.status === "done") w = { ...w, end: null };
      const invalid = validateWorkItem(linked.item, w, now);
      if (invalid) throw new UserError(invalid);
      const conflict = findTechConflict({ project: linked.project, item: w }, items.filter((r) => r.item.id !== w.id), c.world.settings.booking.techMode, now);
      if (conflict && w.status !== "blocked") throw new UserError(conflictMessage(conflict, c.world.people));
      await updateRow(c.supabase, "work_items", w.id, c.world.versions[w.id], {
        status: w.status, tech_id: w.tech, start_at: c.U(w.start), end_at: c.U(w.end), seg_start: c.U(w.segStart),
      });
    }
    await updateRow(c.supabase, "queue_tasks", id, version, {
      status: next.status, actual_start: c.U(next.actualStart), actual_end: c.U(next.actualEnd),
    });
    return { ok: "Status saved." };
  });
}
