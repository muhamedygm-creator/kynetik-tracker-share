"use client";
/**
 * The parts table used for a CSV review and for typing parts in (amends AM-02, AM-03, AM-10): every cell is
 * editable, and a cell with a problem is outlined in red with the reason under its row. The caller runs
 * validatePartRows and passes the problems in, so the server's check and this one are the same code.
 */
import type { CsvColumn, PartRow, Problem } from "@/domain/parts-csv";
import { emptyRow } from "@/domain/parts-csv";

/** A row nobody has typed in yet: its "required" problems wait until something is entered. */
export const isBlank = (r: PartRow) => !r.serial.trim() && !r.part_name.trim() && !r.material.trim() && !r.finish_colour.trim() && !r.finish_sheen.trim();

const cell = "min-h-10 w-full min-w-0 rounded-md border bg-panel2 px-2 text-sm text-ink outline-none focus:border-gold";

export function PartsEditor({ rows, onChange, problems, materials, sheens }: {
  rows: PartRow[];
  onChange: (rows: PartRow[]) => void;
  problems: Problem[];
  materials: string[];
  sheens: string[];
}) {
  const at = (i: number, c: CsvColumn) => !isBlank(rows[i]) && problems.some((p) => p.row === i && p.column === c);
  const set = (i: number, c: CsvColumn, v: string) => onChange(rows.map((r, k) => (k === i ? { ...r, [c]: v } : r)));
  const remove = (i: number) => onChange(rows.filter((_, k) => k !== i));
  const tone = (i: number, c: CsvColumn) => `${cell} ${at(i, c) ? "border-bad" : "border-line2"}`;
  const listSelect = (i: number, c: CsvColumn, list: string[]) => {
    const v = rows[i][c];
    const known = list.some((x) => x.toLowerCase() === v.trim().toLowerCase());
    return (
      <select value={known ? list.find((x) => x.toLowerCase() === v.trim().toLowerCase()) : v} onChange={(e) => set(i, c, e.target.value)} className={tone(i, c)} aria-invalid={at(i, c)}>
        <option value="">Pick…</option>
        {!known && v && <option value={v}>{v} (not in the list)</option>}
        {list.map((x) => <option key={x} value={x}>{x}</option>)}
      </select>
    );
  };

  return (
    <div className="relative overflow-x-auto rounded-lg border border-line">
      <table className="w-full min-w-[980px] border-collapse text-sm">
        <thead className="bg-panel2 text-left">
          <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-mono [&>th]:text-[0.7rem] [&>th]:font-normal [&>th]:uppercase [&>th]:tracking-wider [&>th]:text-grey">
            <th className="w-10">#</th>
            <th className="w-36">Serial</th>
            <th className="min-w-56">Part name</th>
            <th className="w-20">Qty</th>
            <th className="w-40">Material</th>
            <th className="w-40">Finish colour</th>
            <th className="w-28">Sheen</th>
            <th className="w-14"><span className="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const mine = isBlank(r) ? [] : problems.filter((p) => p.row === i);
            return [
              <tr key={`r${i}`} className={`border-t border-line align-top [&>td]:px-2 [&>td]:py-1.5 ${mine.length ? "bg-bad/5" : ""}`}>
                <td className="pt-3 font-mono text-xs text-grey">{i + 1}</td>
                <td><input value={r.serial} onChange={(e) => set(i, "serial", e.target.value)} className={`${tone(i, "serial")} font-mono`} placeholder="12-02-101" aria-invalid={at(i, "serial")} aria-label={`Row ${i + 1} serial`} /></td>
                <td><input value={r.part_name} onChange={(e) => set(i, "part_name", e.target.value)} className={tone(i, "part_name")} aria-invalid={at(i, "part_name")} aria-label={`Row ${i + 1} part name`} /></td>
                <td><input value={r.quantity} onChange={(e) => set(i, "quantity", e.target.value)} inputMode="numeric" className={`${tone(i, "quantity")} font-mono`} aria-invalid={at(i, "quantity")} aria-label={`Row ${i + 1} quantity`} /></td>
                <td>{listSelect(i, "material", materials)}</td>
                <td>
                  <input value={r.finish_colour} onChange={(e) => set(i, "finish_colour", e.target.value)} list="finish-colours" className={tone(i, "finish_colour")} aria-invalid={at(i, "finish_colour")} aria-label={`Row ${i + 1} finish colour`} />
                </td>
                <td>{listSelect(i, "finish_sheen", sheens)}</td>
                <td className="whitespace-nowrap">
                  <button type="button" onClick={() => remove(i)} aria-label={`Remove row ${i + 1}`} className="min-h-10 rounded-md px-2 text-grey hover:bg-panel2 hover:text-bad">✕</button>
                </td>
              </tr>,
              mine.length > 0 && (
                <tr key={`p${i}`} className="bg-bad/5">
                  <td />
                  <td colSpan={7} className="px-2 pb-2">
                    <ul className="grid gap-0.5 text-xs text-bad">{mine.map((p, k) => <li key={k}>{p.message}</li>)}</ul>
                  </td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
      <datalist id="finish-colours"><option value="Exposed carbon" /></datalist>
      <div className="border-t border-line p-2">
        <button type="button" onClick={() => onChange([...rows, { ...emptyRow(), quantity: "1" }])} className="min-h-10 rounded-md px-3 text-sm text-gold hover:bg-panel2">+ Add a row</button>
      </div>
    </div>
  );
}
