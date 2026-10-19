/**
 * Week planner geometry (docs/ROADMAP.md v1.4). The planner draws working time only: each working day is
 * `dayHours` wide and breaks take no space. These helpers convert between a shop-local time and an
 * offset in working hours, and decide where a dropped task goes in a person's queue.
 * The queue rules themselves stay in queue.ts (D12/D13): a drop pins a "not before" start and the
 * queue position; later tasks move along.
 */
import type { Calendar } from "./calendar";
import { byPosition, type PlacedTask } from "./queue";
import { addDays, dayOfDate, weekdayOfDay, type LocalDT, type LocalDate } from "./time";

/** Monday of the week that holds `date`. */
export function mondayOf(date: LocalDate): LocalDate {
  const wd = weekdayOfDay(dayOfDate(date));
  return addDays(date, -((wd + 6) % 7));
}

/** The working days Monday → Sunday of the week starting `monday`. */
export function weekDays(cal: Calendar, monday: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i)).filter((d) => cal.isWorkDay(d));
}

/** Working hours from the shift start of `date` to `dt`, clamped to the day. */
export function offsetH(cal: Calendar, date: LocalDate, dt: LocalDT): number {
  if (dt <= cal.atShiftStart(date)) return 0;
  if (dt >= cal.atShiftEnd(date)) return cal.dayHours;
  return cal.wh(cal.atShiftStart(date), dt);
}

/** The time `h` working hours after the shift start of `date` (the shift end for a full day). */
export function atOffset(cal: Calendar, date: LocalDate, h: number): LocalDT {
  if (h <= 0) return cal.atShiftStart(date);
  if (h >= cal.dayHours) return cal.atShiftEnd(date);
  return cal.addWH(cal.atShiftStart(date), h);
}

/**
 * Where a task dropped at `at` goes in a person's queue: before the first waiting task that would
 * start at or after `at`, after everything else. `placed` is the person's laid-out queue without the
 * task being moved. Returns the neighbours' ids (either may be null).
 */
export function insertionPoint(placed: PlacedTask[], at: LocalDT): { afterId: string | null; beforeId: string | null } {
  const ordered = [...placed].sort((a, b) => byPosition(a.task, b.task));
  const i = ordered.findIndex((p) => (p.task.status === "todo" || p.task.status === "blocked") && p.start !== null && p.start >= at);
  if (i === -1) return { afterId: ordered.at(-1)?.task.id ?? null, beforeId: null };
  return { afterId: ordered[i - 1]?.task.id ?? null, beforeId: ordered[i].task.id };
}

/** Working hours a person has planned in [from, to) (segments clipped to the window). */
export function plannedH(cal: Calendar, placed: PlacedTask[], from: LocalDT, to: LocalDT): number {
  let h = 0;
  for (const p of placed) {
    if (p.blocked || p.task.status === "done") continue;
    for (const s of p.segments) {
      const a = s.start > from ? s.start : from, b = s.end < to ? s.end : to;
      if (b > a) h += cal.wh(a, b);
    }
  }
  return h;
}
