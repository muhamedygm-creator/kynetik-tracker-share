"use server";
/**
 * 3D Printing (amends AM-24): a Modelling & 3D Printing user (or an admin) enters a print job's filament,
 * printing time and slice components, then asks for QC. The first save starts the job and, when nobody was on
 * it, assigns it to the person saving. The database checks who may (start_print_step, save_print_data,
 * submit_qc).
 */
import { PRINT_FIELDS, parsePrint, printProblems, type PrintKey } from "@/domain/print";
import { UserError, context, run, type ActionResult } from "@/lib/actions/common";

const ROLES = ["owner", "supervisor", "modeller"] as const;

function job(c: Awaited<ReturnType<typeof context>>, itemId: string) {
  for (const b of c.world.builds) {
    const w = b.project.work.find((x) => x.id === itemId);
    if (w) return w;
  }
  throw new UserError("That print job no longer exists. Reload the page.");
}

export async function savePrint(itemId: string, input: Record<PrintKey, string>): Promise<ActionResult> {
  return run(async () => {
    const c = await context([...ROLES]);
    const item = job(c, itemId);
    const bad = Object.values(printProblems(input));
    if (bad.length) throw new UserError(bad[0]!);
    if (item.status !== "doing" && item.status !== "done") {
      const { error } = await c.supabase.rpc("start_print_step", { p_item: itemId });
      if (error) throw new Error(error.message);
      // Previewing as a crew member: the untaken job is theirs, as it would be for a real Modelling & 3D Printing user.
      if (c.viewer.preview && !item.tech) {
        const { error: e2 } = await c.supabase.from("work_items").update({ tech_id: c.viewer.preview.personId }).eq("id", itemId).is("tech_id", null);
        if (e2) throw new Error(e2.message);
      }
    }
    const p = Object.fromEntries(PRINT_FIELDS.map((f) => [f.db, parsePrint(input[f.key], f.whole) ?? ""]));
    const { error } = await c.supabase.rpc("save_print_data", { p_item: itemId, p });
    if (error) throw new Error(error.message);
    return { ok: "Print data saved." };
  });
}

export async function submitPrint(itemId: string, notes = ""): Promise<ActionResult> {
  return run(async () => {
    const c = await context([...ROLES]);
    if (notes.length > 1000) throw new UserError("Keep the note under 1000 characters.");
    const { error } = await c.supabase.rpc("submit_qc", { p_item: itemId, p_notes: notes.trim() });
    if (error) throw new Error(error.message);
    // Owner previewing the role: it goes to Requests too, as a real Modelling & 3D Printing user's would.
    if (c.viewer.preview) {
      const { error: e2 } = await c.supabase.rpc("preview_qc_request", { p_item: itemId, p_notes: notes.trim() });
      if (e2) throw new Error(e2.message);
    }
    return { ok: "Sent for QC. It is on the QC and Requests pages for an admin to check." };
  });
}
