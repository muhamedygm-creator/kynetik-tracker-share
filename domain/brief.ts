/**
 * Morning brief for the Board (v2 sketch, docs/ux/DECISIONS.md 2026-10-07): where work stopped on the
 * last working day, how today starts, and recommendations derived only from the tracker's own data.
 */
import type { Calendar } from "./calendar";
import { fmtDate, fmtHM } from "./format";
import { partLabel } from "./parts";
import { startBlocker, stepName } from "./qc";
import { byPosition, dayRow, layoutQueue, type QueueTask } from "./queue";
import type { Health, ItemStatus, Project } from "./types";
import { standardH } from "./work";
import { dateOf, type LocalDT, type LocalDate } from "./time";

export interface BriefInput {
  builds: { project: Project; health: Health; forecastFinish: LocalDate | null }[];
  people: { id: string; name: string; departmentId: string | null; active: boolean; production: boolean }[];
  departments: { id: string; key: string; name: string }[];
  queue: (QueueTask & { projectId: string | null; workItemId: string | null })[];
  cal: Calendar;
  /** AM-29: a person's calendar with their absences off. */
  calFor?: (personId: string) => Calendar;
  now: LocalDT;
}

export interface BriefStep {
  projectId: string;
  serial: string;
  stage: string;
  part: string;
  person: string | null;
  status: ItemStatus;
  /** finished: when; in progress: since when */
  at: LocalDT | null;
}

export interface BriefPerson {
  id: string;
  name: string;
  department: string | null;
  /** today's tasks in clock order */
  tasks: { title: string; serial: string | null; start: LocalDT; end: LocalDT; status: ItemStatus; continues: boolean }[];
  departmentId: string | null;
  plannedH: number;
  freeH: number;
  /** when the last task today ends (or the day starts); null when nothing is free today */
  freeFrom: LocalDT | null;
  /** the next open tasks on this person's queue, today or later */
  next: { title: string; serial: string | null; start: LocalDT | null; end: LocalDT | null; status: ItemStatus }[];
}

/** A part's current step (first not finished) that is on nobody's queue. */
export interface WaitingStep {
  workItemId: string;
  projectId: string;
  serial: string;
  stage: string;
  part: string;
  stationType: string;
  hours: number;
  status: ItemStatus;
}

/** Why a build is late or at risk, in tracker facts. */
export interface BuildWhy {
  projectId: string;
  serial: string;
  name: string;
  health: Health;
  forecast: LocalDate | null;
  promised: LocalDate | null;
  stepsLeft: number;
  /** build tasks (plan rows) not done, for builds planned by task rather than by part */
  tasksLeft: number;
  waiting: number;
  blocked: number;
  inProgress: number;
  /** stages with work going on now */
  stagesNow: string[];
}

export interface Recommendation {
  severity: "bad" | "warn" | "info";
  text: string;
  projectId?: string;
  href?: string;
}

export interface Brief {
  /** the last working day before today */
  lastDay: LocalDate;
  finished: BriefStep[];
  inProgress: BriefStep[];
  blocked: BriefStep[];
  onHold: { projectId: string; serial: string; name: string }[];
  today: LocalDate;
  dayStart: LocalDT;
  people: BriefPerson[];
  plannedH: number;
  /** waiting steps, most urgent build first */
  waiting: WaitingStep[];
  /** facts per open build, late and at-risk first */
  builds: BuildWhy[];
  recommendations: Recommendation[];
}

