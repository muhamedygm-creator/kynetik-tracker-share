/**
 * Technician double-booking and plan clashes (spec §9).
 */
import { stepName } from "./qc";
import { fmtDT } from "./format";
import { MSG } from "./messages";
import { stageAgg } from "./schedule";
import type { BookingSettings } from "./settings";
import type { Person, Project, Station, WorkItem } from "./types";
import type { LocalDT } from "./time";

export interface Segment {
  start: LocalDT;
  end: LocalDT;
  /** true when the segment runs until now (item still in progress) */
  open: boolean;
}

/** Time a work item occupies its technician: earlier segments + the current one while doing or done. Blocked frees the tech. */
export function occupancy(w: WorkItem, now: LocalDT): Segment[] {
  const segs: Segment[] = w.prevSegs.map(([start, end]) => ({ start, end, open: false }));
  const from = w.segStart ?? w.start;
  if ((w.status === "doing" || w.status === "done") && from) {
    segs.push({ start: from, end: w.end ?? now, open: !w.end });
  }
  return segs;
}

/** An open segment (still in progress) runs on until it is closed, so starting now next to it still clashes. */
const OPEN_END = "9999-12-31T23:59";
const endOf = (s: Segment) => (s.open ? OPEN_END : s.end);
const overlaps = (a: Segment, b: Segment) => a.start < endOf(b) && b.start < endOf(a);

export interface ItemRef {
  project: Pick<Project, "id" | "serial" | "stages" | "parts">;
  item: WorkItem;
}

export interface TechConflict {
  tech: string;
  a: ItemRef;
  b: ItemRef;
  /** the overlapping segment of b */
  seg: Segment;
}

function exempt(a: ItemRef, b: ItemRef, mode: BookingSettings["techMode"]): boolean {
  if (a.item.id === b.item.id) return true;
  // stage mode: several parts of the same stage of the same build at once is batch work, allowed.
  return mode === "stage" && a.project.id === b.project.id && a.item.stageId === b.item.stageId;
}

/** Every work item in a set of builds, with its build. */
export function allItems(projects: (ItemRef["project"] & { work: WorkItem[] })[]): ItemRef[] {
  return projects.flatMap((p) => p.work.map((item) => ({ project: p, item })));
}

/** First clash the candidate (an item after its proposed change) would create, or null. */
export function findTechConflict(candidate: ItemRef, world: ItemRef[], mode: BookingSettings["techMode"], now: LocalDT): TechConflict | null {
  const tech = candidate.item.tech;
  if (!tech) return null;
  const mine = occupancy(candidate.item, now);
  if (!mine.length) return null;
  for (const other of world) {
    if (other.item.tech !== tech || exempt(candidate, other, mode)) continue;
    for (const seg of occupancy(other.item, now)) {
      if (mine.some((m) => overlaps(m, seg))) return { tech, a: candidate, b: other, seg };
    }
  }
  return null;
}

export const describeItem = (r: ItemRef) => {
  const stage = r.project.stages.find((s) => s.id === r.item.stageId)?.name ?? "?";
  const part = stepName(r.project.parts.find((p) => p.id === r.item.partId)?.name ?? "?", r.item);
  return { serial: r.project.serial, stage, part };
};

/** The §9 refusal message for a conflict. */
export function conflictMessage(c: TechConflict, people: Pick<Person, "id" | "name">[]): string {
  const name = people.find((p) => p.id === c.tech)?.name ?? "This technician";
  const { serial, stage, part } = describeItem(c.b);
  return MSG.techBlocked(name, serial, stage, part, fmtDT(c.seg.start), c.seg.open ? "now" : fmtDT(c.seg.end));
}

