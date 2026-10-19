"use server";
/**
 * Week planner (docs/ROADMAP.md v1.4). Works on the per-person task queue: a drop sets the queue
 * position and a "not before" start (D13), so later tasks move along by the existing rules (D12);
 * stretching changes the hours. Linked part-steps keep their technician in step (D10).
 */
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { allItems, conflictMessage, findTechConflict } from "@/domain/conflicts";
import { morningBrief } from "@/domain/brief";
import { insertionPoint } from "@/domain/plan";
import { fmtHM } from "@/domain/format";
import { MAX_TASK_H, MIN_TASK_H, byPosition, checkStart, layoutQueue, toMinute, type QueueTask } from "@/domain/queue";
import { partLabel } from "@/domain/parts";
import { stepName } from "@/domain/qc";
import { standardH } from "@/domain/work";
import { allocate } from "@/lib/actions/allocate";
import { UserError, context, run, updateRow, type ActionResult, type Ctx } from "@/lib/actions/common";
import type { QueueRow } from "@/lib/data/world";

const MSG_SHORT = "A task needs at least 5 minutes and at most 400 hours.";

const nameOf = (c: Ctx, id: string) => c.world.people.find((p) => p.id === id)?.name ?? "This person";
const queueOf = (c: Ctx, personId: string, exceptId?: string) =>
  c.world.queue.filter((t) => t.personId === personId && t.id !== exceptId).sort(byPosition);

function mustTask(c: Ctx, id: string) {
  const t = c.world.queue.find((x) => x.id === id);
  if (!t) throw new UserError("That task no longer exists. Reload the page.");
  return t;
}

/** Position for a drop at `at` in `personId`'s queue (without the moved task). */
function positionFor(c: Ctx, personId: string, at: string, exceptId?: string) {
  const rest = queueOf(c, personId, exceptId);
  const placed = layoutQueue(rest as QueueTask[], c.world.calFor(personId), c.world.now);
  const { afterId, beforeId } = insertionPoint(placed, at);
  const lo = afterId ? rest.find((t) => t.id === afterId)!.position : null;
  const hi = beforeId ? rest.find((t) => t.id === beforeId)!.position : null;
  try {
    return generateKeyBetween(lo, hi);
  } catch {
    return generateKeyBetween(rest.at(-1)?.position ?? null, null);
  }
}

/** Keep a linked part-step's technician in step with the person whose plan it sits in. */
async function assignLinked(c: Ctx, workItemId: string, personId: string) {
  const items = allItems(c.world.builds.map((b) => b.project));
  const ref = items.find((r) => r.item.id === workItemId);
  if (!ref || ref.item.tech === personId) return;
  const next = { ...ref.item, tech: personId };
  const conflict = findTechConflict({ project: ref.project, item: next }, items.filter((r) => r.item.id !== next.id), c.world.settings.booking.techMode, c.world.now);
  if (conflict) throw new UserError(conflictMessage(conflict, c.world.people));
  await updateRow(c.supabase, "work_items", ref.item.id, c.world.versions[ref.item.id], { tech_id: personId });
}

const Local = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Pick a time on the plan.");

/**
 * Drag an existing task to a time (and maybe another person). With `hours`, the task also gets a new
 * length: that is the left-edge drag, which moves the start and keeps the end where it was.
 */
export async function moveOnPlan(id: string, version: number, personId: string, at: string, hours?: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const when = Local.parse(at);
    const t = mustTask(c, id);
    if (t.status === "done") throw new UserError("This task is done. Set it back to Not started to plan it again.");
    if (t.status === "doing" && personId === t.personId) throw new UserError("This task is in progress, so it runs from when it started. Finish or block it before moving it.");
    if (t.status === "doing") {
      const refusal = checkStart(nameOf(c, personId), queueOf(c, personId) as QueueTask[], id, c.world.now);
      if (refusal) throw new UserError(refusal);
    }
    const patch: Record<string, unknown> = { position: positionFor(c, personId, when, id), fixed_start: c.U(when) };
    if (hours !== undefined) {
      const h = toMinute(hours);
      if (!(h >= MIN_TASK_H) || h > MAX_TASK_H) throw new UserError(MSG_SHORT);
      Object.assign(patch, { dur_value: h, dur_unit: "hours" });
    }
    if (personId !== t.personId) {
      patch.person_id = personId;
      if (t.workItemId) await assignLinked(c, t.workItemId, personId);
    }
    await updateRow(c.supabase, "queue_tasks", id, version, patch);
    if (hours !== undefined) await allocate(c, t.workItemId, toMinute(hours));
    return { ok: hours !== undefined ? `Starts ${when.slice(11, 16)}, now ${fmtHM(toMinute(hours))}.` : personId === t.personId ? "Moved." : `Moved to ${nameOf(c, personId)}.` };
  });
}

