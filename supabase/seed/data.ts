/**
 * Live data snapshot from the v1 spec §17 (2026-10-01), transcribed literally.
 * `generate.ts` turns this into supabase/seed.sql. Phase 2 domain tests use it as fixtures,
 * so the v1 planned schedules double as a check on the calendar engine.
 * Datetimes are shop-local (Asia/Dubai) wall-clock, "YYYY-MM-DDTHH:mm".
 */

export const workstations = [
  { id: "ws1", name: "Modification 1", type: "modification" },
  { id: "ws2", name: "Modification 2", type: "modification" },
  { id: "ws3", name: "Strip & Fitment 1", type: "fitment" },
  { id: "ws4", name: "Strip & Fitment 2", type: "fitment" },
  { id: "ws5", name: "Paint, Finish & Sanding", type: "paint" },
  { id: "ws6", name: "Detailing & Wash", type: "detailing" },
] as const;

/** §17.3 — all active, production, crew unset, salary 0, loading 25. */
export const crew = [
  "Ahmad", "Francis", "Hamid", "Hamza", "Jazeel", "Nino",
  "Norlen", "Saeed", "Shahid", "Tai", "Toto", "Yan",
].map((name) => ({ id: `per-${name.toLowerCase()}`, name, baseSalary: 0, loadingPct: 25 }));

export const DEFAULT_PARTS = [
  "Left Front Fender", "Right Front Fender", "Bonnet", "Front Bumper", "Left Door", "Right Door",
  "Left Rear Fender", "Right Rear Fender", "Left Side Skirt", "Right Side Skirt", "Rear Engine Cover", "Rear Bumper",
];

export interface TemplateSeed {
  key: string;
  label: string;
  stages: { name: string; stationType: string; partHours: number; tasks: { name: string; durH: number }[] }[];
  parts: string[];
}

export const templates: TemplateSeed[] = [
  {
    key: "buggyBuild",
    label: "Buggy build",
    parts: DEFAULT_PARTS,
    stages: [
      { name: "Prototyping", stationType: "modification", partHours: 16, tasks: [
        { name: "Concept & design review", durH: 40 },
        { name: "Build / refine prototype", durH: 80 },
      ] },
      { name: "Prepare Premold", stationType: "modification", partHours: 8, tasks: [
        { name: "Surface finish prototype (plug)", durH: 40 },
        { name: "Apply mold release / tooling gelcoat", durH: 16 },
      ] },
      { name: "Make Mold", stationType: "modification", partHours: 16, tasks: [
        { name: "Mold layup", durH: 24 },
        { name: "Mold cure", durH: 16 },
        { name: "Demold & mold QC / repair", durH: 24 },
      ] },
      { name: "Make Parts from Mold", stationType: "modification", partHours: 16, tasks: [
        { name: "Parts layup", durH: 32 },
        { name: "Parts cure", durH: 16 },
        { name: "Demold & trim parts", durH: 24 },
      ] },
      { name: "Painting & Finishing", stationType: "paint", partHours: 16, tasks: [
        { name: "Sanding & surface prep", durH: 32 },
        { name: "Primer", durH: 16 },
        { name: "Paint / color coat", durH: 16 },
        { name: "Clear coat & polish", durH: 24 },
      ] },
      { name: "Assembly", stationType: "fitment", partHours: 8, tasks: [
        { name: "Fit-check parts", durH: 24 },
        { name: "Final assembly", durH: 40 },
        { name: "Quality check", durH: 16 },
        { name: "Release / handover", durH: 8 },
      ] },
    ],
  },
  {
    key: "exteriorParts",
    label: "Exterior parts programme",
    parts: DEFAULT_PARTS,
    stages: [
      { name: "Premold Prep", stationType: "modification", partHours: 8, tasks: [{ name: "Plug prep across all parts", durH: 48 }] },
      { name: "Make Mold", stationType: "modification", partHours: 16, tasks: [{ name: "Mold layup & cure", durH: 64 }] },
      { name: "Make Parts from Mold", stationType: "modification", partHours: 16, tasks: [{ name: "Parts layup, cure & trim", durH: 80 }] },
      { name: "Painting & Finishing", stationType: "paint", partHours: 16, tasks: [{ name: "Prep, primer, colour, clear", durH: 64 }] },
      { name: "Assembly", stationType: "fitment", partHours: 8, tasks: [{ name: "Fit-check & install", durH: 40 }] },
    ],
  },
  {
    // §17.4 legacy `clientCar` (only existed inside project 01) — recreated as a real template (§18-4).
    // v1 has no default parts for it (project 01 has no parts list), so none are invented here.
    key: "clientCar",
    label: "Client car",
    parts: [],
    stages: [
      { name: "Carbon panel production", stationType: "modification", partHours: 16, tasks: [{ name: "Carbon panel production", durH: 96 }] },
      { name: "Strip & fitment", stationType: "fitment", partHours: 16, tasks: [{ name: "Strip & fitment", durH: 192 }] },
      { name: "Paint & finish", stationType: "paint", partHours: 16, tasks: [{ name: "Paint & finish", durH: 96 }] },
      { name: "Detailing & handover", stationType: "detailing", partHours: 8, tasks: [{ name: "Detailing & handover", durH: 16 }] },
    ],
  },
];

