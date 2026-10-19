/**
 * Dashboard figures (v2, docs/ux/DECISIONS.md 2026-10-07). Everything here restates finished work:
 * on time = actual working hours within the standard hours plus the scoring tolerance (spec §11).
 */
import type { Calendar } from "./calendar";
import { fmtHM } from "./format";
import type { ScoringSettings } from "./settings";
import { addDays, dateOf, type LocalDT, type LocalDate } from "./time";
import type { Project } from "./types";
import { actualH, standardH } from "./work";

interface Done { stageName: string; stationType: string; actual: number; standard: number; end: LocalDT; rework: number }

/** Finished part steps with a technician, since `from` (inclusive). */
function finished(projects: Project[], cal: Calendar, now: LocalDT, from: LocalDate): Done[] {
  const out: Done[] = [];
  for (const p of projects) for (const w of p.work) {
    if (w.status !== "done" || !w.end || !w.tech || dateOf(w.end) < from) continue;
    const st = p.stages.find((s) => s.id === w.stageId);
    if (!st) continue;
    out.push({ stageName: st.name, stationType: st.stationType, actual: actualH(w, cal, now), standard: standardH(w, st), end: w.end, rework: w.rework });
  }
  return out;
}

export interface Headline { done: number; onTimePct: number | null; ftrPct: number | null; pacePct: number | null; actualH: number; standardH: number }

export function headline(projects: Project[], cal: Calendar, now: LocalDT, from: LocalDate, s: ScoringSettings): Headline {
  const d = finished(projects, cal, now, from);
  const n = d.length;
  const actual = d.reduce((x, y) => x + y.actual, 0), standard = d.reduce((x, y) => x + y.standard, 0);
  return {
    done: n,
    onTimePct: n ? (d.filter((x) => x.actual <= x.standard + s.onTimeToleranceH).length / n) * 100 : null,
    ftrPct: n ? (d.filter((x) => x.rework === 0).length / n) * 100 : null,
    pacePct: n ? (actual > 0 ? (standard / actual) * 100 : s.paceWhenNoActual) : null,
    actualH: actual, standardH: standard,
  };
}

/** On-time share per week (Monday to Sunday), oldest first, for the `weeks` weeks up to and including this one. */
export function weeklyOnTime(projects: Project[], cal: Calendar, now: LocalDT, monday: LocalDate, weeks: number, s: ScoringSettings) {
  const first = addDays(monday, -7 * (weeks - 1));
  const d = finished(projects, cal, now, first);
  return Array.from({ length: weeks }, (_, i) => {
    const from = addDays(first, 7 * i), to = addDays(from, 7);
    const wk = d.filter((x) => dateOf(x.end) >= from && dateOf(x.end) < to);
    return { monday: from, done: wk.length, onTimePct: wk.length ? (wk.filter((x) => x.actual <= x.standard + s.onTimeToleranceH).length / wk.length) * 100 : null };
  });
}

/** Actual hours of finished steps per stage type (department key), largest first. */
export function hoursByType(projects: Project[], cal: Calendar, now: LocalDT, from: LocalDate) {
  const m = new Map<string, number>();
  for (const x of finished(projects, cal, now, from)) m.set(x.stationType, (m.get(x.stationType) ?? 0) + x.actual);
  return [...m].map(([type, hours]) => ({ type, hours })).sort((a, b) => b.hours - a.hours);
}

/** Per stage name: finished steps, average planned and actual hours. Largest overrun first. */
export function stageHours(projects: Project[], cal: Calendar, now: LocalDT, from: LocalDate) {
  const m = new Map<string, { n: number; planned: number; actual: number }>();
  for (const x of finished(projects, cal, now, from)) {
    const r = m.get(x.stageName) ?? { n: 0, planned: 0, actual: 0 };
    r.n++; r.planned += x.standard; r.actual += x.actual;
    m.set(x.stageName, r);
  }
  return [...m].map(([stage, r]) => ({ stage, n: r.n, planned: r.planned / r.n, actual: r.actual / r.n }))
    .sort((a, b) => b.actual - b.planned - (a.actual - a.planned));
}

/** Plain-words suggestions from the figures above; nothing beyond what the data shows. */
export function dashboardTips(stages: ReturnType<typeof stageHours>, s: ScoringSettings, minSteps = 2): string[] {
  const tips: string[] = [];
  for (const r of stages.filter((x) => x.n >= minSteps && x.actual > x.planned + s.onTimeToleranceH).slice(0, 3)) {
    tips.push(`${r.stage}: finished steps took ${fmtHM(r.actual)} on average against ${fmtHM(r.planned)} planned (${r.n} steps). Plan more time for it, or raise the template hours.`);
  }
  const fast = stages.filter((x) => x.n >= minSteps && x.actual > 0 && x.actual < x.planned * 0.75).slice(-1)[0];
  if (fast) tips.push(`${fast.stage}: finished steps took ${fmtHM(fast.actual)} against ${fmtHM(fast.planned)} planned. The plan may be too generous; the time could go to late builds.`);
  return tips;
}
