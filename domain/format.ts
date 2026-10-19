/** Display formatting shared by messages, alerts and UI. Shop-local, English month names. */
import type { LocalDT, LocalDate } from "./time";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11-18" → "18 Nov" */
export function fmtDate(d: LocalDate | LocalDT): string {
  return `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
}

/** "2026-11-30T17:00" → "30 Nov 17:00" */
export function fmtDT(dt: LocalDT): string {
  return `${fmtDate(dt)} ${dt.slice(11, 16)}`;
}

/** Working hours: 24 → "24h", 2.5 → "2.5h", 33.333 → "33.3h". */
export function fmtH(h: number): string {
  const r = Math.round(h * 10) / 10;
  return `${Number.isInteger(r) ? r.toFixed(0) : r.toFixed(1)}h`;
}

/** Working time in hours and minutes: 2.5 → "2h 30m", 0.75 → "45m", 3 → "3h". */
/**
 * A duration for people (AM-28): "45 min", "2h 30m", and with the working hours of one day given, "1d 2h"
 * once it reaches a full day.
 */
export function fmtHM(h: number, dayH = 0): string {
  const m = Math.round(h * 60);
  const dayM = Math.round(dayH * 60);
  if (dayM > 0 && m >= dayM) {
    const d = Math.floor(m / dayM), rest = m - d * dayM;
    const hh = Math.floor(rest / 60), mm = rest % 60;
    return [`${d}d`, hh ? `${hh}h` : "", mm ? `${mm}m` : ""].filter(Boolean).join(" ");
  }
  const hh = Math.floor(m / 60), mm = m % 60;
  if (!hh) return `${mm} min`;
  return mm ? `${hh}h ${mm}m` : `${hh}h`;
}

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}
