/**
 * Print data per part (AMENDS_NEXT_ROUND AM-24): entered on the 3D Printing page for each print job, all
 * required before the 3D printing step can go to QC. The QC combines the sliced components into one printed
 * part. Stored on the part for future estimates (AM-13).
 */
import type { PartPrint } from "./types";

export const PRINT_FIELDS = [
  { key: "filamentG", db: "print_filament_g", label: "Filament", unit: "g", whole: false },
  { key: "minutes", db: "print_min", label: "Printing time", unit: "min", whole: false },
  { key: "slices", db: "print_slices", label: "Slice components", unit: "", whole: true },
] as const;
export type PrintKey = (typeof PRINT_FIELDS)[number]["key"];

/** A typed value: a number above 0 (dot or comma decimals), whole for the slice count. Empty → null. */
export function parsePrint(v: string, whole: boolean): number | null | "bad" {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  if (whole) return /^\d+$/.test(t) && Number(t) >= 1 ? Number(t) : "bad";
  return /^\d*\.?\d+$/.test(t) && Number(t) > 0 ? Number(t) : "bad";
}

/** Problems with typed print data, per field (empty is allowed while saving a draft). */
export function printProblems(input: Record<PrintKey, string>): Partial<Record<PrintKey, string>> {
  const out: Partial<Record<PrintKey, string>> = {};
  for (const f of PRINT_FIELDS) {
    if (parsePrint(input[f.key], f.whole) === "bad") out[f.key] = f.whole ? `${f.label} is a whole number, 1 or more.` : `${f.label} is a number above 0, in ${f.unit}.`;
  }
  return out;
}

/** All three values are in: the print step can go to QC. */
export const printComplete = (p: PartPrint | null | undefined) => !!p && p.filamentG !== null && p.minutes !== null && p.slices !== null;

/** "320 g · 540 min · 4 slices" for lists. */
export function printSummary(p: PartPrint | null | undefined): string | null {
  if (!p || (p.filamentG === null && p.minutes === null && p.slices === null)) return null;
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  return `${n(p.filamentG)} g · ${n(p.minutes)} min · ${n(p.slices)} ${p.slices === 1 ? "slice" : "slices"}`;
}
