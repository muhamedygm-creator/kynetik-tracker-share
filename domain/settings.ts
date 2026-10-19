/**
 * Every value that v1 hard-coded, as typed settings with v1 defaults.
 * Stored in the DB (`settings` table, one row per section; cost in `settings_cost`).
 * Domain functions take these as parameters — never import a default inside a rule.
 */
import { z } from "zod";

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24h).");
const hex = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a #RRGGBB colour.");
const pct = z.number().min(0).max(1000);

export const minutesOf = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
};

// ───────────── calendar ─────────────
export const CalendarSettings = z
  .object({
    timezone: z.string().min(1),
    shiftStart: hhmm,
    shiftEnd: hhmm,
    breakStart: hhmm,
    breakMins: z.number().int().min(0).max(600),
    /** Weekdays with no work, 0 = Sunday … 6 = Saturday. More than one allowed. */
    restDays: z.array(z.number().int().min(0).max(6)).max(6),
  })
  .refine((c) => minutesOf(c.shiftEnd) > minutesOf(c.shiftStart), {
    message: "The shift has to end after it starts.",
    path: ["shiftEnd"],
  });
export type CalendarSettings = z.infer<typeof CalendarSettings>;

// ───────────── booking rules ─────────────
export const BookingSettings = z.object({
  /** stage: one stage at a time (batch parts allowed) · part: one part-step at a time */
  techMode: z.enum(["stage", "part"]),
  /** block: refuse the change · warn: allow it, warn, and list it under Attention (D7) */
  stationClash: z.enum(["block", "warn"]),
  personClash: z.enum(["block", "warn"]),
});
export type BookingSettings = z.infer<typeof BookingSettings>;

// ───────────── health & alerts ─────────────
export const ALERT_TYPES = [
  "forecastLate",
  "atRisk",
  "noParts",
  "taskBlocked",
  "partsBlocked",
  "overStandard",
  "unassigned",
  "partsDoneTasksOpen",
  "techDoubleBooked",
  "planClash",
] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export const HealthSettings = z.object({
  /** "At risk" when 0 ≤ float ≤ this many working days. */
  riskFloatDays: z.number().min(0).max(60),
  maxAlerts: z.number().int().min(1).max(200),
  alerts: z.record(z.enum(ALERT_TYPES), z.boolean()),
  boardOrder: z.array(z.enum(["late", "risk", "unset", "ok", "hold", "done"])).length(6),
});
export type HealthSettings = z.infer<typeof HealthSettings>;

// ───────────── scoring ─────────────
export const ScoringSettings = z.object({
  weights: z.object({ onTime: pct, ftr: pct, pace: pct }),
  paceCap: z.number().min(1).max(1000),
  /** Pace % used when the actual hours are 0. */
  paceWhenNoActual: z.number().min(0).max(1000),
  /** Score shows "—" below this many completed part-steps. */
  minDone: z.number().int().min(0).max(1000),
  bands: z.object({ green: pct, yellow: pct, amber: pct }),
  /** A part is on time when actual ≤ standard + this. */
  onTimeToleranceH: z.number().min(0).max(100),
  utilisationWarnPct: pct,
  /** 0 = all time */
  defaultPeriodDays: z.number().int().min(0),
  periodOptions: z.array(z.number().int().min(0)).min(1),
});
export type ScoringSettings = z.infer<typeof ScoringSettings>;

// ───────────── labels & colours ─────────────
const labelColour = z.object({ label: z.string().min(1), colour: hex });
export const LabelSettings = z.object({
  itemStatus: z.object({ todo: labelColour, doing: labelColour, blocked: labelColour, done: labelColour }),
  projectStatus: z.object({
    planned: z.object({ label: z.string().min(1) }),
    active: z.object({ label: z.string().min(1) }),
    hold: z.object({ label: z.string().min(1) }),
    done: z.object({ label: z.string().min(1) }),
  }),
  /** Colour for anything without a station type. */
  otherColour: hex,
  /** Fixed lists for serial-numbered parts (Owner, AMENDS_NEXT_ROUND AM-03). The database checks the same lists. */
  materials: z.array(z.string().min(1)).min(1),
  sheens: z.array(z.string().min(1)).min(1),
});
export type LabelSettings = z.infer<typeof LabelSettings>;

export const BrandSettings = z.object({
  appName: z.string().min(1),
  company: z.string().min(1),
  logoUrl: z.string().url().nullable(),
});
export type BrandSettings = z.infer<typeof BrandSettings>;

// ───────────── floor log ─────────────
export const FloorSettings = z.object({
  logStepH: z.number().positive().max(8),
  attendanceDefaultIn: z.boolean(),
});
export type FloorSettings = z.infer<typeof FloorSettings>;

