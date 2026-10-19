/**
 * Scheduling, progress, forecast and health (spec §7).
 * Tasks run finish-to-start in `num` order on the working calendar.
 */
import { maxDT, minDT, type Calendar } from "./calendar";
import type { HealthSettings } from "./settings";
import type { Health, Project, Stage, Task } from "./types";
import type { LocalDT } from "./time";

const byNum = (a: Task, b: Task) => a.num - b.num;

/** Plan every task: task 1 at norm(startDate), each next at norm(previous end); a pinned start wins. */
export function schedule(p: Pick<Project, "startDate" | "tasks">, cal: Calendar): { tasks: Task[]; planEnd: LocalDT | null } {
  let cursor: LocalDT = cal.norm(cal.atShiftStart(p.startDate));
  const tasks = [...p.tasks].sort(byNum).map((t, i) => {
    const start = t.pinnedStart ? cal.norm(t.pinnedStart) : i === 0 ? cursor : cal.norm(cursor);
    const end = cal.addWH(start, t.durH);
    cursor = end;
    return { ...t, start, end };
  });
  return { tasks, planEnd: tasks.length ? tasks[tasks.length - 1].end : null };
}

/** Freeze the current plan as the baseline. */
export function baselineOf(tasks: Task[]): Project["baseline"] {
  return Object.fromEntries(tasks.filter((t) => t.start && t.end).map((t) => [t.id, { start: t.start!, end: t.end! }]));
}

// ───────────── progress ─────────────

export function taskPct(t: Task): number {
  if (t.status === "done") return 1;
  if (t.status === "todo") return 0;
  return Math.min(1, Math.max(0, t.pct / 100));
}

export function stagePartsDoneFraction(p: Project, stageId: string): number {
  if (!p.parts.length) return 0;
  const done = p.work.filter((w) => w.stageId === stageId && w.status === "done").length;
  return done / p.parts.length;
}

/** Effective progress: the task's own % or the share of its stage's parts that are done, whichever is higher. */
export function eff(p: Project, t: Task): number {
  return Math.max(taskPct(t), stagePartsDoneFraction(p, t.stageId));
}

export interface StageAgg {
  stage: Stage;
  pct: number; // 0–1, hour-weighted over the stage's tasks
  start: LocalDT | null;
  end: LocalDT | null;
  tasks: Task[];
  done: boolean;
}

export function stageAgg(p: Project, stage: Stage): StageAgg {
  const tasks = p.tasks.filter((t) => t.stageId === stage.id).sort(byNum);
  const hours = tasks.reduce((s, t) => s + t.durH, 0);
  const pct = hours ? tasks.reduce((s, t) => s + t.durH * eff(p, t), 0) / hours : 0;
  const starts = tasks.map((t) => t.start).filter(Boolean) as LocalDT[];
  const ends = tasks.map((t) => t.end).filter(Boolean) as LocalDT[];
  return {
    stage,
    pct,
    start: starts.length ? starts.reduce(minDT) : null,
    end: ends.length ? ends.reduce(maxDT) : null,
    tasks,
    done: tasks.length > 0 && tasks.every((t) => t.status === "done"),
  };
}

/** Hour-weighted progress of the whole build, 0–1. */
export function projectPct(p: Project): number {
  const hours = p.tasks.reduce((s, t) => s + t.durH, 0);
  return hours ? p.tasks.reduce((s, t) => s + t.durH * eff(p, t), 0) / hours : 0;
}

// ───────────── forecast ─────────────

export interface Forecast {
  /** taskId → forecast window */
  tasks: Record<string, { start: LocalDT; end: LocalDT }>;
  /** Delivery forecast: last forecast end. */
  finish: LocalDT | null;
  /** Working hours between baseline finish and forecast (positive = later than baseline). */
  slipH: number | null;
  /** Working hours between forecast and the committed date at shift end (negative = late). */
  floatH: number | null;
  /** Working hours from start to min(now, forecast) … */
  elapsedH: number;
  /** … out of start → forecast. */
  totalH: number;
}

/** The smallest remaining work a not-done task is forecast to need. */
const MIN_REMAINING_H = 0.5;

export function forecast(p: Project, cal: Calendar, now: LocalDT): Forecast {
  const tasks = [...p.tasks].sort(byNum);
  const out: Forecast["tasks"] = {};
  let cursor: LocalDT = tasks[0]?.start ?? cal.norm(cal.atShiftStart(p.startDate));
  for (const t of tasks) {
    if (t.status === "done") {
      const end = t.actualEnd ?? t.end ?? cursor;
      out[t.id] = { start: t.actualStart ?? t.start ?? cursor, end };
      cursor = end;
      continue;
    }
    const remaining = Math.max(MIN_REMAINING_H, t.durH * (1 - eff(p, t)));
    const start = cal.norm(maxDT(cursor, now));
    const end = cal.addWH(start, remaining);
    out[t.id] = { start, end };
    cursor = end;
  }
  const finish = tasks.length ? out[tasks[tasks.length - 1].id].end : null;
  const baseEnds = Object.values(p.baseline).map((b) => b.end);
  const baselineEnd = baseEnds.length ? baseEnds.reduce(maxDT) : null;
  const start = cal.atShiftStart(p.startDate);
  return {
    tasks: out,
    finish,
    slipH: finish && baselineEnd ? cal.wh(baselineEnd, finish) : null,
    floatH: finish && p.deliveryDate ? cal.wh(finish, p.deliveryDate) : null,
    elapsedH: finish ? Math.max(0, cal.wh(start, minDT(now, finish))) : 0,
    totalH: finish ? Math.max(0, cal.wh(start, finish)) : 0,
  };
}

// ───────────── health ─────────────

export function health(p: Pick<Project, "status" | "deliveryDate">, f: Pick<Forecast, "floatH">, h: Pick<HealthSettings, "riskFloatDays">, dayHours: number): Health {
  if (p.status === "done") return "done";
  if (p.status === "hold") return "hold";
  if (!p.deliveryDate || f.floatH === null) return "unset";
  if (f.floatH < 0) return "late";
  if (f.floatH <= h.riskFloatDays * dayHours) return "risk";
  return "ok";
}

/** Board order: by health (settings order), then serial. */
export function boardSort<T extends { serial: string; health: Health }>(rows: T[], order: HealthSettings["boardOrder"]): T[] {
  const rank = (h: Health) => {
    const i = order.indexOf(h);
    return i < 0 ? order.length : i;
  };
  return [...rows].sort((a, b) => rank(a.health) - rank(b.health) || a.serial.localeCompare(b.serial, undefined, { numeric: true }));
}
