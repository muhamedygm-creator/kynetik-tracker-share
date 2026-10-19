/**
 * Shop-floor display data (Phase 3.5 employee screen; Phase 6 adds more screens).
 * `DisplaySnapshot` is an allow-list: `.strict()` everywhere, and no field can hold cost, salary or rate.
 * The display route parses its output through this schema before sending it.
 */
import { z } from "zod";
import type { Calendar } from "./calendar";
import { departmentBoard, finishes, periodWindows, streakDays, visibleEntries, type BoardPeriod } from "./gamification";
import { dayRow, durationLabel, layoutQueue, type QueueTask } from "./queue";
import type { ConveyorSettings, GamificationSettings, LabelSettings, ScoringSettings } from "./settings";
import { dateOf, dayOfDate, type LocalDT } from "./time";
import type { Project } from "./types";

const Item = z.object({
  id: z.string(),
  title: z.string(),
  link: z.string().nullable(),
  duration: z.string(),
  status: z.enum(["todo", "doing", "blocked", "done"]),
  current: z.boolean(),
  start: z.string(),
  end: z.string(),
  /** overrun: the planned end; the bar is hatched from here to `end` */
  overrunFrom: z.string().nullable(),
  /** "Day 1 of 2" for multi-day tasks */
  dayLabel: z.string().nullable(),
  continues: z.boolean(),
  lateStart: z.boolean(),
  accent: z.string().nullable(),
  urgent: z.boolean(),
  /** waiting for QC (a gated step sent to QC, or a QC request from the Floor Station) */
  qc: z.boolean(),
}).strict();

const Row = z.object({
  personId: z.string(),
  name: z.string(),
  initials: z.string(),
  colour: z.string(),
  photoUrl: z.string().nullable(),
  items: z.array(Item),
  blocked: z.array(z.object({ id: z.string(), title: z.string() }).strict()),
  more: z.number().int(),
  /** free time from the start of the day until the first task */
  idleUntil: z.string().nullable(),
  /** AM-29: marked absent today, e.g. "Annual leave · back 20 Oct" (shown greyed out) */
  away: z.string().nullable(),
}).strict();

const Entry = z.object({
  personId: z.string(),
  name: z.string(),
  initials: z.string(),
  photoUrl: z.string().nullable(),
  rank: z.number().int().nullable(),
  score: z.number().int().nullable(),
  badges: z.array(z.object({ emoji: z.string(), name: z.string() }).strict()),
  line: z.string().nullable(),
}).strict();

export const DisplaySnapshot = z.object({
  display: z.object({ name: z.string(), leaderboardMode: z.enum(["side", "rotate", "off"]), confetti: z.boolean() }).strict(),
  department: z.object({ name: z.string(), emoji: z.string(), colour: z.string() }).strict().nullable(),
  brand: z.object({ appName: z.string(), company: z.string() }).strict(),
  now: z.string(),
  day: z.object({
    date: z.string(),
    isToday: z.boolean(),
    start: z.string(),
    end: z.string(),
    breaks: z.array(z.tuple([z.string(), z.string()])),
  }).strict(),
  status: z.record(z.enum(["todo", "doing", "blocked", "done"]), z.object({ label: z.string(), colour: z.string() }).strict()),
  rows: z.array(Row),
  leaderboard: z.object({ period: z.enum(["today", "week", "month", "7d"]), entries: z.array(Entry) }).strict(),
  /** Department notices for the header: a message, or a countdown to `at` (today, shop time). */
  notices: z.array(z.object({ icon: z.string(), title: z.string(), detail: z.string(), at: z.string().nullable() }).strict()),
  /** Conveyor window and banner timings (settings), plus the quotes rotated into the banner. */
  conveyor: z.object({ hours: z.number(), pastMin: z.number() }).strict(),
  banner: z.object({ quoteEverySec: z.number(), quoteShowSec: z.number(), wrapUpMins: z.number(), backToItMins: z.number() }).strict(),
  quotes: z.array(z.string()),
  finishedToday: z.array(z.object({ name: z.string(), title: z.string(), at: z.string() }).strict()),
  week: z.object({ finished: z.number().int(), onTimePct: z.number().int().nullable(), bestStreak: z.number().int() }).strict(),
}).strict();
export type DisplaySnapshot = z.infer<typeof DisplaySnapshot>;

export interface DisplayInput {
  display: DisplaySnapshot["display"];
  department: (DisplaySnapshot["department"] & { id: string }) | null;
  brand: DisplaySnapshot["brand"];
  people: { id: string; name: string; initials: string; photoUrl: string | null; departmentId: string | null; active: boolean; costClass: string; away?: string | null }[];
  queue: (QueueTask & { projectId: string | null; stageId: string | null; workItemId: string | null; colour: string | null; priority?: "normal" | "urgent" })[];
  /** Today's notices for this department, already filtered (see lib/display/snapshot.ts). */
  notices?: { icon: string; title: string; detail: string; at: string | null }[];
  projects: Project[];
  cal: Calendar;
  /** AM-29: each person's calendar with their absences off (planning) and with excused leave off (scoring). */
  calFor?: (personId: string) => Calendar;
  scoreCalFor?: (personId: string) => Calendar;
  now: LocalDT;
  labels: LabelSettings;
  scoring: ScoringSettings;
  game: GamificationSettings;
  period: BoardPeriod;
  conveyor: ConveyorSettings;
  /** Queue tasks with a pending QC request (workshop tasks); gated steps use their work item's qcSince. */
  qcRequested?: string[];
}

