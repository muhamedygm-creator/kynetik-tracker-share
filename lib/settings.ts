import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SETTINGS, SETTINGS_SCHEMAS, parseSection, type Settings, type SettingsKey } from "@/domain/settings";

/** Load all non-cost settings sections + holidays. Missing/invalid sections fall back to v1 defaults. */
export async function loadSettings(supabase: SupabaseClient): Promise<Settings> {
  const [{ data: rows }, { data: hols }] = await Promise.all([
    supabase.from("settings").select("key, value"),
    supabase.from("holidays").select("day").order("day"),
  ]);
  const out = { ...DEFAULT_SETTINGS } as Settings;
  for (const key of Object.keys(SETTINGS_SCHEMAS) as SettingsKey[]) {
    const row = rows?.find((r) => r.key === key);
    (out as unknown as Record<string, unknown>)[key] = parseSection(key, row?.value);
  }
  out.holidays = (hols ?? []).map((h) => h.day as string);
  return out;
}
