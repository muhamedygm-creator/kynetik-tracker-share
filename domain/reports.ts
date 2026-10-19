/**
 * Reports (amends AM-27, redesigned by the Reports fix of 2026-10-17): Employees (the AM-26 log), Parts, Projects
 * and the Activity log. CSV = full detail, one record per row; the PDF summarises. Never costs or salaries.
 *
 * Rules (DECISIONS 2026-10-17):
 *   · "in this period" = any activity in it: assigned, started, worked on, QC requested or decided, or finished.
 *     "Include not started" adds work with no activity yet (open projects only);
 *   · Parts: one row per part, with every stage and its own technician (no employee filter on parts);
 *   · Projects: one row per project, expanding to its stages;
 *   · effective time is the whole step's working time, not only the part inside the period, so it compares
 *     with the allocated time;
 *   · each tab computes its rows for the period first, then applies its own filters, so the filter lists only
 *     offer values that have data in the period.
 */
import { absenceDays, LEAVE_LABEL, type Absence } from "./attendance";
import type { Calendar } from "./calendar";
import type { PerfQueueTask, PerfRequest, PerfReview } from "./performance";
import { componentLabel } from "./qc";
import { dateOf, type LocalDT, type LocalDate } from "./time";
import type { Health, Project, WorkItem } from "./types";
import { actualH, standardH } from "./work";

export interface ReportFilter {
  from: LocalDate;
  to: LocalDate;
  /** Also show work with no activity yet. */
  notStarted?: boolean;
  /** Employees tab. */
  employees?: string[];
  department?: string;
  /** One or several project ids. */
  projects?: string[];
  part?: string;
  stage?: string;
  status?: string;
  material?: string;
  finish?: string;
  /** Activity log. */
  who?: string[];
  action?: string;
  item?: string;
}

export const STEP_STATUS: Record<string, string> = { todo: "Not started", doing: "In progress", blocked: "Blocked", done: "Finished" };
export const PART_STATUSES = ["Not started", "In progress", "Waiting for QC", "Blocked", "Finished"];

const m = (h: number) => Math.round(h * 60);
const inP = (x: LocalDT | null | undefined, f: Pick<ReportFilter, "from" | "to">) => !!x && dateOf(x) >= f.from && dateOf(x) <= f.to;

/** "2h 30m", "186h 39m", "45m", "0h". Never "186:39". */
export function fmtDur(min: number): string {
  const a = Math.abs(Math.round(min)), h = Math.floor(a / 60), r = a % 60, sign = min < 0 ? "−" : "";
  return h && r ? `${sign}${h}h ${r}m` : h ? `${sign}${h}h` : r ? `${sign}${r}m` : "0h";
}
/** "+178h over" when the effective time is past the allocated time, else null. */
export function overNote(allocatedMin: number, effectiveMin: number): string | null {
  const over = effectiveMin - allocatedMin;
  if (allocatedMin <= 0 || over <= 0) return null;
  return `+${over >= 60 ? `${Math.round(over / 60)}h` : `${over}m`} over`;
}

export interface ReportInput {
  projects: Project[];
  people: { id: string; name: string; departmentId: string | null }[];
  departments: { id: string; key: string; name: string }[];
  queue: PerfQueueTask[];
  requests: PerfRequest[];
  reviews: PerfReview[];
  absences: Absence[];
  calFor: (personId: string) => Calendar;
  cal: Calendar;
  now: LocalDT;
}

// ───────────── Parts ─────────────

/** One stage step of a part (a mold component is its own step). */
export interface PartRow {
  projectId: string; project: string; partId: string; serial: string; part: string; material: string; finishColour: string; finishSheen: string;
  splitFrom: string; stage: string; stageNo: number; component: string; moldComponents: number | null;
  technicianId: string | null; technician: string; department: string;
  assignedOn: LocalDT | null; started: LocalDT | null; qcRequested: LocalDT | null; qcDecided: LocalDT | null; qcResult: string;
  qcAttempts: number; qcPassed: number; qcFailed: number; finished: LocalDT | null;
  allocatedMin: number; effectiveMin: number; status: string;
  /** Had activity in the period. */
  active: boolean;
  lengthM: number | null; widthM: number | null; heightM: number | null; weightG: number | null; surfaceM2: number | null; volumeM3: number | null;
  filamentG: number | null; printMin: number | null; slices: number | null;
}