/** Drop a part-step from "Work to do" onto someone's plan: a new task linked to it. */
export async function planWorkItem(workItemId: string, personId: string, at: string | null,
  opts: { hours?: number; priority?: "normal" | "urgent"; notes?: string } = {}): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const when = at ? Local.parse(at) : null;
    if (c.world.queue.some((q) => q.workItemId === workItemId)) throw new UserError("That part is already on someone's plan. Reload the page.");
    const ref = allItems(c.world.builds.map((b) => b.project)).find((r) => r.item.id === workItemId);
    if (!ref) throw new UserError("That part-step no longer exists. Reload the page.");
    const stage = ref.project.stages.find((s) => s.id === ref.item.stageId)!;
    const own = ref.project.parts.find((p) => p.id === ref.item.partId);
    const part = stepName(own ? (own.serial ? partLabel(own) : own.name) : "Part", ref.item);
    const hours = opts.hours !== undefined ? toMinute(opts.hours) : Math.max(0.5, standardH(ref.item, stage));
    if (!(hours >= MIN_TASK_H) || hours > MAX_TASK_H) throw new UserError(MSG_SHORT);
    await assignLinked(c, workItemId, personId);
    const last = queueOf(c, personId).at(-1);
    const { error } = await c.supabase.from("queue_tasks").insert({
      person_id: personId, title: `${part}: ${stage.name}`, dur_value: hours, dur_unit: "hours",
      project_id: ref.project.id, stage_id: stage.id, work_item_id: workItemId, status: ref.item.status === "blocked" ? "blocked" : "todo",
      position: when ? positionFor(c, personId, when) : generateKeyBetween(last?.position ?? null, null), fixed_start: when ? c.U(when) : null,
      priority: opts.priority === "urgent" ? "urgent" : "normal", notes: (opts.notes ?? "").slice(0, 2000), created_by: c.viewer.userId,
    });
    if (error) throw new Error(error.message);
    await allocate(c, workItemId, hours);
    return { ok: `${part} planned for ${nameOf(c, personId)}.` };
  });
}

/** What the Add task panel offers: departments, the crew in them, and each department's waiting part steps. */
export async function addTaskOptions(): Promise<{
  departments: { id: string; key: string; name: string; emoji: string }[];
  people: { id: string; name: string; departmentId: string | null }[];
  /** Working hours in one day, for the Days unit (AM-28). */
  dayHours: number;
  waiting: { workItemId: string; label: string; hours: number; departmentKey: string; late: boolean }[];
}> {
  const c = await context();
  const w = c.world;
  const brief = morningBrief({
    builds: w.builds.map((b) => ({ project: b.project, health: b.health, forecastFinish: b.forecast.finish })),
    people: w.people.map((p) => ({ id: p.id, name: p.name, departmentId: p.departmentId, active: p.active, production: p.costClass === "production" })),
    departments: w.departments, queue: w.queue, cal: w.cal, calFor: w.calFor, now: w.now,
  });
  const late = new Set(w.builds.filter((b) => b.health === "late").map((b) => b.project.id));
  return {
    dayHours: w.cal.dayHours,
    departments: w.departments.map((d) => ({ id: d.id, key: d.key, name: d.name, emoji: d.emoji })),
    people: w.people.filter((p) => p.active && p.costClass === "production").map((p) => ({ id: p.id, name: p.name, departmentId: p.departmentId })),
    waiting: brief.waiting.map((x) => ({ workItemId: x.workItemId, label: `${x.serial} · ${x.part}: ${x.stage}`, hours: x.hours, departmentKey: x.stationType, late: late.has(x.projectId) })),
  };
}

