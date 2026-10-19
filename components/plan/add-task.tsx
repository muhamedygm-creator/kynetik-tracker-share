"use client";
/**
 * Add a task from anywhere (v2): department first, then the person, then either a waiting part step
 * from a build (stays linked to the build) or a workshop task. Used by the + Add task button on every
 * console page and by a click on an empty spot in the Task queue.
 */
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { addPlanTask, addTaskOptions, planWorkItem } from "@/app/(console)/plan/actions";
import { btn } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { DurationField } from "@/components/ui/duration-field";
import { fmtDT, fmtHM } from "@/domain/format";

type Options = Awaited<ReturnType<typeof addTaskOptions>>;
export interface AddTaskPreset { personId?: string; departmentKey?: string; at?: string | null }

const field = "min-h-11 w-full min-w-0 max-w-full truncate rounded-md border border-line2 bg-panel2 px-3 text-ink outline-none focus:border-gold";
const chip = (on: boolean) => `min-h-10 rounded-full border px-3.5 text-sm ${on ? "border-gold bg-gold/10 text-ink" : "border-line2 text-grey hover:text-ink"}`;

export function AddTaskDrawer({ open, preset, onClose, onDone }: {
  open: boolean; preset: AddTaskPreset | null; onClose: () => void; onDone?: (r: { ok?: string; error?: string }) => void;
}) {
  const [opts, setOpts] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open || opts) return;
    addTaskOptions().then(setOpts).catch(() => setError("Couldn't load the crew list. Check the connection and try again."));
  }, [open, opts]);
  return (
    <Drawer open={open} onClose={onClose} eyebrow="Task queue" title="Add a task">
      {error ? <p className="text-sm text-bad">{error}</p>
        : !opts ? <p className="text-sm text-grey">Loading the crew…</p>
        : open && <AddTaskForm key={JSON.stringify(preset)} opts={opts} preset={preset ?? {}} onDone={(r) => { onDone?.(r); if (!r.error) { setOpts(null); onClose(); } }} />}
    </Drawer>
  );
}

