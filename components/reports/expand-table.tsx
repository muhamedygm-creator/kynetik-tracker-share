"use client";
/** Reports (fix 2026-10-17): a table whose rows open to show their detail (a part's stages, a project's stages). */
import { Fragment, useEffect, useState, type ReactNode } from "react";

export type ExpandRow = { key: string; cells: ReactNode[]; detail: ReactNode };

export function ExpandTable({ head, rows, minWidth = 860 }: { head: string[]; rows: ExpandRow[]; minWidth?: number }) {
  const [open, setOpen] = useState<Set<string>>(() => new Set(rows.length === 1 ? [rows[0].key] : []));
  // A single result (one part picked) opens straight away.
  const only = rows.length === 1 ? rows[0].key : null;
  useEffect(() => { if (only) setOpen(new Set([only])); }, [only]);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const all = rows.length > 0 && open.size === rows.length;
  return (
    <div className="grid gap-2">
      <div className="flex justify-end">
        <button type="button" className="min-h-9 px-2 text-sm text-gold hover:underline" onClick={() => setOpen(all ? new Set() : new Set(rows.map((r) => r.key)))}>
          {all ? "Close all" : "Open all"}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ minWidth }}>
          <thead><tr className="label border-b border-line text-left"><th className="w-10 p-2" aria-label="Open" />{head.map((h) => <th key={h} className="p-2 font-normal">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.key}>
                <tr className={`cursor-pointer border-b border-line hover:bg-panel2 ${open.has(r.key) ? "bg-panel2" : ""}`} onClick={() => toggle(r.key)}>
                  <td className="p-2 align-top">
                    <button type="button" aria-expanded={open.has(r.key)} aria-label={open.has(r.key) ? "Close" : "Open"} className="grid h-7 w-7 place-items-center rounded text-gold"
                      onClick={(e) => { e.stopPropagation(); toggle(r.key); }}>{open.has(r.key) ? "▾" : "▸"}</button>
                  </td>
                  {r.cells.map((c, k) => <td key={k} className="p-2 align-top">{c}</td>)}
                </tr>
                {open.has(r.key) && <tr className="border-b border-line bg-panel2/40"><td /><td colSpan={head.length} className="p-2 pb-4">{r.detail}</td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