/** One part, with its stage timeline. */
export interface PartReport {
  projectId: string; project: string; partId: string; serial: string; part: string; splitFrom: string;
  material: string; finishSheen: string; finishColour: string;
  currentStage: string; stagesDone: number; stagesTotal: number;
  allocatedMin: number; effectiveMin: number; status: string;
  /** Activity in the period: steps finished, QC passes and fails. */
  stepsFinished: number; qcPassed: number; qcFailed: number; finishedInPeriod: boolean;
  active: boolean;
  steps: PartRow[];
}

/** "Forged carbon · Red · Matte", or "" when nothing is recorded. */
export const materialFinish = (r: Pick<PartRow, "material" | "finishColour" | "finishSheen">) => [r.material, r.finishColour, r.finishSheen].filter(Boolean).join(" · ");

function stepActive(w: WorkItem, assigned: LocalDT | null, revs: PerfReview[], f: ReportFilter, now: LocalDT) {
  return inP(assigned, f) || (!!w.start && dateOf(w.start) <= f.to && dateOf(w.end ?? now) >= f.from)
    || revs.some((r) => inP(r.submittedAt, f) || inP(r.decidedAt, f));
}

const statusOf = (w: WorkItem) => (w.status === "doing" && w.qcSince ? "Waiting for QC" : STEP_STATUS[w.status] ?? w.status);

