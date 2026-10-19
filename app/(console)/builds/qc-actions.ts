"use server";
/**
 * Admin QC on the new workflow (amends AM-06, AM-07). Owner and Supervisors submit a finished step, approve it
 * (Done) or reject it with a reason (rework for the same technician), and set a part's mold components after
 * its pre-mold is approved. The rules live in the database functions (migration 20261012000300).
 */
import { partLabel } from "@/domain/parts";
import { nextSteps, stepName } from "@/domain/qc";
import { standardH } from "@/domain/work";
import { UserError, context, run, type ActionResult } from "@/lib/actions/common";

export async function submitQc(itemId: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const { error } = await c.supabase.rpc("submit_qc", { p_item: itemId });
    if (error) throw new Error(error.message);
    return { ok: "Submitted for QC." };
  });
}

export async function decideQc(itemId: string, approve: boolean, reason: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    if (!approve && !reason.trim()) throw new UserError("Say what failed — it is the only way the rework history is useful.");
    const { error } = await c.supabase.rpc("decide_qc", { p_item: itemId, p_approve: approve, p_reason: reason.trim() });
    if (error) throw new Error(error.message);
    return { ok: approve ? "Approved. The part moves on to the next stage." : "Sent back for rework to the same technician." };
  });
}

/** From the project board: pass (next stage) or fail (rework) a step In Progress or waiting for QC, in one go. */
export async function boardQc(itemId: string, pass: boolean, reason: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    if (!pass && !reason.trim()) throw new UserError("Say what failed — it is the only way the rework history is useful.");
    const { error } = await c.supabase.rpc("board_qc", { p_item: itemId, p_pass: pass, p_reason: reason.trim() });
    if (error) throw new Error(error.message);
    return { ok: pass ? "Passed QC. The part moves on to the next stage." : "Failed QC. Sent back for rework to the same technician." };
  });
}

export async function setMoldComponents(partId: string, n: number): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    if (!Number.isInteger(n) || n < 1 || n > 50) throw new UserError("Enter how many mold components: a whole number from 1 to 50.");
    const { error } = await c.supabase.rpc("set_mold_components", { p_part: partId, p_n: n });
    if (error) throw new Error(error.message);
    return { ok: `${n} mold ${n === 1 ? "component" : "components"} ready to assign.` };
  });
}

export interface NextStageOptions {
  title: string;
  dayHours: number;
  steps: { workItemId: string; label: string; stage: string; departmentKey: string; hours: number; tech: string | null }[];
  people: { id: string; name: string; departmentKey: string | null }[];
  departments: { key: string; name: string; emoji: string }[];
  /** The next stage is Mold production and its component count is still to be set. */
  mold: { partId: string; label: string } | null;
}

/** After an approval (Owner, 2026-10-15): the steps it opened, to plan straight onto the Task queue. */
export async function nextStageOptions(itemId: string): Promise<NextStageOptions | null> {
  const c = await context();
  const w = c.world;
  const b = w.builds.find((x) => x.project.work.some((y) => y.id === itemId));
  if (!b) return null;
  const p = b.project;
  const all = [...p.parts, ...(p.folders ?? [])];
  const label = (partId: string) => { const pa = all.find((x) => x.id === partId); return pa ? (pa.serial ? partLabel(pa) : pa.name) : "Part"; };
  const it = p.work.find((x) => x.id === itemId)!;
  const { steps, moldPartId } = nextSteps(p, itemId);
  const planned = new Set(w.queue.map((q) => q.workItemId).filter(Boolean));
  const deptKey = new Map(w.departments.map((d) => [d.id, d.key]));
  return {
    dayHours: w.cal.dayHours,
    title: `${label(it.partId)} · ${p.stages.find((s) => s.id === it.stageId)?.name ?? ""}`,
    steps: steps.filter((x) => !planned.has(x.id)).map((x) => {
      const st = p.stages.find((s) => s.id === x.stageId)!;
      return { workItemId: x.id, label: stepName(label(x.partId), x), stage: st.name, departmentKey: st.stationType,
        hours: x.planH ?? Math.max(0.5, standardH(x, st)), tech: x.tech };
    }),
    people: w.people.filter((x) => x.active).map((x) => ({ id: x.id, name: x.name, departmentKey: x.departmentId ? deptKey.get(x.departmentId) ?? null : null })),
    departments: w.departments.map((d) => ({ key: d.key, name: d.name, emoji: d.emoji })),
    mold: moldPartId ? { partId: moldPartId, label: label(moldPartId) } : null,
  };
}
