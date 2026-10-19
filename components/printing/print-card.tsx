"use client";
/** One print job on 3D Printing (amends AM-24): filament, printing time, slice components, then Submit for QC (saves and sends in one tap). */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { savePrint, submitPrint } from "@/app/(console)/printing/actions";
import { btn } from "@/components/ui/dialog";
import { input } from "@/components/ui/form";
import { PRINT_FIELDS, parsePrint, printProblems, type PrintKey } from "@/domain/print";

export interface PrintJob {
  itemId: string;
  serial: string;
  partName: string;
  projectSerial: string;
  techName: string;
  status: "todo" | "doing" | "blocked" | "done";
  qcSince: string | null;
  blocker: string | null;
  lastReject: string | null;
  attempt: number;
  values: Record<PrintKey, string>;
  /** The model this job prints: its measurements and render (of the part, or of the part it was split from). */
  model: string | null;
  renderUrl: string | null;
}

export function PrintCard({ j, canAct, admin = false }: { j: PrintJob; canAct: boolean; admin?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(j.values);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [asking, setAsking] = useState(false);
  const [notes, setNotes] = useState("");
  const [pending, start] = useTransition();
  const problems = printProblems(v);
  const complete = PRINT_FIELDS.every((f) => typeof parsePrint(v[f.key], f.whole) === "number");
  const dirty = PRINT_FIELDS.some((f) => v[f.key] !== j.values[f.key]);
  const editable = canAct && j.status !== "done" && !j.qcSince && !j.blocker;
  // Owner and Supervisors can still correct a job waiting for QC or approved (DECISIONS 2026-10-15).
  const fixing = canAct && admin && !j.blocker && (j.status === "done" || !!j.qcSince);
  const typing = editable || fixing;
  const act = (fn: () => Promise<{ ok?: string; error?: string }>) => start(async () => { const r = await fn(); setMsg(r); if (!r.error) router.refresh(); });

  return (
    <article className="grid gap-4 rounded-xl border border-line bg-panel p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-gold">{j.serial}</span><span className="font-semibold">{j.partName}</span></div>
          <div className="text-sm text-grey">{j.projectSerial} · 3D printing · {j.techName || "unassigned, saving takes the job"}{j.attempt > 1 ? ` · attempt ${j.attempt}` : ""}</div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${j.qcSince ? "bg-warn text-on-accent" : j.status === "done" ? "bg-ok text-on-accent" : j.status === "doing" ? "bg-gold text-on-accent" : "border border-line2 text-grey"}`}>
          {j.qcSince ? "Waiting for QC" : j.status === "done" ? "Approved" : j.status === "doing" ? "In progress" : j.status === "blocked" ? "Blocked" : "Ready to print"}
        </span>
      </header>
      {j.lastReject && j.status === "doing" && !j.qcSince && <p className="rounded-md border border-bad/50 px-3 py-2 text-sm text-bad">Sent back by QC: {j.lastReject}</p>}
      {j.blocker && <p className="text-sm text-grey">{j.blocker}</p>}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid content-start gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {PRINT_FIELDS.map((f) => (
              <label key={f.key} className="grid gap-1">
                <span className="label">{f.label}{f.unit ? ` (${f.unit})` : ""}</span>
                <input value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} inputMode={f.whole ? "numeric" : "decimal"} disabled={!typing}
                  className={`${input} font-mono ${problems[f.key] ? "border-bad" : ""}`} aria-invalid={!!problems[f.key]} />
                {problems[f.key] && <span className="text-xs text-bad">{problems[f.key]}</span>}
              </label>
            ))}
          </div>
          <p className="text-xs text-grey">Slice components are recorded only; QC checks them combined as one printed part.</p>
        </div>
        <div className="grid content-start gap-1">
          <span className="label">Model</span>
          {j.renderUrl
            // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, short-lived
            ? <a href={j.renderUrl} target="_blank" rel="noreferrer"><img src={j.renderUrl} alt={`Render of ${j.serial}`} className="aspect-video w-full rounded-md border border-line bg-panel2 object-contain" /></a>
            : <div className="grid aspect-video place-items-center rounded-md border border-dashed border-line2 text-xs text-grey">No render</div>}
          {j.model && <span className="font-mono text-xs text-grey">{j.model}</span>}
        </div>
      </div>

      {asking && editable && (
        <label className="grid gap-1 rounded-lg border border-line2 bg-panel2 p-3">
          <span className="text-sm">Note for QC (optional)</span>
          <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} autoFocus />
        </label>
      )}

      {fixing && <p className="text-xs text-grey">Admin correction: all three values must stay filled. Changes are kept in the Audit log.</p>}

      {canAct && (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {msg.error && <span role="alert" className="mr-auto text-sm text-bad">{msg.error}</span>}
          {msg.ok && !msg.error && <span className="mr-auto text-sm text-ok">{msg.ok}</span>}
          {fixing && <button className={btn.ghost} disabled={pending || !dirty || !!Object.keys(problems).length || !complete} onClick={() => act(() => savePrint(j.itemId, v))}>Save correction</button>}
          {editable && asking && <button className={btn.ghost} disabled={pending} onClick={() => setAsking(false)}>Cancel</button>}
          {editable && (
            <button className={btn.primary} disabled={pending || !complete || !!Object.keys(problems).length}
              title={!complete ? "Filament, printing time and slice components are needed first." : undefined}
              onClick={() => (asking ? act(async () => {
                // One tap: the values are saved (which starts the job) and sent to QC.
                if (dirty || j.status !== "doing") { const s = await savePrint(j.itemId, v); if (s.error) return s; }
                const r = await submitPrint(j.itemId, notes); if (!r.error) setAsking(false); return r;
              }) : setAsking(true))}>
              {asking ? (pending ? "Sending…" : "Send to QC") : "Submit for QC"}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}
