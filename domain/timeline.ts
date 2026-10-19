/**
 * Timeline / Gantt helpers (spec §14). Dragging a task bar snaps to whole days (to whole hours in the
 * Hours zoom), lands on working time, and pins the task there; later tasks re-flow (schedule.ts).
 */
import type { Calendar } from "./calendar";
import type { TimelineSettings } from "./settings";
import { addDays, dateOf, fromMin, toMin, type LocalDT, type LocalDate } from "./time";
import type { Health, ItemStatus, Project } from "./types";

export type Zoom = TimelineSettings["defaultZoom"];

/** Where a dragged task starts: snapped, then normalised onto working time. */
export function snapMove(start: LocalDT, dxPx: number, zoom: Zoom, px: TimelineSettings["pxPerDay"], cal: Calendar): LocalDT {
  if (zoom === "hours") {
    const hours = Math.round((dxPx / px.hours) * 24);
    return cal.norm(fromMin(toMin(start) + hours * 60));
  }
  const days = Math.round(dxPx / px[zoom]);
  if (days === 0) return start;
  return cal.norm(cal.atShiftStart(addDays(dateOf(start), days)));
}

/** The visible date range: a few days before the earliest start to a week after the latest end. */
export function timelineRange(points: (LocalDT | null | undefined)[], now: LocalDT): { from: string; to: string } {
  const xs = [...points.filter(Boolean) as string[], now].map(dateOf).sort();
  return { from: addDays(xs[0], -3), to: addDays(xs[xs.length - 1], 7) };
}

/** Master view counts for the Timeline header (v2 sketch, docs/ux/DECISIONS.md 2026-10-07). */
export interface MasterCounts {
  active: number;
  hold: number;
  planned: number;
  late: number;
  /** part steps blocked, and in how many builds */
  blockedSteps: number;
  blockedBuilds: number;
  /** part steps finished since Monday 00:00, and builds delivered since Monday */
  doneThisWeek: number;
  deliveredThisWeek: number;
  /** production people with something in progress now, out of the active production crew */
  atWork: number;
  crew: number;
}

export function masterCounts(input: {
  builds: { project: Project; health: Health }[];
  queue: { personId: string; status: ItemStatus }[];
  crewIds: string[];
  monday: LocalDate;
}): MasterCounts {
  const open = input.builds.filter((b) => b.project.status !== "done");
  const from = `${input.monday}T00:00`;
  const blockedBy = open.map((b) => b.project.work.filter((x) => x.status === "blocked").length);
  const busy = new Set<string>();
  for (const q of input.queue) if (q.status === "doing") busy.add(q.personId);
  for (const b of open) for (const x of b.project.work) if (x.status === "doing" && x.tech) busy.add(x.tech);
  const crew = new Set(input.crewIds);
  return {
    active: open.filter((b) => b.project.status === "active").length,
    hold: open.filter((b) => b.project.status === "hold").length,
    planned: open.filter((b) => b.project.status === "planned").length,
    late: open.filter((b) => b.health === "late").length,
    blockedSteps: blockedBy.reduce((s, n) => s + n, 0),
    blockedBuilds: blockedBy.filter((n) => n > 0).length,
    doneThisWeek: input.builds.reduce((s, b) => s + b.project.work.filter((x) => x.status === "done" && x.end && x.end >= from).length, 0),
    deliveredThisWeek: input.builds.filter((b) => b.project.status === "done" && b.project.deliveredOn && b.project.deliveredOn >= input.monday).length,
    atWork: [...busy].filter((id) => crew.has(id)).length,
    crew: crew.size,
  };
}

/** Master view order: builds that are late or have a blocked step first, then the board order given. */
export function masterSort<T extends { health: Health; blocked: number }>(rows: T[]): T[] {
  const urgent = (r: T) => (r.health === "late" || r.blocked > 0 ? 0 : 1);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => urgent(a.r) - urgent(b.r) || a.i - b.i).map((x) => x.r);
}

export type MasterFilter = "all" | "active" | "hold" | "planned" | "late" | "blocked";

/** Which builds a status chip shows. */
export function masterFilter(f: MasterFilter, b: { status: Project["status"]; health: Health; blocked: number }): boolean {
  switch (f) {
    case "all": return true;
    case "late": return b.health === "late";
    case "blocked": return b.blocked > 0;
    default: return b.status === f;
  }
}
