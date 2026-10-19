"use server";
/**
 * Projects on the new workflow (amends 2026-10-12, AM-02/03/04/10): create one from a parts list (CSV or typed
 * in), add parts and sub-parts later, edit or delete a part. Every route runs the same checks
 * (domain/parts-csv.ts) on the server before anything is written.
 */
import { redirect } from "next/navigation";
import { z } from "zod";
import { MSG } from "@/domain/messages";
import { expandParts, projectSerialOf, validatePartRows, CSV_COLUMNS, type PartRow, type Problem } from "@/domain/parts-csv";
import { UserError, context, run, updateRow, type ActionResult, type Ctx } from "@/lib/actions/common";
import { findBuild } from "@/lib/data/world";

type Result = ActionResult & { problems?: Problem[] };

const Row = z.object(Object.fromEntries(CSV_COLUMNS.map((c) => [c, z.string().max(500)])) as Record<(typeof CSV_COLUMNS)[number], z.ZodString>);
const Rows = z.array(Row).max(2000);

/** Every serial already given in the tracker that starts with `prefix` (lower case), parts since deleted included. */
async function taken(c: Ctx, prefix: string): Promise<Set<string>> {
  const { data, error } = await c.supabase.from("serial_registry").select("serial").like("serial", `${prefix.toLowerCase()}%`);
  if (error) throw new Error(error.message);
  return new Set((data ?? []).map((x) => x.serial as string));
}

/** For the review screen: serials already used under a project serial, and whether the project serial is free. */
export async function takenSerials(prefix: string): Promise<{ serials: string[]; projectTaken: boolean }> {
  const c = await context();
  const p = prefix.trim().toUpperCase();
  if (!/^\d{2}-\d{2}$/.test(p)) return { serials: [], projectTaken: false };
  return {
    serials: [...(await taken(c, p))],
    projectTaken: c.world.builds.some((b) => b.project.serial.toUpperCase() === p),
  };
}

function check(c: Ctx, rows: PartRow[], used: Set<string>, projectSerial: string | null): Problem[] {
  return validatePartRows(rows, { taken: (s) => used.has(s.toLowerCase()), lists: c.world.settings.labels, projectSerial });
}

const ProjectForm = z.object({
  name: z.string().trim().max(200),
  client: z.string().trim().max(200),
  notes: z.string().trim().max(4000),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date."),
  deliveryDate: z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/),
});

/** New project from a checked parts list. Nothing is created while any row has a problem. */
export async function createPanelProject(input: z.input<typeof ProjectForm> & { rows: PartRow[] }): Promise<Result> {
  let id = "";
  const r = await run(async () => {
    const c = await context();
    const f = ProjectForm.safeParse(input);
    if (!f.success) throw new UserError(f.error.issues[0].message);
    const rows = Rows.parse(input.rows);
    const serial = projectSerialOf(rows);
    if (!serial) throw new UserError(MSG.serialFormat);
    if (c.world.builds.some((b) => b.project.serial.toUpperCase() === serial)) throw new UserError(MSG.projectTaken(serial));
    const problems = check(c, rows, await taken(c, serial), serial);
    if (problems.length) return { error: `${problems.length} ${problems.length === 1 ? "problem" : "problems"} to fix first.`, problems };

    const { data, error } = await c.supabase.rpc("create_panel_project", {
      p: {
        serial, name: f.data.name, client: f.data.client, notes: f.data.notes, start_date: f.data.startDate, delivery_date: f.data.deliveryDate,
        parts: expandParts(rows, c.world.settings.labels).map(toDb),
      },
    });
    if (error) throw new Error(error.message);
    id = data as string;
    return { ok: "Project created.", id };
  });
  if (id) redirect(`/builds/${id}?tab=parts`);
  return r;
}

/** Add parts to a project (original parts only; sub-parts come from My Models, AM-23). */
export async function addPanelParts(projectId: string, input: PartRow[]): Promise<Result> {
  return run(async () => {
    const c = await context();
    const b = findBuild(c.world, projectId);
    if (!b) throw new UserError("That project no longer exists. Reload the page.");
    if (!b.project.gated) throw new UserError("This project uses the old parts list. Edit it with Parts list.");
    const rows = Rows.parse(input);
    const used = await taken(c, b.project.serial);
    const lists = c.world.settings.labels;
    const problems = validatePartRows(rows, { taken: (s: string) => used.has(s.toLowerCase()), lists, projectSerial: b.project.serial });
    if (problems.length) return { error: `${problems.length} ${problems.length === 1 ? "problem" : "problems"} to fix first.`, problems };
    const drafts = expandParts(rows, lists);
    const { error } = await c.supabase.rpc("add_panel_parts", { p_project: projectId, p_parts: drafts.map((d) => ({ ...toDb(d), sort: null, parent_id: null })) });
    if (error) throw new Error(error.message);
    return { ok: drafts.length === 1 ? "Part added." : `${drafts.length} parts added.` };
  });
}

const PartEdit = z.object({
  name: z.string().trim().min(1, MSG.partRequired("Part name")).max(200),
  description: z.string().trim().max(2000),
  material: z.string(),
  finishColour: z.string().trim().min(1, MSG.partRequired("Finish colour")).max(200),
  finishSheen: z.string(),
});

/** Edit a part's name, description, material or finish (the serial stays: serials are the part's identity). */
export async function updatePanelPart(id: string, version: number, projectId: string, input: z.input<typeof PartEdit>): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = findBuild(c.world, projectId);
    if (!b) throw new UserError("That project no longer exists. Reload the page.");
    const f = PartEdit.safeParse(input);
    if (!f.success) throw new UserError(f.error.issues[0].message);
    const { materials, sheens } = c.world.settings.labels;
    const material = materials.find((m) => m.toLowerCase() === f.data.material.trim().toLowerCase());
    const sheen = sheens.find((m) => m.toLowerCase() === f.data.finishSheen.trim().toLowerCase());
    if (!material) throw new UserError(MSG.oneOf("Material", materials));
    if (!sheen) throw new UserError(MSG.oneOf("Sheen", sheens));
    await updateRow(c.supabase, "parts", id, version, {
      name: f.data.name, description: f.data.description, material, finish_colour: f.data.finishColour, finish_sheen: sheen,
    });
    return { ok: "Part saved." };
  });
}

/** Delete a part (a folder takes its sub-parts with it). Refused once work has started; its serial stays used. */
export async function deletePanelPart(id: string, projectId: string): Promise<ActionResult> {
  return run(async () => {
    const c = await context();
    const b = findBuild(c.world, projectId);
    if (!b) throw new UserError("That project no longer exists. Reload the page.");
    const ids = new Set([id, ...b.project.parts.filter((x) => x.parentId === id).map((x) => x.id)]);
    if (b.project.work.some((w) => ids.has(w.partId) && w.status !== "todo")) {
      throw new UserError("Work has started on this part, so it can't be deleted. Its history stays with the project.");
    }
    const { error } = await c.supabase.from("parts").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: "Part deleted. Its serial stays used." };
  });
}

const toDb = (d: ReturnType<typeof expandParts>[number]) => ({
  key: d.key, parent_key: d.parentKey, serial: d.serial, name: d.name, description: d.description, material: d.material,
  finish_colour: d.finishColour, finish_sheen: d.finishSheen, unit_no: d.unitNo, sort: d.sort,
});
