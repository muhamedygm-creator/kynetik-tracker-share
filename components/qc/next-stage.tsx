"use client";
/**
 * Plan the next stage (Owner, 2026-10-15): after a step passes QC (QC page, Requests or the project board) this
 * pop-up offers the steps it opened (one row each: who, how long, optional start) and puts them on the Task
 * queue, so they show on the person's queue, the TV and the project at once. Skip leaves them unplanned.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { nextStageOptions, type NextStageOptions } from "@/app/(console)/builds/qc-actions";
import { planWorkItem } from "@/app/(console)/plan/actions";
import { btn } from "@/components/ui/dialog";
import { DurationField } from "@/components/ui/duration-field";
import { input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { MoldCount } from "./decision";

const EVENT = "kynetik:next-stage";

/** Ask the console's planner to offer the steps that a just-approved step opened. */
export const openNextStage = (itemId: string) => window.dispatchEvent(new CustomEvent(EVENT, { detail: itemId }));

type Row = { person: string; hours: number; at: string };

export function NextStageHost() {
  const router = useRouter();
  const [itemId, setItemId] = useState<string | null>(null);
  const [opts, setOpts] = useState<NextStageOptions | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [same, setSame] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const load = useCallback(async (id: string) => {
    const o = await nextStageOptions(id);
    if (!o || (!o.steps.length && !o.mold)) { setItemId(null); setOpts(null); return; }
    setOpts(o);
    setRows(o.steps.map((s) => ({ person: s.tech ?? "", hours: s.hours, at: "" })));
    setMsg(null);
  }, []);

  useEffect(() => {
    const on = (e: Event) => { const id = (e as CustomEvent<string>).detail; setItemId(id); void load(id); };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [load]);

  const close = () => { setItemId(null); setOpts(null); };
  const row = (i: number) => (same && i > 0 ? rows[0]! : rows[i]!);
  const set = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const chosen = opts ? opts.steps.map((s, i) => ({ s, r: row(i) })).filter((x) => x.r.person) : [];

  const save = () => start(async () => {
    const errors: string[] = [];
    for (const { s, r } of chosen) {
      const res = await planWorkItem(s.workItemId, r.person, r.at || null, { hours: r.hours });
      if (res.error) errors.push(`${s.label}: ${res.error}`);
    }
    router.refresh();
    if (errors.length) { setMsg(errors.join(" ")); if (itemId) void load(itemId); } else close();
  });

  const dept = (key: string) => opts?.departments.find((d) => d.key === key);
  return (
    <Modal open={!!opts} onClose={close} title="Plan the next stage" wide>
      {opts && (
        <div className="grid gap-4">
          <p className="text-sm text-grey">{opts.title} passed QC. Put what comes next on the Task queue: it shows on the person&apos;s queue, the TV and the project.</p>
          {opts.mold && (
            <div className="rounded-lg border border-line2 bg-panel2 p-3">
              <p className="mb-2 text-sm">Mold production comes next. Set how many mold components {opts.mold.label} needs, then plan each one.</p>
              <MoldCount partId={opts.mold.partId} label={opts.mold.label} onDone={() => itemId && load(itemId)} />
            </div>
          )}
          {opts.steps.length > 1 && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="h-5 w-5 accent-[var(--gold)]" />
              Same person, time and start for all {opts.steps.length}
            </label>
          )}
          {opts.steps.map((s, i) => {
            const r = row(i);
            const locked = same && i > 0;
            const d = dept(s.departmentKey);
            const inDept = opts.people.filter((p) => p.departmentKey === s.departmentKey);
            const others = opts.people.filter((p) => p.departmentKey !== s.departmentKey);
            return (
              <fieldset key={s.workItemId} className="grid gap-3 rounded-lg border border-line p-3" disabled={locked}>
                <legend className="px-1 text-sm"><span className="font-semibold">{s.label}</span> <span className="text-grey">· {s.stage}</span></legend>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="grid content-start gap-1">
                    <span className="label">Who</span>
                    <select value={r.person} onChange={(e) => set(i, { person: e.target.value })} className={input} aria-label={`Who does ${s.label}`}>
                      <option value="">Not now</option>
                      {inDept.length > 0 && <optgroup label={d ? `${d.emoji} ${d.name}` : "This department"}>{inDept.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
                      {others.length > 0 && <optgroup label="Everyone else">{others.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>}
                    </select>
                    <label className="mt-2 grid gap-1">
                      <span className="label">Start (optional)</span>
                      <input type="datetime-local" value={r.at} onChange={(e) => set(i, { at: e.target.value })} className={`${input} font-mono`} />
                      <span className="text-xs text-grey">Empty: after the person&apos;s current queue.</span>
                    </label>
                  </div>
                  <DurationField hours={r.hours} onChange={(h) => set(i, { hours: h })} disabled={locked} label="Hours" dayHours={opts.dayHours} />
                </div>
              </fieldset>
            );
          })}
          {msg && <p role="alert" className="text-sm text-bad">{msg}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
            <button className={btn.ghost} disabled={pending} onClick={close}>Skip for now</button>
            {opts.steps.length > 0 && (
              <button className={btn.primary} disabled={pending || !chosen.length} onClick={save}>
                {pending ? "Adding…" : `Add ${chosen.length || ""} to Task queue`.replace("  ", " ")}
              </button>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
