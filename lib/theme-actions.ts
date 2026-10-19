"use server";
/** Saves the person's theme choice to their profile (it follows them to other devices). */
import { requireViewer } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isTheme } from "@/lib/theme";

export async function saveTheme(theme: string): Promise<{ ok: boolean }> {
  if (!isTheme(theme)) return { ok: false };
  await requireViewer(["owner", "supervisor", "viewer", "modeller", "floor_station"]);
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_theme", { p_theme: theme });
  return { ok: !error };
}
