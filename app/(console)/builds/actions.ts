"use server";
/**
 * Build editing: builds, stages, parts, work items (part-steps) and tasks.
 * Every action: role check → domain rules (validation, double-booking, re-flow) → row-level writes with
 * optimistic version checks. Messages come from domain/messages.ts.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { allItems, clashesInvolving, conflictMessage, findTechConflict, planClashes, type PlanClash } from "@/domain/conflicts";
import { fmtDate } from "@/domain/format";
import { MSG } from "@/domain/messages";
import { schedule } from "@/domain/schedule";

import type { ItemStatus, Project, Task, WorkItem } from "@/domain/types";
import { applyStatus, bulkAssign, diffPartsList, durationFromEnd, projectAfterChange, rework, startBuild, templateFromBuild, validateWorkItem } from "@/domain/work";
import { UserError, context as commonContext, formObj, run, updateRow, type ActionResult, type Ctx as CommonCtx } from "@/lib/actions/common";
import { findBuild, type World } from "@/lib/data/world";

export type { ActionResult } from "@/lib/actions/common";
type Ctx = CommonCtx;
const context = () => commonContext();

function mustBuild(world: World, id: string) {
  const b = findBuild(world, id);
  if (!b) throw new UserError("That build no longer exists. Reload the page.");
  return b;
}

/** Re-flow a build's plan and save the task windows + planned finish. */
async function replan(c: Ctx, project: Pick<Project, "id" | "startDate">, tasks: Task[]) {
  const planned = schedule({ startDate: project.startDate, tasks }, c.world.cal);
  const { error } = await c.supabase.rpc("save_plan", {
    p_project: project.id,
    p_plan_end: c.U(planned.planEnd),
    p_tasks: planned.tasks.map((t) => ({ id: t.id, plan_start: c.U(t.start), plan_end: c.U(t.end) })),
  });
  if (error) throw new Error(error.message);
  return planned.tasks;
}

/** Refuse a plan change that creates a station / task-lead clash when the booking rules say "block" (§9). */
function checkPlanClashes(c: Ctx, project: Project, nextTasks: Task[], extra?: Partial<Project>) {
  const projects = c.world.builds.map((b) => b.project);
  const before = clashesInvolving(planClashes(projects, c.world.stations, c.world.people, c.world.settings.booking.techMode), project.id);
  const next = projects.map((p) => (p.id === project.id ? { ...p, ...extra, tasks: nextTasks } : p));
  const after = clashesInvolving(planClashes(next, c.world.stations, c.world.people, c.world.settings.booking.techMode), project.id);
  const key = (x: PlanClash) => `${x.kind}|${x.resourceId}|${x.a.label}|${x.b.label}|${x.a.projectId}|${x.b.projectId}`;
  const known = new Set(before.map(key));
  const fresh = after.filter((x) => !known.has(key(x)));
  const rule = (x: PlanClash) => (x.kind === "station" ? c.world.settings.booking.stationClash : c.world.settings.booking.personClash);
  const blocking = fresh.find((x) => rule(x) === "block");
  if (blocking) {
    const other = blocking.a.projectId === project.id ? blocking.b : blocking.a;
    throw new UserError(
      `Blocked — ${blocking.resourceName} is double-booked with ${other.serial} · ${other.label} ` +
        `(${fmtDate(other.start)} – ${fmtDate(other.end)}). Move one of them, or change the booking rule in Settings.`,
    );
  }
  return fresh; // warn-mode clashes: allowed, shown under Attention (D7)
}

/** Planned build → active (+ baseline) once work starts; delivered when every task is done. */
async function afterChange(c: Ctx, project: Project) {
  const r = projectAfterChange(project, c.world.today);
  const patch: Record<string, unknown> = {};
  if (r.status !== project.status) patch.status = r.status;
  if (r.deliveredOn !== project.deliveredOn) patch.delivered_on = r.deliveredOn;
  if (Object.keys(patch).length) await updateRow(c.supabase, "projects", project.id, undefined, patch);
  if (!Object.keys(project.baseline).length && Object.keys(r.baseline).length) {
    const { error } = await c.supabase.rpc("set_baseline", { p_project: project.id, p_label: "baseline" });
    if (error) throw new Error(error.message);
  }
}

// ───────────────────────────── builds ─────────────────────────────

