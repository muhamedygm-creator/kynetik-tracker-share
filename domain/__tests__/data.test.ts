import { describe, expect, it } from "vitest";
import { stepRows, stepsCsv, summarise } from "../data";
import type { Project, WorkItem } from "../types";
import { cal } from "./fixtures";

const w = (over: Partial<WorkItem>): WorkItem => ({
  id: "w", stageId: "m", partId: "a", status: "done", tech: "yan", start: "2026-10-12T09:00", end: "2026-10-12T12:00", segStart: "2026-10-12T09:00",
  prevSegs: [], planH: 2, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, attempt: 1, ...over,
});
const p: Project = {
  id: "x", serial: "12-02", name: "", status: "active", startDate: "2026-10-12", deliveryDate: null, deliveredOn: null, tasks: [], baseline: {}, gated: true,
  stages: [
    { id: "m", name: "Modelling", stationType: "modelling", stationId: null, partHours: 0, step: "modelling" },
    { id: "f", name: "Fitment", stationType: "fitment", stationId: null, partHours: 0, step: "fitment" },
  ],
  parts: [{ id: "a", name: "Bonnet", serial: "12-02-101", material: "Twill", finishColour: "Red", finishSheen: "Gloss",
    model: { lengthM: 1.4, widthM: 0.9, heightM: 0.1, weightG: 2400, surfaceM2: 1.2, volumeM3: 0.0124, renderPath: "r.jpg", at: null } }],
  work: [
    w({ id: "1" }),
    // Rejected once: 1h first attempt (09:00–10:00), rework 14:00–15:00, done.
    w({ id: "2", stageId: "f", tech: "toto", planH: 1.5, start: "2026-10-13T09:00", segStart: "2026-10-13T14:00", end: "2026-10-13T15:00",
      prevSegs: [["2026-10-13T09:00", "2026-10-13T10:00"]], prevSegAttempts: [1], attempt: 2, rework: 1 }),
    w({ id: "3", stageId: "f", status: "todo", start: null, end: null, segStart: null }),
  ],
};
const people = [{ id: "yan", name: "Yan" }, { id: "toto", name: "Toto" }];

describe("planning data (AM-13)", () => {
  const rows = stepRows([p], people, cal, "2026-10-13T17:00");
  it("one row per started step with allocated vs actual and rework apart", () => {
    expect(rows.map((r) => [r.stage, r.technician, r.allocatedH, r.actualH, r.firstAttemptH, r.reworkH, r.rejections])).toEqual([
      ["Modelling", "Yan", 2, 3, 3, 0, 0],
      ["Fitment", "Toto", 1.5, 2, 1, 1, 1],
    ]);
    expect(rows[0]).toMatchObject({ serial: "12-02-101", material: "Twill", finish: "Red · Gloss", lengthM: 1.4, weightG: 2400 });
  });
  it("sums by stage and technician", () => {
    expect(summarise(rows, (r) => r.technician).map((s) => [s.key, s.finished, s.actualH, s.varianceH])).toEqual([["Toto", 1, 2, 0.5], ["Yan", 1, 3, 1]]);
  });
  it("exports CSV without costs", () => {
    const csv = stepsCsv(rows);
    expect(csv.split("\n")[0]).toBe("project,part_serial,part_name,material,finish,stage,mold_component,technician,status,allocated_h,actual_h,first_attempt_h,rework_h,times_sent_back,started,finished,length_m,width_m,height_m,weight_g,surface_m2,volume_m3,filament_g,print_min,slice_components");
    expect(csv.split("\n")[2]).toContain("12-02,12-02-101,Bonnet,Twill,Red · Gloss,Fitment,,Toto,done,1.5,2,1,1,1,2026-10-13 09:00,2026-10-13 15:00");
    expect(csv.split("\n")[1]).toMatch(/,1\.4,0\.9,0\.1,2400,1\.2,0\.0124,,,$/);
    expect(csv).not.toMatch(/cost/i);
  });
});