// ───────────── timeline ─────────────
export const TimelineSettings = z.object({
  defaultZoom: z.enum(["hours", "day", "week", "month"]),
  pxPerDay: z.object({ hours: z.number().positive(), day: z.number().positive(), week: z.number().positive(), month: z.number().positive() }),
  defaultRows: z.enum(["tasks", "stages", "stations"]),
  /** Conveyor views (AM-16): hours ahead of the fixed now line, and minutes of past time still visible. */
  conveyor: z.object({ hours: z.number().min(1).max(24), pastMin: z.number().int().min(0).max(240) }),
});
export type TimelineSettings = z.infer<typeof TimelineSettings>;
export type ConveyorSettings = TimelineSettings["conveyor"];

// ───────────── gamification (employee display leaderboard) ─────────────
export const BADGE_KEYS = ["gold", "silver", "bronze", "streak", "sharpshooter", "speedster", "rocket", "climber", "warmingUp"] as const;
export type BadgeKey = (typeof BADGE_KEYS)[number];
export const GamificationSettings = z.object({
  badges: z.array(z.object({
    key: z.enum(BADGE_KEYS),
    emoji: z.string().min(1).max(16),
    name: z.string().min(1).max(40),
    on: z.boolean(),
    /** streak: days in a row · climber: minimum places gained */
    param: z.number().int().min(1).max(60).optional(),
  })),
  /** Rotating friendly lines for people outside the top 3. */
  warmingUp: z.array(z.string().min(1).max(120)),
  hideBottom: z.boolean(),
  /** 0 = show everyone */
  topN: z.number().int().min(0).max(50),
  confetti: z.boolean(),
  defaultPeriod: z.enum(["today", "week", "month", "7d"]),
  /** TV banner (AM-17): short quotes rotated in now and then; the countdown keeps most of the time. */
  quotes: z.array(z.string().min(1).max(140)),
  banner: z.object({
    quoteEverySec: z.number().int().min(0).max(3600),
    quoteShowSec: z.number().int().min(0).max(600),
    wrapUpMins: z.number().int().min(0).max(240),
    backToItMins: z.number().int().min(0).max(60),
  }),
});
export type GamificationSettings = z.infer<typeof GamificationSettings>;
export type BannerSettings = GamificationSettings["banner"];

// ───────────── cost (owner-only, separate table) ─────────────
export const CostSettings = z.object({
  currency: z.string().min(1).max(8),
  defaultLoadingPct: z.number().min(0).max(500),
  workingDaysPerMonth: z.number().positive().max(31),
});
export type CostSettings = z.infer<typeof CostSettings>;

export const SETTINGS_SCHEMAS = {
  calendar: CalendarSettings,
  booking: BookingSettings,
  health: HealthSettings,
  scoring: ScoringSettings,
  labels: LabelSettings,
  brand: BrandSettings,
  floor: FloorSettings,
  timeline: TimelineSettings,
  gamification: GamificationSettings,
} as const;
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;

export interface Settings {
  calendar: CalendarSettings;
  booking: BookingSettings;
  health: HealthSettings;
  scoring: ScoringSettings;
  labels: LabelSettings;
  brand: BrandSettings;
  floor: FloorSettings;
  timeline: TimelineSettings;
  gamification: GamificationSettings;
  /** Public holidays, YYYY-MM-DD, whole days off (D3). */
  holidays: string[];
}

