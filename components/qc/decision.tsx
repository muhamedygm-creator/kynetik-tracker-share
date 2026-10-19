"use client";
/** Approve or reject a step waiting for QC (amends AM-07). Used on the QC page and in a project's step drawer. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideQc, setMoldComponents, submitQc } from "@/app/(console)/builds/qc-actions";
import { btn } from "@/components/ui/dialog";
import { input } from "@/components/ui/form";
import { openNextStage } from "./next-stage";

export function QcDecision({ itemId, techName, onDone, compact }: { itemId: string; techName: string; onDone?: () => void; compact?: boolean }) {
  const router = useRouter();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const go = (approve: boolean) => start(async () => {
    const r = await decideQc(itemId, approve, reason);
    setMsg(r);
    if (!r.error) { router.refresh(); onDone?.(); if (approve) openNextStage(itemId); }
  });
  return (
    <div className="grid gap-2">
      {!rejecting ? (
        <div className={`flex flex-wrap gap-2 ${compact ? "justify-end" : ""}`}>
          <button className={btn.primary} disabled={pending} onClick={() => go(true)}>{pending ? "Saving…" : "Approve"}</button>
          <button className={btn.danger} disabled={pending} onClick={() => setRejecting(true)}>Reject…</button>
        </div>
      ) : (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className="label">What failed</span>
            <textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} className={input} autoFocus
              placeholder="It goes back to the same technician as rework." />
          </label>
          <div className="flex flex-wrap justify-end gap-2">
            <button className={btn.ghost} disabled={pending} onClick={() => { setRejecting(false); setReason(""); }}>Cancel</button>
            <button className={btn.danger} disabled={pending || !reason.trim()} onClick={() => go(false)}>
              {pending ? "Saving…" : `Send back to ${techName || "the technician"}`}
            </button>
          </div>
        </div>
      )}
      {msg.error && <p role="alert" className="text-sm text-bad">{msg.error}</p>}
    </div>
  );
}

export function SubmitQcButton({ itemId, onDone }: { itemId: string; onDone?: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-grid gap-1">
      <button className={btn.primary} disabled={pending} onClick={() => start(async () => {
        const r = await submitQc(itemId);
        if (r.error) setError(r.error); else { router.refresh(); onDone?.(); }
      })}>{pending ? "Sending…" : "Submit for QC"}</button>
      {error && <span role="alert" className="text-sm text-bad">{error}</span>}
    </span>
  );
}

/** After pre-mold passes QC: how many mold components the part needs (AM-06). */
export function MoldCount({ partId, label, onDone }: { partId: string; label: string; onDone?: () => void }) {
  const router = useRouter();
  const [n, setN] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
      e.preventDefault();
      start(async () => { const r = await setMoldComponents(partId, Number(n)); setMsg(r); if (!r.error) { router.refresh(); onDone?.(); } });
    }}>
      <label className="grid gap-1">
        <span className="label">Mold components for {label}</span>
        <input value={n} onChange={(e) => setN(e.target.value)} inputMode="numeric" className={`${input} w-28 font-mono`} placeholder="e.g. 4" required />
      </label>
      <button className={btn.primary} disabled={pending || !/^\d+$/.test(n)}>{pending ? "Saving…" : "Set"}</button>
      {msg.error && <span role="alert" className="text-sm text-bad">{msg.error}</span>}
      {msg.ok && <span className="text-sm text-ok">{msg.ok}</span>}
    </form>
  );
}
