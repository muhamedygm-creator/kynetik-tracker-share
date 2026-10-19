/**
 * Crew performance log (amends AM-26): one row per task (queue task, or a part step on no queue) per employee,
 * time-stamped, for a date range, plus a summary per employee and weekly figures for the PDF charts.
 *
 * Rules (DECISIONS 2026-10-16):
 *   · a task is in the range when it was received, worked on or finished in it;
 *   · times are shop-local; durations in minutes;
 *   · allocated = the time first set; total allocated = with approved extensions;
 *   · effective working time = working-calendar minutes of the person's own scoring calendar (approved leave off),
 *     including time waiting for QC; on time = effective ≤ total allocated + the scoring tolerance;
 *   · no costs or salaries.
 */
import { excused, LEAVE_LABEL, LEAVE_TYPES, type Absence, type LeaveType } from "./attendance";
import type { Calendar } from "./calendar";
import { reworkH, stepName } from "./qc";
import { fmtDur } from "./reports";
import { durationH, type QueueTask } from "./queue";
import { addDays, dateOf, type LocalDT, type LocalDate } from "./time";
import type { Project } from "./types";
import { actualH, standardH } from "./work";

export interface PerfQueueTask extends QueueTask {
  projectId: string | null;
  stageId: string | null;
  workItemId: string | null;
  createdAt: LocalDT | null;
  createdBy: string | null;
}
export interface PerfRequest {
  kind: "extension" | "qc";
  queueTaskId: string | null;
  workItemId: string | null;
  sentAt: LocalDT;
  status: "pending" | "approved" | "rejected";
  decidedAt: LocalDT | null;
  reply: string;
  extraH: number | null;
}
export interface PerfReview {
  workItemId: string;
  submittedAt: LocalDT;
  decidedAt: LocalDT | null;
  result: "approved" | "rejected" | null;
  reason: string;
}
export interface PerfPerson { id: string; name: string; department: string }

export type PerfStatus = "Finished" | "In progress" | "Waiting for QC" | "Not started";
export type QcResult = "Passed first time" | "Failed then passed" | "Pending" | "";

export interface PerfRow {
  personId: string;
  employee: string;
  department: string;
  project: string;
  partSerial: string;
  partName: string;
  stage: string;
  task: string;
  assignedOn: LocalDT | null;
  assignedBy: string;
  allocatedMin: number;
  extensions: number;
  extensionMin: number;
  totalAllocatedMin: number;
  actualStart: LocalDT | null;
  qcRequestedAt: LocalDT[];
  qcResult: QcResult;
  qcFailures: { at: LocalDT | null; reason: string }[];
  reworkMin: number;
  finishedAt: LocalDT | null;
  effectiveMin: number;
  varianceMin: number;
  onTime: boolean | null;
  status: PerfStatus;
}

export interface PerfInput {
  people: PerfPerson[];
  projects: Project[];
  queue: PerfQueueTask[];
  requests: PerfRequest[];
  reviews: PerfReview[];
  /** A person's scoring calendar (approved leave off). */
  calFor: (personId: string) => Calendar;
  dayHours: number;
  toleranceH: number;
  now: LocalDT;
  from: LocalDate;
  to: LocalDate;
  /** Also keep tasks with no activity yet (Reports "Include not started"). */
  notStarted?: boolean;
}

const m = (h: number) => Math.round(h * 60);
const inRange = (x: LocalDT | null, from: LocalDate, to: LocalDate) => !!x && dateOf(x) >= from && dateOf(x) <= to;