const BuildForm = z.object({
  serial: z.string().trim(),
  name: z.string().trim(),
  client: z.string().trim(),
  notes: z.string().trim(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
  deliveryDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
});

export async function updateBuild(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const parsed = BuildForm.extend({ id: z.string(), version: z.coerce.number() }).safeParse(formObj(form));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const f = parsed.data;
    if (!f.serial) throw new UserError(MSG.serialRequired);
    const b = mustBuild(c.world, f.id);
    await updateRow(c.supabase, "projects", f.id, f.version, {
      serial: f.serial, name: f.name, client: f.client, notes: f.notes, start_date: f.startDate, delivery_date: f.deliveryDate || null,
    });
    if (f.startDate !== b.project.startDate) {
      const tasks = b.project.tasks;
      checkPlanClashes(c, b.project, schedule({ startDate: f.startDate, tasks }, c.world.cal).tasks, { startDate: f.startDate });
      await replan(c, { id: f.id, startDate: f.startDate }, tasks);
    }
    return { ok: "Build saved." };
  });
}

export async function deleteBuild(id: string, version: number): Promise<ActionResult> {
  const r = await run(async () => {
    const c = await context();
    const { data, error } = await c.supabase.from("projects").delete().eq("id", id).eq("version", version).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserError(MSG.staleWrite);
  });
  if (!r.error) redirect("/builds");
  return r;
}

/** Start build / Hold / Resume (§14). */
export async function setBuildStatus(id: string, version: number, action: "start" | "hold" | "resume"): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, id);
    if (action === "hold") {
      await updateRow(c.supabase, "projects", id, version, { status: "hold" });
      return { ok: "Build on hold." };
    }
    if (action === "resume") {
      await updateRow(c.supabase, "projects", id, version, { status: "active" });
      return { ok: "Build resumed." };
    }
    // Spec §9 checks plan clashes when tasks are moved or edited; Start build doesn't, and any clash shows under Attention.
    const started = startBuild(b.project, c.world.cal, c.world.now);
    await updateRow(c.supabase, "projects", id, version, { status: "active", start_date: started.startDate });
    const first = started.tasks[0];
    if (first) {
      await updateRow(c.supabase, "tasks", first.id, c.world.versions[first.id], {
        pinned_start: c.U(first.pinnedStart), status: first.status, pct: first.pct,
      });
    }
    await replan(c, { id, startDate: started.startDate }, started.tasks);
    if (!Object.keys(b.project.baseline).length) {
      const { error } = await c.supabase.rpc("set_baseline", { p_project: id, p_label: "baseline" });
      if (error) throw new Error(error.message);
    }
    return { ok: "Build started." };
  });
}

/** Re-baseline: the current plan becomes the baseline; slip resets to zero (§7). */
export async function rebaseline(id: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    mustBuild(c.world, id);
    const { error } = await c.supabase.rpc("set_baseline", { p_project: id, p_label: "rebaseline" });
    if (error) throw new Error(error.message);
    return { ok: "Baseline reset to the current plan." };
  });
}

// ───────────────────────────── stages ─────────────────────────────

export async function updateStage(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const f = z.object({
      id: z.string(), version: z.coerce.number(), name: z.string().trim().min(1, "Give the stage a name."),
      stationId: z.string(), partHours: z.coerce.number().min(0, "Standard hours can't be negative."),
    }).parse(formObj(form));
    await updateRow(c.supabase, "stages", f.id, f.version, { name: f.name, station_id: f.stationId || null, part_hours: f.partHours });
    return { ok: "Stage saved." };
  });
}

export async function addStage(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const f = z.object({
      projectId: z.string(), name: z.string().trim().min(1, "Give the stage a name."), stationType: z.string().min(1),
      stationId: z.string(), partHours: z.coerce.number().min(0),
    }).parse(formObj(form));
    const { error } = await c.supabase.rpc("add_stage", {
      p_project: f.projectId, p_name: f.name, p_station_type: f.stationType, p_station: f.stationId || null, p_part_hours: f.partHours,
    });
    if (error) throw new Error(error.message);
    return { ok: "Stage added." };
  });
}

/** Deleting a stage deletes its tasks and part history — the UI confirms first. */
export async function deleteStage(id: string, version: number, projectId: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, projectId);
    const { data, error } = await c.supabase.from("stages").delete().eq("id", id).eq("version", version).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserError(MSG.staleWrite);
    await replan(c, b.project, b.project.tasks.filter((t) => t.stageId !== id));
    return { ok: "Stage deleted." };
  });
}

