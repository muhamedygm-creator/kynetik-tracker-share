"use client";
/**
 * Parts tab of a project on the new workflow (amends AM-04, AM-10): parts with their sub-parts nested under
 * them, each with its progress through the stages. A folder's progress is its sub-parts' total, and it is
 * complete only when all of them are. Owner and Supervisors add, edit and delete parts here with the same
 * checks as the CSV route. Sub-parts are added by the modeller in My Models (AM-23), not here.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { addPanelParts, deletePanelPart, updatePanelPart } from "@/app/(console)/builds/parts-actions";
import { btn } from "@/components/ui/dialog";
import { Field, input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { emptyRow, type PartRow, type Problem } from "@/domain/parts-csv";
import { PartsEditor, isBlank } from "./parts-editor";
import { usePartChecks } from "./use-checks";

export interface TreePart {
  id: string;
  version: number;
  serial: string | null;
  name: string;
  description: string;
  material: string | null;
  finishColour: string | null;
  finishSheen: string | null;
  unitNo: number | null;
  folder: boolean;
  started: boolean;
  /** Where the part is now: the first stage not done, or "Complete". */
  at: string;
  done: number;
  total: number;
  children: TreePart[];
  /** Model data summary and render (amends AM-05), once the modeller has entered them. */
  model?: string | null;
  renderUrl?: string | null;
}

