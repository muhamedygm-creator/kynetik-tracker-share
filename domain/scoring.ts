/**
 * Technician performance (spec §11). Computed per production person from the part-steps they own.
 */
import type { Calendar } from "./calendar";
import type { ScoringSettings } from "./settings";
import { dayIndex, toMin, type LocalDT } from "./time";
import type { Person, Project, Stage } from "./types";
import { actualH, standardH } from "./work";

export interface TechStats {
  personId: string;
  done: number;
  onTimePct: number | null;
  ftrPct: number | null;
  pacePct: number | null;
  avgActualH: number | null;
  loggedHPerPart: number | null;
  /** Owner only — null when costs are not available to the viewer. */
  costPerPart: number | null;
  /** null below `minDone` completed part-steps ("—"). */
  score: number | null;
  band: ScoreBand | null;
  inWork: number;
}

export type ScoreBand = "green" | "yellow" | "amber" | "red";

export function scoreBand(score: number, s: Pick<ScoringSettings, "bands">): ScoreBand {
  if (score >= s.bands.green) return "green";
  if (score >= s.bands.yellow) return "yellow";
  if (score >= s.bands.amber) return "amber";
  return "red";
}

/** A period: the last N days up to now (0 = all time), or an explicit [from, to] window. */
export type Period = number | { from: LocalDT; to: LocalDT };

/** Is a finish time inside the period? */
export function inPeriod(end: LocalDT, now: LocalDT, period: Period): boolean {
  if (typeof period === "object") return end >= period.from && end <= period.to;
  if (period <= 0) return end <= now;
  return end <= now && dayIndex(toMin(end)) > dayIndex(toMin(now)) - period;
}

export function techStats(
  person: Pick<Person, "id">,
  projects: Project[],
  cal: Calendar,
  now: LocalDT,
  periodDays: Period,
  s: ScoringSettings,
  /** Only work in these stages counts (amends AM-11: Modelling has its own board). */
  keep: (stage: Stage) => boolean = () => true,
): TechStats {
  let done = 0, onTime = 0, ftr = 0, std = 0, act = 0, logged = 0, inWork = 0;
  let cost = 0, costKnown = true;
  for (const p of projects) {
    for (const w of p.work) {
      if (w.tech !== person.id) continue;
      if (w.status === "doing" && keep(p.stages.find((x) => x.id === w.stageId) ?? ({} as Stage))) inWork++;
      if (w.status !== "done" || !w.end || !inPeriod(w.end, now, periodDays)) continue;
      const stage = p.stages.find((x) => x.id === w.stageId);
      if (!stage || !keep(stage)) continue;
      const a = actualH(w, cal, now);
      const sd = standardH(w, stage);
      done++;
      if (a <= sd + s.onTimeToleranceH) onTime++;
      if (w.rework === 0) ftr++;
      std += sd;
      act += a;
      logged += w.hoursBy[person.id] ?? 0;
      if (w.cost === undefined) costKnown = false;
      else cost += w.cost;
    }
  }
  const pct = (n: number) => (done ? (n / done) * 100 : null);
  const pace = done ? (act > 0 ? (std / act) * 100 : s.paceWhenNoActual) : null;
  const onTimePct = pct(onTime), ftrPct = pct(ftr);
  let score: number | null = null;
  if (done >= s.minDone && onTimePct !== null && ftrPct !== null && pace !== null) {
    const w = s.weights;
    score = Math.round((w.onTime / 100) * onTimePct + (w.ftr / 100) * ftrPct + (w.pace / 100) * (Math.min(pace, s.paceCap) / s.paceCap) * 100);
  }
  return {
    personId: person.id,
    done,
    onTimePct,
    ftrPct,
    pacePct: pace,
    avgActualH: done ? act / done : null,
    loggedHPerPart: done ? logged / done : null,
    costPerPart: done && costKnown ? cost / done : null,
    score,
    band: score === null ? null : scoreBand(score, s),
    inWork,
  };
}

/** Ranked table: production people only, best score first, people without a score after. */
export function leaderboard(people: Person[], projects: Project[], cal: Calendar, now: LocalDT, periodDays: Period, s: ScoringSettings,
  keep?: (stage: Stage) => boolean, calFor?: (personId: string) => Calendar): (TechStats & { name: string })[] {
  return people
    .filter((p) => p.costClass === "production" && p.active)
    .map((p) => ({ ...techStats(p, projects, calFor?.(p.id) ?? cal, now, periodDays, s, keep), name: p.name }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.done - a.done || a.name.localeCompare(b.name));
}
