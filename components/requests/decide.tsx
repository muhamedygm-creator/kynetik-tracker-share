"use client";
/** Approve or reject one request (amends AM-15). A time extension asks how much time to add. */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { decideRequest } from "@/app/(console)/requests/actions";
import { btn } from "@/components/ui/buttons";
import { DurationField } from "@/components/ui/duration-field";
import { input } from "@/components/ui/form";
import { openNextStage } from "@/components/qc/next-stage";

export function DecideRequest({ id, kind, gatedQc, workItemId = null, dayHours = 0 }: { id: string; kind: "extension" | "qc"; gatedQc: boolean; workItemId?: string | null; dayHours?: number }) {
  const router = useRouter();
  const [reply, setReply] = useState("");
  const [extra, setExtra] = useState(0.5);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const go = (approve: boolean) => start(async () => { const r = await decideRequest(id, approve, reply, String(extra)); setMsg(r);
    if (!r.error) { router.refresh(); if (approve && kind === "qc" && gatedQc && workItemId) openNextStage(workItemId); } });
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {kind === "extension" && (
          <DurationField hours={extra} onChange={setExtra} dayHours={dayHours} label="Extra time" />
        )}
        <label className="grid min-w-48 flex-1 gap-1">
          <span className="label">Reply note{kind === "qc" && gatedQc ? " (needed to reject)" : " (optional)"}</span>
          <input value={reply} onChange={(e) => setReply(e.target.value)} className={input} />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button className={btn.primary} disabled={pending || (kind === "extension" && !(extra > 0))} onClick={() => go(true)}>
          {kind === "extension" ? "Approve, add time" : "Approve QC"}
        </button>
        <button className={btn.danger} disabled={pending} onClick={() => go(false)}>Not approved</button>
        {msg.error && <span role="alert" className="text-sm text-bad">{msg.error}</span>}
      </div>
    </div>
  );
}
