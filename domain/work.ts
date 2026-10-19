/**
 * Parts × stages work tracking (spec §8). Pure functions: they return the next state or a refusal message.
 */
import type { Calendar } from "./calendar";
import { MSG } from "./messages";
import { baselineOf, schedule } from "./schedule";
import type { ItemStatus, Part, Project, Stage, Task, WorkItem } from "./types";
import type { LocalDT, LocalDate } from "./time";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(error: string): Result<T> => ({ ok: false, error });

/** Standard hours for a part in a stage: the item's override, else the stage standard. */
export const standardH = (w: Pick<WorkItem, "planH">, stage: Pick<Stage, "partHours">) => w.planH ?? stage.partHours;

/**
 * Actual working hours: the time actually worked — earlier segments (before reworks) plus the current
 * segment, start → finish or → now while open. Time a part sat Done before being sent back does not count (I1).
 */
export function actualH(w: Pick<WorkItem, "start" | "end" | "segStart" | "prevSegs">, cal: Calendar, now: LocalDT): number {
  const from = w.segStart ?? w.start;
  const current = from ? Math.max(0, cal.wh(from, w.end ?? now)) : 0;
  return w.prevSegs.reduce((s, [a, b]) => s + Math.max(0, cal.wh(a, b)), current);
}

export const varianceH = (actual: number, standard: number) => actual - standard;

/** Status change with the v1 time side-effects (applyStatus). */
export function applyStatus(w: WorkItem, to: ItemStatus, now: LocalDT): WorkItem {
  switch (to) {
    case "doing":
      return { ...w, status: to, start: w.start ?? now, segStart: w.segStart ?? w.start ?? now, end: null };
    case "done":
      return { ...w, status: to, start: w.start ?? now, segStart: w.segStart ?? w.start ?? now, end: now };
    case "todo":
      return { ...w, status: to, start: null, end: null, segStart: null, prevSegs: [] };
    case "blocked":
      return { ...w, status: to };
  }
}

/**
 * Validate a work item edit. `field` says which time the user edited, so the right message shows
 * when start and finish disagree.
 */
export function validateWorkItem(prev: WorkItem, next: WorkItem, now: LocalDT, field?: "start" | "end"): string | null {
  if ((next.status === "done" || next.end) && !next.tech) return MSG.doneWithoutTech;
  if ((next.start && next.start > now) || (next.end && next.end > now)) return MSG.futureTime;
  if (next.start && next.end && next.start > next.end) return field === "end" ? MSG.finishBeforeStart : MSG.startAfterFinish;
  if (prev.status === "done" && next.status === "done" && prev.start && !next.start) return MSG.clearStartOnDone;
  return null;
}

/** Send a Done part back. Same technician keeps it; the old segment is kept for occupancy history. */
export function rework(w: WorkItem, reason: string, by: string, now: LocalDT): Result<WorkItem> {
  if (w.status !== "done") return fail(MSG.reworkOnlyDone);
  const why = reason.trim();
  if (!why) return fail(MSG.reworkReason);
  const segFrom = w.segStart ?? w.start ?? now;
  return ok({
    ...w,
    status: "doing",
    rework: w.rework + 1,
    reworkLog: [...w.reworkLog, { at: now, why, by }],
    prevSegs: [...w.prevSegs, [segFrom, w.end ?? now]],
    segStart: now,
    end: null,
  });
}

/**
 * Bulk assign: every unassigned, not-done part in the stage goes to `tech`, skipping any that would clash.
 * `wouldConflict` is the double-booking check (conflicts.ts) bound to the current state.
 */
export function bulkAssign(items: WorkItem[], stageId: string, tech: string, wouldConflict: (next: WorkItem) => boolean) {
  const assigned: WorkItem[] = [];
  const skipped: WorkItem[] = [];
  for (const w of items) {
    if (w.stageId !== stageId || w.tech || w.status === "done") continue;
    const next = { ...w, tech };
    (wouldConflict(next) ? skipped : assigned).push(next);
  }
  return { assigned, skipped };
}

// ───────────── parts list ─────────────

export interface PartsDiff {
  keep: Part[];
  add: string[];
  /** Removing a part deletes its history in every stage — the UI must confirm (D5). */
  remove: Part[];
}

