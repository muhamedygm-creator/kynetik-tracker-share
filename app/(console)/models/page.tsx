import { ModelCard, type ModelStep } from "@/components/models/model-card";
import { PageHead } from "@/components/ui/primitives";
import { MODEL_FIELDS } from "@/domain/model";
import { startBlocker } from "@/domain/qc";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { renderUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

/**
 * My models (amends AM-05): Modelling steps with their model data. A Modeller sees their own steps; Owner and
 * Supervisors see every open one (and can fill it in for someone).
 */
export default async function ModelsPage() {
  const viewer = await requireViewer(["owner", "supervisor", "modeller"]);
  const w = await loadWorld(viewer);
  const mine = viewer.role === "modeller";
  const nameOf = (id: string | null) => (id ? w.people.find((p) => p.id === id)?.name ?? "" : "");
  const steps = w.builds.filter((b) => b.project.gated && b.project.status !== "done").flatMap((b) => {
    const p = b.project;
    const st = p.stages.find((s) => s.step === "modelling");
    if (!st) return [];
    return p.work.filter((x) => x.stageId === st.id && (mine ? x.tech !== null && x.tech === viewer.personId : true)).map((x) => ({ p, x }));
  });
  const urls = await renderUrls(await createClient(), steps.map(({ p, x }) => [...p.parts, ...(p.folders ?? [])].find((y) => y.id === x.partId)?.model?.renderPath ?? null));

  const toView = ({ p, x }: (typeof steps)[number]): ModelStep => {
    const part = [...p.parts, ...(p.folders ?? [])].find((y) => y.id === x.partId)!;
    const m = part.model;
    return {
      itemId: x.id, serial: part.serial ?? "", partName: part.name, projectSerial: p.serial, projectId: p.id, techName: nameOf(x.tech),
      status: x.status, qcSince: x.qcSince ?? null, blocker: x.status === "todo" ? startBlocker(p, x) : null,
      lastReject: x.reworkLog.at(-1)?.why.replace(/^QC: /, "") ?? null, attempt: x.attempt ?? 1,
      values: Object.fromEntries(MODEL_FIELDS.map((f) => [f.key, m?.[f.key] === null || m?.[f.key] === undefined ? "" : String(m[f.key])])) as ModelStep["values"],
      renderUrl: m?.renderPath ? urls[m.renderPath] ?? null : null, hasRender: !!m?.renderPath,
      splitPlan: part.splitPlan ?? null, splitAt: part.splitAt ?? null, canSplit: !part.parentId,
      subParts: (p.parts.filter((y) => y.parentId === part.id)).map((y) => ({ serial: y.serial ?? "", name: y.name })),
    };
  };
  const open = steps.filter(({ x }) => x.status !== "done").map(toView);
  const done = steps.filter(({ x }) => x.status === "done").map(toView);
  const canAct = viewer.canWrite || viewer.role === "modeller";

  return (
    <div className="grid gap-5 pb-24">
      <PageHead eyebrow={mine ? "Your Modelling steps" : "Every open Modelling step"} title="My models">
        <span className="text-sm text-grey">{open.length} open</span>
      </PageHead>
      {mine && !viewer.personId && (
        <p className="rounded-lg border border-warn/60 bg-panel p-4 text-sm">This login isn&apos;t linked to a crew member yet, so no steps show here. Ask the Owner to link it under Users.</p>
      )}
      {!open.length && <p className="rounded-xl border border-dashed border-line2 p-6 text-center text-sm text-grey">No open Modelling steps{mine ? " assigned to you" : ""}.</p>}
      <div className="grid gap-4">{open.map((s) => <ModelCard key={`${s.itemId}:${s.qcSince}:${JSON.stringify(s.values)}`} s={s} canAct={canAct} admin={viewer.canWrite} />)}</div>
      {done.length > 0 && (
        <details className="rounded-xl border border-line bg-panel p-4">
          <summary className="cursor-pointer text-sm text-grey">Approved ({done.length})</summary>
          <div className="mt-4 grid gap-4">{done.map((s) => <ModelCard key={`${s.itemId}:${JSON.stringify(s.values)}:${s.hasRender}`} s={s} canAct={viewer.canWrite} admin={viewer.canWrite} />)}</div>
        </details>
      )}
    </div>
  );
}
