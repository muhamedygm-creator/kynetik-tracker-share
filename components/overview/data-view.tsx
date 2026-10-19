import Link from "next/link";
import { Card, PageHead } from "@/components/ui/primitives";
import { btn } from "@/components/ui/buttons";
import { stepRows, summarise, type StepRow, type Summary } from "@/domain/data";
import { fmtDT, fmtHM } from "@/domain/format";
import { filteredRows, type DataFilter } from "@/lib/data/steps";
import type { World } from "@/lib/data/world";

const SHOW = 60;
/**
 * Overview → Data (amends AM-13): allocated vs actual time, first attempt vs rework, QC send-backs and model
 * data, per step and summed per stage, technician, material and project. Viewable here, exportable as CSV.
 */
export function DataView({ w, f, tabs }: { w: World; f: DataFilter; tabs: React.ReactNode }) {
  const all = stepRows(w.builds.map((b) => b.project), w.people, w.cal, w.now);
  const rows = filteredRows(w, f);
  const opts = (k: keyof StepRow) => [...new Set(all.map((r) => String(r[k] ?? "")).filter(Boolean))].sort();
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const select = (name: keyof DataFilter, label: string, values: { value: string; label: string }[]) => (
    <label className="grid gap-1">
      <span className="label">{label}</span>
      <select name={name} defaultValue={f[name] ?? ""} className="min-h-10 rounded-md border border-line2 bg-panel2 px-3 text-sm text-ink">
        <option value="">All</option>
        {values.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
      </select>
    </label>
  );
  const projects = w.builds.filter((b) => all.some((r) => r.projectId === b.project.id)).map((b) => ({ value: b.project.id, label: `${b.project.serial} ${b.project.name}` }));

  return (
    <div className="grid gap-5">
      <PageHead eyebrow="Planning data · allocated vs actual, rework, QC, model data" title="Overview">
        <a href={`/api/export/steps${qs ? `?${qs}` : ""}`} className={btn.primary}>Export CSV</a>
      </PageHead>
      {tabs}
      <form className="flex flex-wrap items-end gap-3" action="/board">
        <input type="hidden" name="tab" value="data" />
        {select("project", "Project", projects)}
        {select("stage", "Stage", opts("stage").map((v) => ({ value: v, label: v })))}
        {select("tech", "Technician", opts("technician").map((v) => ({ value: v, label: v })))}
        {select("material", "Material", opts("material").map((v) => ({ value: v, label: v })))}
        <button className={btn.ghost}>Show</button>
        {qs && <Link href="/board?tab=data" className={`${btn.link} text-sm`}>Clear</Link>}
      </form>

      {!rows.length ? (
        <Card className="p-8 text-center text-sm text-grey">No started part steps match. The data fills in as work is started, finished and checked in QC.</Card>
      ) : (
        <>
          <div className="grid gap-5 xl:grid-cols-2">
            <SummaryTable title="By stage" rows={summarise(rows, (r) => r.stage)} />
            <SummaryTable title="By technician" rows={summarise(rows, (r) => r.technician)} />
            <SummaryTable title="By material" rows={summarise(rows, (r) => r.material)} />
            <SummaryTable title="By project" rows={summarise(rows, (r) => r.project)} />
          </div>
          <Card>
            <h2 className="eyebrow border-b border-line px-4 py-3">Steps ({rows.length}{rows.length > SHOW ? `, newest ${SHOW} shown; the export has all` : ""})</h2>
            <div className="relative overflow-x-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead className="text-left">
                  <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[0.7rem] [&>th]:font-normal [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-grey">
                    <th>Part</th><th>Stage</th><th>Technician</th><th>Status</th><th className="text-right">Allocated</th><th className="text-right">Actual</th>
                    <th className="text-right">Rework</th><th className="text-right">Sent back</th><th>Finished</th><th>Model</th>
                  </tr>
                </thead>
                <tbody>
                  {[...rows].sort((a, b) => (b.started ?? "").localeCompare(a.started ?? "")).slice(0, SHOW).map((r, i) => (
                    <tr key={i} className="border-t border-line [&>td]:px-3 [&>td]:py-2">
                      <td><span className="font-mono text-gold">{r.serial || r.project}</span> {r.part}{r.material && <span className="block text-xs text-grey">{r.material}</span>}</td>
                      <td>{r.stage}{r.component && <span className="block font-mono text-xs text-grey">{r.component}</span>}</td>
                      <td>{r.technician || "—"}</td>
                      <td className="text-grey">{r.status}</td>
                      <td className="text-right font-mono">{r.allocatedH === null ? "—" : fmtHM(r.allocatedH)}</td>
                      <td className={`text-right font-mono ${r.allocatedH !== null && r.actualH > r.allocatedH ? "text-bad" : ""}`}>{fmtHM(r.actualH)}</td>
                      <td className="text-right font-mono">{r.reworkH ? fmtHM(r.reworkH) : "—"}</td>
                      <td className="text-right font-mono">{r.rejections || "—"}</td>
                      <td className="whitespace-nowrap font-mono text-xs">{r.finished ? fmtDT(r.finished) : "—"}</td>
                      <td className="font-mono text-xs text-grey">{r.lengthM ? `${r.lengthM}×${r.widthM}×${r.heightM} m · ${r.weightG} g` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function SummaryTable({ title, rows }: { title: string; rows: Summary[] }) {
  return (
    <Card>
      <h2 className="eyebrow border-b border-line px-4 py-3">{title}</h2>
      <div className="relative overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-left">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[0.7rem] [&>th]:font-normal [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-grey">
              <th /><th className="text-right">Steps</th><th className="text-right">Finished</th><th className="text-right">Avg actual</th>
              <th className="text-right">vs allocated</th><th className="text-right">Rework</th><th className="text-right">Sent back</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-line [&>td]:px-3 [&>td]:py-2">
                <td className="max-w-[16rem] truncate">{r.key}</td>
                <td className="text-right font-mono">{r.steps}</td>
                <td className="text-right font-mono">{r.finished}</td>
                <td className="text-right font-mono">{r.avgActualH === null ? "—" : fmtHM(r.avgActualH)}</td>
                <td className={`text-right font-mono ${r.varianceH !== null && r.varianceH > 0 ? "text-bad" : r.varianceH !== null ? "text-ok" : ""}`}>
                  {r.varianceH === null ? "—" : `${r.varianceH > 0 ? "+" : "−"}${fmtHM(Math.abs(r.varianceH))}`}
                </td>
                <td className="text-right font-mono">{r.reworkH ? fmtHM(r.reworkH) : "—"}</td>
                <td className="text-right font-mono">{r.rejections || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
