import { rangeFor, rangeLabel, type RangePreset } from "@/domain/performance";
import type { ReportFilter } from "@/domain/reports";
import type { World } from "@/lib/data/world";

/**
 * URL parameters of the Reports filter bar (Reports fix 2026-10-17). `employee`, `project` and `who` are comma
 * lists; `ns=1` is "Include not started"; `page` pages the Activity log.
 */
export type ReportParams = {
  section?: string; range?: string; month?: string; from?: string; to?: string; ns?: string;
  employee?: string; department?: string; project?: string; part?: string; stage?: string; status?: string;
  material?: string; finish?: string; who?: string; action?: string; item?: string; page?: string;
};

const list = (x?: string) => {
  const xs = (x ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  return xs.length ? xs : undefined;
};

/** The Reports filters from the page's search params or the export URL. Null when the range is invalid. */
export function readFilter(p: ReportParams, today: string): ReportFilter | null {
  const preset = (["today", "yesterday", "week", "lastWeek", "month", "lastMonth", "last3Months", "year", "pickMonth", "custom"].includes(p.range ?? "") ? p.range : "month") as RangePreset;
  const r = rangeFor(preset, today, { month: p.month, from: p.from, to: p.to });
  if (!r) return null;
  const v = (x?: string) => (x && x.trim() ? x.trim() : undefined);
  return {
    ...r, notStarted: p.ns === "1", employees: list(p.employee), department: v(p.department), projects: list(p.project), part: v(p.part),
    stage: v(p.stage), status: v(p.status), material: v(p.material), finish: v(p.finish), who: list(p.who), action: v(p.action), item: v(p.item),
  };
}

/** The active filters in words, in the order they appear on screen ("001 lambo_buggy · Prototyping"). */
export function filterLabels(f: ReportFilter, w: World): string[] {
  const names = (f.employees ?? []).map((id) => w.people.find((p) => p.id === id)?.name ?? "").filter(Boolean);
  const projects = (f.projects ?? []).map((id) => w.builds.find((b) => b.project.id === id)?.project).filter(Boolean)
    .map((p) => `${p!.serial}${p!.name ? ` ${p!.name}` : ""}`);
  return [
    ...(names.length > 3 ? [`${names.length} employees`] : names),
    ...(projects.length > 3 ? [`${projects.length} projects`] : projects),
    f.who && (f.who.length > 3 ? `${f.who.length} people` : f.who.join(", ")),
    f.department, f.part && `Part "${f.part}"`, f.stage, f.status, f.material, f.finish, f.action, f.item && `"${f.item}"`,
    f.notStarted && "Including not started",
  ].filter(Boolean) as string[];
}

/** "1–17 Oct 2026 · 001 lambo_buggy · Prototyping" for the PDF header. */
export const describeFilter = (f: ReportFilter, w: World) => [rangeLabel(f.from, f.to), ...filterLabels(f, w)].join(" · ");

/** Export file name: tab, filters and range, e.g. "Parts_001-lambo_buggy_2026-10-01_to_2026-10-17". */
export function exportName(tab: string, f: ReportFilter, w: World): string {
  const slug = (s: string) => s.replace(/["“”]/g, "").replace(/[^\p{L}\p{N}_&-]+/gu, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const parts = filterLabels(f, w).filter((x) => x !== "Including not started").map(slug).filter(Boolean);
  return [slug(tab), ...parts, `${f.from}_to_${f.to}`].join("_").slice(0, 150);
}