/** Every existing overlap in the data (legacy "data health", and the techDoubleBooked alert). One entry per pair. */
export function techDoubleBookings(world: ItemRef[], mode: BookingSettings["techMode"], now: LocalDT): TechConflict[] {
  const out: TechConflict[] = [];
  for (let i = 0; i < world.length; i++) {
    const a = world[i];
    if (!a.item.tech) continue;
    const segA = occupancy(a.item, now);
    if (!segA.length) continue;
    for (let j = i + 1; j < world.length; j++) {
      const b = world[j];
      if (b.item.tech !== a.item.tech || exempt(a, b, mode)) continue;
      const seg = occupancy(b.item, now).find((s) => segA.some((m) => overlaps(m, s)));
      if (seg) out.push({ tech: a.item.tech, a, b, seg });
    }
  }
  return out;
}

/** Dropdown annotation for people already on something: "Name — busy: {serial} · {stage}". */
export function busyLabel(person: Pick<Person, "id" | "name">, world: ItemRef[]): string {
  const open = world.find((r) => r.item.tech === person.id && r.item.status === "doing");
  if (!open) return person.name;
  const { serial, stage } = describeItem(open);
  return `${person.name} — busy: ${serial} · ${stage}`;
}

// ───────────── plan-level clashes ─────────────

export interface PlanClash {
  kind: "station" | "person";
  /** station or person id */
  resourceId: string;
  resourceName: string;
  a: { projectId: string; serial: string; label: string; start: LocalDT; end: LocalDT };
  b: { projectId: string; serial: string; label: string; start: LocalDT; end: LocalDT };
}

/**
 * Station clash: two unfinished stages on the same workstation with overlapping scheduled windows.
 * Person clash: the same task lead on overlapping unfinished tasks (same-stage tasks of one build exempt in stage mode).
 */
export function planClashes(projects: Project[], stations: Station[], people: Pick<Person, "id" | "name">[], mode: BookingSettings["techMode"]): PlanClash[] {
  const out: PlanClash[] = [];
  const live = projects.filter((p) => p.status !== "done");

  const stageRows = live.flatMap((p) =>
    p.stages
      .filter((s) => s.stationId)
      .map((s) => ({ p, s, agg: stageAgg(p, s) }))
      .filter((r) => !r.agg.done && r.agg.start && r.agg.end),
  );
  for (let i = 0; i < stageRows.length; i++) {
    for (let j = i + 1; j < stageRows.length; j++) {
      const A = stageRows[i], B = stageRows[j];
      if (A.s.stationId !== B.s.stationId) continue;
      if (!(A.agg.start! < B.agg.end! && B.agg.start! < A.agg.end!)) continue;
      out.push({
        kind: "station",
        resourceId: A.s.stationId!,
        resourceName: stations.find((x) => x.id === A.s.stationId)?.name ?? "Workstation",
        a: { projectId: A.p.id, serial: A.p.serial, label: A.s.name, start: A.agg.start!, end: A.agg.end! },
        b: { projectId: B.p.id, serial: B.p.serial, label: B.s.name, start: B.agg.start!, end: B.agg.end! },
      });
    }
  }

  const taskRows = live.flatMap((p) => p.tasks.filter((t) => t.assignee && t.status !== "done" && t.start && t.end).map((t) => ({ p, t })));
  for (let i = 0; i < taskRows.length; i++) {
    for (let j = i + 1; j < taskRows.length; j++) {
      const A = taskRows[i], B = taskRows[j];
      if (A.t.assignee !== B.t.assignee) continue;
      if (mode === "stage" && A.p.id === B.p.id && A.t.stageId === B.t.stageId) continue;
      if (!(A.t.start! < B.t.end! && B.t.start! < A.t.end!)) continue;
      out.push({
        kind: "person",
        resourceId: A.t.assignee!,
        resourceName: people.find((x) => x.id === A.t.assignee)?.name ?? "Task lead",
        a: { projectId: A.p.id, serial: A.p.serial, label: A.t.name, start: A.t.start!, end: A.t.end! },
        b: { projectId: B.p.id, serial: B.p.serial, label: B.t.name, start: B.t.start!, end: B.t.end! },
      });
    }
  }
  return out;
}

/** Clashes a change to one build would take part in (used when moving or editing tasks). */
export const clashesInvolving = (clashes: PlanClash[], projectId: string) =>
  clashes.filter((c) => c.a.projectId === projectId || c.b.projectId === projectId);