/** Text editor for the parts list: one per line, no duplicates. Unchanged names keep their id and history. */
export function diffPartsList(existing: Part[], text: string): Result<PartsDiff> {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const seen = new Set<string>();
  for (const l of lines) {
    const k = l.toLowerCase();
    if (seen.has(k)) return fail(MSG.duplicatePart(l));
    seen.add(k);
  }
  const byName = new Map(existing.map((p) => [p.name.trim().toLowerCase(), p]));
  const keep: Part[] = [];
  const add: string[] = [];
  for (const l of lines) {
    const hit = byName.get(l.toLowerCase());
    if (hit) keep.push({ ...hit, name: l });
    else add.push(l);
  }
  const kept = new Set(keep.map((p) => p.id));
  return ok({ keep, add, remove: existing.filter((p) => !kept.has(p.id)) });
}

/** Rename one part by id (D5): history stays. */
export function renamePart(existing: Part[], id: string, name: string): Result<Part[]> {
  const n = name.trim();
  if (existing.some((p) => p.id !== id && p.name.trim().toLowerCase() === n.toLowerCase())) return fail(MSG.duplicatePart(n));
  return ok(existing.map((p) => (p.id === id ? { ...p, name: n } : p)));
}

// ───────────── project side-effects ─────────────

/**
 * After any part or task leaves "todo": a planned build becomes active and gets a baseline if it has none.
 * After every task is done: the build is delivered today.
 */
export function projectAfterChange(p: Project, today: LocalDate): Pick<Project, "status" | "baseline" | "deliveredOn"> {
  let { status, baseline, deliveredOn } = p;
  const started = p.work.some((w) => w.status !== "todo") || p.tasks.some((t) => t.status !== "todo");
  if (status === "planned" && started) {
    status = "active";
    if (!Object.keys(baseline).length) baseline = baselineOf(p.tasks);
  }
  if (p.tasks.length && p.tasks.every((t) => t.status === "done") && status !== "done") {
    status = "done";
    deliveredOn = today;
  }
  return { status, baseline, deliveredOn };
}

/** Editing a task's planned end recomputes its duration: rounded to 0.5h, at least 0.5h. */
export function durationFromEnd(t: Pick<Task, "start">, end: LocalDT, cal: Calendar): Result<number> {
  if (!t.start || end <= t.start) return fail(MSG.taskEndBeforeStart);
  return ok(Math.max(0.5, Math.round(cal.wh(t.start, end) * 2) / 2));
}

/**
 * Start build (§14): status active, start = today's first work day, first task pinned to now,
 * re-scheduled, baseline if missing, first task → doing at 10% (v1 behaviour).
 */
export function startBuild(p: Project, cal: Calendar, now: LocalDT): Project {
  const startDate = cal.firstWork(now.slice(0, 10));
  const ordered = [...p.tasks].sort((a, b) => a.num - b.num);
  const pinned = ordered.map((t, i) => (i === 0 ? { ...t, pinnedStart: now } : t));
  const { tasks } = schedule({ startDate, tasks: pinned }, cal);
  const first = tasks[0];
  const withFirst = tasks.map((t) =>
    t === first && t.status === "todo" ? { ...t, status: "doing" as const, pct: Math.max(t.pct, 10) } : t,
  );
  return {
    ...p,
    status: "active",
    startDate,
    tasks: withFirst,
    baseline: Object.keys(p.baseline).length ? p.baseline : baselineOf(withFirst),
  };
}

/** What "Save as template" stores: stages, tasks and parts with hours; never dates, people or costs. */
export interface TemplateCopy {
  stages: { name: string; stationType: string; partHours: number; tasks: { name: string; durH: number }[] }[];
  parts: string[];
}

/**
 * Template from a build (v2, docs/ux/DECISIONS.md 2026-10-07). "plan": the build's planned hours.
 * "actual": the hours it really took where work is finished (finished tasks; the average of finished
 * part steps per stage), the plan everywhere else. Hours are working hours, rounded to the minute.
 */
export function templateFromBuild(p: Project, hours: "plan" | "actual", cal: Calendar, now: LocalDT): TemplateCopy {
  const m = (h: number) => Math.round(h * 60) / 60;
  return {
    stages: p.stages.map((s) => {
      const done = p.work.filter((w) => w.stageId === s.id && w.status === "done");
      const partHours = hours === "actual" && done.length
        ? done.reduce((sum, w) => sum + actualH(w, cal, now), 0) / done.length
        : s.partHours;
      return {
        name: s.name, stationType: s.stationType, partHours: m(partHours),
        tasks: p.tasks.filter((t) => t.stageId === s.id).sort((a, b) => a.num - b.num).map((t) => {
          const real = hours === "actual" && t.status === "done" && t.actualStart && t.actualEnd ? cal.wh(t.actualStart, t.actualEnd) : 0;
          return { name: t.name, durH: m(real > 0 ? real : t.durH) };
        }),
      };
    }),
    parts: p.parts.map((x) => x.name),
  };
}
