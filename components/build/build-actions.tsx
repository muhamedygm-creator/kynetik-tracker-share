"use client";
/** Build header actions and build-level dialogs (§14 Builds → Detail). */
import { useState, useTransition } from "react";
import {
  addStage, bulkAssignStage, deleteBuild, deleteStage, rebaseline, saveAsTemplate, saveParts, setBuildStatus, updateBuild, updateStage,
} from "@/app/(console)/builds/actions";
import { Dialog, btn, useCloseDialog } from "@/components/ui/dialog";
import { ActionForm, Field, input } from "@/components/ui/form";

export interface BuildHead {
  id: string;
  version: number;
  serial: string;
  name: string;
  client: string;
  notes: string;
  status: "planned" | "active" | "hold" | "done";
  startDate: string;
  deliveryDate: string | null;
  parts: string[];
}

function Confirm({ text, label, onConfirm, tone = "danger" }: { text: string; label: string; onConfirm: () => Promise<{ error?: string }>; tone?: "danger" | "primary" }) {
  const close = useCloseDialog();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="grid gap-4">
      <p className="text-sm">{text}</p>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={btn.ghost} onClick={close}>Cancel</button>
        <button className={tone === "danger" ? btn.danger : btn.primary} disabled={pending} onClick={() => start(async () => {
          const r = await onConfirm();
          if (r.error) setError(r.error); else close();
        })}>{pending ? "Working…" : label}</button>
      </div>
    </div>
  );
}

/** Danger confirmation that needs the build serial typed in. */
function TypedConfirm({ word, text, label, onConfirm }: { word: string; text: string; label: string; onConfirm: () => Promise<{ error?: string }> }) {
  const [typed, setTyped] = useState("");
  const close = useCloseDialog();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <div className="grid gap-4">
      <p className="text-sm">{text}</p>
      <Field label={`Type ${word} to confirm`}><input value={typed} onChange={(e) => setTyped(e.target.value)} className={`${input} font-mono`} autoFocus /></Field>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={btn.ghost} onClick={close}>Cancel</button>
        <button className={btn.danger} disabled={pending || typed.trim() !== word} onClick={() => start(async () => {
          const r = await onConfirm();
          if (r.error) setError(r.error); else close();
        })}>{pending ? "Working…" : label}</button>
      </div>
    </div>
  );
}

