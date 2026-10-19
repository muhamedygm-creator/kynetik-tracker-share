"use server";
/**
 * Floor Station requests (amends AM-14): the shared workshop iPad asks for a time extension or a QC check on
 * an employee's task. The database function records it against the task's employee and checks the role.
 */
import { revalidatePath } from "next/cache";
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function sendRequest(queueTaskId: string, kind: "extension" | "qc", notes: string): Promise<{ ok?: string; error?: string }> {
  await requireViewer(["floor_station", "owner", "supervisor"]);
  if (kind !== "extension" && kind !== "qc") return { error: "Unknown request type." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("send_request", { p_queue_task: queueTaskId, p_kind: kind, p_notes: notes.slice(0, 1000) });
  if (error) return { error: error.message };
  revalidatePath("/station");
  return { ok: kind === "qc" ? "QC request sent." : "Time extension request sent." };
}
