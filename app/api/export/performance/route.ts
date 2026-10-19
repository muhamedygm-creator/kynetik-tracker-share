/**
 * Crew performance export (amends AM-26): CSV (full task log) or PDF (report). The filters are the Reports
 * Employees filters (Reports fix 2026-10-17); `format=count` returns how many tasks they match, for the count
 * beside the buttons. Owner and Supervisors; never costs or salaries.
 */
import { performanceCsv, performanceSummaryCsv } from "@/domain/performance";
import { getSession } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { describeFilter, exportName, readFilter, type ReportParams } from "@/lib/reports/filters";
import { PerformanceDoc, toPdf } from "@/lib/reports/pdf";
import { loadEmployees } from "@/lib/reports/reports";
import { download, safeExport } from "@/lib/reports/send";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const s = await getSession();
  if (s.status !== "ok") return new Response("Sign in first.", { status: 401 });
  if (s.viewer.role !== "owner" && s.viewer.role !== "supervisor") return new Response("Owner and Supervisors only.", { status: 403 });
  const p = Object.fromEntries(new URL(req.url).searchParams) as ReportParams & { format?: string; people?: string };
  // Older links named the employees `people` ("all" or a comma list).
  if (!p.employee && p.people && p.people !== "all") p.employee = p.people;
  return safeExport(`crew performance ${p.format === "pdf" ? "PDF" : "export"}`, async () => {
    const w = await loadWorld(s.viewer);
    const f = readFilter(p, w.today);
    if (!f) return new Response("Pick a valid date range.", { status: 400 });
    const data = await loadEmployees(w, f);
    if (p.format === "count") return Response.json({ tasks: data.rows.length, employees: data.people.length });
    const name = exportName("Crew_Performance", f, w);
    if (p.format === "summary") return download(performanceSummaryCsv(data.summary, data.rows), `${name}_summary`, "csv");
    if (p.format === "pdf") {
      const pdf = await toPdf(PerformanceDoc({
        stamp: { title: "Crew performance", from: f.from, to: f.to, generatedAt: w.now, by: s.viewer.name || s.viewer.email, filters: describeFilter(f, w) },
        people: data.people, summary: data.summary, weeks: data.weeks, rows: data.rows,
      }));
      return download(new Uint8Array(pdf), name, "pdf");
    }
    return download(performanceCsv(data.rows), name, "csv");
  });
}
