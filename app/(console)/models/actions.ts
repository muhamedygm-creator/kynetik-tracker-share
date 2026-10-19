"use server";
/**
 * My models (amends AM-05; DECISIONS 2026-10-14): the modeller on a Modelling step (or an admin) enters the model
 * data and the render, then asks for QC. There is no Start button: the first save or upload starts the step's
 * clock. The database checks that it is their own step (save_model_data, start_model_step, submit_qc), and a
 * Modeller's QC ask also shows on Requests.
 */
import { MODEL_FIELDS, modelProblems, parseMeasure, splitProblem, type ModelKey } from "@/domain/model";
import { UserError, context, run, type ActionResult } from "@/lib/actions/common";

const RENDER_BUCKET = "part-renders";
const RENDER_MAX_BYTES = 3_145_728;
const ROLES = ["owner", "supervisor", "modeller"] as const;

/** The first save or upload on a step not started yet starts it (status In Progress, clock running). */
async function startIfNeeded(c: Awaited<ReturnType<typeof context>>, itemId: string, status: string) {
  if (status === "doing" || status === "done") return;
  const { error } = await c.supabase.rpc("start_model_step", { p_item: itemId });
  if (error) throw new Error(error.message);
}

function stepPart(c: Awaited<ReturnType<typeof context>>, itemId: string) {
  for (const b of c.world.builds) {
    const w = b.project.work.find((x) => x.id === itemId);
    if (w) return { project: b.project, item: w, part: [...b.project.parts, ...(b.project.folders ?? [])].find((p) => p.id === w.partId)! };
  }
  throw new UserError("That step no longer exists. Reload the page.");
}

export async function saveModel(itemId: string, input: Record<ModelKey, string>): Promise<ActionResult> {
  return run(async () => {
    const c = await context([...ROLES]);
    const { item } = stepPart(c, itemId);
    const bad = Object.values(modelProblems(input));
    if (bad.length) throw new UserError(bad[0]!);
    await startIfNeeded(c, itemId, item.status);
    const p = Object.fromEntries(MODEL_FIELDS.map((f) => [f.db, parseMeasure(input[f.key]) ?? ""]));
    const { error } = await c.supabase.rpc("save_model_data", { p_item: itemId, p });
    if (error) throw new Error(error.message);
    return { ok: "Model data saved." };
  });
}

/** The render, resized in the browser to a JPEG (≤ 3 MB) → private Storage bucket, then linked to the part. */
export async function uploadRender(itemId: string, form: FormData): Promise<ActionResult> {
  return run(async () => {
    const c = await context([...ROLES]);
    const { part, item } = stepPart(c, itemId);
    const file = form.get("render");
    if (!(file instanceof File) || !file.size) throw new UserError("Choose the render image.");
    if (file.size > RENDER_MAX_BYTES) throw new UserError("That image is over 3 MB after resizing. Try a smaller one.");
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new UserError("Use a JPEG, PNG or WebP image.");
    const path = `${part.id}/${Date.now()}.jpg`;
    const { error: up } = await c.supabase.storage.from(RENDER_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
    if (up) throw new UserError(`Render upload failed: ${up.message}`);
    await startIfNeeded(c, itemId, item.status);
    const { error } = await c.supabase.rpc("save_model_data", { p_item: itemId, p: { render_path: path } });
    if (error) throw new Error(error.message);
    return { ok: "Render saved." };
  });
}

/** Plan the part's sub-parts (AM-23), or clear the plan with an empty list. Applied when QC approves the model. */
export async function saveSplit(itemId: string, names: string[]): Promise<ActionResult> {
  return run(async () => {
    const c = await context([...ROLES]);
    const { item } = stepPart(c, itemId);
    const clean = names.map((n) => n.trim());
    const bad = splitProblem(clean);
    if (bad) throw new UserError(bad);
    await startIfNeeded(c, itemId, item.status);
    const { error } = await c.supabase.rpc("save_split", { p_item: itemId, p_names: clean });
    if (error) throw new Error(error.message);
    return { ok: clean.length ? `Split into ${clean.length} sub-parts. They are created when QC approves the model.` : "Split removed." };
  });
}

export async function submitModel(itemId: string, notes = ""): Promise<ActionResult> {
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
