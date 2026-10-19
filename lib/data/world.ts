import "server-only";
import { cache } from "react";
import { absentOn, awayLabel, calendarsFor, type Absence, type LeaveType } from "@/domain/attendance";
import { makeCalendar, type Calendar } from "@/domain/calendar";
import { panelPlan } from "@/domain/qc";
import { layoutQueue } from "@/domain/queue";
import { forecast, health, type Forecast } from "@/domain/schedule";
import type { Settings } from "@/domain/settings";
import { utcToLocal, type LocalDT } from "@/domain/time";
import type { Health, Part, Person, Project, Station, Task, WorkItem } from "@/domain/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Viewer } from "@/lib/auth";
import { loadSettings } from "@/lib/settings";
import { createClient } from "@/lib/supabase/server";

/** Versions per row id, for optimistic concurrency on writes. */
export type Versions = Record<string, number>;

export interface Department {
  id: string;
  key: string;
  name: string;
  colour: string;
  emoji: string;
  sort: number;
}

/** Person with the Phase 3.5 and v2 Crew fields. */
export interface CrewMember extends Person {
  departmentId: string | null;
  photoPath: string | null;
  /** the stored Active switch; `active` is false as well once a contract has ended */
  enabled: boolean;
  employment: "full_time" | "project_based";
  contractFrom: string | null;
  contractTo: string | null;
  /** contract_to is before today: off the planner, the queue lists and the TVs */
  contractEnded: boolean;
  /** AM-20: in Crew → Deleted accounts (history kept); inactive everywhere */
  archived: boolean;
  /** AM-29: marked absent today ("Annual leave · back 20 Oct"); null when present */
  away: { kind: LeaveType; label: string; backOn: string } | null;
  phone: string;
  skills: string;
  notes: string;
  projectIds: string[];
}

/** Queue task with its links and display fields. */
export interface QueueRow {
  id: string;
  personId: string;
  title: string;
  durValue: number;
  durUnit: "hours" | "days";
  status: "todo" | "doing" | "blocked" | "done";
  fixedStart: LocalDT | null;
  actualStart: LocalDT | null;
  actualEnd: LocalDT | null;
  position: string;
  projectId: string | null;
  stageId: string | null;
  workItemId: string | null;
  notes: string;
  colour: string | null;
  priority: "normal" | "urgent";
}

export interface StationType {
  key: string;
  label: string;
  colour: string;
}

export interface TemplateRow {
  id: string;
  key: string;
  label: string;
  archived: boolean;
  stages: { id: string; name: string; stationType: string; partHours: number; sort: number; tasks: { id: string; name: string; durH: number; sort: number }[] }[];
  parts: string[];
}

export interface BuildView {
  project: Project;
  forecast: Forecast;
  health: Health;
  /** Owner only; null for everyone else (RLS returns nothing). */
  labour: number | null;
  planEnd: LocalDT | null;
  createdAt: string;
  templateId: string | null;
  templateLabel: string;
  client: string;
  notes: string;
  /** New workflow: open steps no admin has put on a task queue yet ("not planned yet", AM-08). */
  unplanned?: number;
}

export interface World {
  settings: Settings;
  cal: Calendar;
  now: LocalDT;
  today: string;
  people: CrewMember[];
  departments: Department[];
  queue: QueueRow[];
  stations: Station[];
  stationTypes: StationType[];
  templates: TemplateRow[];
  builds: BuildView[];
  versions: Versions;
  seesCost: boolean;
  /** Owner only (settings_cost); null for everyone else. */
  currency: string | null;
  /** AM-29: absences that aren't cancelled. */
  absences: Absence[];
  /** A person's own calendar, absences off: for laying out their queue. */
  calFor: (personId: string) => Calendar;
  /** A person's own calendar for scoring: only sick, annual and unpaid leave off (unexcused counts). */
  scoreCalFor: (personId: string) => Calendar;
}

/** Everything the console pages compute from. One round of queries per request. */
export const loadWorld = cache(async (viewer: Viewer): Promise<World> => buildWorld(await createClient(), viewer.seesCost));

