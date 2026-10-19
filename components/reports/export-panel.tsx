"use client";
/**
 * Crew → Performance export (amends AM-26) with the Reports filter bar (Reports fix 2026-10-17): the Employees
 * tab's filters (Employees, Status). Export CSV (with its `_summary.csv`) / Export PDF use exactly what's chosen.
 */
import { FilterBar } from "./filter-bar";

const STATUSES = ["Not started", "In progress", "Waiting for QC", "Finished"];
const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

export function ExportPanel({ people, today, userId }: {
  people: { id: string; name: string; department: string }[];
  today: string;
  userId: string;
  departments: string[];
  projects: { id: string; label: string }[];
  stages: string[];
}) {
  return (
    <FilterBar mode="local" tab="crew" summaryCsv endpoint="/api/export/performance" today={today} userId={userId} value={{}} noun="tasks"
      title={<h2 className="eyebrow">Export performance</h2>}
      fields={[
        { key: "employee", label: "Employees", kind: "multi", options: people.map((p) => ({ value: p.id, label: p.name, group: p.department })) },
        { key: "status", label: "Status", kind: "select", options: opts(STATUSES), more: true },
      ]} />
  );
}
