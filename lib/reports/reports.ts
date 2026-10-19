import "server-only";
/**
 * Reports (AM-27, Reports fix 2026-10-17): data for the four tabs. Each loader works out the period's rows first
 * (for the filter lists: only values with data in the period), then applies the tab's own filters. Never costs
 * or salaries.
 */
import { summaries, weekly } from "@/domain/performance";
import {
  activityNames, activityRows, filterActivity, filterParts, filterProjects, partReports, projectReports,
  type AuditEntry, type ReportFilter, type ReportInput,
} from "@/domain/reports";
import { addDays, localToUtc, utcToLocal } from "@/domain/time";
import { createClient } from "@/lib/supabase/server";
import type { World } from "@/lib/data/world";
import { loadExtras, loadPerformance } from "./performance";

export const SECTIONS = ["employees", "parts", "projects", "activity"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABEL: Record<Section, string> = { employees: "Employees", parts: "Parts", projects: "Projects", activity: "Activity log" };

export type Option = { value: string; label: string; group?: string; project?: string };
const uniq = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const opts = (xs: string[]): Option[] => uniq(xs).map((x) => ({ value: x, label: x }));

export function reportInput(w: World, x: Awaited<ReturnType<typeof loadExtras>>): ReportInput {
  return {
    projects: w.builds.map((b) => b.project), people: w.people.map((p) => ({ id: p.id, name: p.name, departmentId: p.departmentId })),
    departments: w.departments, queue: x.queue, requests: x.requests, reviews: x.reviews, absences: w.absences,
    calFor: w.scoreCalFor, cal: w.cal, now: w.now,
  };
}

const projectLabel = (w: World, id: string) => {
  const p = w.builds.find((b) => b.project.id === id)?.project;
  return p ? `${p.serial}${p.name ? ` ${p.name}` : ""}` : "";
};

export async function loadEmployees(w: World, f: ReportFilter) {
  const ids = w.people.filter((p) => (p.costClass === "production" && !p.archived) || f.employees?.includes(p.id)).map((p) => p.id);
  const data = await loadPerformance(w, ids, f.from, f.to, !!f.notStarted);
  const deptOf = new Map(data.people.map((p) => [p.id, p.department]));
  const projectIds = new Map(w.builds.map((b) => [`${b.project.serial}${b.project.name ? ` ${b.project.name}` : ""}`, b.project.id]));
  const rows = data.rows.filter((r) => (!f.employees?.length || f.employees.includes(r.personId))
    && (!f.department || deptOf.get(r.personId) === f.department)
    && (!f.projects?.length || f.projects.includes(projectIds.get(r.project) ?? ""))
    && (!f.stage || r.stage === f.stage) && (!f.status || r.status === f.status));
  const withRows = new Set(rows.map((r) => r.personId));
  const people = data.people.filter((p) => withRows.has(p.id));
  const all = new Set(data.rows.map((r) => r.personId));
  return {
    ...data, rows, people,
    summary: summaries(rows, people, w.absences, w.cal, f.from, f.to),
    weeks: weekly(rows, f.from, f.to),
    options: {
      employee: data.people.filter((p) => all.has(p.id)).map((p) => ({ value: p.id, label: p.name, group: p.department })),
      department: opts(data.people.filter((p) => all.has(p.id)).map((p) => p.department)),
      project: uniq(data.rows.map((r) => r.project)).map((l) => ({ value: projectIds.get(l) ?? l, label: l })),
      stage: opts(data.rows.map((r) => r.stage)),
      status: opts(data.rows.map((r) => r.status)),
    } as Record<string, Option[]>,
  };
}

export async function loadParts(w: World, f: ReportFilter) {
  const all = partReports(reportInput(w, await loadExtras(w)), f);
  const inProject = f.projects?.length ? all.filter((r) => f.projects!.includes(r.projectId)) : all;
  return {
    rows: filterParts(all, f),
    options: {
      project: uniq(all.map((r) => r.projectId)).map((id) => ({ value: id, label: projectLabel(w, id) })),
      // Smart list: a chosen project narrows the parts offered.
      part: inProject.map((r) => ({ value: r.serial || r.part, label: [r.serial, r.part].filter(Boolean).join(" "), project: r.projectId })),
      stage: uniq(inProject.flatMap((r) => r.steps.filter((s) => s.active || !s.started).map((s) => s.stage))).map((x) => ({ value: x, label: x })),
      status: opts(all.map((r) => r.status)),
      material: opts(all.map((r) => r.material)),
      finish: opts(all.map((r) => r.finishSheen)),
    } as Record<string, Option[]>,
  };
}

export async function loadProjects(w: World, f: ReportFilter) {
  const info = (id: string) => {
    const b = w.builds.find((x) => x.project.id === id);
    return { forecast: b?.forecast.finish?.slice(0, 10) ?? null, health: b?.health ?? ("unset" as const) };
  };
  const all = projectReports(reportInput(w, await loadExtras(w)), f, info);
  return {
    rows: filterProjects(all, f),
    options: {
      project: all.map((r) => ({ value: r.projectId, label: r.project })),
      status: opts(all.map((r) => r.health)),
      department: opts(all.flatMap((r) => r.byDept.map((d) => d.department))),
    } as Record<string, Option[]>,
  };
}

export async function loadActivity(w: World, f: ReportFilter) {
  const supabase = await createClient();
  const tz = w.settings.calendar.timezone;
  const [{ data }, { data: profiles }] = await Promise.all([
    supabase.from("audit_log").select("*")
      .gte("at", localToUtc(`${f.from}T00:00`, tz)).lt("at", localToUtc(`${addDays(f.to, 1)}T00:00`, tz))
      .eq("sensitive", false).order("at", { ascending: false }).limit(20000),
    supabase.from("profiles").select("user_id, name, email"),
  ]);
  const who = new Map((profiles ?? []).map((p) => [p.user_id as string, (p.name as string) || (p.email as string)]));
  const roleWord: Record<string, string> = { owner: "The Owner", supervisor: "A Supervisor", viewer: "A viewer", modeller: "A modeller", floor_station: "The floor station" };
  const entries: AuditEntry[] = (data ?? []).map((r) => ({
    at: utcToLocal(r.at as string, tz), actor: (r.actor_id && who.get(r.actor_id as string)) || (r.actor_role ? roleWord[r.actor_role as string] ?? "A user" : "The system"),
    role: (r.actor_role as string) ?? "", action: r.action as string, entity: r.entity as string, entityId: (r.entity_id as string) ?? null,
    projectId: (r.project_id as string) ?? null, label: (r.label as string) ?? "", before: r.before, after: r.after, sensitive: !!r.sensitive,
  }));
  const all = activityRows(entries, f, activityNames(w.builds.map((b) => b.project), w.people));
  return {
    rows: filterActivity(all, f),
    options: {
      who: opts(all.map((r) => r.who)),
      action: opts(all.map((r) => r.type)),
      project: uniq(all.map((r) => r.projectId ?? "")).map((id) => ({ value: id, label: projectLabel(w, id) })).filter((o) => o.label),
    } as Record<string, Option[]>,
  };
}
