/**
 * Every user-facing rule message, word for word from spec §9 and §15.
 * The UI and the server actions show these; tests lock the wording.
 */
import { fmtH } from "./format";

export const MSG = {
  // §15
  serialRequired: "Every build needs a serial.",
  doneWithoutTech: "Assign a technician before marking this part Done — otherwise the work counts for nobody.",
  futureTime: "That time is in the future — start and finish record what actually happened.",
  startAfterFinish: "Start can't be after the finish.",
  finishBeforeStart: "Finish can't be before the start.",
  taskEndBeforeStart: "End has to be after start.",
  reworkReason: "Say what failed — it is the only way the rework history is useful.",
  duplicatePart: (name: string) => `"${name}" appears twice.`,
  overLogging: (name: string, already: number, date: string, dayHours: number) =>
    `${name} already has ${fmtH(already)} on ${date} — a working day holds ${fmtH(dayHours)}.`,
  shiftInvalid: "The shift has to end after it starts.",
  // §8 rules whose v1 wording is not in the spec; phrased in the same voice.
  clearStartOnDone: "A Done part needs its start time — set it back to In Progress or Not Started first.",
  reworkOnlyDone: "Only a Done part can be sent back for rework.",
  // §9
  techBlocked: (name: string, serial: string, stage: string, part: string, from: string, to: string) =>
    `Blocked — ${name} is already on ${serial} · ${stage} · ${part} (${from} – ${to}). ` +
    "A technician can only work one stage/part at a time. Finish or block that first, or pick someone else.",
  /** §9 wording for a queue task that isn't a part-step (Phase 3.5). */
  techBlockedTask: (name: string, title: string, from: string) =>
    `Blocked — ${name} is already on ${title} (${from} – now). ` +
    "A technician can only work one stage/part at a time. Finish or block that first, or pick someone else.",
  // Amends 2026-10-12: parts from a CSV or typed in (AM-03, AM-10). Same wording for both routes.
  csvNoRows: "The file has no part rows.",
  csvMissingColumns: (cols: string[]) =>
    `The file is missing ${cols.length === 1 ? "the column" : "the columns"} ${cols.join(", ")}. Use the headings from KYNETIK_PARTS_TEMPLATE.csv.`,
  partRequired: (label: string) => `${label} is required.`,
  csvExtraColumns: (cols: string[]) =>
    `The file has ${cols.length === 1 ? "a column" : "columns"} the template doesn't: ${cols.join(", ")}. The header is exactly serial,part_name,quantity,material,finish_colour,finish_sheen.`,
  serialFormat: "Serial format is NN-NN-NNN, for example 12-02-101.",
  serialNoSuffix: "No suffix in the parts list: the serial is NN-NN-NNN, for example 12-02-105. Sub-parts are added in My Models after modelling.",
  serialTwice: (serial: string) => `${serial} appears more than once.`,
  serialTaken: (serials: string[]) => `${serials.join(", ")} ${serials.length === 1 ? "is" : "are"} already used in the tracker. Serials are never reused.`,
  quantityWhole: "Quantity is a whole number, 1 or more.",
  oneOf: (label: string, list: string[]) => `${label} must be one of: ${list.join(", ")}.`,
  serialPrefix: (prefix: string) => `Every part in this project starts with ${prefix}.`,
  projectTaken: (serial: string) => `Project ${serial} already exists.`,
  // Concurrency (v2)
  staleWrite: "Someone else changed this — reload and try again.",
} as const;
