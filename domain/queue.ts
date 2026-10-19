/**
 * Per-employee task queue on the working clock (Phase 3.5, docs/PLAN.md §7.2, D9–D13).
 * Tasks run back to back in queue order from the current task (or now), on the working calendar.
 */
import { maxDT, type Calendar } from "./calendar";
import { fmtDT, fmtHM } from "./format";
import { MSG } from "./messages";
import type { ItemStatus } from "./types";
import { addDays, dateOf, type LocalDT, type LocalDate } from "./time";

export interface QueueTask {
  id: string;
  personId: string;
  title: string;
  durValue: number;
  durUnit: "hours" | "days";
  status: ItemStatus;
  /** "not before" (D13) */
  fixedStart: LocalDT | null;
  actualStart: LocalDT | null;
  actualEnd: LocalDT | null;
  /** fractional index; byte order = queue order (top first) */
  position: string;
}

export interface DaySegment {
  date: LocalDate;
  start: LocalDT;
  end: LocalDT;
  /** 1-based day number of this task, and how many working days it spans */
  day: number;
  days: number;
  /** runs on into the next working day */
  continues: boolean;
}

export interface PlacedTask {
  task: QueueTask;
  hours: number;
  start: LocalDT | null;
  end: LocalDT | null;
  /** where the plan says it should end; for an overrun, earlier than `end` */
  plannedEnd: LocalDT | null;
  /** in progress past its planned time: the bar grows to now (hatched) */
  overrun: boolean;
  /** a fixed start pushed later because the queue ran late (D13) */
  lateStart: boolean;
  /** blocked: takes no time, shown as a marker at `start` (D12) */
  blocked: boolean;
  current: boolean;
  segments: DaySegment[];
}

/** Duration in working hours: hours, or days × the working hours in one day. */
export const durationH = (t: Pick<QueueTask, "durValue" | "durUnit">, dayHours: number) =>
  t.durUnit === "days" ? t.durValue * dayHours : t.durValue;

/** Byte-order compare for fractional positions. */
export const byPosition = (a: { position: string }, b: { position: string }) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0);

/** Cut [start, end) into one segment per working day it touches (rest days and holidays have none). */
export function daySegments(start: LocalDT, end: LocalDT, cal: Calendar): DaySegment[] {
  if (end <= start) return [];
  const out: Omit<DaySegment, "day" | "days" | "continues">[] = [];
  for (let d = dateOf(start), n = 0; d <= dateOf(end) && n < 3660; d = addDays(d, 1), n++) {
    if (!cal.isWorkDay(d)) continue;
    const s = maxDT(start, cal.atShiftStart(d));
    const e = end < cal.atShiftEnd(d) ? end : cal.atShiftEnd(d);
    if (e > s && cal.wh(s, e) > 0) out.push({ date: d, start: s, end: e });
  }
  return out.map((x, i) => ({ ...x, day: i + 1, days: out.length, continues: i < out.length - 1 }));
}

/**
 * Lay a person's queue on the clock.
 * - Done: at its actual times; takes nothing from the future.
 * - In progress: from its actual start for its duration; past that and not done, the bar grows to now
 *   and pushes everything after it (overrun).
 * - Blocked: no time; a marker where it sits; the next task moves up (D12).
 * - Not started: from where the previous ends, or its fixed start if later (D13).
 */
export function layoutQueue(tasks: QueueTask[], cal: Calendar, now: LocalDT): PlacedTask[] {
  const ordered = [...tasks].sort(byPosition);
  const base = (t: QueueTask, hours: number): PlacedTask => ({
    task: t, hours, start: null, end: null, plannedEnd: null, overrun: false, lateStart: false, blocked: false, current: false, segments: [],
  });
  const placed = new Map<string, PlacedTask>();
  let cursor = cal.norm(now);

  for (const t of ordered.filter((x) => x.status === "done")) {
    const p = base(t, durationH(t, cal.dayHours));
    if (t.actualStart && t.actualEnd) Object.assign(p, { start: t.actualStart, end: t.actualEnd, plannedEnd: t.actualEnd, segments: daySegments(t.actualStart, t.actualEnd, cal) });
    placed.set(t.id, p);
  }
  // The current task comes first on the clock, wherever it sits in the list.
  for (const t of ordered.filter((x) => x.status === "doing")) {
    const hours = durationH(t, cal.dayHours);
    const start = t.actualStart ? cal.norm(t.actualStart) : cursor;
    const plannedEnd = cal.addWH(start, hours);
    const overrun = plannedEnd < now;
    const end = overrun ? now : plannedEnd;
    placed.set(t.id, { ...base(t, hours), start, end, plannedEnd, overrun, current: true, segments: daySegments(start, end, cal) });
    cursor = cal.norm(maxDT(cursor, end));
  }
  for (const t of ordered.filter((x) => x.status === "todo" || x.status === "blocked")) {
    const hours = durationH(t, cal.dayHours);
    if (t.status === "blocked") {
      placed.set(t.id, { ...base(t, hours), start: cursor, end: cursor, blocked: true });
      continue;
    }
    const fixed = t.fixedStart ? cal.norm(t.fixedStart) : null;
    const start = fixed && fixed > cursor ? fixed : cursor;
    const end = cal.addWH(start, hours);
    placed.set(t.id, { ...base(t, hours), start, end, plannedEnd: end, lateStart: !!fixed && fixed < cursor, segments: daySegments(start, end, cal) });
    cursor = cal.norm(end);
  }
  return ordered.map((t) => placed.get(t.id)!);
}