export function morningBrief({ builds, people, departments, queue, cal: shop, calFor, now }: BriefInput): Brief {
  const cal = shop;
  const today = dateOf(now);
  const lastDay = cal.prevWorkDay(today);
  const name = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? null : null);
  const open = builds.filter((b) => b.project.status !== "done");

  const step = (p: Project, x: Project["work"][number], at: LocalDT | null): BriefStep => ({
    projectId: p.id, serial: p.serial, status: x.status, at, person: name(x.tech),
    stage: p.stages.find((s) => s.id === x.stageId)?.name ?? "",
    part: p.parts.find((s) => s.id === x.partId)?.name ?? "",
  });

  const finished: BriefStep[] = [];
  const inProgress: BriefStep[] = [];
  const blocked: BriefStep[] = [];
  for (const b of builds) {
    const p = b.project;
    for (const x of p.work) {
      if (x.status === "done" && x.end && dateOf(x.end) >= lastDay && dateOf(x.end) < today) finished.push(step(p, x, x.end));
      if (b.project.status === "done") continue;
      if (x.status === "doing") inProgress.push(step(p, x, x.segStart ?? x.start));
      if (x.status === "blocked") blocked.push(step(p, x, null));
    }
  }
  finished.sort((a, b) => (a.at! < b.at! ? -1 : 1));

  // Today per person: production crew, in name order; tasks from their queue laid on the clock.
  const crew = people.filter((p) => p.active && p.production);
  const serialOf = (pid: string | null) => (pid ? builds.find((b) => b.project.id === pid)?.project.serial ?? null : null);
  const briefPeople: BriefPerson[] = crew.map((p) => {
    const cal = calFor?.(p.id) ?? shop;
    const dayH = cal.isWorkDay(today) ? cal.dayHours : 0;
    const mine = queue.filter((t) => t.personId === p.id).sort(byPosition);
    const placed = layoutQueue(mine, cal, now);
    const row = dayRow(placed, today);
    const tasks = row.items.map(({ placed: pl, seg }) => {
      const t = mine.find((q) => q.id === pl.task.id)!;
      return { title: t.title, serial: serialOf(t.projectId), start: seg.start, end: seg.end, status: t.status, continues: seg.continues };
    });
    const plannedH = row.items.reduce((s, { seg }) => s + cal.wh(seg.start, seg.end), 0);
    // Free time left today: from the end of today's last task (or now, or the shift start) to the shift end.
    const lastEnd = row.items.length ? row.items[row.items.length - 1].seg.end : null;
    let from = cal.atShiftStart(today);
    if (now > from) from = now;
    if (lastEnd && lastEnd > from) from = lastEnd;
    const fromN = dayH ? cal.norm(from) : null;
    const freeFrom = fromN && dateOf(fromN) === today ? fromN : null;
    const freeH = freeFrom ? Math.max(0, cal.wh(freeFrom, cal.atShiftEnd(today))) : 0;
    const next = placed.filter((x) => x.task.status !== "done").slice(0, 4).map((x) => {
      const t = mine.find((q) => q.id === x.task.id)!;
      return { title: t.title, serial: serialOf(t.projectId), start: x.start, end: x.end, status: t.status };
    });
    return {
      id: p.id, name: p.name, departmentId: p.departmentId, department: departments.find((d) => d.id === p.departmentId)?.name ?? null,
      tasks, plannedH, freeH, freeFrom: freeH > 0 ? freeFrom : null, next,
    };
  });

  // Waiting work, most urgent build first (late, at risk, then by forecast).
  const onQueue = new Set(queue.map((q) => q.workItemId).filter(Boolean));
  const urgency = { late: 0, risk: 1, ok: 2, unset: 3, hold: 4, done: 5 } as const;
  const waiting: WaitingStep[] = [...open].filter((b) => b.project.status !== "hold")
    .sort((a, b) => urgency[a.health] - urgency[b.health] || (a.forecastFinish ?? "9").localeCompare(b.forecastFinish ?? "9"))
    .flatMap((b) => {
      const p = b.project;
      return p.parts.flatMap((part) => {
        // The part's current stage: its first one not done. Mold production can hold several steps (AM-06).
        const own = p.stages.flatMap((s) => p.work.filter((x) => x.stageId === s.id && x.partId === part.id));
        const first = own.find((x) => x.status !== "done");
        if (!first) return [];
        const st = p.stages.find((s) => s.id === first.stageId)!;
        return own.filter((x) => x.stageId === first.stageId && x.status !== "done" && x.status !== "blocked" && !onQueue.has(x.id) && !startBlocker(p, x))
          .map((cur) => ({ workItemId: cur.id, projectId: p.id, serial: p.serial, stage: st.name, part: stepName(p.gated ? partLabel(part) : part.name, cur), stationType: st.stationType, hours: Math.max(0.5, standardH(cur, st)), status: cur.status }));
      });
    });

  const buildFacts: BuildWhy[] = [...open].sort((a, b) => urgency[a.health] - urgency[b.health]).map((b) => {
    const p = b.project;
    const left = p.work.filter((x) => x.status !== "done");
    return {
      projectId: p.id, serial: p.serial, name: p.name, health: b.health, forecast: b.forecastFinish, promised: p.deliveryDate,
      stepsLeft: left.length, tasksLeft: p.tasks.filter((t) => t.status !== "done").length, waiting: waiting.filter((w) => w.projectId === p.id).length,
      blocked: left.filter((x) => x.status === "blocked").length, inProgress: left.filter((x) => x.status === "doing").length,
      stagesNow: p.stages.filter((s) => left.some((x) => x.stageId === s.id && x.status === "doing")).map((s) => s.name),
    };
  });

  return {
    lastDay, finished, inProgress, blocked, today,
    dayStart: cal.atShiftStart(cal.firstWork(today)),
    onHold: open.filter((b) => b.project.status === "hold").map((b) => ({ projectId: b.project.id, serial: b.project.serial, name: b.project.name })),
    people: briefPeople,
    plannedH: briefPeople.reduce((s, p) => s + p.plannedH, 0),
    waiting, builds: buildFacts,
    recommendations: recommend({ builds: open, crew, departments, waiting, briefPeople, blocked }),
  };
}

