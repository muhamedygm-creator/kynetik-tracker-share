/**
 * Shop-local wall-clock time. The domain never sees time zones: a LocalDT is what the clock on the
 * workshop wall says ("YYYY-MM-DDTHH:mm"). The app converts at the edges with the timezone setting.
 * Internally we use "local minutes": minutes since 1970-01-01 00:00 of that wall clock (parsed as UTC
 * so there is no DST drift, as in v1 §6).
 */

export type LocalDT = string; // "YYYY-MM-DDTHH:mm"
export type LocalDate = string; // "YYYY-MM-DD"

export const MIN_PER_DAY = 1440;

const DT_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

export function isDateOnly(x: string): boolean {
  return x.length === 10;
}

/** Minutes since epoch of a LocalDT or LocalDate. A date-only value is placed at `dateOnlyMinute` (default 00:00). */
export function toMin(x: string, dateOnlyMinute = 0): number {
  const m = DT_RE.exec(x);
  if (!m) throw new Error(`Not a date/time: ${x}`);
  const days = Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86_400_000;
  const mins = m[4] === undefined ? dateOnlyMinute : +m[4] * 60 + +m[5];
  return days * MIN_PER_DAY + mins;
}

export function fromMin(min: number): LocalDT {
  return new Date(Math.round(min) * 60_000).toISOString().slice(0, 16);
}

export function dayIndex(min: number): number {
  return Math.floor(min / MIN_PER_DAY);
}

export function dateOfDay(day: number): LocalDate {
  return new Date(day * 86_400_000).toISOString().slice(0, 10);
}

export function dayOfDate(date: LocalDate): number {
  return toMin(date) / MIN_PER_DAY;
}

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function addDays(date: LocalDate, n: number): LocalDate {
  return dateOfDay(dayOfDate(date) + n);
}

export const dateOf = (x: string): LocalDate => x.slice(0, 10);

// ───────────── time-zone edges ─────────────

function partsIn(tz: string, utcMs: number) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** A UTC instant (ISO string or Date) → shop wall-clock time. */
export function utcToLocal(utc: string | Date, tz: string): LocalDT {
  return partsIn(tz, new Date(utc).getTime());
}

/** Shop wall-clock time → UTC ISO string. */
export function localToUtc(local: LocalDT, tz: string): string {
  const wall = toMin(local) * 60_000;
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const offset = toMin(partsIn(tz, guess)) * 60_000 - guess;
    guess = wall - offset;
  }
  return new Date(guess).toISOString();
}
