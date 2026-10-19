/**
 * Department leaderboard and badges for the employee display (Phase 3.5, §7.3, D11, D14, D15).
 * Score = §11 on part-steps. Task-count badges count every finished queue task, plus finished
 * part-steps that aren't linked to a queue task (so the same work never counts twice).
 * Kind by design: rank, score and badges only — no negative numbers.
 */
import type { Calendar } from "./calendar";
import { queueOnTime, type QueueTask } from "./queue";
import { techStats } from "./scoring";
import type { BadgeKey, GamificationSettings, ScoringSettings } from "./settings";
import { addDays, dateOf, dayOfDate, weekdayOfDay, type LocalDT, type LocalDate } from "./time";
import type { Person, Project } from "./types";
import { actualH, standardH } from "./work";

export type BoardPeriod = "today" | "week" | "month" | "7d";
export interface Window { from: LocalDT; to: LocalDT }

/** The period up to now, and the previous period of the same kind (for 📈). Weeks start on Monday. */
export function periodWindows(period: BoardPeriod, now: LocalDT, cal: Calendar): { current: Window; previous: Window } {
  const today = dateOf(now);
  const start = (d: LocalDate) => `${d}T00:00`;
  const end = (d: LocalDate) => `${d}T23:59`;
  if (period === "today") {
    const prev = cal.prevWorkDay(today);
    return { current: { from: start(today), to: now }, previous: { from: start(prev), to: end(prev) } };
  }
  if (period === "7d") {
    // Rolling: the last 7 days up to now (never empty after a weekend), and the 7 days before.
    const from = addDays(today, -6), prevTo = addDays(from, -1);
    return { current: { from: start(from), to: now }, previous: { from: start(addDays(prevTo, -6)), to: end(prevTo) } };
  }
  if (period === "week") {
    const wd = weekdayOfDay(dayOfDate(today));
    const monday = addDays(today, -((wd + 6) % 7));
    return { current: { from: start(monday), to: now }, previous: { from: start(addDays(monday, -7)), to: end(addDays(monday, -1)) } };
  }
  const first = `${today.slice(0, 8)}01`;
  const prevFirst = `${addDays(first, -1).slice(0, 8)}01`;
  return { current: { from: start(first), to: now }, previous: { from: start(prevFirst), to: end(addDays(first, -1)) } };
}

interface Finish { at: LocalDT; onTime: boolean }

/** Everything a person finished: queue tasks + part-steps not linked to a queue task. */
export function finishes(personId: string, projects: Project[], queue: (QueueTask & { workItemId?: string | null })[], cal: Calendar, toleranceH: number, now: LocalDT): Finish[] {
  const linked = new Set(queue.map((q) => q.workItemId).filter(Boolean) as string[]);
  const out: Finish[] = queue
    .filter((q) => q.personId === personId && q.status === "done" && q.actualEnd)
    .map((q) => ({ at: q.actualEnd!, onTime: queueOnTime(q, cal, toleranceH) }));
  for (const p of projects) {
    for (const w of p.work) {
      if (w.tech !== personId || w.status !== "done" || !w.end || linked.has(w.id)) continue;
      const st = p.stages.find((s) => s.id === w.stageId);
      if (!st) continue;
      out.push({ at: w.end, onTime: actualH(w, cal, now) <= standardH(w, st) + toleranceH });
    }
  }
  return out;
}

/** Working days in a row (back from today; today counts once it has one) with at least one on-time finish. */
export function streakDays(fin: Finish[], now: LocalDT, cal: Calendar): number {
  const days = new Set(fin.filter((f) => f.onTime).map((f) => dateOf(f.at)));
  let d = dateOf(now);
  if (!cal.isWorkDay(d) || !days.has(d)) d = cal.prevWorkDay(d);
  let n = 0;
  for (let guard = 0; guard < 400 && days.has(d); guard++) {
    n++;
    d = cal.prevWorkDay(d);
  }
  return n;
}

export interface BoardEntry {
  personId: string;
  name: string;
  /** null = warming up (below the §11 minimum, D15) */
  rank: number | null;
  score: number | null;
  badges: { key: BadgeKey; emoji: string; name: string }[];
  /** friendly line for people outside the top 3 */
  line: string | null;
  finishedThisWeek: number;
}

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function rankOf(people: Pick<Person, "id" | "name">[], projects: Project[], calOf: (id: string) => Calendar, now: LocalDT, w: Window, s: ScoringSettings) {
  const stats = people.map((p) => ({ p, st: techStats(p, projects, calOf(p.id), now, w, s) }));
  const ranked = stats.filter((x) => x.st.score !== null)
    .sort((a, b) => b.st.score! - a.st.score! || b.st.done - a.st.done || a.p.name.localeCompare(b.p.name));
  return { stats, rank: new Map(ranked.map((x, i) => [x.p.id, i + 1])) };
}

