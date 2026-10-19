/**
 * Floor log: attendance and hours (spec §12).
 */
import type { Calendar } from "./calendar";
import { fmtDate } from "./format";
import { MSG } from "./messages";
import type { FloorSettings, ScoringSettings } from "./settings";
import type { LocalDT, LocalDate } from "./time";
import type { Project } from "./types";
import { actualH, standardH } from "./work";

export interface HourLog {
  personId: string;
  projectId: string;
  workItemId: string;
  hours: number;
  /** Hour rate snapshotted at logging time — owner only, absent otherwise. */
  rate?: number;
}

/** A working day holds `dayHours` per person (D2: derived from the shift). */
export function checkDayCap(name: string, alreadyH: number, addH: number, date: LocalDate, dayHours: number): string | null {
  return alreadyH + addH > dayHours + 1e-9 ? MSG.overLogging(name, alreadyH, fmtDate(date), dayHours) : null;
}

export const hoursLeft = (alreadyH: number, dayHours: number) => Math.max(0, dayHours - alreadyH);

const roundDown = (h: number, step: number) => Math.floor(h / step + 1e-9) * step;

/**
 * Fill from assignments: each present person's remaining hours are split evenly across their
 * In Progress parts, rounded down to the log step, the remainder going to the last part.
 */
export function fillFromAssignments(
  present: string[],
  loggedH: Record<string, number>,
  inProgress: Record<string, { projectId: string; workItemId: string }[]>,
  dayHours: number,
  f: Pick<FloorSettings, "logStepH">,
): HourLog[] {
  const out: HourLog[] = [];
  for (const personId of present) {
    const items = inProgress[personId] ?? [];
    const remaining = roundDown(hoursLeft(loggedH[personId] ?? 0, dayHours), f.logStepH);
    if (!items.length || remaining <= 0) continue;
    const each = roundDown(remaining / items.length, f.logStepH);
    items.forEach((it, i) => {
      const hours = i === items.length - 1 ? Math.round((remaining - each * (items.length - 1)) * 100) / 100 : each;
      if (hours > 0) out.push({ personId, ...it, hours });
    });
  }
  return out;
}

/** Hours available on site: present people × day hours. */
export const availableH = (presentCount: number, dayHours: number) => presentCount * dayHours;

/** This week: utilisation = hours ÷ (days in × day hours); warn below the threshold. */
export function utilisation(hours: number, daysIn: number, dayHours: number, s: Pick<ScoringSettings, "utilisationWarnPct">) {
  const pct = daysIn && dayHours ? (hours / (daysIn * dayHours)) * 100 : null;
  return { pct, warn: pct !== null && pct < s.utilisationWarnPct };
}

/**
 * Saving a day (v1 commitDay): reverse the old logs, apply the new ones.
 * Returns the change per work item and per build; the DB function applies it in one transaction.
 */
export function dayDelta(oldLogs: HourLog[], newLogs: HourLog[]) {
  const items = new Map<string, { projectId: string; hours: number; cost: number; hoursBy: Record<string, number> }>();
  const labour = new Map<string, number>();
  const apply = (l: HourLog, sign: 1 | -1) => {
    const it = items.get(l.workItemId) ?? { projectId: l.projectId, hours: 0, cost: 0, hoursBy: {} };
    it.hours += sign * l.hours;
    it.hoursBy[l.personId] = (it.hoursBy[l.personId] ?? 0) + sign * l.hours;
    const c = l.rate === undefined ? 0 : sign * l.hours * l.rate;
    it.cost += c;
    items.set(l.workItemId, it);
    labour.set(l.projectId, (labour.get(l.projectId) ?? 0) + c);
  };
  oldLogs.forEach((l) => apply(l, -1));
  newLogs.forEach((l) => apply(l, 1));
  return { items, labour };
}

/** Who's on what: per technician, open items, hours queued (remaining standard hours) and what is in work now. */
export function whosOnWhat(personId: string, projects: Project[], cal: Calendar, now: LocalDT) {
  let open = 0, queuedH = 0;
  const perStage = new Map<string, number>();
  const inWork: { projectId: string; serial: string; stage: string; part: string }[] = [];
  for (const p of projects) {
    for (const w of p.work) {
      if (w.tech !== personId || w.status === "done") continue;
      const st = p.stages.find((s) => s.id === w.stageId);
      if (!st) continue;
      open++;
      queuedH += Math.max(0, standardH(w, st) - actualH(w, cal, now));
      perStage.set(st.name, (perStage.get(st.name) ?? 0) + 1);
      if (w.status === "doing") {
        inWork.push({ projectId: p.id, serial: p.serial, stage: st.name, part: p.parts.find((x) => x.id === w.partId)?.name ?? "?" });
      }
    }
  }
  return { open, queuedH, perStage: Object.fromEntries(perStage), inWork, idle: inWork.length === 0 };
}

/** Prev / next buttons on the Day view skip rest days and holidays. */
export const stepDay = (cal: Calendar, date: LocalDate, dir: 1 | -1) => (dir === 1 ? cal.nextWorkDay(date) : cal.prevWorkDay(date));
