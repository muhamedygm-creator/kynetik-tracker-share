import "server-only";
import { UserError, type Ctx } from "./common";

/**
 * New workflow (amends AM-08): a part step's allocated time is the time an admin sets on its task-queue task.
 * It is kept on the step (work_items.plan_h) so standard vs actual, scoring and the data export use it.
 * Old projects keep their stage standards.
 */
export async function allocate(c: Ctx, workItemId: string | null | undefined, hours: number) {
  if (!workItemId) return;
  const b = c.world.builds.find((x) => x.project.work.some((w) => w.id === workItemId));
  if (!b?.project.gated) return;
  const w = b.project.work.find((x) => x.id === workItemId)!;
  if (w.planH !== null && Math.abs(w.planH - hours) < 1e-4) return;
  const { error } = await c.supabase.from("work_items").update({ plan_h: hours }).eq("id", workItemId);
  if (error) throw new UserError(error.message);
}
