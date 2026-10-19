/**
 * Parts lists for the new workflow (AMENDS_NEXT_ROUND AM-02, AM-03, AM-10, AM-21; serial answers in
 * docs/ux/DECISIONS.md 2026-10-12, CSV change 2026-10-13). The same rows and the same checks serve a CSV upload
 * and typing parts in, so both routes behave alike.
 *
 * The CSV holds original parts only, with exactly six columns. Serials: NN-NN-NNN (design, production number,
 * part code), no suffix; the project's serial is the first two parts. A quantity above 1 makes one trackable
 * part per unit, numbered -1, -2 … (12-02-110-1). Sub-parts are never in the CSV: the modeller adds them in
 * My Models (AM-23).
 */
import { MSG } from "./messages";
import type { LabelSettings } from "./settings";
import type { Result } from "./work";

export const CSV_COLUMNS = ["serial", "part_name", "quantity", "material", "finish_colour", "finish_sheen"] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];
/** One row as typed or read from the file: raw text, nothing converted yet. */
export type PartRow = Record<CsvColumn, string>;

const REQUIRED: CsvColumn[] = [...CSV_COLUMNS];
export const COLUMN_LABEL: Record<CsvColumn, string> = {
  serial: "Serial", part_name: "Part name", quantity: "Quantity", material: "Material", finish_colour: "Finish colour", finish_sheen: "Sheen",
};

const PART = /^\d{2}-\d{2}-\d{3}$/;
const SUB = /^(\d{2}-\d{2}-\d{3})-([A-Z])$/;

export const emptyRow = (): PartRow => Object.fromEntries(CSV_COLUMNS.map((c) => [c, ""])) as PartRow;
const norm = (serial: string) => serial.trim().toUpperCase();
/** The project's serial from a part serial: 12-02-105-A → 12-02. */
export const prefixOf = (serial: string) => norm(serial).slice(0, 5);

// ───────────── reading the file ─────────────

/** RFC 4180 style: commas, quoted fields with "" for a quote, CRLF or LF, a leading BOM. Blank lines are dropped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = "";
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Rows keyed by the template's headings: exactly the six columns (any order, any letter case). */
export function rowsFromCsv(text: string): Result<PartRow[]> {
  const [head, ...body] = parseCsv(text);
  if (!head) return { ok: false, error: MSG.csvNoRows };
  const idx = new Map(head.map((h, i) => [h.trim().toLowerCase(), i]));
  const missing = REQUIRED.filter((c) => !idx.has(c));
  if (missing.length) return { ok: false, error: MSG.csvMissingColumns(missing) };
  const extra = head.map((h) => h.trim()).filter((h) => h && !(CSV_COLUMNS as readonly string[]).includes(h.toLowerCase()));
  if (extra.length) return { ok: false, error: MSG.csvExtraColumns(extra) };
  if (!body.length) return { ok: false, error: MSG.csvNoRows };
  return {
    ok: true,
    value: body.map((r) => Object.fromEntries(CSV_COLUMNS.map((c) => [c, idx.has(c) ? (r[idx.get(c)!] ?? "").trim() : ""])) as PartRow),
  };
}

// ───────────── checking ─────────────

export interface Problem { row: number; column: CsvColumn | null; message: string }
type Lists = Pick<LabelSettings, "materials" | "sheens">;

/** The list entry a typed value means (letter case ignored), or null. */
const pick = (list: string[], v: string) => list.find((x) => x.toLowerCase() === v.trim().toLowerCase()) ?? null;
const whole = (v: string) => (/^\d+$/.test(v.trim()) ? Number(v.trim()) : NaN);

/** Serials a row will create once its quantity is split into units. */
export function unitSerials(r: Pick<PartRow, "serial" | "quantity">): string[] {
  const q = whole(r.quantity);
  const s = norm(r.serial);
  return q > 1 ? Array.from({ length: q }, (_, i) => `${s}-${i + 1}`) : [s];
}

/**
 * Every problem in a parts list, per row and column. `taken` says whether a serial is already used
 * anywhere in the tracker (including parts since deleted). `projectSerial` is the project the parts go
 * into, when it is already known; otherwise the first serial decides.
 */