export function performanceRows(i: PerfInput): PerfRow[] {
  const linked = new Set(i.queue.map((q) => q.workItemId).filter(Boolean) as string[]);
  const byItem = new Map<string, { p: Project; w: Project["work"][number] }>();
  for (const p of i.projects) for (const w of p.work) byItem.set(w.id, { p, w });
  const out: PerfRow[] = [];

  for (const person of i.people) {
    const cal = i.calFor(person.id);
    const tol = m(i.toleranceH);

    const row = (x: {
      p: Project | null; w: Project["work"][number] | null; title: string; stageId: string | null;
      assignedOn: LocalDT | null; assignedBy: string; totalAllocMin: number; ext: PerfRequest[];
      start: LocalDT | null; end: LocalDT | null; qc: { at: LocalDT; decidedAt: LocalDT | null; ok: boolean | null; why: string }[];
      effectiveMin: number; waitingQc: boolean; done: boolean;
    }): PerfRow => {
      const part = x.w && x.p ? [...x.p.parts, ...(x.p.folders ?? [])].find((y) => y.id === x.w!.partId) : undefined;
      const st = x.p?.stages.find((s) => s.id === (x.w?.stageId ?? x.stageId));
      const extMin = x.ext.reduce((s, r) => s + m(r.extraH ?? 0), 0);
      const failures = x.qc.filter((q) => q.ok === false).map((q) => ({ at: q.decidedAt, reason: q.why }));
      return {
        personId: person.id, employee: person.name, department: person.department,
        project: x.p ? `${x.p.serial}${x.p.name ? ` ${x.p.name}` : ""}` : "",
        partSerial: part?.serial ?? "", partName: part ? (x.w ? stepName(part.name, x.w) : part.name) : "",
        stage: st?.name ?? "", task: x.title,
        assignedOn: x.assignedOn, assignedBy: x.assignedBy,
        allocatedMin: Math.max(0, x.totalAllocMin - extMin), extensions: x.ext.length, extensionMin: extMin, totalAllocatedMin: x.totalAllocMin,
        actualStart: x.start, qcRequestedAt: x.qc.map((q) => q.at).sort(),
        // Only work that goes through QC has a result: a gated step, or a task with a QC request.
        qcResult: !x.p?.gated && !x.qc.length && !x.waitingQc ? ""
          : x.done ? (failures.length ? "Failed then passed" : "Passed first time") : "Pending",
        qcFailures: failures,
        reworkMin: x.w ? m(reworkH(x.w, cal, i.now)) : 0,
        finishedAt: x.done ? x.end : null,
        effectiveMin: x.effectiveMin,
        varianceMin: x.effectiveMin - x.totalAllocMin,
        onTime: x.done ? x.effectiveMin <= x.totalAllocMin + tol : null,
        status: x.done ? "Finished" : x.waitingQc ? "Waiting for QC" : x.start ? "In progress" : "Not started",
      };
    };
    // Any activity in the period (Reports fix 2026-10-17): assigned, worked on, QC requested or decided, finished.
    const keep = (r: PerfRow, qc: { at: LocalDT; decidedAt: LocalDT | null }[]) => inRange(r.assignedOn, i.from, i.to) || inRange(r.finishedAt, i.from, i.to)
      || (!!r.actualStart && dateOf(r.actualStart) <= i.to && dateOf(r.finishedAt ?? i.now) >= i.from)
      || qc.some((q) => inRange(q.at, i.from, i.to) || inRange(q.decidedAt, i.from, i.to))
      || (!!i.notStarted && r.status === "Not started");

    // Queue tasks (linked part steps take their times and QC from the step).
    for (const t of i.queue.filter((q) => q.personId === person.id)) {
      const ref = t.workItemId ? byItem.get(t.workItemId) : undefined;
      const w = ref?.w ?? null;
      const p = ref?.p ?? i.projects.find((x) => x.id === t.projectId) ?? null;
      const reqs = i.requests.filter((r) => r.queueTaskId === t.id || (!!w && r.workItemId === w.id));
      // A part step's QC lives in its reviews (gated or not); a plain task's in its QC requests.
      const qc = w && (p?.gated || i.reviews.some((r) => r.workItemId === w.id))
        ? i.reviews.filter((r) => r.workItemId === w.id).map((r) => ({ at: r.submittedAt, decidedAt: r.decidedAt, ok: r.result === null ? null : r.result === "approved", why: r.reason }))
        : reqs.filter((r) => r.kind === "qc").map((r) => ({ at: r.sentAt, decidedAt: r.decidedAt, ok: r.status === "pending" ? null : r.status === "approved", why: r.reply }));
      const done = w ? w.status === "done" : t.status === "done";
      const start = w?.start ?? t.actualStart;
      const end = w ? w.end : t.actualEnd;
      const r = row({
        p, w, title: t.title, stageId: t.stageId, assignedOn: t.createdAt, assignedBy: t.createdBy ?? "",
        totalAllocMin: m(durationH(t, i.dayHours)), ext: reqs.filter((x) => x.kind === "extension" && x.status === "approved"),
        start, end, qc, done,
        effectiveMin: w ? m(actualH(w, cal, i.now)) : start ? m(Math.max(0, cal.wh(start, end ?? i.now))) : 0,
        waitingQc: !done && ((!!w && !!w.qcSince) || reqs.some((x) => x.kind === "qc" && x.status === "pending")),
      });
      if (keep(r, qc)) out.push(r);
    }

    // Part steps on no queue task (older projects, or assigned on the board only).
    for (const p of i.projects) {
      for (const w of p.work) {
        if (w.tech !== person.id || linked.has(w.id)) continue;
        const st = p.stages.find((s) => s.id === w.stageId);
        if (!st) continue;
        const qc = i.reviews.filter((r) => r.workItemId === w.id).map((r) => ({ at: r.submittedAt, decidedAt: r.decidedAt, ok: r.result === null ? null : r.result === "approved", why: r.reason }));
        const r = row({
          p, w, title: st.name, stageId: st.id, assignedOn: null, assignedBy: "",
          totalAllocMin: m(w.planH ?? standardH(w, st)), ext: i.requests.filter((x) => x.workItemId === w.id && x.kind === "extension" && x.status === "approved"),
          start: w.start, end: w.end, qc, done: w.status === "done", effectiveMin: m(actualH(w, cal, i.now)), waitingQc: !!w.qcSince && w.status !== "done",
        });
        if (keep(r, qc)) out.push(r);
      }
    }
  }
  return out.sort((a, b) => a.employee.localeCompare(b.employee) || (a.actualStart ?? a.assignedOn ?? "9").localeCompare(b.actualStart ?? b.assignedOn ?? "9"));
}

