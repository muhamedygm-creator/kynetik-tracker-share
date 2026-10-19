/**
 * Model data per part (AMENDS_NEXT_ROUND AM-05): entered by the modeller when the model is finished, all
 * required before the Modelling step can be submitted for QC. Stored on the part for future estimates (AM-13).
 */
import type { PartModel } from "./types";

export const MODEL_FIELDS = [
  { key: "lengthM", db: "length_m", label: "Length", unit: "m" },
  { key: "widthM", db: "width_m", label: "Width", unit: "m" },
  { key: "heightM", db: "height_m", label: "Height", unit: "m" },
  { key: "weightG", db: "weight_g", label: "Weight", unit: "g" },
  { key: "surfaceM2", db: "surface_m2", label: "Surface area", unit: "m²" },
  { key: "volumeM3", db: "volume_m3", label: "Volume", unit: "m³" },
] as const;
export type ModelKey = (typeof MODEL_FIELDS)[number]["key"];

/** A typed number: dot or comma decimals, nothing else. Empty → null. */
export function parseMeasure(v: string): number | null | "bad" {
  const t = v.trim().replace(",", ".");
  if (!t) return null;
  return /^\d*\.?\d+$/.test(t) && Number(t) > 0 ? Number(t) : "bad";
}

/** Problems with typed model data, per field (empty is allowed while saving a draft). */
export function modelProblems(input: Record<ModelKey, string>): Partial<Record<ModelKey, string>> {
  const out: Partial<Record<ModelKey, string>> = {};
  for (const f of MODEL_FIELDS) if (parseMeasure(input[f.key]) === "bad") out[f.key] = `${f.label} is a number above 0, in ${f.unit}.`;
  return out;
}

/** Every measurement and the render are in: the step can go to QC. */
export const modelComplete = (m: PartModel | null | undefined) =>
  !!m && MODEL_FIELDS.every((f) => m[f.key] !== null && m[f.key]! > 0) && !!m.renderPath;

/** "1.42 × 0.98 × 0.12 m · 2,450 g · 1.21 m² · 0.0124 m³" for lists. */
export function modelSummary(m: PartModel | null | undefined): string | null {
  if (!m || MODEL_FIELDS.every((f) => m[f.key] === null)) return null;
  const n = (x: number | null) => (x === null ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: 4 }));
  return `${n(m.lengthM)} × ${n(m.widthM)} × ${n(m.heightM)} m · ${n(m.weightG)} g · ${n(m.surfaceM2)} m² · ${n(m.volumeM3)} m³`;
}

/**
 * Sub-parts (AM-23): the serial of piece `i` (0-based) of a part: its serial + a letter (12-02-105-A,
 * 12-02-110-1-A for a unit). Given only when the model passes QC.
 */
export const subSerial = (serial: string, i: number) => `${serial}-${String.fromCharCode(65 + i)}`;

/** Default names for n pieces: "Front Bumper 1 of 3", "2 of 3" … (the modeller can rename them). */
export const defaultSubNames = (name: string, n: number) => Array.from({ length: n }, (_, i) => `${name} ${i + 1} of ${n}`);

/** Problems with a planned split: 2 to 26 pieces, each with a name. */
export function splitProblem(names: string[]): string | null {
  if (names.length === 1 || names.length > 26) return "Split into 2 to 26 sub-parts.";
  if (names.some((n) => !n.trim() || n.trim().length > 200)) return "Every sub-part needs a name (up to 200 characters).";
  return null;
}
