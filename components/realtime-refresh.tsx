"use client";
/**
 * Keeps console pages current: the database broadcasts "something changed" (no row data) on
 * `kynetik-changes`; we re-fetch the page through the user's own permissions. Debounced.
 */
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { createClient } from "@/lib/supabase/browser";

export function RealtimeRefresh() {
  const router = useRouter();
  useEffect(() => {
    const supabase = createClient();
    let t: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel("kynetik-changes", { config: { private: false } })
      .on("broadcast", { event: "changed" }, () => {
        clearTimeout(t);
        t = setTimeout(() => {
          // Don't yank a form away from someone typing in a dialog.
          if (!document.querySelector("dialog[open]")) router.refresh();
        }, 400);
      })
      .subscribe();
    return () => {
      clearTimeout(t);
      supabase.removeChannel(channel);
    };
  }, [router]);
  return null;
}