/**
 * Build the world from a client. `seesCost` false never queries a cost table — the display route
 * (service role) always passes false.
 */
export async function buildWorld(supabase: SupabaseClient, seesCost: boolean): Promise<World> {
  const viewer = { seesCost };
  const settings = await loadSettings(supabase);
  const tz = settings.calendar.timezone;
  const L = (x: string | null): LocalDT | null => (x ? utcToLocal(x, tz) : null);
  const cal = makeCalendar(settings);
  const now = utcToLocal(new Date(), tz);

  const q = <T>(p: PromiseLike<{ data: T[] | null; error: { message: string } | null }>) =>
    Promise.resolve(p).then((r) => {
      if (r.error) throw new Error(r.error.message);
      return r.data ?? [];
    });

  const [projects, stages, parts, tasks, baselines, work, segs, reworks, hours, people, stations, stypes, tpls, tstages, ttasks, tparts, costs, labour] =
    await Promise.all([
      q(supabase.from("projects").select("*")),
      q(supabase.from("stages").select("*").order("sort")),
      q(supabase.from("parts").select("*").order("sort").order("serial")),
      q(supabase.from("tasks").select("*").order("num")),
      q(supabase.from("baselines").select("*")),
      q(supabase.from("work_items").select("*")),
      q(supabase.from("work_segments").select("*").order("start_at")),
      q(supabase.from("rework_log").select("*").order("at")),
      q(supabase.from("work_item_hours").select("*")),
      q(supabase.from("people").select("*").order("name")),
      q(supabase.from("workstations").select("*").order("sort")),
      q(supabase.from("station_types").select("*").order("sort")),
      q(supabase.from("templates").select("*").order("label")),
      q(supabase.from("template_stages").select("*").order("sort")),
      q(supabase.from("template_tasks").select("*").order("sort")),
      q(supabase.from("template_parts").select("*").order("sort")),
      viewer.seesCost ? q(supabase.from("work_item_cost").select("*")) : Promise.resolve([]),
      viewer.seesCost ? q(supabase.from("project_labour").select("*")) : Promise.resolve([]),
    ]);
  const [departments, queue, absenceRows] = await Promise.all([
    q(supabase.from("departments").select("*").order("sort")),
    q(supabase.from("queue_tasks").select("*")),
    q(supabase.from("absences").select("*").is("cancelled_at", null)),
  ]);
  const absences: Absence[] = absenceRows.map((a) => ({
    id: a.id, personId: a.person_id, kind: a.kind, startsOn: a.starts_on, days: a.days, endsOn: a.ends_on, backOn: a.back_on,
    note: a.note ?? "", cancelled: !!a.cancelled_at,
  }));
  const cals = calendarsFor(settings, cal, absences);
  const currency = viewer.seesCost
    ? ((await supabase.from("settings_cost").select("currency").maybeSingle()).data?.currency as string | undefined) ?? "AED"
    : null;

  const versions: Versions = {};
  const v = (r: { id: string; version: number }) => (versions[r.id] = r.version);
  [projects, stages, parts, tasks, work, people, stations, tpls, departments, queue, absenceRows].forEach((rows) => rows.forEach(v));

  const hoursBy = new Map(hours.map((h) => [h.work_item_id as string, h]));
  const costBy = new Map(costs.map((c) => [c.work_item_id as string, Number(c.cost)]));
  const labourBy = new Map(labour.map((l) => [l.project_id as string, Number(l.labour)]));
  const reworkBy = (id: string) =>
    reworks.filter((r) => r.work_item_id === id).map((r) => ({ at: L(r.at)!, why: r.reason as string, by: (r.by_role as string) ?? "" }));

  const builds: BuildView[] = projects.map((p) => {
    const ts: Task[] = tasks.filter((t) => t.project_id === p.id).map((t) => ({
      id: t.id, num: t.num, stageId: t.stage_id, name: t.name, assignee: t.assignee, status: t.status, durH: Number(t.dur_h),
      pct: Number(t.pct), start: L(t.plan_start), end: L(t.plan_end), pinnedStart: L(t.pinned_start),
      actualStart: L(t.actual_start), actualEnd: L(t.actual_end), notes: t.notes,
    }));
    const ws: WorkItem[] = work.filter((w) => w.project_id === p.id).map((w) => {
      const h = hoursBy.get(w.id);
      return {
        id: w.id, stageId: w.stage_id, partId: w.part_id, status: w.status, tech: w.tech_id,
        start: L(w.start_at), end: L(w.end_at), segStart: L(w.seg_start),
        prevSegs: segs.filter((s) => s.work_item_id === w.id).map((s) => [L(s.start_at)!, L(s.end_at)!] as [LocalDT, LocalDT]),
        prevSegAttempts: segs.filter((s) => s.work_item_id === w.id).map((s) => Number(s.attempt ?? 1)),
        qcSince: L(w.qc_since ?? null), attempt: Number(w.attempt ?? 1),
        componentNo: w.component_no ?? null, componentTotal: w.component_total ?? null,
        planH: w.plan_h === null ? null : Number(w.plan_h), rework: w.rework, reworkLog: reworkBy(w.id), notes: w.notes,
        hours: h ? Number(h.hours) : 0, hoursBy: (h?.hours_by as Record<string, number>) ?? {},
        ...(viewer.seesCost ? { cost: costBy.get(w.id) ?? 0 } : {}),
      };
    });
    const project: Project = {
      id: p.id, serial: p.serial, name: p.name, status: p.status, startDate: p.start_date, deliveryDate: p.delivery_date,
      deliveredOn: p.delivered_on,
      stages: stages.filter((s) => s.project_id === p.id).map((s) => ({
        id: s.id, name: s.name, stationType: s.station_type, stationId: s.station_id, partHours: Number(s.part_hours), step: s.step ?? null,
      })),
      ...splitParts(parts.filter((x) => x.project_id === p.id)),
      gated: !!p.gated,
      tasks: ts,
      baseline: Object.fromEntries(baselines.filter((b) => b.project_id === p.id).map((b) => [b.task_id, { start: L(b.start_at)!, end: L(b.end_at)! }])),
      work: ws,
    };
    const f = forecast(project, cal, now);
    return {
      project, forecast: f, health: health(project, f, settings.health, cal.dayHours),
      labour: viewer.seesCost ? labourBy.get(p.id) ?? 0 : null,
      planEnd: L(p.plan_end), createdAt: p.created_at, templateId: p.template_id, templateLabel: p.template_label,
      client: p.client, notes: p.notes,
    };
  });

  const queueRows: QueueRow[] = queue.map((t) => ({
    id: t.id, personId: t.person_id, title: t.title, durValue: Number(t.dur_value), durUnit: t.dur_unit, status: t.status,
    fixedStart: L(t.fixed_start), actualStart: L(t.actual_start), actualEnd: L(t.actual_end), position: t.position,
    projectId: t.project_id, stageId: t.stage_id, workItemId: t.work_item_id, notes: t.notes, colour: t.colour,
    priority: t.priority === "urgent" ? "urgent" : "normal",
  }));

  // New-workflow projects are planned only from the times admins set on the task queue (AM-08).
  if (builds.some((b) => b.project.gated)) {
    const placed = new Map<string, LocalDT | null>();
    for (const pid of new Set(queueRows.map((t) => t.personId))) {
      for (const x of layoutQueue(queueRows.filter((t) => t.personId === pid), cals.away(pid), now)) placed.set(x.task.id, x.end);
    }
    for (const b of builds) {
      if (!b.project.gated) continue;
      const plan = panelPlan(b.project, queueRows, (id) => placed.get(id) ?? null);
      const floatH = plan.finish && b.project.deliveryDate ? cal.wh(plan.finish, b.project.deliveryDate) : null;
      b.forecast = { ...b.forecast, finish: plan.finish, floatH, slipH: null };
      b.health = health(b.project, b.forecast, settings.health, cal.dayHours);
      b.unplanned = plan.unplanned;
    }
  }

  return {
    settings, cal, now, today: now.slice(0, 10),
    people: people.map((x) => ({
      id: x.id, name: x.name, crew: x.crew, costClass: x.cost_class, departmentId: x.department_id, photoPath: x.photo_path,
      ...crewFields(x, now.slice(0, 10)),
      away: ((a) => (a ? { kind: a.kind, label: awayLabel(a), backOn: a.backOn } : null))(absentOn(absences, x.id, now.slice(0, 10))),
    })),
    departments: departments.map((d) => ({ id: d.id, key: d.key, name: d.name, colour: d.colour, emoji: d.emoji, sort: d.sort })),
    queue: queueRows,
    stations: stations.map((x) => ({ id: x.id, name: x.name, type: x.station_type })),
    stationTypes: stypes.map((x) => ({ key: x.key, label: x.label, colour: x.colour })),
    templates: tpls.map((t) => ({
      id: t.id, key: t.key, label: t.label, archived: t.archived,
      stages: tstages.filter((s) => s.template_id === t.id).map((s) => ({
        id: s.id, name: s.name, stationType: s.station_type, partHours: Number(s.part_hours), sort: s.sort,
        tasks: ttasks.filter((x) => x.template_stage_id === s.id).map((x) => ({ id: x.id, name: x.name, durH: Number(x.dur_h), sort: x.sort })),
      })),
      parts: tparts.filter((x) => x.template_id === t.id).map((x) => x.name),
    })),
    builds,
    versions,
    seesCost: viewer.seesCost,
    currency,
    absences,
    calFor: cals.away,
    scoreCalFor: cals.score,
  };
}

