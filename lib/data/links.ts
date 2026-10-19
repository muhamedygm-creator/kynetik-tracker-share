import "server-only";
import { stepName } from "@/domain/qc";
import type { World } from "./world";

/** Labels for every link target ("001 · whole build", "001 · Prototyping", "001 · Prototyping · Bonnet"). */
export function linkLabels(w: World) {
  const m = new Map<string, string>();
  for (const b of w.builds) {
    const p = b.project;
    m.set(`p:${p.id}`, `${p.serial} · whole build`);
    for (const s of p.stages) m.set(`s:${s.id}`, `${p.serial} · ${s.name}`);
    for (const it of p.work) {
      m.set(it.id, `${p.serial} · ${p.stages.find((s) => s.id === it.stageId)?.name} · ${stepName(p.parts.find((x) => x.id === it.partId)?.name ?? "", it)}`);
    }
  }
  return m;
}

/** Grouped options for the queue task "link" select: open builds, their stages, and their unfinished part-steps. */
export function linkOptions(w: World) {
  const labels = linkLabels(w);
  return w.builds.filter((b) => b.project.status !== "done").map((b) => {
    const p = b.project;
    return {
      label: `${p.serial} ${p.name}`,
      options: [
        { value: `p:${p.id}`, label: labels.get(`p:${p.id}`)! },
        ...p.stages.map((s) => ({ value: `s:${s.id}`, label: labels.get(`s:${s.id}`)! })),
        ...p.work.filter((it) => it.status !== "done").map((it) => ({ value: it.id, label: labels.get(it.id)! })),
      ],
    };
  });
}