export interface TaskSeed {
  start: string; // planned
  end: string;
  status?: "todo" | "doing" | "blocked" | "done";
  pct?: number;
  actualStart?: string;
  actualEnd?: string;
}

export interface WorkSeed {
  stage: string;
  part: string;
  tech: string; // person name
  status: "todo" | "doing" | "blocked" | "done";
  start?: string;
  end?: string;
}

export interface ProjectSeed {
  id: string;
  serial: string;
  name: string;
  template: string;
  status: "planned" | "active" | "hold" | "done";
  startDate: string;
  deliveryDate: string | null;
  planEnd: string;
  client: string;
  notes: string;
  /** workstation legacy id per stage, in stage order (null = none assigned) */
  stations: (string | null)[];
  hasParts: boolean;
  /** task plan in template order */
  tasks: TaskSeed[];
  work: WorkSeed[];
  createdAt?: string; // UTC ISO
}

const d = (md: string, t: string) => `2026-${md}T${t}`;
/** Whole-day task window "MM-DD → MM-DD", 08:00 → 17:00 (every v1 task fills whole shifts). */
const day = (from: string, to: string, extra: Partial<TaskSeed> = {}): TaskSeed => ({
  start: d(from, "08:00"),
  end: d(to, "17:00"),
  ...extra,
});

const BUGGY_FROM_0921: TaskSeed[] = [
  day("09-21", "09-25"), day("09-26", "10-07"), day("10-08", "10-13"), day("10-14", "10-15"),
  day("10-16", "10-19"), day("10-20", "10-21"), day("10-22", "10-24"), day("10-26", "10-29"),
  day("10-30", "10-31"), day("11-02", "11-04"), day("11-05", "11-09"), day("11-10", "11-11"),
  day("11-12", "11-13"), day("11-14", "11-17"), day("11-18", "11-20"), day("11-21", "11-26"),
  day("11-27", "11-28"), day("11-30", "11-30"),
];

const BUGGY_FROM_1005: TaskSeed[] = [
  day("10-05", "10-09"), day("10-10", "10-21"), day("10-22", "10-27"), day("10-28", "10-29"),
  day("10-30", "11-02"), day("11-03", "11-04"), day("11-05", "11-07"), day("11-09", "11-12"),
  day("11-13", "11-14"), day("11-16", "11-18"), day("11-19", "11-23"), day("11-24", "11-25"),
  day("11-26", "11-27"), day("11-28", "12-01"), day("12-02", "12-04"), day("12-05", "12-10"),
  day("12-11", "12-12"), day("12-14", "12-14"),
];

const IMPORTED = "Imported from the buggy build tracker workbook. Durations are defaults — adjust them.";