/** Drag a task's edge: new length in working hours. */
export async function resizeOnPlan(id: string, version: number, hours: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    const h = toMinute(hours);
    if (!(h >= MIN_TASK_H) || h > MAX_TASK_H) throw new UserError(MSG_SHORT);
    await updateRow(c.supabase, "queue_tasks", id, version, { dur_value: h, dur_unit: "hours" });
    await allocate(c, t.workItemId, h);
    return { ok: `Now ${fmtHM(h)}.` };
  });
}

const Details = z.object({
  title: z.string().trim().min(1, "Give the task a name."),
  hours: z.number().min(MIN_TASK_H, "A task needs at least 5 minutes.").max(MAX_TASK_H),
  notes: z.string().max(2000),
  priority: z.enum(["normal", "urgent"]),
  clearPin: z.boolean(),
});

/** The details drawer: name, hours, notes for the technician, urgent flag, and "follow the previous task". */
export async function savePlanDetails(id: string, version: number, input: z.input<typeof Details>): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    const parsed = Details.safeParse(input);
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const d = parsed.data;
    await updateRow(c.supabase, "queue_tasks", id, version, {
      title: d.title, dur_value: toMinute(d.hours), dur_unit: "hours", notes: d.notes, priority: d.priority,
      ...(d.clearPin ? { fixed_start: null } : {}),
    });
    await allocate(c, t.workItemId, toMinute(d.hours));
    return { ok: "Saved." };
  });
}

/**
 * A workshop task with no build (clean-down, delivery, training…). With `at` it is placed at that time
 * (not before it, like a dropped task); without, it goes to the end of the person's queue.
 */
export async function addPlanTask(personId: string, title: string, hours: number, opts: { at?: string | null; priority?: "normal" | "urgent"; notes?: string } = {}): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    if (!title.trim()) throw new UserError("Give the task a name.");
    if (!c.world.people.some((p) => p.id === personId)) throw new UserError("Pick who does it.");
    if (!(toMinute(hours) >= MIN_TASK_H) || hours > MAX_TASK_H) throw new UserError(MSG_SHORT);
    const when = opts.at ? Local.parse(opts.at) : null;
    const last = queueOf(c, personId).at(-1);
    const { error } = await c.supabase.from("queue_tasks").insert({
      person_id: personId, title: title.trim(), dur_value: toMinute(hours), dur_unit: "hours",
      position: when ? positionFor(c, personId, when) : generateKeyBetween(last?.position ?? null, null),
      fixed_start: when ? c.U(when) : null, priority: opts.priority === "urgent" ? "urgent" : "normal",
      notes: (opts.notes ?? "").slice(0, 2000), created_by: c.viewer.userId,
    });
    if (error) throw new Error(error.message);
    return { ok: `Added to ${nameOf(c, personId)}'s queue.` };
  });
}

/** "Back to Work to do": take the task off the plan (a linked part-step returns to the list). */
export async function removeFromPlan(id: string, version: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    if (t.status === "doing") throw new UserError("This task is in progress. Finish or block it before taking it off the plan.");
    const { data, error } = await c.supabase.from("queue_tasks").delete().eq("id", id).eq("version", version).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserError("Someone else changed this — reload and try again.");
    return { ok: t.workItemId ? "Back in Work to do." : "Removed from the plan." };
  });
}

/** Undo for the last move or resize: put the task back exactly as it was. */
export async function restorePlanTask(id: string, before: Pick<QueueRow, "personId" | "position" | "fixedStart" | "durValue" | "durUnit">): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const t = mustTask(c, id);
    if (before.personId !== t.personId && t.workItemId) await assignLinked(c, t.workItemId, before.personId);
    const taken = queueOf(c, before.personId, id).some((x) => x.position === before.position);
    await updateRow(c.supabase, "queue_tasks", id, undefined, {
      person_id: before.personId, fixed_start: c.U(before.fixedStart), dur_value: before.durValue, dur_unit: before.durUnit,
      position: taken ? generateKeyBetween(queueOf(c, before.personId, id).at(-1)?.position ?? null, null) : before.position,
    });
    return { ok: "Undone." };
  });
}