function AddTaskForm({ opts, preset, onDone }: { opts: Options; preset: AddTaskPreset; onDone: (r: { ok?: string; error?: string }) => void }) {
  const router = useRouter();
  const presetPerson = opts.people.find((p) => p.id === preset.personId);
  const firstDept = opts.departments.find((d) => d.key === preset.departmentKey)
    ?? opts.departments.find((d) => d.id === presetPerson?.departmentId)
    ?? opts.departments.find((d) => opts.people.some((p) => p.departmentId === d.id));
  const [deptId, setDeptId] = useState<string>(presetPerson && !presetPerson.departmentId ? "none" : firstDept?.id ?? "none");
  const people = useMemo(() => opts.people.filter((p) => (deptId === "none" ? !p.departmentId : p.departmentId === deptId)), [opts.people, deptId]);
  const [person, setPerson] = useState(presetPerson?.id ?? people[0]?.id ?? "");
  const dept = opts.departments.find((d) => d.id === deptId);
  const waiting = useMemo(() => opts.waiting.filter((x) => x.departmentKey === dept?.key), [opts.waiting, dept]);
  const [kind, setKind] = useState<"part" | "workshop">("workshop");
  const [part, setPart] = useState("");
  const [title, setTitle] = useState("");
  const [hours, setHours] = useState(1);
  const [priority, setPriority] = useState<"normal" | "urgent">("normal");
  const [notes, setNotes] = useState("");
  const [placed, setPlaced] = useState(!!preset.at);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => { if (!people.some((p) => p.id === person)) setPerson(people[0]?.id ?? ""); }, [people, person]);
  const chosen = waiting.find((x) => x.workItemId === part);

  return (
    <form className="grid min-w-0 gap-4 [&>*]:min-w-0" onSubmit={(e) => {
      e.preventDefault();
      setMsg(null);
      start(async () => {
        const at = placed ? preset.at ?? null : null;
        const r = kind === "part" && chosen
          ? await planWorkItem(chosen.workItemId, person, at, { hours, priority, notes })
          : await addPlanTask(person, title, hours, { at, priority, notes });
        if (r.error) { setMsg(r.error); return; }
        router.refresh();
        onDone(r);
      });
    }}>
      <label className="grid gap-1"><span className="label">Department</span>
        <select value={deptId} onChange={(e) => { setDeptId(e.target.value); setPart(""); }} className={field}>
          {opts.departments.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
          <option value="none">No department</option>
        </select>
      </label>
      <label className="grid gap-1"><span className="label">Who</span>
        {people.length ? (
          <select value={person} onChange={(e) => setPerson(e.target.value)} className={field}>
            {people.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        ) : <span className="text-sm text-warn">Nobody is in this department yet. Add people to it under Crew.</span>}
      </label>

      <div className="grid gap-1.5"><span className="label">What</span>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={chip(kind === "workshop")} onClick={() => setKind("workshop")}>Workshop task</button>
          <button type="button" className={chip(kind === "part")} onClick={() => setKind("part")} disabled={!waiting.length}>
            Part from a build{waiting.length ? ` (${waiting.length})` : ""}
          </button>
        </div>
      </div>
      {kind === "part" ? (
        <label className="grid gap-1"><span className="label">Waiting part step</span>
          <select value={part} onChange={(e) => { setPart(e.target.value); const w = waiting.find((x) => x.workItemId === e.target.value); if (w) setHours(w.hours); }} className={field} required>
            <option value="" disabled>Pick a part</option>
            {waiting.map((x) => <option key={x.workItemId} value={x.workItemId}>{x.late ? "Late · " : ""}{x.label} · {fmtHM(x.hours, opts?.dayHours ?? 0)}</option>)}
          </select>
          <span className="text-xs text-grey">It stays linked to the build: its status updates the build too.</span>
        </label>
      ) : (
        <label className="grid gap-1"><span className="label">Task</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Clean-down, delivery run, training" className={field} />
        </label>
      )}

      <div className="grid gap-1.5"><span className="label">When</span>
        <div className="flex flex-wrap gap-1.5">
          {preset.at && <button type="button" className={chip(placed)} onClick={() => setPlaced(true)}>{fmtDT(preset.at)}</button>}
          <button type="button" className={chip(!placed)} onClick={() => setPlaced(false)}>After their last task</button>
        </div>
      </div>
      <DurationField hours={hours} onChange={setHours} dayHours={opts?.dayHours ?? 0} />
      <div className="grid gap-1.5"><span className="label">Priority</span>
        <div className="flex gap-1.5">
          <button type="button" className={chip(priority === "normal")} onClick={() => setPriority("normal")}>Normal</button>
          <button type="button" className={chip(priority === "urgent")} onClick={() => setPriority("urgent")}>Urgent</button>
        </div>
      </div>
      <label className="grid gap-1"><span className="label">Notes for the technician</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full rounded-md border border-line2 bg-panel2 px-3 py-2 text-ink outline-none focus:border-gold" />
      </label>
      {msg && <p role="alert" className="text-sm text-bad">{msg}</p>}
      <div className="flex justify-end border-t border-line pt-4">
        <button className={btn.primary} disabled={pending || !person || (kind === "part" ? !part : !title.trim())}>{pending ? "Adding…" : "Add task"}</button>
      </div>
    </form>
  );
}

/** The + New task button shown on every console page (Owner and Supervisors). New project lives on the Projects page (Reports fix B11). */
export function QuickAddTask() {
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t); }, [toast]);
  return (
    <>
      {/* Amends AM-09: + New task on every page (+ New project only on the Projects page, Reports fix B11). */}
      <div className="fixed bottom-5 right-5 z-40 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => setOpen(true)}
          className="display flex min-h-12 items-center gap-2 rounded-full bg-gold px-5 text-[0.72rem] tracking-[0.16em] text-on-accent shadow-[0_8px_28px_rgba(0,0,0,.55)] hover:brightness-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
          <span aria-hidden className="text-lg leading-none">+</span>New task
        </button>
      </div>
      <AddTaskDrawer open={open} preset={null} onClose={() => setOpen(false)} onDone={(r) => setToast(r.ok ?? "Added.")} />
      {toast && <div role="status" className="fixed bottom-24 right-5 z-[70] max-w-[calc(100%-2.5rem)] rounded-lg bg-ink px-4 py-2.5 text-sm font-bold text-carbon shadow-2xl">{toast}</div>}
    </>
  );
}
