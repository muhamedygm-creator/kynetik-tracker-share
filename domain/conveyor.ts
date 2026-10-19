/**
 * Conveyor timeline and TV banner (amends AM-16, AM-17; docs/ux/DECISIONS.md 2026-10-13).
 * The "now" line stays put a little after the names; the day slides right to left into it. Times here are
 * minutes on one shop-local clock (any epoch), so the TV, Task queue → Live and Timeline → By person share them.
 */
import type { ConveyorSettings, BannerSettings } from "./settings";

export interface ConveyorAxis {
  /** first and last minute shown */
  from: number;
  to: number;
  /** share (0–1) of the width where minute `m` sits, clamped to the window */
  at: (m: number) => number;
  /** whole hours inside the window */
  hours: number[];
}

/** The window: `pastMin` before now (past time leaving on the left), then `hours` ahead. */
export function conveyorAxis(nowMin: number, c: ConveyorSettings): ConveyorAxis {
  const from = nowMin - c.pastMin, to = nowMin + c.hours * 60;
  const span = to - from;
  const hours: number[] = [];
  for (let m = Math.ceil(from / 60) * 60; m <= to; m += 60) hours.push(m);
  return { from, to, at: (m) => Math.min(1, Math.max(0, (m - from) / span)), hours };
}

/** Where the now line sits, as a share of the width. It never moves. */
export const nowShare = (c: ConveyorSettings) => c.pastMin / (c.pastMin + c.hours * 60);

/**
 * Colour of a task at this moment (AM-16): green while within its allocated time, red once past it,
 * grey not started, blue waiting for QC, faded when done; blocked keeps its red outline.
 */
export type LiveTone = "ok" | "over" | "todo" | "qc" | "done" | "blocked";
export function liveTone(t: { status: "todo" | "doing" | "blocked" | "done"; qc: boolean }, nowMin: number, plannedEndMin: number | null): LiveTone {
  if (t.status === "done") return "done";
  if (t.qc) return "qc";
  if (t.status === "blocked") return "blocked";
  if (t.status === "doing") return plannedEndMin !== null && nowMin > plannedEndMin ? "over" : "ok";
  return "todo";
}

export type Banner =
  | { kind: "lunchSoon"; at: number }
  | { kind: "lunch"; until: number }
  | { kind: "backToIt" }
  | { kind: "wrapUp"; at: number }
  | { kind: "shiftEnds"; at: number }
  | { kind: "idle" };

/**
 * The banner's main message at `nowMin` (AM-17). Order through the day: countdown to the next break;
 * during a break a countdown to its end; for `backToItMins` after it "back to it"; from `wrapUpMins`
 * before the shift end a countdown to it. Between lunch and the wrap-up: when the shift ends.
 * Outside the shift (or on a day that isn't today) nothing.
 */
export function banner(nowMin: number, day: { start: number; end: number; breaks: [number, number][]; isToday: boolean }, b: BannerSettings): Banner {
  if (!day.isToday || nowMin >= day.end || nowMin < day.start - 60) return { kind: "idle" };
  const br = day.breaks.find(([a, z]) => nowMin >= a && nowMin < z);
  if (br) return { kind: "lunch", until: br[1] };
  if (nowMin >= day.end - b.wrapUpMins) return { kind: "wrapUp", at: day.end };
  if (day.breaks.some(([, z]) => nowMin >= z && nowMin < z + b.backToItMins)) return { kind: "backToIt" };
  const next = day.breaks.find(([a]) => a > nowMin);
  if (next) return { kind: "lunchSoon", at: next[0] };
  return { kind: "shiftEnds", at: day.end };
}

/**
 * Whether the rotating slot (quotes and department notices) takes the banner now: `quoteShowSec` of every
 * `quoteEverySec`, never during a break, "back to it" or the wrap-up, so the countdown keeps most of the time.
 */
export function quoteTurn(epochSec: number, main: Banner, b: BannerSettings): number | null {
  if (main.kind === "lunch" || main.kind === "backToIt" || main.kind === "wrapUp") return null;
  if (b.quoteEverySec <= 0 || b.quoteShowSec <= 0) return null;
  const cycle = Math.floor(epochSec / b.quoteEverySec);
  return epochSec % b.quoteEverySec >= b.quoteEverySec - b.quoteShowSec ? cycle : null;
}

/** "23 min", "1 h 05 min", "4:09" under ten minutes (a live seconds countdown). */
export function countdown(minLeft: number): string {
  const m = Math.max(0, minLeft);
  if (m < 10) {
    const s = Math.floor(m * 60);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  }
  const r = Math.ceil(m), h = Math.floor(r / 60);
  return h ? `${h} h ${String(r % 60).padStart(2, "0")} min` : `${r} min`;
}