// ───────────────────────────── parts ─────────────────────────────

/** Parts list editor: one per line. Removed lines delete that part's history in every stage, so `confirmRemove` must be set. */
export async function saveParts(projectId: string, text: string, confirmRemove: boolean): Promise<ActionResult & { removing?: string[] }> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, projectId);
    const d = diffPartsList(b.project.parts, text);
    if (!d.ok) throw new UserError(d.error);
    if (d.value.remove.length && !confirmRemove) {
      return { removing: d.value.remove.map((p) => p.name), error: "confirm" };
    }
    if (d.value.remove.length) {
      const { error } = await c.supabase.from("parts").delete().in("id", d.value.remove.map((p) => p.id));
      if (error) throw new Error(error.message);
    }
    for (const p of d.value.keep) {
      const old = b.project.parts.find((x) => x.id === p.id)!;
      if (old.name !== p.name) await updateRow(c.supabase, "parts", p.id, c.world.versions[p.id], { name: p.name });
    }
    if (d.value.add.length) {
      const { error } = await c.supabase.rpc("add_parts", { p_project: projectId, p_names: d.value.add });
      if (error) throw new Error(error.message);
    }
    return { ok: "Parts list saved." };
  });
}

export async function renamePartAction(id: string, version: number, projectId: string, name: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, projectId);
    const n = name.trim();
    if (!n) throw new UserError("A part needs a name.");
    if (b.project.parts.some((p) => p.id !== id && p.name.toLowerCase() === n.toLowerCase())) throw new UserError(MSG.duplicatePart(n));
    await updateRow(c.supabase, "parts", id, version, { name: n });
    return { ok: "Part renamed." };
  });
}

// ───────────────────────────── work items ─────────────────────────────

const WorkForm = z.object({
  id: z.string(), version: z.coerce.number(), projectId: z.string(),
  tech: z.string(), status: z.enum(["todo", "doing", "blocked", "done"]),
  start: z.string(), end: z.string(), planH: z.string(), notes: z.string(),
  field: z.enum(["start", "end", ""]).optional(),
});

function checkTech(c: Ctx, project: Project, next: WorkItem) {
  const world = allItems(c.world.builds.map((b) => b.project)).filter((r) => r.item.id !== next.id);
  const conflict = findTechConflict({ project, item: next }, world, c.world.settings.booking.techMode, c.world.now);
  if (conflict) throw new UserError(conflictMessage(conflict, c.world.people));
}

export async function updateWorkItem(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const f = WorkForm.parse(formObj(form));
    const b = mustBuild(c.world, f.projectId);
    const prev = b.project.work.find((w) => w.id === f.id);
    if (!prev) throw new UserError("That part-step no longer exists. Reload the page.");

    let next: WorkItem = { ...prev, tech: f.tech || null, notes: f.notes, planH: f.planH === "" ? null : Number(f.planH) };
    if (f.status !== prev.status) next = applyStatus(next, f.status, c.world.now);
    // Explicit time edits win over the status side-effects (they record what actually happened).
    if (f.start !== (prev.start ?? "")) next = { ...next, start: f.start || null, segStart: prev.prevSegs.length ? next.segStart : f.start || null };
    if (f.end !== (prev.end ?? "") && next.status === "done") next = { ...next, end: f.end || null };

    const invalid = validateWorkItem(prev, next, c.world.now, f.field || undefined);
    if (invalid) throw new UserError(invalid);
    if (next.tech) checkTech(c, b.project, next);

    await updateRow(c.supabase, "work_items", f.id, f.version, {
      tech_id: next.tech, status: next.status, start_at: c.U(next.start), end_at: c.U(next.end), seg_start: c.U(next.segStart),
      plan_h: next.planH, notes: next.notes,
    });
    // D10: a queue task linked to this part-step shares its status.
    for (const q of c.world.queue.filter((x) => x.workItemId === f.id && x.status !== next.status)) {
      await updateRow(c.supabase, "queue_tasks", q.id, c.world.versions[q.id], {
        status: next.status, actual_start: c.U(next.start), actual_end: c.U(next.status === "done" ? next.end : null),
      });
    }
    await afterChange(c, { ...b.project, work: b.project.work.map((w) => (w.id === f.id ? next : w)) });
    return { ok: "Part-step saved." };
  });
}