/** Working days of each leave type an absence covers inside the range. */
export function absenceDaysByType(absences: Absence[], personId: string, cal: Calendar, from: LocalDate, to: LocalDate): Record<LeaveType, number> {
  const out = Object.fromEntries(LEAVE_TYPES.map((k) => [k, 0])) as Record<LeaveType, number>;
  for (const a of absences) {
    if (a.cancelled || a.personId !== personId) continue;
    for (let d = a.startsOn > from ? a.startsOn : from; d <= a.endsOn && d <= to; d = addDays(d, 1)) if (cal.isWorkDay(d)) out[a.kind]++;
  }
  return out;
}

export interface PerfSummary {
  personId: string;
  employee: string;
  department: string;
  finished: number;
  onTimePct: number | null;
  firstTimeQcPct: number | null;
  allocatedMin: number;
  effectiveMin: number;
  extensions: number;
  reworkMin: number;
  absence: Record<LeaveType, number>;
}

export function summaries(rows: PerfRow[], people: PerfPerson[], absences: Absence[], cal: Calendar, from: LocalDate, to: LocalDate): PerfSummary[] {
  return people.map((p) => {
    const mine = rows.filter((r) => r.personId === p.id);
    const fin = mine.filter((r) => r.status === "Finished" && inRange(r.finishedAt, from, to));
    const withQc = fin.filter((r) => r.qcResult !== "");
    const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null);
    return {
      personId: p.id, employee: p.name, department: p.department, finished: fin.length,
      onTimePct: pct(fin.filter((r) => r.onTime).length, fin.length),
      firstTimeQcPct: pct(withQc.filter((r) => r.qcResult === "Passed first time").length, withQc.length),
      allocatedMin: mine.reduce((s, r) => s + r.totalAllocatedMin, 0),
      effectiveMin: mine.reduce((s, r) => s + r.effectiveMin, 0),
      extensions: mine.reduce((s, r) => s + r.extensions, 0),
      reworkMin: mine.reduce((s, r) => s + r.reworkMin, 0),
      absence: absenceDaysByType(absences, p.id, cal, from, to),
    };
  });
}

