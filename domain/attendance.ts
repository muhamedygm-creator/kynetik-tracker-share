/**
 * Attendance and absences (amends AM-29). Everyone is present unless an admin marks them absent for a number of
 * working days. An absence takes those days out of the person's own calendar:
 *   · for planning (their queue skips them), every absence;
 *   · for scoring (on time, pace, streaks), only sick, annual and unpaid / other leave; an unexcused absence
 *     still counts against them.
 */
import { makeCalendar, type Calendar, type CalendarInput } from "./calendar";
import { fmtDate } from "./format";
import { addDays } from "./time";
import type { LocalDate } from "./time";

export const LEAVE_TYPES = ["sick", "annual", "unpaid", "unexcused"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];
export const LEAVE_LABEL: Record<LeaveType, string> = {
  sick: "Sick leave", annual: "Annual leave", unpaid: "Unpaid / other leave", unexcused: "Unexcused absence",
};
/** Leave that doesn't count against the person's score or task delay. */
export const excused = (k: LeaveType) => k !== "unexcused";

export interface Absence {
  id: string;
  personId: string;
  kind: LeaveType;
  startsOn: LocalDate;
  days: number;
  /** Last absent working day. */
  endsOn: LocalDate;
  /** First working day back. */
  backOn: LocalDate;
  note: string;
  cancelled: boolean;
}

/** `days` working days from `from` (moved on to a working day if needed): the first and last day, and the day back. */
export function absenceSpan(cal: Calendar, from: LocalDate, days: number): { startsOn: LocalDate; endsOn: LocalDate; backOn: LocalDate } {
  const startsOn = cal.isWorkDay(from) ? from : cal.nextWorkDay(from);
  let endsOn = startsOn;
  for (let i = 1; i < days; i++) endsOn = cal.nextWorkDay(endsOn);
  return { startsOn, endsOn, backOn: cal.nextWorkDay(endsOn) };
}

/** The person's absence covering a day, if any (cancelled ones don't count). */
export const absentOn = (absences: Absence[], personId: string, day: LocalDate) =>
  absences.find((a) => !a.cancelled && a.personId === personId && a.startsOn <= day && day <= a.endsOn);

/** "Annual leave · back 20 Oct" */
export const awayLabel = (a: Pick<Absence, "kind" | "backOn">) => `${LEAVE_LABEL[a.kind]} · back ${fmtDate(a.backOn)}`;

/** Every calendar day an absence covers (rest days inside it are already off). */
export function absenceDays(a: Pick<Absence, "startsOn" | "endsOn">): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = a.startsOn; d <= a.endsOn && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * A person's own calendar: the shop calendar with their absences as days off. `scoring` keeps only excused
 * leave, so an unexcused absence still counts against them.
 */
export function personCalendar(input: CalendarInput, absences: Absence[], personId: string, scoring = false): Calendar | null {
  const mine = absences.filter((a) => !a.cancelled && a.personId === personId && (!scoring || excused(a.kind)));
  if (!mine.length) return null;
  return makeCalendar({ calendar: input.calendar, holidays: [...input.holidays, ...mine.flatMap(absenceDays)] });
}

/** Calendars per person, built once: `away` for planning, `score` for scoring. Falls back to the shop calendar. */
export function calendarsFor(input: CalendarInput, shop: Calendar, absences: Absence[]) {
  const away = new Map<string, Calendar>(), score = new Map<string, Calendar>();
  const get = (m: Map<string, Calendar>, id: string, scoring: boolean) => {
    if (!m.has(id)) m.set(id, personCalendar(input, absences, id, scoring) ?? shop);
    return m.get(id)!;
  };
  return { away: (id: string) => get(away, id, false), score: (id: string) => get(score, id, true) };
}