/** "001 · Prototyping · Bonnet" */
function linkLabel(t: DisplayInput["queue"][number], projects: Project[]): string | null {
  const p = projects.find((x) => x.id === t.projectId);
  if (!p) return null;
  const w = t.workItemId ? p.work.find((x) => x.id === t.workItemId) : undefined;
  const st = p.stages.find((x) => x.id === (w?.stageId ?? t.stageId));
  const part = w ? p.parts.find((x) => x.id === w.partId) : undefined;
  return [p.serial, st?.name, part?.name].filter(Boolean).join(" · ");
}

export function buildDisplaySnapshot(i: DisplayInput): DisplaySnapshot {
  const { cal, now } = i;
  const today = dateOf(now);
  const date = cal.isWorkDay(today) ? today : cal.firstWork(today);
  const windows = cal.windows(dayOfDate(date));
  const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const breaks = windows.slice(1).map((w, k) => [`${date}T${hm(windows[k][1])}`, `${date}T${hm(w[0])}`] as [string, string]);
  const dayStart = cal.atShiftStart(date), dayEnd = cal.atShiftEnd(date);

  // One department only — never everyone (no department → nobody).
  const members = i.department ? i.people.filter((p) => p.active && p.departmentId === i.department!.id) : [];
  const deptColour = i.department?.colour ?? i.labels.otherColour;
  const qcItems = new Set(i.projects.flatMap((p) => p.work.filter((w) => w.qcSince).map((w) => w.id)));
  const qcAsked = new Set(i.qcRequested ?? []);

  const rows = members.map((m) => {
    const placed = layoutQueue(i.queue.filter((t) => t.personId === m.id), i.calFor?.(m.id) ?? cal, now);
    const row = dayRow(placed, date);
    const first = row.items.find((x) => x.seg.end > dayStart);
    return {
      personId: m.id, name: m.name, initials: m.initials, colour: deptColour, photoUrl: m.photoUrl,
      items: row.items.map(({ placed: p, seg }) => {
        const t = i.queue.find((q) => q.id === p.task.id)!;
        return {
          id: t.id, title: t.title, link: linkLabel(t, i.projects), duration: durationLabel(t, cal.dayHours), status: t.status, current: p.current,
          start: seg.start, end: seg.end,
          overrunFrom: p.overrun && p.plannedEnd && p.plannedEnd < seg.end ? (p.plannedEnd > seg.start ? p.plannedEnd : seg.start) : null,
          dayLabel: seg.days > 1 ? `Day ${seg.day} of ${seg.days}` : null, continues: seg.continues, lateStart: p.lateStart, accent: t.colour,
          urgent: t.priority === "urgent",
          qc: t.status !== "done" && (qcAsked.has(t.id) || (!!t.workItemId && qcItems.has(t.workItemId))),
        };
      }),
      blocked: row.blocked.map((b) => ({ id: b.task.id, title: b.task.title })),
      more: row.more,
      idleUntil: first && first.seg.start > dayStart ? first.seg.start : null,
      away: m.away ?? null,
    };
  });

  const entries = visibleEntries(
    departmentBoard({ people: members, projects: i.projects, queue: i.queue, cal, calFor: i.scoreCalFor, now, period: i.period, scoring: i.scoring, game: i.game }),
    i.game,
  ).map((e) => {
    const m = members.find((x) => x.id === e.personId)!;
    return {
      personId: e.personId, name: e.name, initials: m.initials, photoUrl: m.photoUrl, rank: e.rank, score: e.score,
      badges: e.badges.map((b) => ({ emoji: b.emoji, name: b.name })), line: e.line,
    };
  });

  // Finished today: queue tasks and unlinked part-steps closed today by this department.
  const memberIds = new Set(members.map((m) => m.id));
  const nameOf = (id: string) => members.find((m) => m.id === id)?.name ?? "";
  const linked = new Set(i.queue.map((q) => q.workItemId).filter(Boolean) as string[]);
  const finishedToday = [
    ...i.queue.filter((q) => memberIds.has(q.personId) && q.status === "done" && q.actualEnd && dateOf(q.actualEnd) === today)
      .map((q) => ({ name: nameOf(q.personId), title: q.title, at: q.actualEnd! })),
    ...i.projects.flatMap((p) => p.work.filter((w) => w.tech && memberIds.has(w.tech) && w.status === "done" && w.end && dateOf(w.end) === today && !linked.has(w.id))
      .map((w) => ({ name: nameOf(w.tech!), title: `${p.parts.find((x) => x.id === w.partId)?.name ?? "Part"}: ${p.stages.find((x) => x.id === w.stageId)?.name ?? ""}`, at: w.end! }))),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 6);

  // This week, for the department: finishes, share on time, best streak.
  const wk = periodWindows("week", now, cal).current;
  const fins = members.map((m) => finishes(m.id, i.projects, i.queue, cal, i.scoring.onTimeToleranceH, now));
  const thisWeek = fins.flat().filter((f) => f.at >= wk.from && f.at <= wk.to);
  const week = {
    finished: thisWeek.length,
    onTimePct: thisWeek.length ? Math.round((thisWeek.filter((f) => f.onTime).length / thisWeek.length) * 100) : null,
    bestStreak: Math.max(0, ...fins.map((f) => streakDays(f, now, cal))),
  };

  return DisplaySnapshot.parse({
    notices: i.notices ?? [],
    finishedToday,
    week,
    display: i.display,
    department: i.department ? { name: i.department.name, emoji: i.department.emoji, colour: i.department.colour } : null,
    brand: i.brand,
    now,
    day: { date, isToday: date === today, start: dayStart, end: dayEnd, breaks },
    status: i.labels.itemStatus,
    rows,
    leaderboard: { period: i.period, entries },
    conveyor: { hours: i.conveyor.hours, pastMin: i.conveyor.pastMin },
    banner: { ...i.game.banner },
    quotes: i.game.quotes,
  });
}
