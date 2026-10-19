/**
 * Parts and sub-parts (AMENDS_NEXT_ROUND AM-04). A part split into sub-parts is a folder: it has no stages
 * of its own, its progress is the total of its sub-parts, and it is complete only when all of them are.
 */
import type { Part, Project } from "./types";

export interface PartNode {
  part: Part;
  /** Sub-parts, for a folder; empty for a trackable part. */
  children: Part[];
  folder: boolean;
}

/** The parts list as a tree, folders and plain parts in their saved order, sub-parts under their folder. */
export function partTree(p: Pick<Project, "parts" | "folders">): PartNode[] {
  const folders = p.folders ?? [];
  const folderIds = new Set(folders.map((f) => f.id));
  const roots: PartNode[] = [];
  const seen = new Set<string>();
  // Keep the saved order: a folder takes the place of its first appearance among roots.
  const order = [...folders, ...p.parts].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  for (const x of order) {
    if (x.parentId && folderIds.has(x.parentId)) continue;
    if (seen.has(x.id)) continue;
    seen.add(x.id);
    const folder = folderIds.has(x.id);
    roots.push({ part: x, folder, children: folder ? p.parts.filter((c) => c.parentId === x.id).sort((a, b) => (a.serial ?? "").localeCompare(b.serial ?? "")) : [] });
  }
  return roots;
}

/** "12-02-105-A Front Bumper - Left Section", or just the name for parts without a serial. */
export const partLabel = (x: Pick<Part, "name" | "serial">) => (x.serial ? `${x.serial} ${x.name}` : x.name);

export interface PartProgress { done: number; total: number; pct: number; complete: boolean }

/** Stage steps done out of all steps, for a part or (summed over its sub-parts) a folder. */
export function partProgress(p: Pick<Project, "parts" | "work">, partId: string): PartProgress {
  const ids = new Set([partId, ...p.parts.filter((x) => x.parentId === partId).map((x) => x.id)]);
  const items = p.work.filter((w) => ids.has(w.partId));
  const done = items.filter((w) => w.status === "done").length;
  return { done, total: items.length, pct: items.length ? done / items.length : 0, complete: items.length > 0 && done === items.length };
}
