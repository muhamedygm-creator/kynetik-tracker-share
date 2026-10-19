/**
 * Admin QC between stages (AMENDS_NEXT_ROUND AM-06, AM-07; answers in docs/ux/DECISIONS.md 2026-10-12).
 * Applies to projects on the new workflow (Project.gated). A finished step waits for QC while still In
 * Progress, so the wait counts inside its allocated time; approval marks it Done, a rejection sends it back
 * to the same technician as rework. A stage starts only once every earlier stage of the part is approved.
 * The database enforces the same rules (migration 20261012000300); these give the screens their wording.
 */
import type { Calendar } from "./calendar";
import type { LocalDT } from "./time";
import type { Project, Stage, WorkItem } from "./types";

const stageOrder = (p: Pick<Project, "stages">) => new Map(p.stages.map((s, i) => [s.id, i]));

/** Why this step can't start yet, or null when it can. */
export function startBlocker(p: Pick<Project, "stages" | "work" | "gated">, w: Pick<WorkItem, "partId" | "stageId" | "componentTotal">): string | null {
  if (!p.gated) return null;
  const order = stageOrder(p);
  const mine = order.get(w.stageId) ?? 0;
  const waiting = [...new Set(p.work
    .filter((x) => x.partId === w.partId && (order.get(x.stageId) ?? 0) < mine && x.status !== "done")
    .map((x) => p.stages.find((s) => s.id === x.stageId)?.name ?? ""))];
  if (waiting.length) return `This part is still in ${waiting.join(", ")}. A stage starts once the stage before it has passed QC.`;
  const st = p.stages.find((s) => s.id === w.stageId);
  if (st?.step === "mold" && !w.componentTotal) return "Set how many mold components this part needs before Mold production starts.";
  return null;
}

export const waitingQc = (w: Pick<WorkItem, "qcSince" | "status">) => w.status === "doing" && !!w.qcSince;

/** "Mold component 2 of 4", for a step that is one of several. */
export const componentLabel = (w: Pick<WorkItem, "componentNo" | "componentTotal">) =>
  w.componentNo && w.componentTotal ? `Mold component ${w.componentNo} of ${w.componentTotal}` : null;

/** A step's name for lists: the part, plus its mold component when it is one. */
export const stepName = (partName: string, w: Pick<WorkItem, "componentNo" | "componentTotal">) => {
  const c = componentLabel(w);
  return c ? `${partName} · ${c}` : partName;
};

/** Parts whose pre-mold has passed QC but whose mold components haven't been counted yet (AM-06). */
export function needsMoldCount(p: Pick<Project, "stages" | "work" | "parts" | "gated">): { partId: string; moldItemId: string }[] {
  if (!p.gated) return [];
  const premold = p.stages.find((s) => s.step === "premold");
  const mold = p.stages.find((s) => s.step === "mold");
  if (!premold || !mold) return [];
  return p.parts.flatMap((part) => {
    const pre = p.work.filter((w) => w.partId === part.id && w.stageId === premold.id);
    const m = p.work.filter((w) => w.partId === part.id && w.stageId === mold.id);
    return pre.length && pre.every((w) => w.status === "done") && m.length === 1 && !m[0].componentTotal
      ? [{ partId: part.id, moldItemId: m[0].id }] : [];
  });
}

type Timed = Pick<WorkItem, "start" | "end" | "segStart" | "prevSegs" | "prevSegAttempts" | "attempt">;
const current = (w: Timed, cal: Calendar, now: LocalDT) => {
  const from = w.segStart ?? w.start;
  return from ? Math.max(0, cal.wh(from, w.end ?? now)) : 0;
};

/** Working hours of the first attempt (its QC wait included). */
export function firstAttemptH(w: Timed, cal: Calendar, now: LocalDT): number {
  if ((w.attempt ?? 1) <= 1) return current(w, cal, now);
  return w.prevSegs.reduce((s, [a, b], i) => s + ((w.prevSegAttempts?.[i] ?? 1) <= 1 ? Math.max(0, cal.wh(a, b)) : 0), 0);
}