/** Monday of the week a date falls in. */
export function weekOf(d: LocalDate): LocalDate {
  const dow = new Date(`${d}T00:00:00Z`).getUTCDay();
  return addDays(d, -((dow + 6) % 7));
}

export interface WeekPoint { week: LocalDate; allocatedH: number; effectiveH: number; onTimePct: number | null; firstTimeQcPct: number | null }

/** Finished work per week (by finish date): allocated vs effective hours, on-time %, first-time QC pass %. */
export function weekly(rows: PerfRow[], from: LocalDate, to: LocalDate): WeekPoint[] {
  const out: WeekPoint[] = [];
  for (let wk = weekOf(from); wk <= to; wk = addDays(wk, 7)) {
    const fin = rows.filter((r) => r.status === "Finished" && r.finishedAt && weekOf(dateOf(r.finishedAt)) === wk);
    const qc = fin.filter((r) => r.qcResult !== "");
    out.push({
      week: wk,
      allocatedH: fin.reduce((s, r) => s + r.totalAllocatedMin, 0) / 60,
      effectiveH: fin.reduce((s, r) => s + r.effectiveMin, 0) / 60,
      onTimePct: fin.length ? Math.round((fin.filter((r) => r.onTime).length / fin.length) * 100) : null,
      firstTimeQcPct: qc.length ? Math.round((qc.filter((r) => r.qcResult === "Passed first time").length / qc.length) * 100) : null,
    });
  }
  return out;
}

// ───────────── CSV ─────────────

const hm = fmtDur;
const dt = (x: LocalDT | null) => (x ? x.slice(0, 16).replace("T", " ") : "");
const cell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Hours as a decimal number with 2 places, so Excel can total them: 150 min → "2.50". */
const hd = (min: number) => (min / 60).toFixed(2);

export const PERF_COLUMNS = [
  "Employee", "Department", "Project", "Part serial", "Part name", "Stage", "Task", "Assigned on", "Assigned by",
  "Allocated (min)", "Allocated (h)", "Approved extensions", "Extension (min)", "Approved extensions (h)",
  "Total allocated (min)", "Total allocated (h)",
  "Actual start", "QC requested at", "QC result", "QC failures", "QC failure details", "Rework (min)", "Rework time (h)", "Finished at",
  "Effective working time (min)", "Effective working time (h)", "Variance (min)", "Variance (h)", "On time", "Status",
] as const;