export function PartsTree({ projectId, projectSerial, parts, history = [], canWrite, materials, sheens }: {
  projectId: string; projectSerial: string; parts: TreePart[]; canWrite: boolean; materials: string[]; sheens: string[];
  /** Parts split after modelling (AM-23): no longer in the list, kept here as history. */
  history?: { serial: string; name: string; model: string | null; into: string[]; at: string }[];
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TreePart | null>(null);
  const count = parts.reduce((n, p) => n + (p.folder ? p.children.length : 1), 0);

  return (
    <div className="grid gap-3 [&>*]:min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-grey">{count} trackable {count === 1 ? "part" : "parts"}{parts.some((p) => p.folder) ? `, ${parts.filter((p) => p.folder).length} split into sub-parts` : ""}.</p>
        {canWrite && <button className={btn.primary} onClick={() => setAdding(true)}>+ Add parts</button>}
      </div>
      <div className="relative overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="bg-panel2 text-left">
            <tr className="[&>th]:px-3 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[0.7rem] [&>th]:font-normal [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-grey">
              <th className="w-44">Serial</th><th>Part</th><th>Material</th><th>Finish</th><th className="w-56">Progress</th><th className="w-40"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {parts.flatMap((p) => [
              <Row key={p.id} p={p} canWrite={canWrite} projectId={projectId} onEdit={setEditing} />,
              ...p.children.map((c) => <Row key={c.id} p={c} sub canWrite={canWrite} projectId={projectId} onEdit={setEditing} />),
            ])}
            {!parts.length && <tr><td colSpan={6} className="p-6 text-center text-grey">No parts yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {history.length > 0 && (
        <details className="rounded-xl border border-line bg-panel p-3">
          <summary className="cursor-pointer text-sm text-grey">Split after modelling ({history.length})</summary>
          <ul className="mt-2 grid gap-1.5 text-sm">
            {history.map((h) => (
              <li key={h.serial}>
                <span className="font-mono text-grey">{h.serial}</span> {h.name} became <span className="font-mono text-gold">{h.into.join(", ")}</span> on {h.at}.
                {h.model && <span className="block font-mono text-xs text-grey">Model data: {h.model}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <Modal xl open={adding} onClose={() => setAdding(false)} title={`Add parts to ${projectSerial}`}>
        {adding && <AddParts projectId={projectId} projectSerial={projectSerial} materials={materials} sheens={sheens} onDone={() => setAdding(false)} />}
      </Modal>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `${editing.serial ?? ""} ${editing.name}` : ""}>
        {editing && <EditPart p={editing} projectId={projectId} materials={materials} sheens={sheens} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function Row({ p, sub, canWrite, projectId, onEdit }: {
  p: TreePart; sub?: boolean; canWrite: boolean; projectId: string; onEdit: (p: TreePart) => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const pct = p.total ? p.done / p.total : 0;
  return (
    <tr className={`border-t border-line align-middle [&>td]:px-3 [&>td]:py-2 ${sub ? "bg-panel2/40" : ""}`}>
      <td className={`font-mono ${sub ? "pl-8 text-grey" : "text-gold"}`}>{sub && <span aria-hidden className="mr-1.5 text-line2">└</span>}{p.serial ?? "—"}</td>
      <td>
        <div className="font-semibold">{p.name}{p.folder && <span className="ml-2 rounded border border-line2 px-1.5 py-0.5 font-mono text-[0.65rem] font-normal text-grey">{p.children.length} sub-parts</span>}</div>
        {p.description && <div className="text-xs text-grey">{p.description}</div>}
        {p.model && <div className="font-mono text-xs text-grey">{p.model}{p.renderUrl && <> · <a href={p.renderUrl} target="_blank" rel="noreferrer" className="text-gold hover:underline">render</a></>}</div>}
        {error && <div role="alert" className="text-xs text-bad">{error}</div>}
      </td>
      <td>{p.material ?? "—"}</td>
      <td>{p.finishColour ?? "—"}{p.finishSheen ? <span className="text-grey"> · {p.finishSheen}</span> : null}</td>
      <td>
        <div className="flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line"><div className={`h-full ${pct === 1 ? "bg-ok" : "bg-gold"}`} style={{ width: `${pct * 100}%` }} /></div>
          <span className="font-mono text-xs text-grey">{p.done}/{p.total}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-grey">{p.at}</div>
      </td>
      <td className="whitespace-nowrap text-right">
        {canWrite && (
          <>
            <button className="min-h-10 rounded-md px-2 text-xs text-gold hover:bg-panel2" onClick={() => onEdit(p)}>Edit</button>
            {!p.started && (
              <button className="min-h-10 rounded-md px-2 text-xs text-grey hover:bg-panel2 hover:text-bad" disabled={pending} onClick={() => {
                if (!confirm(`Delete ${p.serial ?? ""} ${p.name}${p.folder ? " and its sub-parts" : ""}? The serial stays used and can't be given again.`)) return;
                start(async () => { const r = await deletePanelPart(p.id, projectId); if (r.error) setError(r.error); else router.refresh(); });
              }}>Delete</button>
            )}
          </>
        )}
      </td>
    </tr>
  );
}

function AddParts({ projectId, projectSerial, materials, sheens, onDone }: {
  projectId: string; projectSerial: string; materials: string[]; sheens: string[]; onDone: () => void;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<PartRow[]>(() => [{ ...emptyRow(), serial: `${projectSerial}-`, quantity: "1" }]);
  const [serverProblems, setServerProblems] = useState<Problem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const checks = usePartChecks(rows, { materials, sheens, projectSerial });
  const problems = serverProblems ?? checks.problems;
  return (
    <div className="grid gap-4">
      <PartsEditor rows={rows} onChange={(r) => { setRows(r); setServerProblems(null); setError(null); }} problems={problems} materials={materials} sheens={sheens} />
      <div className="flex items-center justify-end gap-3">
        {(error || problems.some((p) => !isBlank(rows[p.row] ?? emptyRow()))) && <span role="alert" className="text-sm text-bad">{error ?? `${problems.length} ${problems.length === 1 ? "problem" : "problems"} to fix.`}</span>}
        <button className={btn.ghost} onClick={onDone}>Cancel</button>
        <button className={btn.primary} disabled={pending || !!problems.length || !checks.checked || !rows.length} onClick={() => start(async () => {
          const r = await addPanelParts(projectId, rows);
          if (r.problems) setServerProblems(r.problems);
          if (r.error) { setError(r.error); return; }
          router.refresh(); onDone();
        })}>{pending ? "Saving…" : "Add parts"}</button>
      </div>
    </div>
  );
}

function EditPart({ p, projectId, materials, sheens, onDone }: { p: TreePart; projectId: string; materials: string[]; sheens: string[]; onDone: () => void }) {
  const router = useRouter();
  const [f, setF] = useState({ name: p.name, description: p.description, material: p.material ?? "", finishColour: p.finishColour ?? "", finishSheen: p.finishSheen ?? "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form className="grid gap-3" onSubmit={(e) => {
      e.preventDefault();
      start(async () => {
        const r = await updatePanelPart(p.id, p.version, projectId, f);
        if (r.error) { setError(r.error); return; }
        router.refresh(); onDone();
      });
    }}>
      <Field label="Serial" hint="A part's serial can't change, and it is never given to another part."><input value={p.serial ?? ""} disabled className={`${input} font-mono`} /></Field>
      <Field label="Part name"><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} required /></Field>
      <Field label="Description"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className={input} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Material">
          <select value={f.material} onChange={(e) => setF({ ...f, material: e.target.value })} className={input}>
            {materials.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Sheen">
          <select value={f.finishSheen} onChange={(e) => setF({ ...f, finishSheen: e.target.value })} className={input}>
            {sheens.map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Finish colour" hint="A paint colour (name or code) or Exposed carbon.">
        <input value={f.finishColour} onChange={(e) => setF({ ...f, finishColour: e.target.value })} list="finish-colours-edit" className={input} required />
        <datalist id="finish-colours-edit"><option value="Exposed carbon" /></datalist>
      </Field>
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" className={btn.ghost} onClick={onDone}>Cancel</button>
        <button className={btn.primary} disabled={pending}>{pending ? "Saving…" : "Save"}</button>
      </div>
    </form>
  );
}