/** One-tap status change from the build board (same rules as the edit form: technician, times, double-booking). */
export async function setWorkItemStatus(id: string, version: number, projectId: string, status: ItemStatus): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, projectId);
    const prev = b.project.work.find((w) => w.id === id);
    if (!prev) throw new UserError("That part-step no longer exists. Reload the page.");
    if (prev.status === status) return { ok: "No change." };
    const next = applyStatus(prev, status, c.world.now);
    const invalid = validateWorkItem(prev, next, c.world.now);
    if (invalid) throw new UserError(invalid);
    if (next.tech && next.status !== "blocked") checkTech(c, b.project, next);
    await updateRow(c.supabase, "work_items", id, version, {
      status: next.status, start_at: c.U(next.start), end_at: c.U(next.end), seg_start: c.U(next.segStart),
    });
    // D10: a queue task linked to this part-step shares its status.
    for (const q of c.world.queue.filter((x) => x.workItemId === id && x.status !== next.status)) {
      await updateRow(c.supabase, "queue_tasks", q.id, c.world.versions[q.id], {
        status: next.status, actual_start: c.U(next.start), actual_end: c.U(next.status === "done" ? next.end : null),
      });
    }
    await afterChange(c, { ...b.project, work: b.project.work.map((w) => (w.id === id ? next : w)) });
    return { ok: "Status saved." };
  });
}

export async function reworkWorkItem(id: string, version: number, projectId: string, reason: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, projectId);
    const prev = b.project.work.find((w) => w.id === id);
    if (!prev) throw new UserError("That part-step no longer exists. Reload the page.");
    const r = rework(prev, reason, c.viewer.role, c.world.now);
    if (!r.ok) throw new UserError(r.error);
    checkTech(c, b.project, r.value);
    const { error } = await c.supabase.rpc("rework_item", { p_item: id, p_version: version, p_reason: reason.trim(), p_at: c.U(c.world.now) });
    if (error) throw new UserError(error.message);
    return { ok: "Sent back for rework." };
  });
}

/** Assign every unassigned, not-done part in a stage to one technician, skipping clashes. */
export async function bulkAssignStage(projectId: string, stageId: string, tech: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, projectId);
    const world = allItems(c.world.builds.map((x) => x.project));
    const mode = c.world.settings.booking.techMode;
    const { assigned, skipped } = bulkAssign(b.project.work, stageId, tech, (next) =>
      !!findTechConflict({ project: b.project, item: next }, world.filter((r) => r.item.id !== next.id), mode, c.world.now));
    for (const w of assigned) await updateRow(c.supabase, "work_items", w.id, c.world.versions[w.id], { tech_id: tech });
    const name = c.world.people.find((p) => p.id === tech)?.name ?? "";
    return { ok: `${assigned.length} part(s) assigned to ${name}${skipped.length ? `, ${skipped.length} skipped (would double-book)` : ""}.` };
  });
}

// ───────────────────────────── tasks ─────────────────────────────

const TaskForm = z.object({
  id: z.string().optional(), version: z.coerce.number().optional(), projectId: z.string(),
  stageId: z.string().min(1, "Pick a stage."), name: z.string().trim().min(1, "Give the task a name."),
  assignee: z.string(), status: z.enum(["todo", "doing", "blocked", "done"]),
  durH: z.coerce.number().min(0.5, "A task needs at least 0.5 working hours."),
  pct: z.coerce.number().min(0).max(100), start: z.string(), end: z.string(), notes: z.string(),
});

