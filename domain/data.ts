/**
 * Data for future planning and benchmarks (AMENDS_NEXT_ROUND AM-13): every part step with its allocated vs
 * actual time, first attempt vs rework, QC results and the part's material and model data, plus averages per
 * stage, technician and material. Stored as it happens; this only organises it for viewing and export.
 * Costs never appear here.
 */
import type { Calendar } from "./calendar";
import { firstAttemptH, reworkH, componentLabel } from "./qc";
import type { LocalDT } from "./time";
import type { Project } from "./types";
import { actualH, standardH } from "./work";

export interface StepRow {
  project: string;
  projectId: string;
  part: string;
  serial: string;
  material: string;
  finish: string;
  stage: string;
  component: string;
  technician: string;
  status: string;
  allocatedH: number | null;
  actualH: number;
  firstAttemptH: number;
  reworkH: number;
  /** times sent back (QC rejections and later reworks) */
  rejections: number;
  started: LocalDT | null;
  finished: LocalDT | null;
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
  weightG: number | null;
  surfaceM2: number | null;
  volumeM3: number | null;
  /** AM-24: print data (on the 3D printing step's part). */
  filamentG: number | null;
  printMin: number | null;
  printSlices: number | null;
}

/** One row per part step that has started, newest projects first, in stage order. */
export function stepRows(projects: Project[], people: { id: string; name: string }[], cal: Calendar, now: LocalDT): StepRow[] {
  const nameOf = (id: string | null) => (id ? people.find((p) => p.id === id)?.name ?? "" : "");
  return projects.flatMap((p) => {
    const order = new Map(p.stages.map((s, i) => [s.id, i]));
    return [...p.work]
      .filter((w) => w.start)
      .sort((a, b) => (order.get(a.stageId) ?? 0) - (order.get(b.stageId) ?? 0) || (a.componentNo ?? 0) - (b.componentNo ?? 0))
      .map((w) => {
        const st = p.stages.find((s) => s.id === w.stageId)!;
        const part = [...p.parts, ...(p.folders ?? [])].find((x) => x.id === w.partId);
        const m = part?.model;
        const std = standardH(w, st);
        return {
          project: p.serial, projectId: p.id, part: part?.name ?? "", serial: part?.serial ?? "", material: part?.material ?? "",
          finish: [part?.finishColour, part?.finishSheen].filter(Boolean).join(" · "), stage: st.name, component: componentLabel(w) ?? "",
          technician: nameOf(w.tech), status: w.qcSince ? "waiting for QC" : w.status,
          allocatedH: p.gated ? w.planH : std, actualH: actualH(w, cal, now), firstAttemptH: firstAttemptH(w, cal, now), reworkH: reworkH(w, cal, now),
          rejections: w.rework, started: w.start, finished: w.status === "done" ? w.end : null,
          lengthM: m?.lengthM ?? null, widthM: m?.widthM ?? null, heightM: m?.heightM ?? null, weightG: m?.weightG ?? null,
          surfaceM2: m?.surfaceM2 ?? null, volumeM3: m?.volumeM3 ?? null,
          filamentG: part?.print?.filamentG ?? null, printMin: part?.print?.minutes ?? null, printSlices: part?.print?.slices ?? null,
        };
      });
  });
}

export interface Summary { key: string; steps: number; finished: number; allocatedH: number; actualH: number; reworkH: number; rejections: number; avgActualH: number | null; varianceH: number | null }

/** Totals and averages of finished steps by one field (stage, technician, material, project). */
export function summarise(rows: StepRow[], by: (r: StepRow) => string): Summary[] {
  const m = new Map<string, StepRow[]>();
  for (const r of rows) { const k = by(r) || "—"; m.set(k, [...(m.get(k) ?? []), r]); }
  return [...m].map(([key, rs]) => {
    const done = rs.filter((r) => r.finished);
    const withAlloc = done.filter((r) => r.allocatedH !== null);
    const actual = done.reduce((s, r) => s + r.actualH, 0);
    return {
      key, steps: rs.length, finished: done.length,
      allocatedH: withAlloc.reduce((s, r) => s + r.allocatedH!, 0), actualH: actual,
      reworkH: rs.reduce((s, r) => s + r.reworkH, 0), rejections: rs.reduce((s, r) => s + r.rejections, 0),
      avgActualH: done.length ? actual / done.length : null,
      varianceH: withAlloc.length ? withAlloc.reduce((s, r) => s + r.actualH - r.allocatedH!, 0) / withAlloc.length : null,
    };
  }).sort((a, b) => b.steps - a.steps || a.key.localeCompare(b.key));
}

const COLUMNS: [keyof StepRow, string][] = [
  ["project", "project"], ["serial", "part_serial"], ["part", "part_name"], ["material", "material"], ["finish", "finish"],
  ["stage", "stage"], ["component", "mold_component"], ["technician", "technician"], ["status", "status"],
  ["allocatedH", "allocated_h"], ["actualH", "actual_h"], ["firstAttemptH", "first_attempt_h"], ["reworkH", "rework_h"],
  ["rejections", "times_sent_back"], ["started", "started"], ["finished", "finished"],
  ["lengthM", "length_m"], ["widthM", "width_m"], ["heightM", "height_m"], ["weightG", "weight_g"], ["surfaceM2", "surface_m2"], ["volumeM3", "volume_m3"],
  ["filamentG", "filament_g"], ["printMin", "print_min"], ["printSlices", "slice_components"],
];

/** The rows as CSV (hours to 2 decimals, times as shop-local YYYY-MM-DD HH:mm). */
export function stepsCsv(rows: StepRow[]): string {
  // Hours to 2 decimals; measurements as entered (a volume can be 0.0124 m³).
  const cell = (v: unknown, k: keyof StepRow) => {
    const s = v === null || v === undefined ? "" : typeof v === "number" ? String(k.endsWith("H") ? Math.round(v * 100) / 100 : v)
      : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(v)) ? String(v).replace("T", " ") : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [COLUMNS.map(([, h]) => h).join(","), ...rows.map((r) => COLUMNS.map(([k]) => cell(r[k], k)).join(","))].join("\n") + "\n";
}
