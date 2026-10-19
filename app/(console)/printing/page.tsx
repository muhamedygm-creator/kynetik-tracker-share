import { PrintCard, type PrintJob } from "@/components/printing/print-card";
import { PageHead } from "@/components/ui/primitives";
import { modelSummary } from "@/domain/model";
import { PRINT_FIELDS } from "@/domain/print";
import { startBlocker } from "@/domain/qc";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { renderUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

/**
 * 3D Printing (amends AM-24): every 3D printing step whose model has passed QC is a print job (one per
 * sub-part when the part was split). A Modelling & 3D Printing user sees the jobs nobody has taken and their
 * own; Owner and Supervisors see them all.
 */
export default async function PrintingPage() {
  const viewer = await requireViewer(["owner", "supervisor", "modeller"]);
  const w = await loadWorld(viewer);
  const mine = viewer.role === "modeller";
  const nameOf = (id: string | null) => (id ? w.people.find((p) => p.id === id)?.name ?? "" : "");
  const jobs = w.builds.filter((b) => b.project.gated && b.project.status !== "done").flatMap((b) => {
    const p = b.project;
    const st = p.stages.find((s) => s.step === "printing");
    if (!st) return [];
    return p.work.filter((x) => x.stageId === st.id && (!mine || x.tech === null || x.tech === viewer.personId)).map((x) => ({ p, x }));
  });
  const all = (p: (typeof jobs)[number]["p"]) => [...p.parts, ...(p.folders ?? [])];
  // The model a job prints: the part's own, or the part it was split from.
  const modelOf = (p: (typeof jobs)[number]["p"], partId: string) => {
    const part = all(p).find((y) => y.id === partId);
    return part?.model?.renderPath || !part?.parentId ? part : all(p).find((y) => y.id === part.parentId) ?? part;
  };
  const urls = await renderUrls(await createClient(), jobs.map(({ p, x }) => modelOf(p, x.partId)?.model?.renderPath ?? null));

  const toView = ({ p, x }: (typeof jobs)[number]): PrintJob => {
    const part = all(p).find((y) => y.id === x.partId)!;
    const m = modelOf(p, x.partId)?.model;
    const pr = part.print;
    const val = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));
    return {
      itemId: x.id, serial: part.serial ?? "", partName: part.name, projectSerial: p.serial, techName: nameOf(x.tech),
      status: x.status, qcSince: x.qcSince ?? null, blocker: x.status === "todo" ? startBlocker(p, x) : null,
      lastReject: x.reworkLog.at(-1)?.why.replace(/^QC: /, "") ?? null, attempt: x.attempt ?? 1,
      values: Object.fromEntries(PRINT_FIELDS.map((f) => [f.key, val(pr?.[f.key])])) as PrintJob["values"],
      model: modelSummary(m), renderUrl: m?.renderPath ? urls[m.renderPath] ?? null : null,
    };
  };
  const ready = jobs.filter(({ p, x }) => x.status !== "done" && !(x.status === "todo" && startBlocker(p, x))).map(toView);
  const waiting = jobs.filter(({ p, x }) => x.status === "todo" && startBlocker(p, x)).length;
  const done = jobs.filter(({ x }) => x.status === "done").map(toView);
  const canAct = viewer.canWrite || viewer.role === "modeller";

  return (
    <div className="grid gap-5 pb-24">
      <PageHead eyebrow={mine ? "Print jobs for you and nobody yet" : "Every print job"} title="3D Printing">
        <span className="text-sm text-grey">{ready.length} open{waiting ? ` · ${waiting} waiting for their model` : ""}</span>
      </PageHead>
      {mine && !viewer.personId && (
        <p className="rounded-lg border border-warn/60 bg-panel p-4 text-sm">This login isn&apos;t linked to a crew member yet, so it can&apos;t take print jobs. Ask the Owner to link it under Users.</p>
      )}
      {!ready.length && <p className="rounded-xl border border-dashed border-line2 p-6 text-center text-sm text-grey">No print jobs ready. A part appears here when its model passes QC (one job per sub-part).</p>}
      <div className="grid gap-4">{ready.map((j) => <PrintCard key={`${j.itemId}:${j.status}:${j.qcSince}:${JSON.stringify(j.values)}`} j={j} canAct={canAct} admin={viewer.canWrite} />)}</div>
      {done.length > 0 && (
        <details className="rounded-xl border border-line bg-panel p-4">
          <summary className="cursor-pointer text-sm text-grey">Approved ({done.length})</summary>
          <div className="mt-4 grid gap-4">{done.map((j) => <PrintCard key={`${j.itemId}:${JSON.stringify(j.values)}`} j={j} canAct={viewer.canWrite} admin={viewer.canWrite} />)}</div>
        </details>
      )}
    </div>
  );
}