export function departmentBoard(input: {
  people: Pick<Person, "id" | "name">[];
  projects: Project[];
  queue: (QueueTask & { workItemId?: string | null })[];
  cal: Calendar;
  /** AM-29: each person's scoring calendar (excused leave off); the shop calendar when absent. */
  calFor?: (personId: string) => Calendar;
  now: LocalDT;
  period: BoardPeriod;
  scoring: ScoringSettings;
  game: GamificationSettings;
}): BoardEntry[] {
  const { people, projects, queue, cal, now, scoring, game } = input;
  const pc = (id: string) => input.calFor?.(id) ?? cal;
  const { current, previous } = periodWindows(input.period, now, cal);
  const week = periodWindows("week", now, cal).current;
  const cur = rankOf(people, projects, pc, now, current, scoring);
  const prev = rankOf(people, projects, pc, now, previous, scoring);
  const badge = (k: BadgeKey) => game.badges.find((b) => b.key === k && b.on);

  const rows = cur.stats.map(({ p, st }) => {
    const fin = finishes(p.id, projects, queue, pc(p.id), scoring.onTimeToleranceH, now);
    return {
      p, st, rank: cur.rank.get(p.id) ?? null,
      prevRank: prev.rank.get(p.id) ?? null,
      week: fin.filter((f) => f.at >= week.from && f.at <= week.to).length,
      streak: streakDays(fin, now, pc(p.id)),
    };
  });

  const ranked = rows.filter((r) => r.rank !== null);
  const bestPace = Math.max(-1, ...ranked.map((r) => r.st.pacePct ?? -1));
  const mostWeek = Math.max(0, ...rows.map((r) => r.week));
  const gains = rows.filter((r) => r.rank !== null && r.prevRank !== null).map((r) => r.prevRank! - r.rank!);
  const climber = badge("climber");
  const bestGain = Math.max(climber?.param ?? 1, ...gains);

  const entries: BoardEntry[] = rows.map((r) => {
    const out: BoardEntry["badges"] = [];
    const give = (k: BadgeKey) => { const b = badge(k); if (b) out.push({ key: k, emoji: b.emoji, name: b.name }); };
    if (r.rank === 1) give("gold");
    if (r.rank === 2) give("silver");
    if (r.rank === 3) give("bronze");
    if (r.streak >= (badge("streak")?.param ?? 3)) give("streak");
    if (r.rank !== null && r.st.ftrPct === 100) give("sharpshooter");
    if (r.rank !== null && bestPace >= 0 && r.st.pacePct === bestPace) give("speedster");
    if (mostWeek > 0 && r.week === mostWeek) give("rocket");
    if (r.rank !== null && r.prevRank !== null && r.prevRank - r.rank >= bestGain) give("climber");
    const outsideTop3 = r.rank === null || r.rank > 3;
    if (outsideTop3) give("warmingUp");
    const lines = game.warmingUp;
    const line = outsideTop3 && lines.length ? lines[(hash(r.p.id) + dayOfDate(dateOf(now))) % lines.length] : null;
    return { personId: r.p.id, name: r.p.name, rank: r.rank, score: r.st.score, badges: out, line, finishedThisWeek: r.week };
  });

  return entries.sort((a, b) =>
    (a.rank ?? Infinity) - (b.rank ?? Infinity) || b.finishedThisWeek - a.finishedThisWeek || a.name.localeCompare(b.name));
}

/** What the screen shows: only the top N if set; "hide bottom" keeps the upper half of the ranked list. */
export function visibleEntries(entries: BoardEntry[], game: Pick<GamificationSettings, "topN" | "hideBottom">): BoardEntry[] {
  const ranked = entries.filter((e) => e.rank !== null);
  const warming = entries.filter((e) => e.rank === null);
  if (game.topN > 0) return ranked.slice(0, game.topN);
  if (game.hideBottom) return ranked.slice(0, Math.max(3, Math.ceil(ranked.length / 2)));
  return [...ranked, ...warming];
}
