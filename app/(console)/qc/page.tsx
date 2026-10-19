import Link from "next/link";
import { MoldCount, QcDecision } from "@/components/qc/decision";
import { ModelDetails, PrintDetails } from "@/components/qc/model-details";
import { modelSummary } from "@/domain/model";
import { Card, PageHead } from "@/components/ui/primitives";
import { fmtDT, fmtHM } from "@/domain/format";
import { componentLabel, needsMoldCount, qcQueue } from "@/domain/qc";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";
import { renderUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

/**
 * Waiting for QC (amends AM-07): every finished step on the new workflow waits here for an admin. Approve
 * moves the part on; Reject sends it back to the same technician as rework, with the reason. Pre-mold
 * approvals also ask for the mold component count (AM-06).
 */
export default async function QcPage() {
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const supabase = await createClient();
  const projects = w.builds.map((b) => b.project).filter((p) => p.gated);
  const waiting = qcQueue(projects);
  const molds = projects.flatMap((p) => needsMoldCount(p).map((m) => ({ project: p, part: p.parts.find((x) => x.id === m.partId)! })));
  const [{ data: reviews }, { data: profiles }] = await Promise.all([
    supabase.from("qc_reviews").select("work_item_id, submitted_by, submitted_at, decided_at, decided_by, result, reason, attempt, notes").order("submitted_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("user_id, name"),
  ]);
  const who = (id: string | null) => (id ? profiles?.find((p) => p.user_id === id)?.name ?? "—" : "—");
  const nameOf = (id: string | null) => (id ? w.people.find((p) => p.id === id)?.name ?? "" : "");
  const stepOf = (itemId: string) => {
    for (const p of projects) {
      const item = p.work.find((x) => x.id === itemId);
      if (item) return { p, item, stage: p.stages.find((s) => s.id === item.stageId)!, part: p.parts.find((x) => x.id === item.partId) };
    }
    return null;
  };
  const decided = (reviews ?? []).filter((r) => r.result).slice(0, 25);
  // Modelling requests show the full model (AM-22): the part may already be a folder once split.
  const partOf = (p: (typeof projects)[number], id: string) => [...p.parts, ...(p.folders ?? [])].find((x) => x.id === id);
  const urls = await renderUrls(supabase, waiting.filter((x) => x.stage.step === "modelling").map(({ project, item }) => partOf(project, item.partId)?.model?.renderPath ?? null));

  return (
    <div className="grid gap-5">
      <PageHead eyebrow="Admin QC between stages" title="QC">
        <span className="text-sm text-grey">{waiting.length ? `${waiting.length} waiting` : "Nothing waiting"}</span>
      </PageHead>

      {molds.length > 0 && (
        <Card className="grid gap-3 border-warn/60 p-4">
          <h2 className="eyebrow text-warn">Mold components needed</h2>
          <p className="text-sm text-grey">Pre-mold passed QC. Set how many components each mold needs; each becomes its own step in Mold production.</p>
          {viewer.canWrite
            ? molds.map((m) => <MoldCount key={m.part.id} partId={m.part.id} label={`${m.part.serial ?? m.part.name} ${m.part.name}`} />)
            : <ul className="text-sm">{molds.map((m) => <li key={m.part.id}>{m.part.serial} {m.part.name}</li>)}</ul>}
        </Card>
      )}

      <Card>
        <h2 className="eyebrow border-b border-line px-4 py-3">Waiting for QC</h2>
        {!waiting.length && <p className="p-6 text-center text-sm text-grey">Nothing is waiting. Finished steps on new-workflow projects appear here when they are submitted for QC.</p>}
        <ul className="divide-y divide-line">
          {waiting.map(({ project: p, item, stage }) => {
            const part = partOf(p, item.partId);
            const r = reviews?.find((x) => x.work_item_id === item.id && !x.result);
            const isModel = stage.step === "modelling" && part;
            const isPrint = stage.step === "printing" && part;
            const printed = isPrint ? (part.model?.renderPath || !part.parentId ? part : partOf(p, part.parentId)) : null;
            const waitH = w.cal.wh(item.qcSince!, w.now);
            return (
              <li key={item.id} className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-gold">{part?.serial ?? ""}</span>
                    <span className="font-semibold">{part?.name}</span>
                    {componentLabel(item) && <span className="font-mono text-xs text-gold">{componentLabel(item)}</span>}
                  </div>
                  <div className="mt-0.5 text-sm text-grey">
                    <Link href={`/builds/${p.id}`} className="hover:text-gold">{p.serial}</Link> · {stage.name} · {nameOf(item.tech) || "no technician"}
                    {(item.attempt ?? 1) > 1 && <span className="text-warn"> · attempt {item.attempt}</span>}
                  </div>
                  <div className="mt-0.5 font-mono text-xs text-grey">
                    Submitted {fmtDT(item.qcSince!)} by {who(r?.submitted_by ?? null)} · waiting <span className={waitH >= 1 ? "text-warn" : ""}>{fmtHM(waitH)}</span>
                  </div>
                  {!isModel && !isPrint && r?.notes && <p className="mt-1 text-sm">“{r.notes}”</p>}
                  {isPrint && <div className="mt-2"><PrintDetails part={part} model={modelSummary(printed?.model)} sender={who(r?.submitted_by ?? null)} sentAt={fmtDT(item.qcSince!)} notes={r?.notes ?? ""} /></div>}
                  {isModel && <div className="mt-2"><ModelDetails part={part} renderUrl={part.model?.renderPath ? urls[part.model.renderPath] ?? null : null}
                    sender={who(r?.submitted_by ?? null)} sentAt={fmtDT(item.qcSince!)} notes={r?.notes ?? ""} /></div>}
                </div>
                {viewer.canWrite && <QcDecision itemId={item.id} techName={nameOf(item.tech)} compact />}
              </li>
            );
          })}
        </ul>
      </Card>

      {decided.length > 0 && (
        <Card>
          <h2 className="eyebrow border-b border-line px-4 py-3">Recent decisions</h2>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left">
                <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[0.7rem] [&>th]:font-normal [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-grey">
                  <th>When</th><th>Step</th><th>Result</th><th>Reason</th><th>By</th>
                </tr>
              </thead>
              <tbody>
                {decided.map((r, i) => {
                  const s = stepOf(r.work_item_id);
                  return (
                    <tr key={i} className="border-t border-line [&>td]:px-4 [&>td]:py-2">
                      <td className="whitespace-nowrap font-mono text-xs">{r.decided_at ? new Date(r.decided_at).toLocaleString("en-GB", { timeZone: w.settings.calendar.timezone, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""}</td>
                      <td>{s ? <>{s.p.serial} · {s.part?.serial ?? s.part?.name} · {s.stage.name}{componentLabel(s.item) ? ` · ${componentLabel(s.item)}` : ""}</> : "—"}</td>
                      <td className={r.result === "approved" ? "text-ok" : "text-bad"}>{r.result === "approved" ? "Approved" : "Rejected"}{r.attempt > 1 ? ` (attempt ${r.attempt})` : ""}</td>
                      <td className="text-grey">{r.reason || "—"}</td>
                      <td>{who(r.decided_by)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
