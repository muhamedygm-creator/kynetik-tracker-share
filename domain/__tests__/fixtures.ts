/** The v1 §17 snapshot (supabase/seed/data.ts) as domain objects. Ids are readable: "001/Prototyping". */
import { crew, projects as seedProjects, templates, workstations } from "../../supabase/seed/data";
import { DEFAULT_SETTINGS } from "../settings";
import { makeCalendar } from "../calendar";
import type { Person, Project, Station, Task, WorkItem } from "../types";

/** v1's calendar (08:00–17:00, break 12:00). The engine must reproduce every v1 plan on it. */
export const V1_CALENDAR = { ...DEFAULT_SETTINGS.calendar, shiftStart: "08:00", shiftEnd: "17:00", breakStart: "12:00", breakMins: 60, restDays: [0] };
export const settings = { ...DEFAULT_SETTINGS, calendar: V1_CALENDAR };
export const cal = makeCalendar(settings);
/** Snapshot moment: 1 Oct 2026, 09:00 shop time. */
export const NOW = "2026-10-01T09:00";

export const people: Person[] = crew.map((c) => ({ id: c.id, name: c.name, crew: "", costClass: "production", active: true }));
export const stations: Station[] = workstations.map((w) => ({ id: w.id, name: w.name, type: w.type }));
const personByName = (n: string) => people.find((p) => p.name === n)!.id;

export function buildProjects(): Project[] {
  return seedProjects.map((sp) => {
    const t = templates.find((x) => x.key === sp.template)!;
    const stages = t.stages.map((s, i) => ({ id: `${sp.id}/${s.name}`, name: s.name, stationType: s.stationType, stationId: sp.stations[i], partHours: s.partHours }));
    const parts = (sp.hasParts ? t.parts : []).map((n) => ({ id: `${sp.id}/${n}`, name: n }));
    let num = 0;
    const tasks: Task[] = t.stages.flatMap((s) => s.tasks.map((task) => {
      const plan = sp.tasks[num];
      num++;
      return {
        id: `${sp.id}#${num}`, num, stageId: `${sp.id}/${s.name}`, name: task.name, assignee: null,
        status: plan.status ?? "todo", durH: task.durH, pct: plan.pct ?? (plan.status === "done" ? 100 : 0),
        start: plan.start, end: plan.end, pinnedStart: null,
        actualStart: plan.actualStart ?? null, actualEnd: plan.actualEnd ?? null, notes: "",
      };
    }));
    const work: WorkItem[] = stages.flatMap((st) => parts.map((part) => {
      const w = sp.work.find((x) => `${sp.id}/${x.stage}` === st.id && x.part === part.name);
      return {
        id: `${st.id}/${part.name}`, stageId: st.id, partId: part.id, status: w?.status ?? "todo",
        tech: w ? personByName(w.tech) : null, start: w?.start ?? null, end: w?.end ?? null, segStart: w?.start ?? null,
        prevSegs: [], planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {},
      };
    }));
    return {
      id: sp.id, serial: sp.serial, name: sp.name, status: sp.status, startDate: sp.startDate, deliveryDate: sp.deliveryDate,
      deliveredOn: null, stages, parts, tasks,
      baseline: Object.fromEntries(tasks.map((x) => [x.id, { start: x.start!, end: x.end! }])),
      work,
    };
  });
}

export const byId = (ps: Project[], id: string) => ps.find((p) => p.id === id)!;