/** Trackable parts and folders (a part with sub-parts), with the serial-numbered part fields (amends 2026-10-12). */
function splitParts(rows: Record<string, unknown>[]): Pick<Project, "parts" | "folders"> {
  const parents = new Set(rows.map((x) => x.parent_id as string | null).filter(Boolean));
  const str = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
  const all: Part[] = rows.map((x) => ({
    id: String(x.id), name: String(x.name), serial: str(x.serial), parentId: str(x.parent_id), description: str(x.description) ?? "",
    material: str(x.material), finishColour: str(x.finish_colour), finishSheen: str(x.finish_sheen),
    unitNo: x.unit_no === null || x.unit_no === undefined ? null : Number(x.unit_no), sort: Number(x.sort ?? 0),
    model: x.serial ? {
      lengthM: num(x.length_m), widthM: num(x.width_m), heightM: num(x.height_m), weightG: num(x.weight_g),
      surfaceM2: num(x.surface_m2), volumeM3: num(x.volume_m3), renderPath: str(x.render_path), at: str(x.model_at),
    } : null,
    print: x.serial ? { filamentG: num(x.print_filament_g), minutes: num(x.print_min), slices: num(x.print_slices) } : null,
    splitPlan: Array.isArray(x.split_plan) ? (x.split_plan as unknown[]).map(String) : null, splitAt: str(x.split_at),
  }));
  return { parts: all.filter((x) => !parents.has(x.id)), folders: all.filter((x) => parents.has(x.id)) };
}

export const findBuild = (w: World, id: string) => w.builds.find((b) => b.project.id === id) ?? null;

/** v2 Crew fields; a contract that ended before today makes the person inactive everywhere but the Crew page. */
function crewFields(x: Record<string, unknown>, today: string) {
  const contractTo = (x.contract_to as string | null) ?? null;
  const contractEnded = !!contractTo && contractTo < today;
  const archived = !!x.archived_at;
  return {
    active: (x.active as boolean) && !contractEnded && !archived,
    archived,
    enabled: x.active as boolean,
    employment: (x.employment as "full_time" | "project_based" | undefined) ?? "full_time",
    contractFrom: (x.contract_from as string | null) ?? null,
    contractTo,
    contractEnded,
    phone: (x.phone as string | undefined) ?? "",
    skills: (x.skills as string | undefined) ?? "",
    notes: (x.notes as string | undefined) ?? "",
    projectIds: (x.project_ids as string[] | undefined) ?? [],
  };
}
