import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MSG } from "../messages";
import { emptyRow, expandParts, parseCsv, projectSerialOf, rowsFromCsv, toCsv, validatePartRows, type PartRow } from "../parts-csv";
import { partProgress, partTree } from "../parts";
import { DEFAULT_SETTINGS } from "../settings";
import type { Project, WorkItem } from "../types";

const TEMPLATE = readFileSync(join(__dirname, "../../public/templates/KYNETIK_PARTS_TEMPLATE.csv"), "utf8");
const lists = DEFAULT_SETTINGS.labels;
const none = () => false;
const rows = () => { const r = rowsFromCsv(TEMPLATE); if (!r.ok) throw new Error(r.error); return r.value; };
const row = (over: Partial<PartRow>): PartRow => ({
  ...emptyRow(), serial: "12-02-101", part_name: "Bonnet", quantity: "1", material: "Carbon fiber", finish_colour: "Exposed carbon", finish_sheen: "Gloss", ...over,
});
const problems = (rs: PartRow[], taken: (s: string) => boolean = none, projectSerial?: string) =>
  validatePartRows(rs, { taken, lists, projectSerial }).map((p) => [p.row, p.column, p.message]);

describe("parts CSV (AM-02, AM-03)", () => {
  it("reads the Owner's template without problems", () => {
    const rs = rows();
    expect(rs).toHaveLength(5);
    expect(problems(rs)).toEqual([]);
    expect(projectSerialOf(rs)).toBe("12-02");
  });

  it("turns the template into 6 trackable parts (quantity 2 → two units)", () => {
    const drafts = expandParts(rows(), lists);
    expect(drafts.map((d) => [d.serial, d.parentKey, d.unitNo])).toEqual([
      ["12-02-101", null, null], ["12-02-102", null, null], ["12-02-103", null, null], ["12-02-105", null, null],
      ["12-02-110-1", null, 1], ["12-02-110-2", null, 2],
    ]);
    expect(drafts.filter((d) => d.serial.startsWith("12-02-110")).map((d) => d.name)).toEqual(["Side Mirror Cap", "Side Mirror Cap"]);
  });

  it("handles quotes, commas, CRLF and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, ""y""",z\r\n\r\n')).toEqual([["a", "b"], ['x, "y"', "z"]]);
    const back = rowsFromCsv(toCsv([row({ part_name: 'Bonnet, "vented"' })]));
    expect(back.ok && back.value[0].part_name).toBe('Bonnet, "vented"');
  });

  it("refuses a file without the template's headings", () => {
    expect(rowsFromCsv("serial,name\n12-02-101,Bonnet")).toEqual({ ok: false, error: MSG.csvMissingColumns(["part_name", "quantity", "material", "finish_colour", "finish_sheen"]) });
    expect(rowsFromCsv("")).toEqual({ ok: false, error: MSG.csvNoRows });
  });

  it("refuses extra columns: the header is exactly the six (AM-03)", () => {
    expect(rowsFromCsv("serial,parent_serial,part_name,description,quantity,material,finish_colour,finish_sheen\n12-02-101,,Bonnet,,1,Twill,Red,Gloss"))
      .toEqual({ ok: false, error: MSG.csvExtraColumns(["parent_serial", "description"]) });
    expect(rowsFromCsv("FINISH_SHEEN,serial,part_name,quantity,material,finish_colour\nGloss,12-02-101,Bonnet,1,Twill,Red").ok).toBe(true);
  });

  it("flags missing values", () => {
    expect(problems([row({ part_name: "", finish_colour: " " })])).toEqual([
      [0, "part_name", MSG.partRequired("Part name")], [0, "finish_colour", MSG.partRequired("Finish colour")],
    ]);
  });

  it("flags serials in the wrong format, twice in the file, or already used", () => {
    expect(problems([row({ serial: "12-2-101" })])).toEqual([[0, "serial", MSG.serialFormat]]);
    expect(problems([row({}), row({ part_name: "Hood" })])).toEqual([
      [0, "serial", MSG.serialTwice("12-02-101")], [1, "serial", MSG.serialTwice("12-02-101")],
    ]);
    expect(problems([row({})], (s) => s === "12-02-101")).toEqual([[0, "serial", MSG.serialTaken(["12-02-101"])]]);
    // A unit serial counts too.
    expect(problems([row({ quantity: "2" })], (s) => s === "12-02-101-2")).toEqual([[0, "serial", MSG.serialTaken(["12-02-101-2"])]]);
  });

  it("keeps every part in one project", () => {
    expect(problems([row({}), row({ serial: "12-03-102" })])).toEqual([[1, "serial", MSG.serialPrefix("12-02")]]);
    expect(problems([row({})], none, "13-01")).toEqual([[0, "serial", MSG.serialPrefix("13-01")]]);
  });

  it("refuses a sub-part suffix: sub-parts come from My Models, not the parts list", () => {
    expect(problems([row({ serial: "12-02-105-A" })])).toEqual([[0, "serial", MSG.serialNoSuffix]]);
    expect(problems([row({ serial: "12-02-105-1" })])).toEqual([[0, "serial", MSG.serialNoSuffix]]);
  });

  it("checks quantity and the fixed lists, letter case aside", () => {
    expect(problems([row({ quantity: "1.5" }), row({ serial: "12-02-102", quantity: "0" })])).toEqual([
      [0, "quantity", MSG.quantityWhole], [1, "quantity", MSG.quantityWhole],
    ]);
    expect(problems([row({ material: "Kevlar", finish_sheen: "Shiny" })])).toEqual([
      [0, "material", MSG.oneOf("Material", lists.materials)], [0, "finish_sheen", MSG.oneOf("Sheen", lists.sheens)],
    ]);
    expect(problems([row({ material: "forged CARBON", finish_sheen: "matte" })])).toEqual([]);
    expect(expandParts([row({ material: "forged CARBON", finish_sheen: "matte" })], lists)[0]).toMatchObject({ material: "Forged carbon", finishSheen: "Matte" });
  });

});

describe("part tree (AM-04)", () => {
  const item = (partId: string, status: WorkItem["status"]): WorkItem => ({
    id: `${partId}:${status}:${Math.random()}`, stageId: "s", partId, status, tech: null, start: null, end: null, segStart: null,
    prevSegs: [], planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {},
  });
  const p: Pick<Project, "parts" | "folders" | "work"> = {
    folders: [{ id: "f", name: "Front Bumper", serial: "12-02-105", sort: 1 }],
    parts: [
      { id: "a", name: "Bonnet", serial: "12-02-101", sort: 0 },
      { id: "b1", name: "Left", serial: "12-02-105-A", parentId: "f", sort: 2 },
      { id: "b2", name: "Right", serial: "12-02-105-B", parentId: "f", sort: 3 },
    ],
    work: [item("a", "done"), item("b1", "done"), item("b1", "done"), item("b2", "done"), item("b2", "doing")],
  };

  it("nests sub-parts under their folder, in saved order", () => {
    expect(partTree(p).map((n) => [n.part.id, n.folder, n.children.map((c) => c.id)])).toEqual([["a", false, []], ["f", true, ["b1", "b2"]]]);
  });

  it("a folder's progress is its sub-parts', complete only when all are", () => {
    expect(partProgress(p, "f")).toEqual({ done: 3, total: 4, pct: 0.75, complete: false });
    expect(partProgress(p, "a").complete).toBe(true);
  });
});
