"use client";
/**
 * + New project (amends AM-02, AM-10): upload a CSV made from KYNETIK_PARTS_TEMPLATE.csv, or type the parts
 * in. Both land on the same review table; problems are highlighted and nothing is created until the admin
 * taps Create project with every problem fixed.
 */
import { useRef, useState, useTransition } from "react";
import { createPanelProject } from "@/app/(console)/builds/parts-actions";
import { btn } from "@/components/ui/dialog";
import { Field, input } from "@/components/ui/form";
import { emptyRow, expandParts, rowsFromCsv, toCsv, type PartRow, type Problem } from "@/domain/parts-csv";
import { MSG } from "@/domain/messages";
import { PartsEditor, isBlank } from "./parts-editor";
import { usePartChecks } from "./use-checks";

export function NewProject({ mode, today, materials, sheens, stages }: {
  mode: "csv" | "manual"; today: string; materials: string[]; sheens: string[]; stages: string[];
}) {
  const [rows, setRows] = useState<PartRow[] | null>(mode === "manual" ? [{ ...emptyRow(), quantity: "1" }] : null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", client: "internal", startDate: today, deliveryDate: "", notes: "" });
  const [serverProblems, setServerProblems] = useState<Problem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const checks = usePartChecks(rows ?? [], { materials, sheens });
  const problems = serverProblems ?? checks.problems;
  // Problems on rows nobody has typed in yet aren't shown or counted; Create stays off until those rows are filled or removed.
  const shown = problems.filter((p) => p.row < 0 || !rows?.[p.row] || !isBlank(rows[p.row]));
  const parts = rows && !problems.length ? expandParts(rows, { materials, sheens }) : [];
  const trackable = parts.length;

  const load = async (file: File | undefined) => {
    if (!file) return;
    setFileError(null);
    const r = rowsFromCsv(await file.text());
    if (!r.ok) { setFileError(r.error); return; }
    setRows(r.value); setFileName(file.name); setServerProblems(null); setError(null);
  };
  const edit = (next: PartRow[]) => { setRows(next); setServerProblems(null); setError(null); };

  const upload = (
    <>
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ""; }} />
      <button type="button" className={rows ? btn.ghost : btn.primary} onClick={() => fileRef.current?.click()}>{rows ? "Re-upload CSV" : "Choose CSV file"}</button>
    </>
  );

  if (!rows) {
    return (
      <div className="grid max-w-2xl gap-4 rounded-xl border border-line bg-panel p-6">
        <p>Upload the parts list as a CSV made from the template. Every row is shown for review before anything is created.</p>
        <div className="flex flex-wrap items-center gap-3">
          {upload}
          <a href="/templates/KYNETIK_PARTS_TEMPLATE.csv" download className={btn.link}>Download the template</a>
        </div>
        {fileError && <p role="alert" className="text-sm text-bad">{fileError}</p>}
      </div>
    );
  }

  const blocked = !!problems.length || !checks.checked || checks.projectTaken || pending;
  return (
    <div className="grid gap-5 [&>*]:min-w-0">
      <section className="grid gap-4 rounded-xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="label">Project serial</span>
          <span className="font-mono text-2xl text-gold">{checks.prefix ?? "—"}</span>
          <span className="text-sm text-grey">From the part serials (design and production number).</span>
        </div>
        {checks.projectTaken && <p role="alert" className="text-sm text-bad">{MSG.projectTaken(checks.prefix!)}</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={input} placeholder="e.g. GT body kit" /></Field>
          <Field label="Client"><input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} className={input} /></Field>
          <Field label="Start"><input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={`${input} font-mono`} /></Field>
          <Field label="Promised delivery"><input type="date" value={form.deliveryDate} onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })} className={`${input} font-mono`} /></Field>
        </div>
        <Field label="Notes"><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className={input} /></Field>
      </section>

      <section className="grid min-w-0 gap-3 [&>*]:min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="eyebrow">Parts{fileName ? ` · ${fileName}` : ""}</h2>
            <p className={`mt-1 text-sm ${shown.length ? "text-bad" : "text-grey"}`}>
              {shown.length
                ? `${shown.length} ${shown.length === 1 ? "problem" : "problems"} to fix. Edit the cells below or re-upload the file.`
                : problems.length ? "Fill in the parts, one row per part."
                : !checks.checked && checks.prefix ? "Checking serials…"
                : `${rows.length} ${rows.length === 1 ? "row" : "rows"}: ${trackable} trackable ${trackable === 1 ? "part" : "parts"}.`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {upload}
            <button type="button" className={btn.ghost} onClick={() => {
              const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv" }));
              const a = Object.assign(document.createElement("a"), { href: url, download: fileName ?? `${checks.prefix ?? "parts"}.csv` });
              a.click(); URL.revokeObjectURL(url);
            }}>Download as CSV</button>
          </div>
        </div>
        {fileError && <p role="alert" className="text-sm text-bad">{fileError}</p>}
        <PartsEditor rows={rows} onChange={edit} problems={problems} materials={materials} sheens={sheens} />
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
        <p className="max-w-[70ch] text-sm text-grey">
          Every trackable part starts in {stages[0]} and goes through {stages.length} stages: {stages.join(", ")}. If a part needs splitting, the modeller adds its sub-parts in My Models after modelling.
        </p>
        <div className="flex items-center gap-3">
          {error && <span role="alert" className="text-sm text-bad">{error}</span>}
          <button className={btn.primary} disabled={blocked} onClick={() => start(async () => {
            setError(null);
            const r = await createPanelProject({ ...form, rows });
            if (r?.problems) setServerProblems(r.problems);
            if (r?.error) setError(r.error);
          })}>{pending ? "Creating…" : "Create project"}</button>
        </div>
      </div>
    </div>
  );
}
