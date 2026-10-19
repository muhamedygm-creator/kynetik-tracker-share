"use client";
import { useState, useTransition } from "react";
import { deleteDepartment, saveDepartment } from "@/app/(console)/settings/actions";
import { btn } from "@/components/ui/dialog";
import { ActionForm, Field, input, type Result } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";

export interface DeptRow { id: string; version: number; name: string; colour: string; emoji: string; sort: number; members: number }

export function Departments({ rows, canWrite }: { rows: DeptRow[]; canWrite: boolean }) {
  const [edit, setEdit] = useState<DeptRow | "new" | null>(null);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const action = async (prev: Result, f: FormData) => { const r = await saveDepartment(prev, f); if (r.ok) setEdit(null); return r; };
  const d = edit === "new" ? null : edit;
  return (
    <>
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 rounded-md border border-line bg-panel2 px-3 py-2">
            <span className="h-4 w-4 rounded-full" style={{ background: r.colour }} />
            <span className="text-lg">{r.emoji}</span>
            <span className="flex-1">{r.name}</span>
            <span className="font-mono text-xs text-grey">{r.members} people</span>
            {canWrite && <button className={`${btn.link} text-xs`} onClick={() => setEdit(r)}>Edit</button>}
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      {canWrite && <div><button className={btn.ghost} onClick={() => setEdit("new")}>Add department</button></div>}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={d ? `Edit · ${d.name}` : "Add department"}>
        {edit && (
          <>
            <ActionForm key={d ? `${d.id}:${d.version}` : "new"} action={action} keepOpen>
              {d && <input type="hidden" name="id" value={d.id} />}
              {d && <input type="hidden" name="version" value={d.version} />}
              <Field label="Name"><input name="name" defaultValue={d?.name} className={input} autoFocus /></Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Emoji"><input name="emoji" defaultValue={d?.emoji} className={`${input} text-lg`} maxLength={16} /></Field>
                <Field label="Colour"><input type="color" name="colour" defaultValue={d?.colour ?? "#9A8FB0"} className="h-10 w-full rounded border border-line2 bg-panel2" /></Field>
                <Field label="Order"><input type="number" name="sort" defaultValue={d?.sort ?? rows.length} className={`${input} font-mono`} /></Field>
              </div>
            </ActionForm>
            {d && (
              <div className="mt-4 border-t border-line pt-3">
                <button className={btn.danger} disabled={pending} onClick={() => start(async () => {
                  const r = await deleteDepartment(d.id, d.version);
                  if (r.error) setError(r.error); else setEdit(null);
                })}>Delete department</button>
                <p className="mt-2 text-xs text-grey">Its {d.members} people become unassigned, and TVs set to it show nobody until changed.</p>
              </div>
            )}
          </>
        )}
      </Modal>
    </>
  );
}
