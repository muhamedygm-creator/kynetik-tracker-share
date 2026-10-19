/**
 * Reports export (AM-27, Reports fix 2026-10-17): any tab as CSV (full detail) or PDF (summary page with charts,
 * then the tables), with exactly the filters on screen; Employees also has `format=summary` (per-employee totals in
 * hours). Owner and Supervisors; no costs.
 */
import { performanceCsv, performanceSummaryCsv } from "@/domain/performance";
import { ACTIVITY_CSV, PART_CSV, PROJECT_CSV, projectCsvRows, toCsv } from "@/domain/reports";
import { getSession } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { describeFilter, exportName, readFilter, type ReportParams } from "@/lib/reports/filters";
import { ActivityDoc, PartsDoc, PerformanceDoc, ProjectsDoc, toPdf } from "@/lib/reports/pdf";
import { SECTIONS, SECTION_LABEL, loadActivity, loadEmployees, loadParts, loadProjects, type Section } from "@/lib/reports/reports";
import { download, safeExport } from "@/lib/reports/send";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const s = await getSession();
  if (s.status !== "ok") return new Response("Sign in first.", { status: 401 });
  if (s.viewer.role !== "owner" && s.viewer.role !== "supervisor") return new Response("Owner and Supervisors only.", { status: 403 });
  const p = Object.fromEntries(new URL(req.url).searchParams) as ReportParams & { format?: string };
  const section = (SECTIONS as readonly string[]).includes(p.section ?? "") ? (p.section as Section) : "employees";
  const pdf = p.format === "pdf";
  return safeExport(`${SECTION_LABEL[section]} ${pdf ? "PDF" : "CSV"}`, async () => {
    const w = await loadWorld(s.viewer);
    const f = readFilter(p, w.today);
    if (!f) return new Response("Pick a valid date range.", { status: 400 });
    const stamp = { title: `Reports · ${SECTION_LABEL[section]}`, from: f.from, to: f.to, generatedAt: w.now, by: s.viewer.name || s.viewer.email, filters: describeFilter(f, w) };
    const name = exportName(SECTION_LABEL[section].replace(/ /g, "_"), f, w);
    const csv = (text: string) => download(text, name, "csv");
    const doc = async (el: Parameters<typeof toPdf>[0]) => download(new Uint8Array(await toPdf(el)), name, "pdf");

    if (section === "employees") {
      const d = await loadEmployees(w, f);
      if (p.format === "summary") return download(performanceSummaryCsv(d.summary, d.rows), `${name}_summary`, "csv");
      return pdf ? doc(PerformanceDoc({ stamp, people: d.people, summary: d.summary, weeks: d.weeks, rows: d.rows })) : csv(performanceCsv(d.rows));
    }
    if (section === "parts") {
      const { rows } = await loadParts(w, f);
      return pdf ? doc(PartsDoc({ stamp, rows })) : csv(toCsv(PART_CSV, rows.flatMap((r) => r.steps)));
    }
    if (section === "projects") {
      const { rows } = await loadProjects(w, f);
      return pdf ? doc(ProjectsDoc({ stamp, rows })) : csv(toCsv(PROJECT_CSV, projectCsvRows(rows)));
    }
    const { rows } = await loadActivity(w, f);
    return pdf ? doc(ActivityDoc({ stamp, rows })) : csv(toCsv(ACTIVITY_CSV, rows));
  });
}