export async function saveTask(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const parsed = TaskForm.safeParse(formObj(form));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const f = parsed.data;
    const b = mustBuild(c.world, f.projectId);
    const prev = f.id ? b.project.tasks.find((t) => t.id === f.id) : undefined;
    if (f.id && !prev) throw new UserError("That task no longer exists. Reload the page.");

    let durH = f.durH;
    let pinnedStart = prev?.pinnedStart ?? null;
    if (prev && f.start && f.start !== prev.start) pinnedStart = f.start; // editing the start pins it
    const startForEnd = pinnedStart && prev && f.start !== prev.start ? f.start : prev?.start ?? null;
    if (prev && f.end && f.end !== prev.end) {
      const d = durationFromEnd({ start: startForEnd }, f.end, c.world.cal);
      if (!d.ok) throw new UserError(d.error);
      durH = d.value;
    }
    const now = c.world.now;
    const status = f.status;
    const actualStart = status !== "todo" ? prev?.actualStart ?? now : prev?.actualStart ?? null;
    const actualEnd = status === "done" ? prev?.actualEnd ?? now : null;
    const pct = status === "done" ? 100 : f.pct;

    const row = {
      stage_id: f.stageId, name: f.name, assignee: f.assignee || null, status, dur_h: durH, pct,
      pinned_start: c.U(pinnedStart), actual_start: c.U(actualStart), actual_end: c.U(actualEnd), notes: f.notes,
    };
    const draft: Task = {
      id: prev?.id ?? "new", num: prev?.num ?? Math.max(0, ...b.project.tasks.map((t) => t.num)) + 1, stageId: f.stageId, name: f.name,
      assignee: f.assignee || null, status, durH, pct, start: null, end: null, pinnedStart, actualStart, actualEnd, notes: f.notes,
    };
    const nextTasks = prev ? b.project.tasks.map((t) => (t.id === prev.id ? draft : t)) : [...b.project.tasks, draft];
    checkPlanClashes(c, b.project, schedule({ startDate: b.project.startDate, tasks: nextTasks }, c.world.cal).tasks);

    let id = prev?.id;
    if (prev) {
      await updateRow(c.supabase, "tasks", prev.id, f.version, row);
    } else {
      const { data, error } = await c.supabase.from("tasks").insert({ ...row, project_id: b.project.id, num: draft.num }).select("id").single();
      if (error) throw new Error(error.message);
      id = data.id;
    }
    const saved = nextTasks.map((t) => (t.id === "new" ? { ...t, id: id! } : t));
    await replan(c, b.project, saved);
    await afterChange(c, { ...b.project, tasks: saved });
    return { ok: prev ? "Task saved." : "Task added." };
  });
}

export async function deleteTask(id: string, version: number, projectId: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, projectId);
    const { data, error } = await c.supabase.from("tasks").delete().eq("id", id).eq("version", version).select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) throw new UserError(MSG.staleWrite);
    await replan(c, b.project, b.project.tasks.filter((t) => t.id !== id));
    return { ok: "Task deleted." };
  });
}

/**
 * Timeline drag (§14): pin the task at its new start, re-flow the tasks after it, and refuse the move
 * if it creates a workstation or task-lead clash while the booking rules say "block".
 */
export async function moveTask(taskId: string, version: number, projectId: string, newStart: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = mustBuild(c.world, projectId);
    const t = b.project.tasks.find((x) => x.id === taskId);
    if (!t) throw new UserError("That task no longer exists. Reload the page.");
    const start = c.world.cal.norm(newStart);
    const next = b.project.tasks.map((x) => (x.id === taskId ? { ...x, pinnedStart: start } : x));
    checkPlanClashes(c, b.project, schedule({ startDate: b.project.startDate, tasks: next }, c.world.cal).tasks);
    await updateRow(c.supabase, "tasks", taskId, version, { pinned_start: c.U(start) });
    await replan(c, b.project, next);
    return { ok: `${t.name} moved.` };
  });
}

const TemplateForm = z.object({
  projectId: z.string().min(1),
  label: z.string().trim().min(1, "Name the template, e.g. \"Buggy build v2\".").max(80),
  hours: z.enum(["plan", "actual"]),
});

/** Save a build's stages, tasks and parts as a new template (no dates, people or costs). */
export async function saveAsTemplate(_: ActionResult, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const parsed = TemplateForm.safeParse(formObj(form));
    if (!parsed.success) throw new UserError(parsed.error.issues[0].message);
    const f = parsed.data;
    const b = c.world.builds.find((x) => x.project.id === f.projectId);
    if (!b) throw new UserError("That build no longer exists. Reload the page.");
    if (c.world.templates.some((t) => t.label.toLowerCase() === f.label.toLowerCase())) throw new UserError("A template with that name already exists. Pick another name.");
    const copy = templateFromBuild(b.project, f.hours, c.world.cal, c.world.now);
    if (!copy.stages.length) throw new UserError("This build has no stages to copy.");
    const key = `${f.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "template"}-${Date.now().toString(36)}`;
    const { error } = await c.supabase.rpc("create_template", { p: {
      key, label: f.label, from_project: b.project.id,
      stages: copy.stages.map((s) => ({ name: s.name, station_type: s.stationType, part_hours: s.partHours, tasks: s.tasks.map((t) => ({ name: t.name, dur_h: t.durH })) })),
      parts: copy.parts,
    } });
    if (error) throw new Error(error.message);
    return { ok: `Saved as template "${f.label}". It is in the list when you create a new build.` };
  });
}