/** Every part with work in the period (or not started yet, when asked), before the tab's own filters. */
export function partReports(i: ReportInput, f: ReportFilter): PartReport[] {
  const name = (id: string | null) => (id ? i.people.find((p) => p.id === id)?.name ?? "" : "");
  const deptOf = (id: string | null) => {
    const d = i.people.find((p) => p.id === id)?.departmentId;
    return i.departments.find((x) => x.id === d)?.name ?? "";
  };
  const assigned = new Map(i.queue.filter((q) => q.workItemId).map((q) => [q.workItemId!, q.createdAt]));
  const out: PartReport[] = [];
  for (const p of i.projects) {
    const all = [...p.parts, ...(p.folders ?? [])];
    const order = new Map(p.stages.map((s, k) => [s.id, k]));
    for (const part of p.parts) {
      const work = p.work.filter((w) => w.partId === part.id).sort((a, b) => (order.get(a.stageId) ?? 0) - (order.get(b.stageId) ?? 0) || (a.componentNo ?? 0) - (b.componentNo ?? 0));
      if (!work.length) continue;
      const parent = part.parentId ? all.find((x) => x.id === part.parentId) : undefined;
      const model = part.model?.at || part.model?.lengthM ? part.model : parent?.model;
      const material = part.material || parent?.material || "", colour = part.finishColour || parent?.finishColour || "", sheen = part.finishSheen || parent?.finishSheen || "";
      const steps: PartRow[] = [];
      for (const w of work) {
        const st = p.stages.find((x) => x.id === w.stageId);
        if (!st) continue;
        const revs = i.reviews.filter((r) => r.workItemId === w.id).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
        const failed = revs.filter((r) => r.result === "rejected");
        const cal = w.tech ? i.calFor(w.tech) : i.cal;
        const at = assigned.get(w.id) ?? null;
        steps.push({
          projectId: p.id, project: `${p.serial}${p.name ? ` ${p.name}` : ""}`, partId: part.id, serial: part.serial ?? "", part: part.name,
          material, finishColour: colour, finishSheen: sheen, splitFrom: parent ? `${parent.serial ?? ""} ${parent.name}`.trim() : "",
          stage: st.name, stageNo: (order.get(st.id) ?? 0) + 1, component: componentLabel(w) ?? "", moldComponents: w.componentTotal ?? null,
          technicianId: w.tech, technician: name(w.tech), department: deptOf(w.tech),
          assignedOn: at, started: w.start, qcRequested: revs[0]?.submittedAt ?? null, qcDecided: revs.filter((r) => r.decidedAt).at(-1)?.decidedAt ?? null,
          qcResult: !revs.length && !w.qcSince ? "" : w.status === "done" ? (failed.length ? "Failed then passed" : "Passed first time") : failed.length ? "Failed, reworking" : "Pending",
          qcAttempts: revs.length, qcPassed: revs.filter((r) => r.result === "approved" && inP(r.decidedAt, f)).length,
          qcFailed: failed.filter((r) => inP(r.decidedAt, f)).length, finished: w.status === "done" ? w.end : null,
          allocatedMin: m(w.planH ?? standardH(w, st)), effectiveMin: m(actualH(w, cal, i.now)), status: statusOf(w),
          active: stepActive(w, at, revs, f, i.now),
          lengthM: model?.lengthM ?? null, widthM: model?.widthM ?? null, heightM: model?.heightM ?? null, weightG: model?.weightG ?? null,
          surfaceM2: model?.surfaceM2 ?? null, volumeM3: model?.volumeM3 ?? null,
          filamentG: part.print?.filamentG ?? null, printMin: part.print?.minutes ?? null, slices: part.print?.slices ?? null,
        });
      }
      if (!steps.length) continue;
      const active = steps.some((s) => s.active);
      const started = steps.some((s) => s.started);
      if (!active && !(f.notStarted && !started && p.status !== "done")) continue;
      const stageNames = [...new Set(steps.map((s) => s.stage))];
      const stageDone = (n: string) => steps.filter((s) => s.stage === n).every((s) => s.status === "Finished");
      const st = steps.map((s) => s.status);
      const status = st.every((x) => x === "Finished") ? "Finished" : st.includes("Waiting for QC") ? "Waiting for QC" : st.includes("Blocked") ? "Blocked"
        : st.some((x) => x !== "Not started") ? "In progress" : "Not started";
      const lastEnd = steps.map((s) => s.finished).filter(Boolean).sort().at(-1) ?? null;
      out.push({
        projectId: p.id, project: steps[0].project, partId: part.id, serial: part.serial ?? "", part: part.name, splitFrom: steps[0].splitFrom,
        material, finishColour: colour, finishSheen: sheen,
        currentStage: status === "Finished" ? "" : stageNames.find((n) => !stageDone(n)) ?? "",
        stagesDone: stageNames.filter(stageDone).length, stagesTotal: stageNames.length,
        allocatedMin: steps.reduce((n, s) => n + s.allocatedMin, 0), effectiveMin: steps.reduce((n, s) => n + s.effectiveMin, 0), status,
        stepsFinished: steps.filter((s) => inP(s.finished, f)).length, qcPassed: steps.reduce((n, s) => n + s.qcPassed, 0), qcFailed: steps.reduce((n, s) => n + s.qcFailed, 0),
        finishedInPeriod: status === "Finished" && inP(lastEnd, f), active, steps,
      });
    }
  }
  return out.sort((a, b) => a.project.localeCompare(b.project, undefined, { numeric: true }) || a.serial.localeCompare(b.serial, undefined, { numeric: true }) || a.part.localeCompare(b.part));
}

/** The Parts tab's own filters: project, part (serial or name), stage, status, material, finish. */
export function filterParts(rows: PartReport[], f: ReportFilter): PartReport[] {
  const q = f.part?.trim().toLowerCase();
  return rows.filter((r) => (!f.projects?.length || f.projects.includes(r.projectId))
    && (!q || `${r.serial} ${r.part}`.toLowerCase().includes(q))
    && (!f.stage || r.steps.some((s) => s.stage === f.stage && (s.active || !s.started)))
    && (!f.status || r.status === f.status)
    && (!f.material || r.material === f.material)
    && (!f.finish || r.finishSheen === f.finish));
}