/** Facts that call for a decision, most urgent first. Each one restates tracker data; none invents a rule. */
function recommend({ builds, crew, departments, waiting, briefPeople, blocked }: {
  builds: BriefInput["builds"]; crew: BriefInput["people"]; departments: BriefInput["departments"]; waiting: WaitingStep[];
  briefPeople: BriefPerson[]; blocked: BriefStep[];
}): Recommendation[] {
  const out: Recommendation[] = [];

  for (const b of builds.filter((x) => x.health === "late" || x.health === "risk")) {
    const p = b.project;
    const when = b.forecastFinish ? `forecasts ${fmtDate(b.forecastFinish)}` : "has no forecast";
    const promise = p.deliveryDate ? ` against a promise of ${fmtDate(p.deliveryDate)}` : "";
    out.push({
      severity: b.health === "late" ? "bad" : "warn", projectId: p.id, href: `/builds/${p.id}`,
      text: `${p.serial} ${p.name} ${when}${promise}${b.health === "late" ? "" : " (at risk)"}. Plan its waiting steps first.`,
    });
  }

  for (const s of blocked) {
    out.push({ severity: "bad", projectId: s.projectId, href: `/builds/${s.projectId}`, text: `${s.serial} · ${s.stage} · ${s.part} is blocked. Check what it is waiting for.` });
  }

  const byType = new Map<string, { n: number; first: string }>();
  for (const w of waiting) {
    const x = byType.get(w.stationType) ?? { n: 0, first: `${w.stage} · ${w.part} (${w.serial})` };
    x.n++;
    byType.set(w.stationType, x);
  }
  for (const d of departments) {
    const w = byType.get(d.key);
    if (!w) continue;
    const members = crew.filter((p) => p.departmentId === d.id);
    if (!members.length) {
      out.push({ severity: "warn", href: "/setup/crew", text: `${d.name} has nobody assigned, and ${w.n} part step${w.n === 1 ? " is" : "s are"} waiting there. Add people to the department under Crew.` });
      continue;
    }
    const free = briefPeople.filter((p) => members.some((m) => m.id === p.id) && p.freeH >= 1).sort((a, b) => b.freeH - a.freeH);
    if (free.length) {
      const who = free.slice(0, 2).map((p) => `${p.name} (${fmtHM(p.freeH)} free)`).join(" and ");
      out.push({ severity: "info", href: `/plan?dept=${d.key}`, text: `${who} today. ${w.n} step${w.n === 1 ? " is" : "s are"} waiting in ${d.name}, next: ${w.first}.` });
    }
  }

  const rank = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
