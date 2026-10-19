"use server";
/** Requests from the Floor Station (amends AM-15): Owner and Supervisors approve or reject, with a reply. */
import { parseDuration } from "@/domain/queue";
import { UserError, context, run, type ActionResult } from "@/lib/actions/common";

export async function decideRequest(id: string, approve: boolean, reply: string, extra: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const { data: r } = await c.supabase.from("requests").select("kind, work_item_id").eq("id", id).maybeSingle();
    if (!r) throw new UserError("That request no longer exists. Reload the page.");
    let extraH: number | null = null;
    if (r.kind === "extension" && approve) {
      extraH = parseDuration(extra);
      if (extraH === null || !(extraH > 0)) throw new UserError("Type the extra time, e.g. 30m, 1h or 1h 30m.");
    }
    const gated = !!r.work_item_id && c.world.builds.some((b) => b.project.gated && b.project.work.some((w) => w.id === r.work_item_id));
    if (r.kind === "qc" && !approve && gated && !reply.trim()) throw new UserError("Say what failed — it is the only way the rework history is useful.");
    const { error } = await c.supabase.rpc("decide_request", { p_request: id, p_approve: approve, p_reply: reply.trim(), p_extra_h: extraH });
    if (error) throw new Error(error.message);
    return { ok: approve ? "Approved." : "Not approved." };
  });
}