/** Working hours spent after QC (or a later check) sent it back: kept apart for scoring and estimates (AM-07). */
export function reworkH(w: Timed, cal: Calendar, now: LocalDT): number {
  const before = w.prevSegs.reduce((s, [a, b], i) => s + ((w.prevSegAttempts?.[i] ?? 1) > 1 ? Math.max(0, cal.wh(a, b)) : 0), 0);
  return before + ((w.attempt ?? 1) > 1 ? current(w, cal, now) : 0);
}

/** Steps waiting for QC across projects, longest wait first. */
export function qcQueue<P extends Pick<Project, "id" | "stages" | "work">>(projects: P[]): { project: P; item: WorkItem; stage: Stage }[] {
  return projects
    .flatMap((p) => p.work.filter(waitingQc).map((item) => ({ project: p, item, stage: p.stages.find((s) => s.id === item.stageId)! })))
    .filter((x) => x.stage)
    .sort((a, b) => (a.item.qcSince! < b.item.qcSince! ? -1 : 1));
}

/**
 * Plan of a new-workflow project (AM-08): only the times admins set count. A step is planned when it sits on
 * someone's task queue; the forecast finish is the latest planned end, and steps not on any queue are
 * counted, never estimated.
 */
export function panelPlan(
  p: Pick<Project, "work">,
  queue: { id: string; workItemId: string | null; status: string }[],
  plannedEnd: (queueTaskId: string) => LocalDT | null,
): { finish: LocalDT | null; unplanned: number; planned: number } {
  let finish: LocalDT | null = null;
  let unplanned = 0;
  let planned = 0;
  for (const w of p.work) {
    if (w.status === "done") {
      if (w.end && (!finish || w.end > finish)) finish = w.end;
      continue;
    }
    const q = queue.find((t) => t.workItemId === w.id && t.status !== "done");
    const end = q ? plannedEnd(q.id) : null;
    if (!end) { unplanned++; continue; }
    planned++;
    if (!finish || end > finish) finish = end;
  }
  return { finish: unplanned && !planned ? null : finish, unplanned, planned };
}

/**
 * After a step passes QC (Owner, 2026-10-15): the steps that can start now because of it, to plan straight away.
 * For each of the part's units (the part itself, or its sub-parts after a split) the earliest later stage with
 * work still to do, when nothing else holds it back. `moldPartId` is set when the next stage is Mold production
 * and its component count isn't set yet.
 */
export function nextSteps(p: Pick<Project, "stages" | "work" | "gated" | "parts">, itemId: string): { steps: WorkItem[]; moldPartId: string | null } {
  const it = p.work.find((x) => x.id === itemId);
  if (!it || !p.gated) return { steps: [], moldPartId: null };
  const order = stageOrder(p);
  const mine = order.get(it.stageId) ?? 0;
  const units = new Set([it.partId, ...p.parts.filter((x) => x.parentId === it.partId).map((x) => x.id)]);
  const later = p.work.filter((x) => units.has(x.partId) && (order.get(x.stageId) ?? 0) > mine && x.status !== "done");
  const first = new Map<string, number>();
  for (const x of later) first.set(x.partId, Math.min(first.get(x.partId) ?? Infinity, order.get(x.stageId) ?? 0));
  const due = later.filter((x) => (order.get(x.stageId) ?? 0) === first.get(x.partId));
  const mold = due.find((x) => p.stages.find((s) => s.id === x.stageId)?.step === "mold" && !x.componentTotal);
  const steps = due.filter((x) => x.status === "todo" && !startBlocker(p, x))
    .sort((a, b) => (order.get(a.stageId)! - order.get(b.stageId)!) || a.partId.localeCompare(b.partId) || (a.componentNo ?? 0) - (b.componentNo ?? 0));
  return { steps, moldPartId: mold ? mold.partId : null };
}
