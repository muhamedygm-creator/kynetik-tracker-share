"use client";
/** Task schedule tab (§14): table + add/edit/delete dialog. */
import { useEffect, useRef, useState, useTransition } from "react";
import { deleteTask, saveTask } from "@/app/(console)/builds/actions";
import { btn } from "@/components/ui/dialog";
import { ActionForm, Field, input, type Result } from "@/components/ui/form";

export interface TaskView {
  id: string;
  version: number;
  num: number;
  stageId: string;
  stageName: string;
  name: string;
  assignee: string | null;
  assigneeName: string;
  status: "todo" | "doing" | "blocked" | "done";
  durH: number;
  pct: number;
  start: string | null;
  end: string | null;
  startLabel: string;
  endLabel: string;
  forecastLabel: string;
  varLabel: string;
  varTone: "ok" | "warn" | "bad" | "";
  pinned: boolean;
  notes: string;
}

interface Props {
  projectId: string;
  canWrite: boolean;
  tasks: TaskView[];
  stages: { id: string; name: string }[];
  people: { id: string; name: string }[];
  statusLabels: Record<TaskView["status"], { label: string; colour: string }>;
  stageFilter?: string;
}

const tone = { ok: "var(--ok)", warn: "var(--warn)", bad: "var(--bad)", "": undefined };

function TaskForm({ t, p, onDone }: { t: TaskView | null; p: Props; onDone: () => void }) {
  const [pending, start] = useTransition();
  const [delError, setDelError] = useState<string>();
  const action = async (prev: Result, f: FormData) => {
    const r = await saveTask(prev, f);
    if (r.ok) onDone();
    return r;
  };
  return (
    <ActionForm action={action} keepOpen submit={t ? "Save task" : "Add task"}>
      {t && <input type="hidden" name="id" value={t.id} />}
      {t && <input type="hidden" name="version" value={t.version} />}
      <input type="hidden" name="projectId" value={p.projectId} />
      <Field label="Task"><input name="name" defaultValue={t?.name} className={input} autoFocus={!t} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Stage">
          <select name="stageId" defaultValue={t?.stageId ?? p.stageFilter ?? p.stages[0]?.id} className={input}>
            {p.stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="Lead">
          <select name="assignee" defaultValue={t?.assignee ?? ""} className={input}>
            <option value="">— none —</option>
            {p.people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
        <Field label="Status">
          <select name="status" defaultValue={t?.status ?? "todo"} className={input}>
            {(Object.keys(p.statusLabels) as TaskView["status"][]).map((s) => <option key={s} value={s}>{p.statusLabels[s].label}</option>)}
          </select>
        </Field>
        <Field label="% done"><input type="number" name="pct" min={0} max={100} step={5} defaultValue={t?.pct ?? 0} className={`${input} font-mono`} /></Field>
        <Field label="Working hours"><input type="number" name="durH" min={0.5} step={0.5} defaultValue={t?.durH ?? 8} className={`${input} font-mono`} /></Field>
        <div />
        {t && (
          <>
            <Field label="Planned start" hint="Changing it pins the task here; later tasks re-flow.">
              <input type="datetime-local" name="start" defaultValue={t.start ?? ""} className={`${input} font-mono`} />
            </Field>
            <Field label="Planned end" hint="Changing it recomputes the hours (0.5h steps).">
              <input type="datetime-local" name="end" defaultValue={t.end ?? ""} className={`${input} font-mono`} />
            </Field>
          </>
        )}
      </div>
      {!t && <><input type="hidden" name="start" value="" /><input type="hidden" name="end" value="" /></>}
      <Field label="Notes" hint="Shown in the Attention list when the task is Blocked."><textarea name="notes" rows={2} defaultValue={t?.notes} className={input} /></Field>
      {t && (
        <div className="flex items-center gap-3 border-t border-line pt-3">
          <button type="button" className={btn.danger} disabled={pending} onClick={() => start(async () => {
            const r = await deleteTask(t.id, t.version, p.projectId);
            if (r.error) setDelError(r.error); else onDone();
          })}>Delete task</button>
          {delError && <span className="text-sm text-bad">{delError}</span>}
        </div>
      )}
    </ActionForm>
  );
}

export function TaskTable(p: Props) {
  const [open, setOpen] = useState<TaskView | "new" | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  const rows = p.stageFilter ? p.tasks.filter((t) => t.stageId === p.stageFilter) : p.tasks;

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="label border-b border-line text-left">
              {["#", "Stage", "Task", "Lead", "Status", "Start", "End", "Hours", "%", "Forecast end", "Vs baseline", ""].map((x) => (
                <th key={x} className={`px-3 py-2 ${["Hours", "%"].includes(x) ? "text-right" : ""}`}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-b border-line last:border-0 hover:bg-panel2">
                <td className="px-3 py-2 font-mono text-grey">{t.num}</td>
                <td className="px-3 py-2 text-grey">{t.stageName}</td>
                <td className="px-3 py-2">{t.name}</td>
                <td className="px-3 py-2">{t.assigneeName || <span className="text-grey">—</span>}</td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: p.statusLabels[t.status].colour }} />{p.statusLabels[t.status].label}</span>
                </td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{t.startLabel}{t.pinned && <span title="Pinned start" className="ml-1 text-gold">•</span>}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{t.endLabel}</td>
                <td className="px-3 py-2 text-right font-mono">{t.durH}h</td>
                <td className="px-3 py-2 text-right font-mono">{Math.round(t.pct)}%</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono">{t.forecastLabel}</td>
                <td className="whitespace-nowrap px-3 py-2 font-mono" style={{ color: tone[t.varTone] }}>{t.varLabel}</td>
                <td className="px-3 py-2 text-right">{p.canWrite && <button className={`${btn.link} text-xs`} onClick={() => setOpen(t)}>Edit</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {p.canWrite && <div className="p-3"><button className={btn.ghost} onClick={() => setOpen("new")}>Add task</button></div>}
      <dialog ref={ref} onClose={() => setOpen(null)} onClick={(e) => e.target === ref.current && setOpen(null)}
        className="m-auto w-[calc(100%-2rem)] max-w-xl rounded-[10px] border border-line2 bg-panel p-0 text-ink backdrop:bg-black/70">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="display text-sm">{open === "new" ? "Add task" : open ? `Task ${open.num}` : ""}</h2>
          <button type="button" onClick={() => setOpen(null)} aria-label="Close" className="font-mono text-grey hover:text-ink">✕</button>
        </div>
        <div className="max-h-[75dvh] overflow-y-auto px-5 py-4">
          {open && <TaskForm key={open === "new" ? "new" : `${open.id}:${open.version}`} t={open === "new" ? null : open} p={p} onDone={() => setOpen(null)} />}
        </div>
      </dialog>
    </>
  );
}