export const projects: ProjectSeed[] = [
  {
    id: "001", serial: "001", name: "lambo_buggy", template: "buggyBuild", status: "active",
    startDate: "2026-09-21", deliveryDate: "2026-11-18", planEnd: d("11-30", "17:00"), client: "internal", notes: "",
    stations: ["ws1", "ws1", "ws1", "ws1", "ws5", "ws3"], hasParts: true,
    tasks: BUGGY_FROM_0921,
    work: [
      { stage: "Prototyping", part: "Left Front Fender", tech: "Francis", status: "done", start: d("09-23", "08:00"), end: d("09-23", "14:59") },
      { stage: "Prototyping", part: "Right Front Fender", tech: "Toto", status: "done", start: d("09-23", "08:00"), end: d("09-23", "14:59") },
      { stage: "Prototyping", part: "Bonnet", tech: "Toto", status: "todo" },
    ],
  },
  {
    id: "EXT-001", serial: "EXT-001", name: "Exterior Parts", template: "exteriorParts", status: "active",
    startDate: "2026-09-21", deliveryDate: null, planEnd: d("11-02", "17:00"), client: "internal", notes: IMPORTED,
    stations: [null, null, null, null, null], hasParts: true,
    tasks: [
      day("09-21", "09-26", { status: "done", pct: 100, actualStart: d("09-21", "08:00"), actualEnd: d("09-21", "17:00") }),
      day("09-28", "10-06", { status: "doing", pct: 10, actualStart: d("09-21", "08:00") }),
      day("10-07", "10-17"), day("10-19", "10-27"), day("10-28", "11-02"),
    ],
    work: [
      { stage: "Premold Prep", part: "Rear Bumper", tech: "Francis", status: "doing", start: d("09-21", "08:00") },
      { stage: "Premold Prep", part: "Rear Engine Cover", tech: "Norlen", status: "doing", start: d("09-21", "08:00") },
      { stage: "Premold Prep", part: "Left Side Skirt", tech: "Toto", status: "doing", start: d("09-21", "08:00") },
      { stage: "Premold Prep", part: "Right Side Skirt", tech: "Toto", status: "doing", start: d("09-21", "08:00") },
      { stage: "Assembly", part: "Rear Bumper", tech: "Yan", status: "done", start: d("09-29", "10:27"), end: d("10-01", "08:29") },
    ],
  },
  {
    id: "002", serial: "002", name: "Exterior parts programme", template: "exteriorParts", status: "planned",
    startDate: "2026-09-23", deliveryDate: null, planEnd: d("11-04", "17:00"), client: "internal", notes: "",
    stations: ["ws1", "ws1", "ws1", "ws5", "ws3"], hasParts: true,
    tasks: [day("09-23", "09-29"), day("09-30", "10-08"), day("10-09", "10-20"), day("10-21", "10-29"), day("10-30", "11-04")],
    work: [],
  },
  {
    id: "01", serial: "01", name: "Client car", template: "clientCar", status: "planned",
    startDate: "2026-09-22", deliveryDate: "2026-10-05", planEnd: d("11-18", "17:00"), client: "internal", notes: "",
    stations: ["ws1", "ws3", "ws5", "ws6"], hasParts: false,
    tasks: [day("09-22", "10-05"), day("10-06", "11-02"), day("11-03", "11-16"), day("11-17", "11-18")],
    work: [],
    createdAt: "2026-09-21T11:30:45Z",
  },
  {
    id: "BUG-KYN", serial: "BUG-KYN", name: "Buggy Kynetik", template: "buggyBuild", status: "planned",
    startDate: "2026-09-21", deliveryDate: null, planEnd: d("11-30", "17:00"), client: "internal", notes: IMPORTED,
    stations: ["ws1", "ws1", "ws1", "ws1", "ws5", "ws3"], hasParts: true,
    tasks: BUGGY_FROM_0921,
    work: [],
  },
  {
    id: "BUG-CUS", serial: "BUG-CUS", name: "Custom Buggy", template: "buggyBuild", status: "planned",
    startDate: "2026-10-05", deliveryDate: null, planEnd: d("12-14", "17:00"), client: "internal", notes: IMPORTED,
    stations: ["ws2", "ws2", "ws2", "ws2", "ws5", "ws4"], hasParts: true,
    tasks: BUGGY_FROM_1005,
    work: [],
  },
];

/** §17.6 */
export const auditEntries = [
  { at: "2026-09-21T11:30:45Z", action: "project.create", label: "01", project: "01", role: "owner" },
  { at: "2026-10-01T06:17:18Z", action: "rebaseline", label: "002", project: "002", role: "owner" },
] as const;
