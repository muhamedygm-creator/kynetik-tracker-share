import { stepRows, type StepRow } from "@/domain/data";
import type { World } from "./world";

export type DataFilter = { project?: string; stage?: string; tech?: string; material?: string };

/** Rows after the page's filters (shared with the CSV export so both give the same rows). */
export function filteredRows(w: World, f: DataFilter): StepRow[] {
  return stepRows(w.builds.map((b) => b.project), w.people, w.cal, w.now)
    .filter((r) => (!f.project || r.projectId === f.project) && (!f.stage || r.stage === f.stage) && (!f.tech || r.technician === f.tech) && (!f.material || r.material === f.material));
}