// ───────────── Projects ─────────────

/** One stage of a project. */
export interface ProjectRow {
  projectId: string; project: string; status: string; start: LocalDate; planned: LocalDate | null; forecast: LocalDate | null; actual: LocalDate | null;
  partsTotal: number; partsDone: number; partsInProgress: number;
  stage: string; department: string; steps: number; stepsDone: number; allocatedMin: number; effectiveMin: number;
  delays: number; extensions: number; qcFailures: number; absenceDays: number; absences: string;
}

export const HEALTH_LABEL: Record<Health, string> = { ok: "On track", risk: "At risk", late: "Late", hold: "On hold", done: "Finished", unset: "No delivery date" };
export const PROJECT_STATUSES = ["On track", "At risk", "Late", "On hold", "Finished", "No delivery date"];

export interface ProjectReport {
  projectId: string; project: string; status: string; health: string;
  start: LocalDate; planned: LocalDate | null; forecast: LocalDate | null; actual: LocalDate | null;
  progressPct: number; stepsDone: number; stepsTotal: number; partsDone: number; partsTotal: number;
  allocatedMin: number; effectiveMin: number; delays: number; extensions: number; qcFailures: number; absenceDays: number;
  byDept: { department: string; allocatedMin: number; effectiveMin: number }[];
  active: boolean;
  stages: ProjectRow[];
}

