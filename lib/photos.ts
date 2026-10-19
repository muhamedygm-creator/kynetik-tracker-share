import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export const PHOTO_BUCKET = "people-photos";
export const PHOTO_MAX_BYTES = 1_048_576;

/** Short-lived signed URLs for employee photos; missing Storage or objects → null (initials placeholder). */
export async function photoUrls(db: SupabaseClient, paths: (string | null)[], seconds = 3600): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter(Boolean) as string[])];
  if (!list.length) return {};
  try {
    const { data } = await db.storage.from(PHOTO_BUCKET).createSignedUrls(list, seconds);
    return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
  } catch {
    return {};
  }
}

/** Up to two initials from words that start with a letter ("Ali (demo)" → "A", "Abu Bakr" → "AB"). */
export const initials = (name: string) =>
  name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";

/** Part renders (amends AM-05): private bucket, signed URLs like the photos. */
export const RENDER_BUCKET = "part-renders";
export async function renderUrls(db: SupabaseClient, paths: (string | null)[], seconds = 3600): Promise<Record<string, string>> {
  const list = [...new Set(paths.filter(Boolean) as string[])];
  if (!list.length) return {};
  try {
    const { data } = await db.storage.from(RENDER_BUCKET).createSignedUrls(list, seconds);
    return Object.fromEntries((data ?? []).filter((d) => d.signedUrl && d.path).map((d) => [d.path!, d.signedUrl as string]));
  } catch {
    return {};
  }
}
