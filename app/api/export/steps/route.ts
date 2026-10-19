import { filteredRows } from "@/lib/data/steps";
import { stepsCsv } from "@/domain/data";
import { getSession } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";

/** CSV of the Overview → Data rows (amends AM-13), same filters. Members only; never costs. */
export async function GET(req: Request) {
  const s = await getSession();
  if (s.status !== "ok") return new Response("Sign in first.", { status: 401 });
  if (s.viewer.role === "floor_station") return new Response("Not available on the Floor Station.", { status: 403 });
  const w = await loadWorld(s.viewer);
  const q = new URL(req.url).searchParams;
  const rows = filteredRows(w, { project: q.get("project") ?? undefined, stage: q.get("stage") ?? undefined, tech: q.get("tech") ?? undefined, material: q.get("material") ?? undefined });
  return new Response(stepsCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kynetik-steps-${w.today}.csv"`,
      "cache-control": "no-store",
    },
  });
}