export function projectReports(i: ReportInput, f: ReportFilter, info: (projectId: string) => { forecast: LocalDate | null; health: Health }): ProjectReport[] {
  const assigned = new Map(i.queue.filter((q) => q.workItemId).map((q) => [q.workItemId!, q.createdAt]));
  const out: ProjectReport[] = [];
  for (const p of i.projects) {
    const ends = p.work.filter((w) => w.end).map((w) => w.end!).sort();
    const actual = p.status === "done" ? p.deliveredOn ?? (ends.length ? dateOf(ends[ends.length - 1]) : null) : null;
    const active = inP(actual ? `${actual}T00:00` : null, f)
      || p.work.some((w) => stepActive(w, assigned.get(w.id) ?? null, i.reviews.filter((r) => r.workItemId === w.id), f, i.now));
    const started = p.work.some((w) => w.start);
    if (!active && !(f.notStarted && !started && p.status !== "done")) continue;
    const parts = p.parts.filter((x) => p.work.some((w) => w.partId === x.id));
    const partDone = (id: string) => p.work.filter((w) => w.partId === id).every((w) => w.status === "done");
    const status = p.status === "done" ? "Finished" : p.status === "hold" ? "On hold" : "Open";
    const { forecast, health } = info(p.id);
    const techs = new Set(p.work.map((w) => w.tech).filter(Boolean) as string[]);
    const hit = i.absences.filter((a) => !a.cancelled && techs.has(a.personId) && a.endsOn >= f.from && a.startsOn <= f.to
      && p.work.some((w) => w.tech === a.personId && (w.status !== "done" || (w.end && dateOf(w.end) >= a.startsOn))));
    const absenceDaysN = hit.reduce((s, a) => s + absenceDays(a).filter((d) => i.cal.isWorkDay(d) && d >= f.from && d <= f.to).length, 0);
    const absences = hit.map((a) => `${i.people.find((x) => x.id === a.personId)?.name ?? ""} ${LEAVE_LABEL[a.kind]} ${a.startsOn}`).join(" | ");
    const stages: ProjectRow[] = [];
    for (const st of p.stages) {
      const ws = p.work.filter((w) => w.stageId === st.id);
      if (!ws.length) continue;
      const dept = i.departments.find((d) => d.key === st.stationType)?.name ?? st.stationType;
      const effOf = (w: WorkItem) => m(actualH(w, w.tech ? i.calFor(w.tech) : i.cal, i.now));
      const allocOf = (w: WorkItem) => m(w.planH ?? standardH(w, st));
      const ids = new Set(ws.map((w) => w.id));
      const qids = new Set(i.queue.filter((q) => q.workItemId && ids.has(q.workItemId)).map((q) => q.id));
      stages.push({
        projectId: p.id, project: `${p.serial}${p.name ? ` ${p.name}` : ""}`, status, start: p.startDate, planned: p.deliveryDate,
        forecast, actual, partsTotal: parts.length, partsDone: parts.filter((x) => partDone(x.id)).length,
        partsInProgress: parts.filter((x) => !partDone(x.id) && p.work.some((w) => w.partId === x.id && w.status === "doing")).length,
        stage: st.name, department: dept, steps: ws.length, stepsDone: ws.filter((w) => w.status === "done").length,
        allocatedMin: ws.reduce((s, w) => s + allocOf(w), 0), effectiveMin: ws.reduce((s, w) => s + effOf(w), 0),
        delays: ws.filter((w) => allocOf(w) > 0 && effOf(w) > allocOf(w)).length,
        extensions: i.requests.filter((r) => r.kind === "extension" && r.status === "approved" && ((r.workItemId && ids.has(r.workItemId)) || (r.queueTaskId && qids.has(r.queueTaskId)))).length,
        qcFailures: i.reviews.filter((r) => ids.has(r.workItemId) && r.result === "rejected").length,
        absenceDays: absenceDaysN, absences,
      });
    }
    const sum = (k: "allocatedMin" | "effectiveMin" | "delays" | "extensions" | "qcFailures" | "steps" | "stepsDone") => stages.reduce((n, s) => n + s[k], 0);
    const depts = [...new Set(stages.map((s) => s.department))];
    out.push({
      projectId: p.id, project: `${p.serial}${p.name ? ` ${p.name}` : ""}`, status, health: HEALTH_LABEL[health],
      start: p.startDate, planned: p.deliveryDate, forecast, actual,
      progressPct: sum("steps") ? Math.round((sum("stepsDone") / sum("steps")) * 100) : 0, stepsDone: sum("stepsDone"), stepsTotal: sum("steps"),
      partsDone: parts.filter((x) => partDone(x.id)).length, partsTotal: parts.length,
      allocatedMin: sum("allocatedMin"), effectiveMin: sum("effectiveMin"), delays: sum("delays"), extensions: sum("extensions"), qcFailures: sum("qcFailures"),
      absenceDays: absenceDaysN,
      byDept: depts.map((d) => ({ department: d, allocatedMin: stages.filter((s) => s.department === d).reduce((n, s) => n + s.allocatedMin, 0), effectiveMin: stages.filter((s) => s.department === d).reduce((n, s) => n + s.effectiveMin, 0) })),
      active, stages,
    });
  }
  return out.sort((a, b) => a.project.localeCompare(b.project, undefined, { numeric: true }));
}

/** The Projects tab's own filters: projects, status, department (which also narrows the stage breakdown). */
export function filterProjects(rows: ProjectReport[], f: ReportFilter): ProjectReport[] {
  return rows
    .filter((r) => (!f.projects?.length || f.projects.includes(r.projectId)) && (!f.status || r.health === f.status))
    .map((r) => {
      if (!f.department) return r;
      const stages = r.stages.filter((s) => s.department === f.department);
      const sum = (k: "allocatedMin" | "effectiveMin" | "delays" | "extensions" | "qcFailures") => stages.reduce((n, s) => n + s[k], 0);
      return { ...r, stages, byDept: r.byDept.filter((d) => d.department === f.department), allocatedMin: sum("allocatedMin"), effectiveMin: sum("effectiveMin"),
        delays: sum("delays"), extensions: sum("extensions"), qcFailures: sum("qcFailures") };
    })
    .filter((r) => r.stages.length > 0);
}

// ───────────── Activity log ─────────────

export interface AuditEntry {
  at: LocalDT; actor: string; role: string; action: string; entity: string; entityId: string | null; projectId: string | null;
  label: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; sensitive: boolean;
}
export interface ActivityRow { at: LocalDT; who: string; role: string; type: string; what: string; item: string; change: string; notes: string; projectId: string | null }

