/**
 * Working-hours calendar engine (spec §6). Every duration in the system is measured in working hours.
 * Built from settings: shift, break, rest days (several allowed) and public holidays (whole days, D3).
 */
import { minutesOf, type CalendarSettings } from "./settings";
import {
  MIN_PER_DAY, dateOfDay, dayIndex, dayOfDate, fromMin, isDateOnly, toMin, weekdayOfDay,
  type LocalDT, type LocalDate,
} from "./time";

export interface CalendarInput {
  calendar: Pick<CalendarSettings, "shiftStart" | "shiftEnd" | "breakStart" | "breakMins" | "restDays">;
  holidays: readonly LocalDate[];
}

/** Guards against a calendar with no working time at all. */
const MAX_SCAN_DAYS = 3660;

export interface Calendar {
  /** Working minutes of a normal (non-rest, non-holiday) day. */
  readonly dayHours: number;
  /** Work windows of a day as [startMin, endMin) minutes since midnight; empty on rest days and holidays. */
  windows(day: number): readonly (readonly [number, number])[];
  isWorkDay(date: LocalDate): boolean;
  /** Working hours between two times; negative when b is before a. Date-only: a → shift start, b → shift end. */
  wh(a: string, b: string): number;
  /** Next moment someone could be working (skips breaks, after-hours, rest days, holidays). */
  norm(x: string): LocalDT;
  /** The time `h` working hours after `x`. */
  addWH(x: string, h: number): LocalDT;
  /** The first working day on or after `date`. */
  firstWork(date: LocalDate): LocalDate;
  nextWorkDay(date: LocalDate): LocalDate;
  prevWorkDay(date: LocalDate): LocalDate;
  /** Date-only value → shift start / shift end of that day. */
  atShiftStart(date: LocalDate): LocalDT;
  atShiftEnd(date: LocalDate): LocalDT;
}

export function makeCalendar({ calendar: c, holidays }: CalendarInput): Calendar {
  const s = minutesOf(c.shiftStart);
  const e = minutesOf(c.shiftEnd);
  const bs = minutesOf(c.breakStart);
  const be = bs + c.breakMins;

  // v1: the break splits the shift only when it starts inside the shift.
  const base: [number, number][] =
    c.breakMins > 0 && bs >= s && bs < e
      ? ([[s, bs], [Math.min(be, e), e]] as [number, number][]).filter(([a, b]) => b > a)
      : [[s, e]];
  const workMinutes = base.reduce((t, [a, b]) => t + (b - a), 0);
  const rest = new Set(c.restDays);
  const hol = new Set(holidays);

  const windows = (day: number) => (rest.has(weekdayOfDay(day)) || hol.has(dateOfDay(day)) ? [] : base);
  const isWorkDayIdx = (day: number) => windows(day).length > 0;

  const startMin = (x: string) => toMin(x, s);
  const endMin = (x: string) => toMin(x, e);

  function sumRange(from: number, to: number): number {
    let total = 0;
    for (let d = dayIndex(from); d <= dayIndex(to); d++) {
      const ds = d * MIN_PER_DAY;
      for (const [a, b] of windows(d)) {
        const lo = Math.max(from, ds + a);
        const hi = Math.min(to, ds + b);
        if (hi > lo) total += hi - lo;
      }
    }
    return total;
  }

  function normMin(m: number): number {
    for (let d = dayIndex(m), n = 0; n < MAX_SCAN_DAYS; d++, n++) {
      const ds = d * MIN_PER_DAY;
      for (const [a, b] of windows(d)) if (m < ds + b) return Math.max(m, ds + a);
    }
    throw new Error("The working calendar has no working time.");
  }

  function addMin(m0: number, minutes: number): number {
    let m = normMin(m0);
    let rem = minutes;
    if (rem <= 0) return m;
    for (let d = dayIndex(m), n = 0; n < MAX_SCAN_DAYS * 10; d++, n++) {
      const ds = d * MIN_PER_DAY;
      for (const [a, b] of windows(d)) {
        const start = Math.max(m, ds + a);
        if (start >= ds + b) continue;
        const avail = ds + b - start;
        if (rem <= avail) return start + rem;
        rem -= avail;
        m = ds + b;
      }
    }
    throw new Error("The working calendar has no working time.");
  }

  function scanWorkDay(date: LocalDate, step: 1 | -1, inclusive: boolean): LocalDate {
    let d = dayOfDate(date) + (inclusive ? 0 : step);
    for (let n = 0; n < MAX_SCAN_DAYS; n++, d += step) if (isWorkDayIdx(d)) return dateOfDay(d);
    throw new Error("The working calendar has no working days.");
  }

  return {
    dayHours: workMinutes / 60,
    windows,
    isWorkDay: (date) => isWorkDayIdx(dayOfDate(date)),
    wh(a, b) {
      const am = startMin(a);
      const bm = isDateOnly(b) ? endMin(b) : toMin(b);
      return bm >= am ? sumRange(am, bm) / 60 : -sumRange(bm, am) / 60;
    },
    norm: (x) => fromMin(normMin(toMin(x))),
    addWH: (x, h) => fromMin(Math.round(addMin(toMin(x), h * 60))),
    firstWork: (date) => scanWorkDay(date, 1, true),
    nextWorkDay: (date) => scanWorkDay(date, 1, false),
    prevWorkDay: (date) => scanWorkDay(date, -1, false),
    atShiftStart: (date) => fromMin(toMin(date, s)),
    atShiftEnd: (date) => fromMin(toMin(date, e)),
  };
}

/** Max of two LocalDTs (string compare is chronological for this format). */
export const maxDT = (a: LocalDT, b: LocalDT): LocalDT => (a > b ? a : b);
export const minDT = (a: LocalDT, b: LocalDT): LocalDT => (a < b ? a : b);
