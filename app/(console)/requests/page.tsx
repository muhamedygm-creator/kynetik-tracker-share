import { ModelDetails, PrintDetails } from "@/components/qc/model-details";
import { modelSummary } from "@/domain/model";
import { DecideRequest } from "@/components/requests/decide";
import { Card, PageHead } from "@/components/ui/primitives";
import { fmtHM } from "@/domain/format";
import { requireViewer } from "@/lib/auth";
import { linkLabels } from "@/lib/data/links";
import { loadWorld } from "@/lib/data/world";
import { renderUrls } from "@/lib/photos";
import { createClient } from "@/lib/supabase/server";

const KIND = { extension: "Time extension", qc: "QC" } as const;

/**
 * Requests (amends AM-15): time extensions and QC checks sent from the Floor Station iPad, and QC asks from
 * modellers on My models (DECISIONS 2026-10-14). Owner and Supervisors decide; every request and decision is
 * kept for the performance data.
 */
export default async function RequestsPage() {
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const supabase = await createClient();
  const [{ data: rows }, { data: profiles }] = await Promise.all([
    supabase.from("requests").select("*").order("sent_at", { ascending: false }).limit(200),
    supabase.from("profiles").select("user_id, name"),
  ]);
  const labels = linkLabels(w);
  const tz = w.settings.calendar.timezone;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: tz, day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");
  const who = (id: string | null) => (id ? profiles?.find((p) => p.user_id === id)?.name ?? "—" : "—");
  const person = (id: string | null) => (id ? w.people.find((p) => p.id === id)?.name ?? "—" : "—");
  const gated = (itemId: string | null) => !!itemId && w.builds.some((b) => b.project.gated && b.project.work.some((x) => x.id === itemId));
  const pending = (rows ?? []).filter((r) => r.status === "pending").reverse();
  // A modelling QC request shows the full model, as on the QC page (AM-22).
  const stepPart = (itemId: string | null, step: string) => {
    for (const b of w.builds) {
      const it = itemId ? b.project.work.find((x) => x.id === itemId) : undefined;
      if (!it) continue;
      if (b.project.stages.find((s) => s.id === it.stageId)?.step !== step) return null;
      const all = [...b.project.parts, ...(b.project.folders ?? [])];
      const part = all.find((x) => x.id === it.partId) ?? null;
      return part ? { part, parent: part.parentId ? all.find((x) => x.id === part.parentId) ?? null : null } : null;
    }
    return null;
  };
  const modelOf = (itemId: string | null) => stepPart(itemId, "modelling")?.part ?? null;
  const printOf = (itemId: string | null) => stepPart(itemId, "printing");
  const urls = await renderUrls(supabase, pending.map((r) => (r.kind === "qc" ? modelOf(r.work_item_id)?.model?.renderPath ?? null : null)));
  const done = (rows ?? []).filter((r) => r.status !== "pending").slice(0, 50);

  return (
    <div className="grid gap-5">
      <PageHead eyebrow="From the Floor Station and My models" title="Requests">
        <span className="text-sm text-grey">{pending.length ? `${pending.length} waiting` : "Nothing waiting"}</span>
      </PageHead>

      <Card>
        <h2 className="eyebrow border-b border-line px-4 py-3">Waiting for a decision</h2>
        {!pending.length && <p className="p-6 text-center text-sm text-grey">No requests waiting. Requests from the workshop iPad and QC asks from modellers appear here within seconds.</p>}
        <ul className="divide-y divide-line">
          {pending.map((r) => (
            <li key={r.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold text-on-accent ${r.kind === "qc" ? "bg-cool" : "bg-warn"}`}>{KIND[r.kind as "qc"]}</span>
                  <span className="font-semibold">{person(r.person_id)}</span>
                  <span className="font-mono text-xs text-grey">{when(r.sent_at)}</span>
                  <span className="text-xs text-grey">sent by {who(r.sent_by)}</span>
                </div>
                <div className="mt-1">{r.task_title}</div>
                {r.work_item_id && labels.get(r.work_item_id) && <div className="text-sm text-grey">{labels.get(r.work_item_id)}</div>}
                {(() => {
                  const part = r.kind === "qc" ? modelOf(r.work_item_id) : null;
                  const job = r.kind === "qc" && !part ? printOf(r.work_item_id) : null;
                  return part
                    ? <div className="mt-2"><ModelDetails part={part} renderUrl={part.model?.renderPath ? urls[part.model.renderPath] ?? null : null} sender={who(r.sent_by)} sentAt={when(r.sent_at)} notes={r.notes} /></div>
                    : job ? <div className="mt-2"><PrintDetails part={job.part} model={modelSummary(job.part.model?.renderPath ? job.part.model : job.parent?.model ?? job.part.model)} sender={who(r.sent_by)} sentAt={when(r.sent_at)} notes={r.notes} /></div>
                    : r.notes ? <p className="mt-1 rounded-md border border-line bg-panel2 px-3 py-2 text-sm">“{r.notes}”</p> : null;
                })()}
              </div>
              {viewer.canWrite ? <DecideRequest id={r.id} kind={r.kind} gatedQc={gated(r.work_item_id)} workItemId={r.work_item_id} dayHours={w.cal.dayHours} /> : <span className="text-sm text-grey">Owner and Supervisors decide.</span>}
            </li>
          ))}
        </ul>
      </Card>

      {done.length > 0 && (
        <Card>
          <h2 className="eyebrow border-b border-line px-4 py-3">History</h2>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="text-left">
                <tr className="[&>th]:px-4 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[0.7rem] [&>th]:font-normal [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-grey">
                  <th>Sent</th><th>Type</th><th>Employee</th><th>Task</th><th>Decision</th><th>Reply</th><th>By</th>
                </tr>
              </thead>
              <tbody>
                {done.map((r) => (
                  <tr key={r.id} className="border-t border-line [&>td]:px-4 [&>td]:py-2">
                    <td className="whitespace-nowrap font-mono text-xs">{when(r.sent_at)}</td>
                    <td>{KIND[r.kind as "qc"]}</td>
                    <td>{person(r.person_id)}</td>
                    <td className="max-w-[18rem] truncate">{r.task_title}</td>
                    <td className={r.status === "approved" ? "text-ok" : "text-bad"}>
                      {r.status === "approved" ? "Approved" : "Not approved"}{r.extra_h ? ` · +${fmtHM(Number(r.extra_h))}` : ""}
                    </td>
                    <td className="text-grey">{r.reply || "—"}</td>
                    <td>{who(r.decided_by)} <span className="font-mono text-xs text-grey">{when(r.decided_at)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