export function validatePartRows(rows: PartRow[], o: { taken: (serial: string) => boolean; lists: Lists; projectSerial?: string | null }): Problem[] {
  const out: Problem[] = [];
  const add = (row: number, column: CsvColumn | null, message: string) => out.push({ row, column, message });
  if (!rows.length) return [{ row: -1, column: null, message: MSG.csvNoRows }];

  const bySerial = new Map<string, number[]>();
  rows.forEach((r, i) => { if (r.serial.trim()) bySerial.set(norm(r.serial), [...(bySerial.get(norm(r.serial)) ?? []), i]); });
  const firstValid = rows.map((r) => norm(r.serial)).find((s) => PART.test(s));
  const prefix = o.projectSerial?.trim().toUpperCase() || (firstValid ? prefixOf(firstValid) : null);

  rows.forEach((r, i) => {
    for (const c of REQUIRED) if (!r[c].trim()) add(i, c, MSG.partRequired(COLUMN_LABEL[c]));
    const serial = norm(r.serial);
    if (serial) {
      // Sub-parts are added in My Models after modelling, never in the parts list (AM-23).
      if (SUB.test(serial) || /^\d{2}-\d{2}-\d{3}-/.test(serial)) add(i, "serial", MSG.serialNoSuffix);
      else if (!PART.test(serial)) add(i, "serial", MSG.serialFormat);
      if (PART.test(serial) && prefix && prefixOf(serial) !== prefix) add(i, "serial", MSG.serialPrefix(prefix));
      if ((bySerial.get(serial)?.length ?? 0) > 1) add(i, "serial", MSG.serialTwice(serial));
      const used = unitSerials(r).filter((s) => o.taken(s));
      if (used.length) add(i, "serial", MSG.serialTaken(used));
    }
    if (r.quantity.trim() && !(whole(r.quantity) >= 1)) add(i, "quantity", MSG.quantityWhole);
    if (r.material.trim() && !pick(o.lists.materials, r.material)) add(i, "material", MSG.oneOf(COLUMN_LABEL.material, o.lists.materials));
    if (r.finish_sheen.trim() && !pick(o.lists.sheens, r.finish_sheen)) add(i, "finish_sheen", MSG.oneOf(COLUMN_LABEL.finish_sheen, o.lists.sheens));
  });
  return out;
}

/** The project's serial (12-02) the rows belong to, or null while no row has a valid serial. */
export function projectSerialOf(rows: PartRow[]): string | null {
  const s = rows.map((r) => norm(r.serial)).find((x) => PART.test(x));
  return s ? prefixOf(s) : null;
}

// ───────────── turning rows into parts ─────────────

/** What the database receives: one entry per trackable part or folder. `parentKey` points at another entry. */
export interface PartDraft {
  key: string;
  parentKey: string | null;
  serial: string;
  name: string;
  description: string;
  material: string;
  finishColour: string;
  finishSheen: string;
  unitNo: number | null;
  sort: number;
}

/** Rows → parts, for rows that passed `validatePartRows`. Units of one row share its name and finish. */
export function expandParts(rows: PartRow[], lists: Lists): PartDraft[] {
  const out: PartDraft[] = [];
  for (const r of rows) {
    const base = {
      parentKey: null, name: r.part_name.trim(), description: "",
      material: pick(lists.materials, r.material) ?? r.material.trim(),
      finishColour: r.finish_colour.trim(), finishSheen: pick(lists.sheens, r.finish_sheen) ?? r.finish_sheen.trim(),
    };
    const serials = unitSerials(r);
    serials.forEach((serial, u) => out.push({ ...base, key: serial, serial, unitNo: serials.length > 1 ? u + 1 : null, sort: out.length }));
  }
  return out;
}

/** A parts list back to CSV text (same headings as the template), e.g. to fix a file outside the tracker. */
export function toCsv(rows: PartRow[]): string {
  const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  return [CSV_COLUMNS.join(","), ...rows.map((r) => CSV_COLUMNS.map((c) => cell(r[c])).join(","))].join("\n") + "\n";
}
