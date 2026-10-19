"use client";
/** Parts × stages: the per-stage parts table, the parts matrix, and the part-step edit / rework dialogs. */
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { reworkWorkItem, updateWorkItem } from "@/app/(console)/builds/actions";
import { btn } from "@/components/ui/dialog";
import { ActionForm, Field, input, type Result } from "@/components/ui/form";

export interface ItemView {
  id: string;
  version: number;
  stageId: string;
  stageName: string;
  partId: string;
  partName: string;
  status: "todo" | "doing" | "blocked" | "done";
  tech: string | null;
  techName: string;
  start: string | null;
  end: string | null;
  startLabel: string;
  endLabel: string;
  std: number;
  planH: number | null;
  actual: number;
  rework: number;
  reworkLog: { at: string; why: string; by: string }[];
  hours: number;
  notes: string;
  /** New workflow (amends AM-06/07): waiting for QC since (label), mold component, why it can't start yet, try number. */
  qcSince?: string | null;
  component?: string | null;
  blocker?: string | null;
  attempt?: number;
  reworkH?: number;
}

export interface Common {
  projectId: string;
  canWrite: boolean;
  /** New workflow: Done comes from QC approval. */
  gated?: boolean;
  statusLabels: Record<ItemView["status"], { label: string; colour: string }>;
  people: { id: string; label: string }[];
}

const h = (x: number) => `${Math.round(x * 10) / 10}h`;

/** Controlled modal used by the table and the matrix. */
function Modal({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-[10px] border border-line2 bg-panel p-0 text-ink backdrop:bg-black/70">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="display text-sm">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="font-mono text-grey hover:text-ink">✕</button>
      </div>
      <div className="max-h-[75dvh] overflow-y-auto px-5 py-4">{open && children}</div>
    </dialog>
  );
}

function StatusDot({ status, c }: { status: ItemView["status"]; c: Common }) {
  const s = c.statusLabels[status];
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.colour, border: status === "todo" ? "1px solid var(--grey2)" : undefined }} />
      {s.label}
    </span>
  );
}

export function WorkItemForm({ item, c, onDone }: { item: ItemView; c: Common; onDone: () => void }) {
  const [field, setField] = useState<"" | "start" | "end">("");
  const action = async (prev: Result, f: FormData) => {
    const r = await updateWorkItem(prev, f);
    if (r.ok) onDone();
    return r;
  };
  return (
    <ActionForm action={action} keepOpen>
      <input type="hidden" name="id" value={item.id} />
      <input type="hidden" name="version" value={item.version} />
      <input type="hidden" name="projectId" value={c.projectId} />
      <input type="hidden" name="field" value={field} />
      <Field label="Technician">
        <select name="tech" defaultValue={item.tech ?? ""} className={input} disabled={!c.canWrite}>
          <option value="">— nobody —</option>
          {c.people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
      </Field>
      <Field label="Status">
        <select name="status" defaultValue={item.status} className={input} disabled={!c.canWrite}>
          {(Object.keys(c.statusLabels) as ItemView["status"][]).filter((s) => !c.gated || s !== "done" || item.status === "done")
            .map((s) => <option key={s} value={s}>{c.statusLabels[s].label}</option>)}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Started"><input type="datetime-local" name="start" defaultValue={item.start ?? ""} onChange={() => setField("start")} className={`${input} font-mono`} disabled={!c.canWrite} /></Field>
        <Field label="Finished"><input type="datetime-local" name="end" defaultValue={item.end ?? ""} onChange={() => setField("end")} className={`${input} font-mono`} disabled={!c.canWrite} /></Field>
      </div>
      <Field label={c.gated ? "Allocated hours" : "Standard hours"} hint={c.gated ? "Set by an admin; planning the step on a task queue sets it too." : `Leave empty to use the stage standard (${h(item.std)} now).`}>
        <input type="number" step="0.5" min="0" name="planH" defaultValue={item.planH ?? ""} className={`${input} font-mono`} disabled={!c.canWrite} />
      </Field>
      <Field label="Notes"><textarea name="notes" rows={2} defaultValue={item.notes} className={input} disabled={!c.canWrite} /></Field>
      <p className="font-mono text-xs text-grey">Actual {h(item.actual)} · logged {h(item.hours)} · rework {item.rework}{item.reworkH ? ` (${h(item.reworkH)})` : ""}</p>
    </ActionForm>
  );
}

export function ReworkForm({ item, c, onDone }: { item: ItemView; c: Common; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3">
      <p className="text-sm text-grey">{item.partName} goes back to In Progress with {item.techName || "its technician"}. The first attempt stays in the history.</p>
      <Field label="What failed"><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={input} autoFocus /></Field>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {item.reworkLog.length > 0 && (
        <ul className="grid gap-1 font-mono text-xs text-grey">
          {item.reworkLog.map((r, i) => <li key={i}>{r.at.replace("T", " ")} · {r.by}: {r.why}</li>)}
        </ul>
      )}
      <div className="flex justify-end">
        <button className={btn.primary} disabled={pending || !c.canWrite} onClick={() => start(async () => {
          const r = await reworkWorkItem(item.id, item.version, c.projectId, reason);
          if (r.error) setError(r.error); else onDone();
        })}>{pending ? "Saving…" : "Send back"}</button>
      </div>
    </div>
  );
}

function useEditor(c: Common) {
  const [edit, setEdit] = useState<ItemView | null>(null);
  const [redo, setRedo] = useState<ItemView | null>(null);
  const dialogs = (
    <>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit ? `${edit.stageName} · ${edit.partName}` : ""}>
        {edit && <WorkItemForm key={`${edit.id}:${edit.version}`} item={edit} c={c} onDone={() => setEdit(null)} />}
      </Modal>
      <Modal open={!!redo} onClose={() => setRedo(null)} title={redo ? `Rework · ${redo.partName}` : ""}>
        {redo && <ReworkForm item={redo} c={c} onDone={() => setRedo(null)} />}
      </Modal>
    </>
  );
  return { setEdit, setRedo, dialogs };
}