export const ACTION_TYPES = ["Assignment", "Status", "QC", "Extension", "Absence", "Split", "Crew change", "Request", "Planning", "Hours", "Settings", "Other"];

const ENTITY: Record<string, string> = {
  projects: "Project", stages: "Stage", parts: "Part", tasks: "Task", work_items: "Part step", queue_tasks: "Task", people: "Crew member",
  settings: "Settings", departments: "Department", displays: "TV display", holidays: "Holiday", attendance: "Attendance",
  hour_logs: "Hours", invitations: "Invitation", profiles: "User", notices: "TV notice", requests: "Request", qc_reviews: "QC review",
  absences: "Absence", station_types: "Workstation type", workstations: "Workstation", work_segments: "Work time", templates: "Template",
  serial_registry: "Serial", rework_log: "Rework",
};
const FIELD: Record<string, string> = {
  status: "Status", tech_id: "Technician", person_id: "Person", plan_h: "Allocated hours", start_at: "Start", end_at: "Finish", dur_value: "Duration",
  fixed_start: "Pinned start", qc_since: "Waiting for QC since", name: "Name", title: "Title", delivery_date: "Delivery date", start_date: "Start date",
  active: "Active", department_id: "Department", material: "Material", finish_sheen: "Finish", finish_colour: "Colour", priority: "Priority", notes: "Notes",
  kind: "Type", reply: "Reply", extra_h: "Extra hours", starts_on: "From", ends_on: "To", back_on: "Back on", days: "Days", cancelled_at: "Cancelled",
};
/** Never in a report: cost tables, and cost or salary fields anywhere. */
const COST_ENTITIES = new Set(["people_cost", "settings_cost", "hour_log_cost"]);
const HIDDEN = new Set(["version", "updated_at", "created_at", "id", "base_salary", "loading_pct", "rate", "cost", "hour_rate", "salary", "position", "seg_start", "project_id", "stage_id", "part_id", "work_item_id", "queue_task_id", "created_by", "sent_by", "decided_by", "qc_by"]);
const ACTION: Record<string, string> = { insert: "Added", update: "Changed", delete: "Removed" };
const VALUE: Record<string, string> = { ...STEP_STATUS, pending: "Pending", approved: "Approved", rejected: "Rejected", extension: "Extension", qc: "QC", true: "Yes", false: "No", urgent: "Urgent", normal: "Normal" };