/** UTF-8 CSV with a byte-order mark so Excel opens it correctly. One row per task; minutes and hours side by side. */
export function performanceCsv(rows: PerfRow[]): string {
  const lines = [PERF_COLUMNS.join(",")];
  for (const r of rows) {
    lines.push([
      r.employee, r.department, r.project, r.partSerial, r.partName, r.stage, r.task, dt(r.assignedOn), r.assignedBy,
      r.allocatedMin, hd(r.allocatedMin), r.extensions, r.extensionMin, hd(r.extensionMin), r.totalAllocatedMin, hd(r.totalAllocatedMin),
      dt(r.actualStart), r.qcRequestedAt.map(dt).join(" | "), r.qcResult, r.qcFailures.length,
      r.qcFailures.map((f) => `${dt(f.at)} ${f.reason}`.trim()).join(" | "), r.reworkMin, hd(r.reworkMin), dt(r.finishedAt),
      r.effectiveMin, hd(r.effectiveMin), r.varianceMin, hd(r.varianceMin), r.onTime === null ? "" : r.onTime ? "Yes" : "No", r.status,
    ].map(cell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

/** The `_summary.csv` beside the task file (Reports fix 3b): one row per employee, totals in hours. No total rows in the task file. */
export function performanceSummaryCsv(summary: PerfSummary[], rows: PerfRow[]): string {
  const lines = [[
    "Employee", "Department", "Tasks", "Tasks finished", "Total allocated (h)", "Total effective (h)", "Variance (h)",
    "On time (%)", "First-time QC pass (%)", "Approved extensions", "Rework time (h)", ...LEAVE_TYPES.map((k) => `${LEAVE_LABEL[k]} (days)`),
  ].join(",")];
  for (const s of summary) {
    const tasks = rows.filter((r) => r.personId === s.personId).length;
    lines.push([
      s.employee, s.department, tasks, s.finished, hd(s.allocatedMin), hd(s.effectiveMin), hd(s.effectiveMin - s.allocatedMin),
      s.onTimePct ?? "", s.firstTimeQcPct ?? "", s.extensions, hd(s.reworkMin), ...LEAVE_TYPES.map((k) => s.absence[k]),
    ].map(cell).join(","));
  }
  return `\uFEFF${lines.join("\r\n")}\r\n`;
}

export const leaveSummary = (a: Record<LeaveType, number>) =>
  LEAVE_TYPES.filter((k) => a[k]).map((k) => `${LEAVE_LABEL[k]} ${a[k]}d${excused(k) ? "" : " (counts)"}`).join(", ") || "None";
export { hm as fmtMinHM, dt as fmtStamp };

// ───────────── Date range (presets + custom) ─────────────

export type RangePreset = "today" | "yesterday" | "week" | "lastWeek" | "month" | "lastMonth" | "last3Months" | "year" | "pickMonth" | "custom";

/** The From–To dates for a preset; `month` is YYYY-MM for "Pick a month". Null when the custom range is incomplete. */
export function rangeFor(preset: RangePreset, today: LocalDate, opt: { month?: string; from?: string; to?: string } = {}): { from: LocalDate; to: LocalDate } | null {
  const monthEnd = (ym: string) => {
    const [y, mo] = ym.split("-").map(Number);
    return `${ym}-${String(new Date(Date.UTC(y, mo, 0)).getUTCDate()).padStart(2, "0")}`;
  };
  const ym = today.slice(0, 7);
  switch (preset) {
    case "today": return { from: today, to: today };
    case "yesterday": { const y = addDays(today, -1); return { from: y, to: y }; }
    case "lastWeek": { const f = addDays(weekOf(today), -7); return { from: f, to: addDays(f, 6) }; }
    // Last 3 months: the same day three months back (or that month's last day) up to today.
    case "last3Months": {
      const [y, mo, d] = today.split("-").map(Number);
      const m0 = mo - 3 <= 0 ? mo + 9 : mo - 3, y0 = mo - 3 <= 0 ? y - 1 : y;
      const last = new Date(Date.UTC(y0, m0, 0)).getUTCDate();
      return { from: `${y0}-${String(m0).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`, to: today };
    }
    case "year": return { from: `${today.slice(0, 4)}-01-01`, to: today };
    // This week and This month run up to today (nothing after today has happened yet).
    case "week": return { from: weekOf(today), to: today };
    case "month": return { from: `${ym}-01`, to: today };
    case "lastMonth": { const prev = addDays(`${ym}-01`, -1).slice(0, 7); return { from: `${prev}-01`, to: monthEnd(prev) }; }
    case "pickMonth": return opt.month && /^\d{4}-\d{2}$/.test(opt.month) ? { from: `${opt.month}-01`, to: monthEnd(opt.month) } : null;
    case "custom": {
      const ok = (d?: string) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
      return ok(opt.from) && ok(opt.to) && opt.from! <= opt.to! ? { from: opt.from!, to: opt.to! } : null;
    }
  }
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** AM-30: a range in words: "16 Oct 2026", "1–31 Oct 2026", "28 Sep – 4 Oct 2026", "28 Dec 2026 – 3 Jan 2027". */
export function rangeLabel(from: LocalDate, to: LocalDate): string {
  const [fy, fm, fd] = from.split("-").map(Number), [ty, tm, td] = to.split("-").map(Number);
  if (from === to) return `${fd} ${MONTHS[fm - 1]} ${fy}`;
  if (fy === ty && fm === tm) return `${fd}–${td} ${MONTHS[fm - 1]} ${fy}`;
  if (fy === ty) return `${fd} ${MONTHS[fm - 1]} – ${td} ${MONTHS[tm - 1]} ${ty}`;
  return `${fd} ${MONTHS[fm - 1]} ${fy} – ${td} ${MONTHS[tm - 1]} ${ty}`;
}