function StatusButton({ b, action, label }: { b: BuildHead; action: "start" | "hold" | "resume"; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  return (
    <span className="inline-flex items-center gap-2">
      <button className={action === "start" ? btn.primary : btn.ghost} disabled={pending}
        onClick={() => start(async () => setError((await setBuildStatus(b.id, b.version, action)).error))}>
        {pending ? "Working…" : label}
      </button>
      {error && <span role="alert" className="text-sm text-bad">{error}</span>}
    </span>
  );
}

function PartsListForm({ b }: { b: BuildHead }) {
  const close = useCloseDialog();
  const [text, setText] = useState(b.parts.join("\n"));
  const [removing, setRemoving] = useState<string[] | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const save = (confirm: boolean) => start(async () => {
    const r = await saveParts(b.id, text, confirm);
    if ("removing" in r && r.removing) { setRemoving(r.removing); setError(undefined); return; }
    if (r.error) { setError(r.error); return; }
    close();
  });
  return (
    <div className="grid gap-3">
      <Field label="Parts, one per line" hint="Unchanged lines keep their history. To rename a part without losing history, edit only that line's text.">
        <textarea rows={12} value={text} onChange={(e) => { setText(e.target.value); setRemoving(null); }} className={`${input} font-mono`} />
      </Field>
      {removing && (
        <div className="rounded-md border border-bad p-3 text-sm">
          Removing <strong>{removing.join(", ")}</strong> deletes that part&apos;s history in every stage. This can&apos;t be undone.
        </div>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        {removing ? (
          <button className={btn.danger} disabled={pending} onClick={() => save(true)}>Remove and save</button>
        ) : (
          <button className={btn.primary} disabled={pending} onClick={() => save(false)}>{pending ? "Saving…" : "Save parts"}</button>
        )}
      </div>
    </div>
  );
}

export function BuildActions({ b, canWrite, gated }: { b: BuildHead; canWrite: boolean; gated?: boolean }) {
  if (!canWrite) return null;
  return (
    <>
      {b.status === "planned" && <StatusButton b={b} action="start" label="Start build" />}
      {b.status === "active" && <StatusButton b={b} action="hold" label="Hold" />}
      {b.status === "hold" && <StatusButton b={b} action="resume" label="Resume" />}
      {!gated && <Dialog trigger="Parts list" title={`Parts list · ${b.serial}`}><PartsListForm b={b} /></Dialog>}
      <Dialog trigger="Edit" title={`Edit build · ${b.serial}`}>
        <ActionForm action={updateBuild}>
          <input type="hidden" name="id" value={b.id} />
          <input type="hidden" name="version" value={b.version} />
          <div className="grid grid-cols-2 gap-3">
            <Field label="Serial"><input name="serial" defaultValue={b.serial} className={`${input} font-mono`} /></Field>
            <Field label="Client"><input name="client" defaultValue={b.client} className={input} /></Field>
          </div>
          <Field label="Name"><input name="name" defaultValue={b.name} className={input} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Start" hint="Changing it re-flows the plan."><input type="date" name="startDate" defaultValue={b.startDate} className={`${input} font-mono`} /></Field>
            <Field label="Promised delivery" hint="The date promised for handover. Health compares the forecast with it."><input type="date" name="deliveryDate" defaultValue={b.deliveryDate ?? ""} className={`${input} font-mono`} /></Field>
          </div>
          <Field label="Notes"><textarea name="notes" rows={3} defaultValue={b.notes} className={input} /></Field>
        </ActionForm>
      </Dialog>
      <details className="relative">
        <summary className={`${btn.ghost} inline-flex min-h-10 cursor-pointer list-none items-center gap-1 [&::-webkit-details-marker]:hidden`}>More ▾</summary>
        <div className="absolute right-0 z-20 mt-1 grid min-w-48 gap-1 rounded-lg border border-line2 bg-panel3 p-2 shadow-xl">
          <Dialog trigger="Re-baseline" title="Re-baseline" triggerClass="min-h-11 rounded-md px-3 text-left text-sm hover:bg-panel2">
            <Confirm tone="primary" label="Re-baseline"
              text="The current plan becomes the new baseline. Slip resets to zero and the old baseline is lost."
              onConfirm={() => rebaseline(b.id)} />
          </Dialog>
          <Dialog trigger="Save as template" title={`Save ${b.serial} as a template`} triggerClass="min-h-11 rounded-md px-3 text-left text-sm hover:bg-panel2">
            <ActionForm action={saveAsTemplate} submit="Save template">
              <input type="hidden" name="projectId" value={b.id} />
              <Field label="Template name"><input name="label" defaultValue={`${b.name} (from ${b.serial})`} className={input} required /></Field>
              <Field label="Hours" hint="Actual uses the hours the finished work really took; unfinished work keeps the plan.">
                <select name="hours" defaultValue="plan" className={input}>
                  <option value="plan">Planned hours</option>
                  <option value="actual">Actual hours where finished</option>
                </select>
              </Field>
              <p className="text-sm text-grey">Copies the stages, tasks, parts and hours. Dates, people and costs are not copied.</p>
            </ActionForm>
          </Dialog>
          <Dialog trigger="Delete build" title={`Delete ${b.serial}`} triggerClass="min-h-11 rounded-md px-3 text-left text-sm text-bad hover:bg-panel2">
            <TypedConfirm word={b.serial} label="Delete build" text={`Delete ${b.serial} ${b.name} with all its stages, tasks, parts and history? This can't be undone.`}
              onConfirm={() => deleteBuild(b.id, b.version)} />
          </Dialog>
        </div>
      </details>
    </>
  );
}

export interface StageHead {
  id: string;
  version: number;
  name: string;
  stationType: string;
  stationId: string | null;
  partHours: number;
}

export function StageActions({ projectId, s, stations, people, canWrite }: {
  projectId: string; s: StageHead; stations: { id: string; name: string; type: string }[]; people: { id: string; label: string }[]; canWrite: boolean;
}) {
  const [tech, setTech] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  if (!canWrite) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={tech} onChange={(e) => setTech(e.target.value)} className="rounded-md border border-line2 bg-panel2 px-3 py-2 text-ink outline-none focus:border-gold" aria-label="Technician for bulk assign">
        <option value="">Bulk assign to…</option>
        {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      <button className={btn.ghost} disabled={!tech || pending} onClick={() => start(async () => setMsg(await bulkAssignStage(projectId, s.id, tech)))}>
        Assign unassigned
      </button>
      <Dialog trigger="Stage settings" title={`Stage settings · ${s.name}`}>
        <ActionForm action={updateStage}>
          <input type="hidden" name="id" value={s.id} />
          <input type="hidden" name="version" value={s.version} />
          <Field label="Name"><input name="name" defaultValue={s.name} className={input} /></Field>
          <Field label="Workstation">
            <select name="stationId" defaultValue={s.stationId ?? ""} className={input}>
              <option value="">— none —</option>
              {stations.map((w) => <option key={w.id} value={w.id}>{w.name}{w.type !== s.stationType ? ` (${w.type})` : ""}</option>)}
            </select>
          </Field>
          <Field label="Standard hours per part"><input type="number" name="partHours" step={0.5} min={0} defaultValue={s.partHours} className={`${input} font-mono`} /></Field>
        </ActionForm>
        <div className="mt-4 border-t border-line pt-3">
          <Dialog trigger="Delete stage" title={`Delete ${s.name}`} triggerClass={btn.danger}>
            <Confirm label="Delete stage" text={`Delete ${s.name} with its tasks and every part's history in it? This can't be undone.`}
              onConfirm={() => deleteStage(s.id, s.version, projectId)} />
          </Dialog>
        </div>
      </Dialog>
      {msg.ok && <span className="text-sm text-ok">{msg.ok}</span>}
      {msg.error && <span role="alert" className="text-sm text-bad">{msg.error}</span>}
    </div>
  );
}

export function AddStage({ projectId, stationTypes, stations }: {
  projectId: string; stationTypes: { key: string; label: string }[]; stations: { id: string; name: string; type: string }[];
}) {
  return (
    <Dialog trigger="+ Stage" title="Add stage" triggerClass={`${btn.ghost} !px-2`}>
      <ActionForm action={addStage} submit="Add stage">
        <input type="hidden" name="projectId" value={projectId} />
        <Field label="Name"><input name="name" className={input} autoFocus /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Station type">
            <select name="stationType" className={input}>{stationTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
          </Field>
          <Field label="Standard h / part"><input type="number" name="partHours" step={0.5} min={0} defaultValue={8} className={`${input} font-mono`} /></Field>
        </div>
        <Field label="Workstation">
          <select name="stationId" className={input}><option value="">— none —</option>{stations.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
        </Field>
      </ActionForm>
    </Dialog>
  );
}
