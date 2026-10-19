"use client";
/**
 * Theme button (2026-10-17): Light · Dark · System beside the user menu (and on the Floor Station). The choice
 * applies at once, is kept in this browser (cookie + localStorage, so the next page opens without a flash) and is
 * saved to the person's profile so it follows them to other devices. System follows the device and changes live.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { saveTheme } from "@/lib/theme-actions";
import { THEME_COOKIE, THEME_STORE, isTheme, type ThemeChoice } from "@/lib/theme";

const LABEL: Record<ThemeChoice, string> = { light: "Light", dark: "Dark", system: "System" };

function Icon({ k, className = "h-4 w-4" }: { k: ThemeChoice; className?: string }) {
  const p = { viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round" as const, className, "aria-hidden": true };
  if (k === "light") return <svg {...p}><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" /></svg>;
  if (k === "dark") return <svg {...p}><path d="M13.5 9.6A5.6 5.6 0 0 1 6.4 2.5a5.6 5.6 0 1 0 7.1 7.1Z" /></svg>;
  return <svg {...p}><rect x="1.8" y="2.5" width="12.4" height="8.5" rx="1.2" /><path d="M5.5 13.8h5M8 11v2.8" /></svg>;
}

const resolve = (t: ThemeChoice) => (t === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : t);
function apply(t: ThemeChoice) {
  document.documentElement.dataset.theme = resolve(t);
}
function remember(t: ThemeChoice) {
  document.cookie = `${THEME_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
  try { localStorage.setItem(THEME_STORE, t); } catch { /* storage unavailable */ }
}
function current(): ThemeChoice {
  const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(light|dark|system)`));
  let v: string | null = m?.[1] ?? null;
  try { v = v ?? localStorage.getItem(THEME_STORE); } catch { /* ignore */ }
  return isTheme(v) ? v : "dark";
}

export function ThemeButton({ saved, compact = false, down = false }: {
  /** The choice on the person's profile (from another device, or the default Dark). */
  saved: ThemeChoice;
  /** Icon only (icon rail, phone bar, Floor Station header). */
  compact?: boolean;
  /** Open the menu below the button (top-of-screen headers); otherwise above (the menu's foot). */
  down?: boolean;
}) {
  const [choice, setChoice] = useState<ThemeChoice>(saved);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The profile wins: a choice made on another device is applied here too.
  useEffect(() => {
    if (current() !== saved) { remember(saved); apply(saved); }
    setChoice(saved);
  }, [saved]);
  // System follows the device, live (e.g. at sunset).
  useEffect(() => {
    if (choice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: light)");
    const on = () => apply("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", out); document.addEventListener("touchstart", out); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", out); document.removeEventListener("touchstart", out); document.removeEventListener("keydown", esc); };
  }, [open]);

  const pick = useCallback((t: ThemeChoice) => {
    setChoice(t); remember(t); apply(t); setOpen(false);
    void saveTheme(t);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={`Theme: ${LABEL[choice]}`}
        className={`flex min-h-11 items-center gap-2 rounded-lg text-grey hover:bg-panel hover:text-ink ${compact ? "w-11 justify-center" : "w-full px-2 text-sm"}`}>
        <Icon k={choice} />{!compact && <span>Theme: {LABEL[choice]}</span>}
      </button>
      {open && (
        <div role="menu" aria-label="Theme" className={`absolute z-50 grid w-44 gap-0.5 rounded-[10px] border border-line2 bg-panel p-1.5 shadow-2xl ${down ? "right-0 top-full mt-2" : "bottom-full left-0 mb-2 max-md:bottom-auto max-md:left-auto max-md:right-0 max-md:top-full max-md:mb-0 max-md:mt-2"}`}>
          {(["light", "dark", "system"] as ThemeChoice[]).map((t) => (
            <button key={t} type="button" role="menuitemradio" aria-checked={choice === t} onClick={() => pick(t)}
              className={`flex min-h-10 items-center gap-2.5 rounded-md px-2.5 text-left text-sm ${choice === t ? "bg-gold/15 text-ink" : "text-grey hover:bg-panel2 hover:text-ink"}`}>
              <Icon k={t} /><span className="flex-1">{LABEL[t]}</span>{choice === t && <span aria-hidden className="text-gold">✓</span>}
            </button>
          ))}
          <p className="px-2.5 pb-1 pt-1 text-xs text-grey">System follows this device.</p>
        </div>
      )}
    </div>
  );
}
