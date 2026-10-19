"use client";
/** TV notices editor (docs/ROADMAP.md v1.5): messages and daily countdowns per department. */
import { useState, useTransition } from "react";
import { deleteNotice, saveNotice, toggleNotice } from "@/app/(console)/settings/actions";
import { Dialog, btn } from "@/components/ui/dialog";
import { ActionForm, Field, input } from "@/components/ui/form";

export interface NoticeRow {
  id: string; version: number; departmentId: string | null; icon: string; title: string; detail: string;
  dailyAt: string | null; startsOn: string | null; endsOn: string | null; active: boolean;
}
type Dept = { id: string; name: string; emoji: string };

function NoticeForm({ n, depts }: { n?: NoticeRow; depts: Dept[] }) {
  return (
    <ActionForm action={saveNotice} submit={n ? "Save notice" : "Add notice"}>
      {n && <input type="hidden" name="id" value={n.id} />}
      {n && <input type="hidden" name="version" value={n.version} />}
      <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3">
        <Field label="Icon"><input name="icon" defaultValue={n?.icon ?? "📢"} className={`${input} text-center text-xl`} maxLength={4} /></Field>
        <Field label="Notice"><input name="title" defaultValue={n?.title} placeholder="Quality check" className={input} autoFocus required /></Field>
      </div>
      <Field label="Detail (optional)"><input name="detail" defaultValue={n?.detail} placeholder="Bay 1 · all Premold Prep parts" className={input} /></Field>
      <Field label="Which TVs">
        <select name="departmentId" defaultValue={n?.departmentId ?? ""} className={input}>
          <option value="">Every department</option>
          {depts.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
        </select>
      </Field>
      <Field label="Countdown to a time every working day (optional)" hint="E.g. 16:00 shows “Quality check · in 25 min” and disappears 10 minutes after.">
        <input type="time" name="dailyAt" defaultValue={n?.dailyAt ?? ""} className={`${input} font-mono`} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First day (optional)"><input type="date" name="startsOn" defaultValue={n?.startsOn ?? ""} className={`${input} font-mono`} /></Field>
        <Field label="Last day (optional)"><input type="date" name="endsOn" defaultValue={n?.endsOn ?? ""} className={`${input} font-mono`} /></Field>
      </div>
    </ActionForm>
  );
}

export function NoticesEditor({ rows, depts, canWrite }: { rows: NoticeRow[]; depts: Dept[]; canWrite: boolean }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string>();
  const deptOf = (id: string | null) => (id ? depts.find((d) => d.id === id) : null);
  return (
    <div className="grid gap-3">
      <p className="text-sm text-grey">Notices rotate in the header of the department TVs, every 8 seconds. Lunch is announced automatically from the working day.</p>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <ul className="grid gap-2">
        {rows.map((n) => {
          const d = deptOf(n.departmentId);
          return (
            <li key={n.id} className={`flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel2 px-3 py-2.5 ${n.active ? "" : "opacity-60"}`}>
              <span className="text-xl">{n.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="font-semibold">{n.title}{n.dailyAt && <span className="ml-2 font-mono text-sm font-normal text-gold">countdown to {n.dailyAt.slice(0, 5)}</span>}</div>
                <div className="truncate text-sm text-grey">{[n.detail, d ? `${d.emoji} ${d.name}` : "Every department", n.startsOn || n.endsOn ? `${n.startsOn ?? "…"} → ${n.endsOn ?? "…"}` : null].filter(Boolean).join(" · ")}</div>
              </div>
              {canWrite && (
                <div className="flex items-center gap-2">
                  <button className={btn.ghost} disabled={pending} onClick={() => start(async () => setError((await toggleNotice(n.id, n.version, !n.active)).error))}>{n.active ? "Turn off" : "Turn on"}</button>
                  <Dialog trigger="Edit" title="Edit notice"><NoticeForm n={n} depts={depts} /></Dialog>
                  <button className={btn.link} disabled={pending} onClick={() => start(async () => setError((await deleteNotice(n.id, n.version)).error))}>Delete</button>
                </div>
              )}
            </li>
          );
        })}
        {!rows.length && <li className="rounded-lg border border-dashed border-line2 p-4 text-sm text-grey">No notices yet. Add one, for example “Quality check” with a countdown to 16:00 for Modification.</li>}
      </ul>
      {canWrite && <div><Dialog trigger="Add notice" title="Add notice" triggerClass={btn.primary}><NoticeForm depts={depts} /></Dialog></div>}
    </div>
  );
}