/** Parts table for one stage (§14 Stages & parts). */
export function PartsTable({ items, c }: { items: ItemView[]; c: Common }) {
  const { setEdit, setRedo, dialogs } = useEditor(c);
  if (!items.length) return <p className="p-4 text-sm text-grey">This build has no parts list, so this stage can&apos;t be tracked by part. Add parts with Parts list.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead>
            <tr className="label border-b border-line text-left">
              {["#", "Part", "Technician", "Status", "Started", "Finished", c.gated ? "Allocated h" : "Std h", "Actual h", "Var", "Rework", "Logged h", ""].map((x) => (
                <th key={x} className={`px-3 py-2 ${["Std h", "Allocated h", "Actual h", "Var", "Rework", "Logged h"].includes(x) ? "text-right" : ""}`}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((w, i) => {
              const v = w.actual - w.std;
              const showVar = w.start !== null;
              return (
                <tr key={w.id} className="border-b border-line last:border-0 hover:bg-panel2">
                  <td className="px-3 py-2 font-mono text-grey">{i + 1}</td>
                  <td className="px-3 py-2">{w.partName}{w.component && <span className="block font-mono text-xs text-gold">{w.component}</span>}</td>
                  <td className="px-3 py-2">{w.techName || <span className="text-grey">—</span>}</td>
                  <td className="px-3 py-2">{w.qcSince ? <span className="whitespace-nowrap text-warn">Waiting for QC</span> : <StatusDot status={w.status} c={c} />}</td>
                  <td className="px-3 py-2 font-mono">{w.startLabel}</td>
                  <td className="px-3 py-2 font-mono">{w.endLabel}</td>
                  <td className="px-3 py-2 text-right font-mono">{h(w.std)}</td>
                  <td className="px-3 py-2 text-right font-mono">{w.start ? h(w.actual) : "—"}</td>
                  <td className="px-3 py-2 text-right font-mono" style={{ color: !showVar ? undefined : v > 0 ? "var(--bad)" : "var(--ok)" }}>
                    {showVar ? `${v > 0 ? "+" : ""}${h(v)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">{w.rework || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{w.hours ? h(w.hours) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    {c.canWrite && w.status === "done" && <button className={`${btn.link} mr-3 text-xs`} onClick={() => setRedo(w)}>Rework</button>}
                    <button className={`${btn.link} text-xs`} onClick={() => setEdit(w)}>{c.canWrite ? "Edit" : "View"}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {dialogs}
    </>
  );
}

/** Parts × stages grid, cell coloured by status, showing technician and ↺ rework count (§14). */
export function Matrix({ parts, stages, items, c }: { parts: { id: string; name: string }[]; stages: { id: string; name: string }[]; items: ItemView[]; c: Common }) {
  const { setEdit, dialogs } = useEditor(c);
  // A cell can hold several steps: one per mold component (amends AM-06).
  const at = new Map<string, ItemView[]>();
  for (const w of items) at.set(`${w.stageId}|${w.partId}`, [...(at.get(`${w.stageId}|${w.partId}`) ?? []), w]);
  if (!parts.length) return <p className="p-4 text-sm text-grey">No parts list yet.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="label sticky left-0 bg-panel px-2 py-1 text-left">Part</th>
              {stages.map((s) => <th key={s.id} className="label min-w-28 px-2 py-1 text-left">{s.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {parts.map((p) => (
              <tr key={p.id}>
                <th className="sticky left-0 whitespace-nowrap bg-panel px-2 py-1 text-left font-normal">{p.name}</th>
                {stages.map((s) => {
                  const ws = at.get(`${s.id}|${p.id}`) ?? [];
                  if (!ws.length) return <td key={s.id} />;
                  return (
                    <td key={s.id} className="p-0">
                      <div className="grid gap-0.5">
                        {ws.map((w) => {
                          const st = c.statusLabels[w.status];
                          const light = w.status === "doing";
                          return (
                            <button key={w.id} onClick={() => setEdit(w)} title={`${w.component ? `${w.component} · ` : ""}${w.qcSince ? "Waiting for QC" : st.label}${w.techName ? ` · ${w.techName}` : ""}`}
                              className={`flex w-full items-center justify-between gap-1 rounded px-2 text-left text-xs ${ws.length > 1 ? "h-6" : "h-9"}`}
                              // Status fills come from Settings and stay the same in both themes; Not started uses the theme's neutral fill.
                              style={{ background: w.qcSince ? "var(--warn)" : w.status === "todo" ? "var(--chip)" : st.colour, color: w.qcSince ? "var(--on-accent)" : w.status === "todo" ? "var(--ink)" : light ? "#1e1e1e" : "#ececec" }}>
                              <span className="truncate">{ws.length > 1 ? `${w.component?.replace("Mold component ", "#")} ` : ""}{w.techName}</span>
                              {w.rework > 0 && <span className="font-mono">↺{w.rework}</span>}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 px-1 text-xs text-grey">
        {(Object.keys(c.statusLabels) as ItemView["status"][]).map((s) => <StatusDot key={s} status={s} c={c} />)}
      </div>
      {dialogs}
    </>
  );
}