const words = (t: string) => {
  const s = t.replace(/_/g, " ").replace(/\bqc\b/gi, "QC");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

function typeOf(e: AuditEntry, changed: string[]): string {
  const any = (k: string) => changed.includes(k);
  const kind = (e.after?.kind ?? e.before?.kind) as string | undefined;
  if (/qc/i.test(e.action) || e.entity === "qc_reviews" || (e.entity === "requests" && kind === "qc")) return "QC";
  if (/split/i.test(e.action) || /split/i.test(e.label)) return "Split";
  if (e.entity === "requests") return kind === "extension" || /extension/i.test(e.label) ? "Extension" : "Request";
  if (e.entity === "absences" || /absen/i.test(e.action)) return "Absence";
  if (e.entity === "people" || /person_status/i.test(e.action)) return "Crew change";
  if (e.entity === "queue_tasks") return e.action !== "update" || any("person_id") ? "Assignment" : any("status") ? "Status" : "Planning";
  if (e.entity === "work_items") return any("tech_id") ? "Assignment" : any("status") ? "Status" : "Planning";
  if (["projects", "stages", "parts", "tasks", "templates", "work_segments", "rework_log"].includes(e.entity) || /baseline|plan|rework/i.test(e.action)) return "Planning";
  if (e.entity === "hour_logs" || e.entity === "attendance") return "Hours";
  if (["settings", "departments", "displays", "holidays", "invitations", "profiles", "notices", "station_types", "workstations"].includes(e.entity)) return "Settings";
  return "Other";
}

/** Readable names for the log: people, work items ("001 · Rear Bumper · Make Mold"), projects. */
export interface ActivityNames { person: (id: string) => string | undefined; workItem: (id: string) => string | undefined; project: (id: string) => string | undefined }

export function activityNames(projects: Project[], people: { id: string; name: string }[]): ActivityNames {
  const items = new Map<string, string>(), proj = new Map<string, string>();
  for (const p of projects) {
    proj.set(p.id, `${p.serial}${p.name ? ` ${p.name}` : ""}`);
    for (const w of p.work) {
      const part = [...p.parts, ...(p.folders ?? [])].find((x) => x.id === w.partId);
      const st = p.stages.find((x) => x.id === w.stageId);
      items.set(w.id, [p.serial, part ? `${part.serial ? `${part.serial} ` : ""}${part.name}` : null, st?.name, componentLabel(w)].filter(Boolean).join(" · "));
    }
  }
  const ppl = new Map(people.map((p) => [p.id, p.name]));
  return { person: (id) => ppl.get(id), workItem: (id) => items.get(id), project: (id) => proj.get(id) };
}

/** Every readable action in the period (no cost or salary data), newest first, before the tab's own filters. */
export function activityRows(entries: AuditEntry[], f: ReportFilter, names: ActivityNames): ActivityRow[] {
  const show = (k: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "string" && (k === "tech_id" || k === "person_id")) return names.person(v) ?? "someone";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return v.slice(0, 16).replace("T", " ");
    if (typeof v === "object") return JSON.stringify(v);
    return VALUE[String(v)] ?? String(v);
  };
  return entries
    .filter((e) => !e.sensitive && !COST_ENTITIES.has(e.entity) && inP(e.at, f))
    .map((e) => {
      const keys = e.action === "update" && e.before && e.after
        ? Object.keys(e.after).filter((k) => !HIDDEN.has(k) && !k.endsWith("_path") && JSON.stringify(e.before![k]) !== JSON.stringify(e.after![k])) : [];
      const n = e.after?.name ?? e.before?.name ?? e.after?.title ?? e.before?.title ?? e.after?.serial ?? e.before?.serial ?? e.after?.task_title;
      const wid = e.entity === "work_items" ? e.entityId : ((e.after?.work_item_id ?? e.before?.work_item_id) as string | undefined) ?? null;
      const pid = (e.after?.person_id ?? e.before?.person_id) as string | undefined;
      const detail = (wid && names.workItem(wid)) || (n ? String(n) : null) || (e.entity === "projects" && e.entityId ? names.project(e.entityId) : null)
        || (pid ? names.person(pid) : null) || (e.entity === "people" && e.entityId ? names.person(e.entityId) : null);
      return {
        at: e.at, who: e.actor, role: e.role, type: typeOf(e, keys), what: ACTION[e.action] ?? words(e.action),
        item: `${ENTITY[e.entity] ?? words(e.entity)}${detail ? ` · ${detail}` : ""}`,
        change: keys.map((k) => `${FIELD[k] ?? words(k)}: ${show(k, e.before![k])} → ${show(k, e.after![k])}`).join("; "),
        notes: e.label, projectId: e.projectId,
      };
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** The Activity log's own filters: who, action type, item text, project. */
export function filterActivity(rows: ActivityRow[], f: ReportFilter): ActivityRow[] {
  const q = f.item?.trim().toLowerCase();
  return rows.filter((r) => (!f.who?.length || f.who.includes(r.who)) && (!f.action || r.type === f.action)
    && (!q || `${r.item} ${r.notes} ${r.change}`.toLowerCase().includes(q)) && (!f.projects?.length || (!!r.projectId && f.projects.includes(r.projectId))));
}

// ───────────── CSV ─────────────

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const stamp = (x: LocalDT | null) => (x ? x.slice(0, 16).replace("T", " ") : "");

export function toCsv<T>(cols: [string, (r: T) => unknown][], rows: T[]): string {
  return `﻿${[cols.map(([h]) => h).join(","), ...rows.map((r) => cols.map(([, g]) => cell(g(r))).join(","))].join("\r\n")}\r\n`;
}

/** One record per stage step of every part on screen. */
export const PART_CSV: [string, (r: PartRow) => unknown][] = [
  ["Project", (r) => r.project], ["Part serial", (r) => r.serial], ["Part name", (r) => r.part], ["Material", (r) => r.material],
  ["Finish colour", (r) => r.finishColour], ["Finish sheen", (r) => r.finishSheen], ["Split from", (r) => r.splitFrom],
  ["Stage no.", (r) => r.stageNo], ["Stage", (r) => r.stage], ["Mold component", (r) => r.component], ["Mold components", (r) => r.moldComponents],
  ["Technician", (r) => r.technician], ["Department", (r) => r.department], ["Assigned", (r) => stamp(r.assignedOn)],
  ["Started", (r) => stamp(r.started)], ["QC requested", (r) => stamp(r.qcRequested)], ["QC decided", (r) => stamp(r.qcDecided)], ["QC result", (r) => r.qcResult],
  ["QC attempts", (r) => r.qcAttempts], ["Finished", (r) => stamp(r.finished)], ["Allocated (min)", (r) => r.allocatedMin],
  ["Effective (min)", (r) => r.effectiveMin], ["Allocated", (r) => fmtDur(r.allocatedMin)], ["Effective", (r) => fmtDur(r.effectiveMin)],
  ["Over allocated", (r) => overNote(r.allocatedMin, r.effectiveMin) ?? ""], ["Status", (r) => r.status], ["Activity in period", (r) => (r.active ? "Yes" : "No")],
  ["Length (m)", (r) => r.lengthM], ["Width (m)", (r) => r.widthM], ["Height (m)", (r) => r.heightM], ["Weight (g)", (r) => r.weightG],
  ["Surface (m²)", (r) => r.surfaceM2], ["Volume (m³)", (r) => r.volumeM3], ["Filament (g)", (r) => r.filamentG],
  ["Print time (min)", (r) => r.printMin], ["Slice components", (r) => r.slices],
];

/** One record per stage of every project on screen, the project's own figures repeated. */
export const PROJECT_CSV: [string, (r: ProjectRow & { health: string; progressPct: number }) => unknown][] = [
  ["Project", (r) => r.project], ["Status", (r) => r.status], ["Health", (r) => r.health], ["Progress (%)", (r) => r.progressPct], ["Start", (r) => r.start],
  ["Planned finish", (r) => r.planned ?? ""], ["Forecast finish", (r) => r.forecast ?? ""], ["Actual finish", (r) => r.actual ?? ""], ["Parts", (r) => r.partsTotal],
  ["Parts done", (r) => r.partsDone], ["Parts in progress", (r) => r.partsInProgress], ["Stage", (r) => r.stage], ["Department", (r) => r.department],
  ["Steps", (r) => r.steps], ["Steps done", (r) => r.stepsDone], ["Allocated (min)", (r) => r.allocatedMin], ["Effective (min)", (r) => r.effectiveMin],
  ["Allocated", (r) => fmtDur(r.allocatedMin)], ["Effective", (r) => fmtDur(r.effectiveMin)], ["Late steps", (r) => r.delays], ["Extensions", (r) => r.extensions],
  ["QC failures", (r) => r.qcFailures], ["Absence days (project)", (r) => r.absenceDays], ["Absences (project)", (r) => r.absences],
];
export const projectCsvRows = (rows: ProjectReport[]) => rows.flatMap((p) => p.stages.map((s) => ({ ...s, health: p.health, progressPct: p.progressPct })));

export const ACTIVITY_CSV: [string, (r: ActivityRow) => unknown][] = [
  ["When", (r) => stamp(r.at)], ["Who", (r) => r.who], ["Role", (r) => r.role], ["Type", (r) => r.type], ["Action", (r) => r.what], ["Item", (r) => r.item],
  ["Before → after", (r) => r.change], ["Notes", (r) => r.notes],
];