/** What one day's row shows: segments on that date, in clock order, plus how many queued tasks start after it. */
export function dayRow(placed: PlacedTask[], date: LocalDate) {
  const items = placed
    .flatMap((p) => p.segments.filter((s) => s.date === date).map((s) => ({ placed: p, seg: s })))
    .sort((a, b) => (a.seg.start < b.seg.start ? -1 : 1));
  const blocked = placed.filter((p) => p.blocked);
  const later = placed.filter((p) => !p.blocked && p.task.status !== "done" && p.segments.length && p.segments[0].date > date).length;
  return { items, blocked, more: later };
}

/** One task in progress at a time (§9): refuse starting another while one is open. */
export function checkStart(personName: string, tasks: QueueTask[], startingId: string, now: LocalDT): string | null {
  const open = tasks.find((t) => t.id !== startingId && t.status === "doing");
  if (!open) return null;
  return MSG.techBlockedTask(personName, open.title, open.actualStart ? fmtDT(open.actualStart) : fmtDT(now));
}

/** Status side-effects for a queue task (mirrors applyStatus for part-steps). */
export function applyQueueStatus(t: QueueTask, to: ItemStatus, now: LocalDT): QueueTask {
  switch (to) {
    case "doing":
      return { ...t, status: to, actualStart: t.actualStart ?? now, actualEnd: null };
    case "done":
      return { ...t, status: to, actualStart: t.actualStart ?? now, actualEnd: now };
    case "todo":
      return { ...t, status: to, actualStart: null, actualEnd: null };
    case "blocked":
      return { ...t, status: to };
  }
}

/** On time: actual working hours within the planned duration (+ the scoring tolerance). */
export function queueOnTime(t: QueueTask, cal: Calendar, toleranceH: number): boolean {
  if (t.status !== "done" || !t.actualStart || !t.actualEnd) return false;
  return cal.wh(t.actualStart, t.actualEnd) <= durationH(t, cal.dayHours) + toleranceH;
}

/** "45 min" / "2h 30m" / "1d 2h" (AM-28); without the day length, a task set in days reads "2 days". */
export const durationLabel = (t: Pick<QueueTask, "durValue" | "durUnit">, dayH = 0) =>
  t.durUnit === "days" && !dayH ? `${t.durValue} ${t.durValue === 1 ? "day" : "days"}` : fmtHM(durationH(t, dayH), dayH);

/** Shortest and longest task a person can be given, in working hours. */
export const MIN_TASK_H = 5 / 60;
export const MAX_TASK_H = 400;

/** Whole minutes, as hours. */
export const toMinute = (h: number) => Math.round(h * 60) / 60;

/**
 * A typed duration, in working hours rounded to the minute, or null when it can't be read.
 * Accepts "2h 30m", "2h30", "1h45min", "90m", "90 min", "1.5h", "1,5", "2:30" and a bare number of hours; given the
 * working hours of one day, also "1d", "1.5 days" and "1d 2h 30m".
 */
export function parseDuration(text: string, dayH = 0): number | null {
  let t = text.trim().toLowerCase().replace(",", ".").replace(/\s+/g, "");
  if (!t) return null;
  let h: number | null = null;
  let m: RegExpMatchArray | null;
  const finish = (x: number) => {
    const r = toMinute(x);
    return r >= MIN_TASK_H && r <= MAX_TASK_H ? r : null;
  };
  // Days first (AM-28): "1d", "1.5 days", "1d 2h", "1d2h30m"; a day is the working hours of one shift.
  let days = 0;
  if (dayH > 0 && (m = t.match(/^(\d+(?:\.\d+)?)(?:days|day|d)(.*)$/))) {
    days = +m[1] * dayH;
    t = m[2];
    if (!t) return finish(days);
  }
  if ((m = t.match(/^(\d+):([0-5]?\d)$/))) h = +m[1] + +m[2] / 60;
  else if ((m = t.match(/^(\d+(?:\.\d+)?)(?:h|hr|hrs|hour|hours)?$/))) h = +m[1];
  else if ((m = t.match(/^(\d+(?:\.\d+)?)(?:m|min|mins|minute|minutes)$/))) h = +m[1] / 60;
  else if ((m = t.match(/^(\d+)(?:h|hr|hrs|hour|hours)(\d+)(?:m|min|mins|minute|minutes)?$/))) h = +m[1] + +m[2] / 60;
  if (h === null || !Number.isFinite(h)) return null;
  return finish(days + h);
}