/** v1 defaults (spec §5, §10, §11, §14, §16). */
export const DEFAULT_SETTINGS: Settings = {
  // D9 (2026-10-02): 09:00–18:00 with lunch 13:00–14:00 replaces v1's 08:00–17:00 everywhere.
  calendar: {
    timezone: "Asia/Dubai",
    shiftStart: "09:00",
    shiftEnd: "18:00",
    breakStart: "13:00",
    breakMins: 60,
    restDays: [0],
  },
  booking: { techMode: "stage", stationClash: "block", personClash: "block" },
  health: {
    riskFloatDays: 3,
    maxAlerts: 10,
    alerts: Object.fromEntries(ALERT_TYPES.map((t) => [t, true])) as Record<AlertType, boolean>,
    boardOrder: ["late", "risk", "unset", "ok", "hold", "done"],
  },
  scoring: {
    weights: { onTime: 40, ftr: 30, pace: 30 },
    paceCap: 120,
    paceWhenNoActual: 120,
    minDone: 3,
    bands: { green: 85, yellow: 70, amber: 55 },
    onTimeToleranceH: 0.01,
    utilisationWarnPct: 70,
    defaultPeriodDays: 30,
    periodOptions: [7, 30, 90, 0],
  },
  labels: {
    itemStatus: {
      todo: { label: "Not Started", colour: "#3A3A3A" },
      doing: { label: "In Progress", colour: "#E9BE5F" },
      blocked: { label: "Blocked", colour: "#C0483B" },
      done: { label: "Done", colour: "#5CA96F" },
    },
    projectStatus: {
      planned: { label: "Not started" },
      active: { label: "In build" },
      hold: { label: "On hold" },
      done: { label: "Delivered" },
    },
    otherColour: "#9A8FB0",
    materials: ["Carbon fiber", "Twill", "Forged carbon", "Fiberglass"],
    sheens: ["Matte", "Satin", "Gloss"],
  },
  brand: { appName: "BUILD TRACKER", company: "Kynetik Koncepts", logoUrl: null },
  floor: { logStepH: 0.5, attendanceDefaultIn: true },
  timeline: { defaultZoom: "week", pxPerDay: { hours: 72, day: 24, week: 8, month: 3 }, defaultRows: "tasks", conveyor: { hours: 5, pastMin: 0 } },
  gamification: {
    badges: [
      { key: "gold", emoji: "🥇", name: "1st place", on: true },
      { key: "silver", emoji: "🥈", name: "2nd place", on: true },
      { key: "bronze", emoji: "🥉", name: "3rd place", on: true },
      { key: "streak", emoji: "🔥", name: "On a streak", on: true, param: 3 },
      { key: "sharpshooter", emoji: "🎯", name: "Sharpshooter", on: true },
      { key: "speedster", emoji: "⚡", name: "Speedster", on: true },
      { key: "rocket", emoji: "🚀", name: "Most tasks this week", on: true },
      { key: "climber", emoji: "📈", name: "Climber", on: true, param: 1 },
      { key: "warmingUp", emoji: "🐢", name: "Warming up", on: true },
    ],
    warmingUp: [
      "The turtle won the race once… 👀",
      "Engines warming up. Big lap coming.",
      "Every podium starts with one finished part.",
      "Quiet now, loud later.",
      "Tomorrow's leaderboard has your name on it.",
    ],
    hideBottom: false,
    topN: 0,
    confetti: true,
    defaultPeriod: "7d",
    quotes: [
      "Measure twice, cut once.",
      "Clean work is fast work.",
      "Carbon doesn't lay itself. Let's go.",
      "Small wins, every hour.",
      "Done right beats done twice.",
      "The finish line likes a steady pace.",
    ],
    banner: { quoteEverySec: 60, quoteShowSec: 10, wrapUpMins: 30, backToItMins: 5 },
  },
  holidays: [],
};

export const DEFAULT_COST: CostSettings = { currency: "AED", defaultLoadingPct: 25, workingDaysPerMonth: 26 };

/** Phase 3.5 departments (matching the station types). Editable in Settings. */
export const DEFAULT_DEPARTMENTS = [
  { key: "modification", name: "Modification", colour: "#E9BE5F", emoji: "🔧" },
  { key: "fitment", name: "Strip & Fitment", colour: "#7FA8C9", emoji: "🔩" },
  { key: "paint", name: "Paint & Finish", colour: "#C58B5A", emoji: "🎨" },
  { key: "detailing", name: "Detailing", colour: "#7FB68C", emoji: "✨" },
] as const;

export const DEFAULT_STATION_TYPES = [
  { key: "modification", label: "Modification", colour: "#E9BE5F" },
  { key: "fitment", label: "Fitment", colour: "#7FA8C9" },
  { key: "paint", label: "Paint", colour: "#C58B5A" },
  { key: "detailing", label: "Detailing", colour: "#7FB68C" },
] as const;

/** D2: working hours in a day = shift length minus the part of the break that falls inside the shift. */
export function dayHours(c: Pick<CalendarSettings, "shiftStart" | "shiftEnd" | "breakStart" | "breakMins">): number {
  const s = minutesOf(c.shiftStart);
  const e = minutesOf(c.shiftEnd);
  const bs = minutesOf(c.breakStart);
  const be = bs + c.breakMins;
  const overlap = Math.max(0, Math.min(e, be) - Math.max(s, bs));
  return (e - s - overlap) / 60;
}

/** Parse a settings row from the DB, falling back to defaults for anything missing or invalid. */
export function parseSection<K extends SettingsKey>(key: K, value: unknown): Settings[K] {
  const merged = { ...(DEFAULT_SETTINGS[key] as object), ...((value as object) ?? {}) };
  const r = SETTINGS_SCHEMAS[key].safeParse(merged);
  return (r.success ? r.data : DEFAULT_SETTINGS[key]) as Settings[K];
}
