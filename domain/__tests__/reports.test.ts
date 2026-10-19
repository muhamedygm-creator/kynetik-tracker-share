import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import {
  activityNames, activityRows, filterActivity, filterParts, filterProjects, fmtDur, overNote, partReports, projectReports, toCsv, PART_CSV,
  type ReportInput,
} from "../reports";
import { DEFAULT_SETTINGS } from "../settings";
import type { Project, WorkItem } from "../types";

const cal = makeCalendar(DEFAULT_SETTINGS);
const item = (over: Partial<WorkItem>): WorkItem => ({
  id: "w", stageId: "s1", partId: "pa", status: "todo", tech: "t", start: null, end: null, segStart: null, prevSegs: [],
  planH: 2, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, ...over,
});
const project: Project = {
  id: "x", serial: "12-02", name: "BMW", status: "active", startDate: "2026-10-01", deliveryDate: "2026-11-30", deliveredOn: null, gated: true,
  stages: [
    { id: "s1", name: "3D printing", stationType: "modelling", stationId: null, partHours: 0, step: "printing" },
    { id: "s2", name: "Make Mold", stationType: "modification", stationId: null, partHours: 0, step: "mold" },
  ],
  parts: [
    { id: "pa", name: "Bonnet 1 of 2", serial: "12-02-101-A", parentId: "p0", material: null, finishColour: null, finishSheen: null, print: { filamentG: 320, minutes: 540, slices: 4 } },
    { id: "pb", name: "Rear Bumper", serial: "12-02-102", material: "Forged carbon", finishSheen: "Matte" },
  ],
  folders: [{ id: "p0", name: "Bonnet", serial: "12-02-101", material: "Twill", finishColour: "Red", finishSheen: "Gloss", model: { lengthM: 1.4, widthM: 1, heightM: 0.1, weightG: 900, surfaceM2: 1.2, volumeM3: 0.01, renderPath: "r.jpg", at: "2026-10-05T10:00" } }],
  tasks: [], baseline: {},
  work: [
    item({ status: "done", start: "2026-10-12T09:00", end: "2026-10-12T12:00" }),
    item({ id: "w2", stageId: "s2", tech: "u", planH: 1 }),
    item({ id: "w3", partId: "pb", tech: "t", status: "done", start: "2026-10-05T09:00", end: "2026-10-05T17:00", planH: 4 }),
    item({ id: "w4", partId: "pb", stageId: "s2", tech: "u", status: "doing", start: "2026-10-13T09:00", planH: 8 }),
  ],
};
const input: ReportInput = {
  projects: [project], people: [{ id: "t", name: "Tai", departmentId: "d" }, { id: "u", name: "Hamza", departmentId: "d2" }],
  departments: [{ id: "d", key: "modelling", name: "Modelling & 3D Printing" }, { id: "d2", key: "modification", name: "Modification" }],
  queue: [], requests: [], absences: [], calFor: () => cal, cal, now: "2026-10-16T12:00",
  reviews: [
    { workItemId: "w", submittedAt: "2026-10-12T11:30", decidedAt: "2026-10-12T12:00", result: "approved", reason: "" },
    { workItemId: "w3", submittedAt: "2026-10-05T15:00", decidedAt: "2026-10-05T16:00", result: "rejected", reason: "Pinholes" },
    { workItemId: "w3", submittedAt: "2026-10-05T16:30", decidedAt: "2026-10-05T17:00", result: "approved", reason: "" },
  ],
};
const f = { from: "2026-10-01", to: "2026-10-31" };

describe("reports (Reports fix 2026-10-17)", () => {
  it("durations read as hours and minutes, with an over-time note", () => {
    expect(fmtDur(11199)).toBe("186h 39m");
    expect(fmtDur(150)).toBe("2h 30m");
    expect(fmtDur(45)).toBe("45m");
    expect(fmtDur(480)).toBe("8h");
    expect(overNote(480, 11160)).toBe("+178h over");
    expect(overNote(480, 400)).toBeNull();
  });

  it("parts: one row per part with every stage and its own technician; material from the part it was split from", () => {
    const rows = partReports(input, f);
    expect(rows.map((r) => r.serial)).toEqual(["12-02-101-A", "12-02-102"]);
    const bumper = rows[1];
    expect(bumper).toMatchObject({ part: "Rear Bumper", material: "Forged carbon", finishSheen: "Matte", currentStage: "Make Mold", stagesDone: 1, stagesTotal: 2,
      status: "In progress", qcPassed: 1, qcFailed: 1, stepsFinished: 1 });
    expect(bumper.steps.map((s) => [s.stage, s.technician, s.qcResult])).toEqual([["3D printing", "Tai", "Failed then passed"], ["Make Mold", "Hamza", ""]]);
    expect(rows[0]).toMatchObject({ material: "Twill", finishColour: "Red", splitFrom: "12-02-101 Bonnet" });
    expect(rows[0].steps[0]).toMatchObject({ lengthM: 1.4, filamentG: 320, allocatedMin: 120, effectiveMin: 180, qcResult: "Passed first time" });
    // Picking the part keeps every stage and technician.
    expect(filterParts(rows, { ...f, part: "rear bumper" })[0].steps.map((s) => s.technician)).toEqual(["Tai", "Hamza"]);
    expect(filterParts(rows, { ...f, material: "Twill" }).map((r) => r.serial)).toEqual(["12-02-101-A"]);
    expect(toCsv(PART_CSV, rows[0].steps).split("\r\n")[1]).toContain("12-02 BMW,12-02-101-A,Bonnet 1 of 2,Twill,Red,Gloss,12-02-101 Bonnet,1,3D printing");
  });

  it("in this period = any activity; Include not started adds the rest", () => {
    expect(partReports(input, { from: "2026-10-14", to: "2026-10-15" }).map((r) => r.serial)).toEqual(["12-02-102"]); // still being worked on
    expect(partReports(input, { from: "2026-09-01", to: "2026-09-30" })).toEqual([]);
    const idle: Project = { ...project, id: "y", serial: "13", work: [item({ id: "z", partId: "pb" })] };
    const i2 = { ...input, projects: [idle] };
    expect(partReports(i2, f)).toEqual([]);
    expect(partReports(i2, { ...f, notStarted: true }).map((r) => r.status)).toEqual(["Not started"]);
  });

  it("projects: one row per project with progress and a stage breakdown; department narrows the stages", () => {
    const [r] = projectReports(input, f, () => ({ forecast: "2026-12-05", health: "late" }));
    expect(r).toMatchObject({ project: "12-02 BMW", health: "Late", stepsDone: 2, stepsTotal: 4, progressPct: 50, partsDone: 0, partsTotal: 2, qcFailures: 1 });
    expect(r.stages.map((s) => s.stage)).toEqual(["3D printing", "Make Mold"]);
    expect(r.byDept.map((d) => d.department)).toEqual(["Modelling & 3D Printing", "Modification"]);
    const [m] = filterProjects([r], { ...f, department: "Modification" });
    expect(m.stages.map((s) => s.stage)).toEqual(["Make Mold"]);
    expect(filterProjects([r], { ...f, status: "On track" })).toEqual([]);
  });

  it("activity: readable item, type and before → after, never cost or salary data", () => {
    const names = activityNames([project], input.people);
    const rows = activityRows([
      { at: "2026-10-12T10:00", actor: "Sam", role: "supervisor", action: "update", entity: "work_items", entityId: "w4", projectId: "x", label: "",
        before: { status: "todo", tech_id: "u", version: 2 }, after: { status: "doing", tech_id: "u", version: 3 }, sensitive: false },
      { at: "2026-10-12T11:00", actor: "Sam", role: "supervisor", action: "qc_decision", entity: "work_items", entityId: "w3", projectId: "x", label: "QC failed: Pinholes",
        before: null, after: null, sensitive: false },
      { at: "2026-10-12T10:01", actor: "Owner", role: "owner", action: "update", entity: "people_cost", entityId: "t", projectId: null, label: "",
        before: { base_salary: 1 }, after: { base_salary: 2 }, sensitive: true },
    ], f, names);
    expect(rows).toEqual([
      { at: "2026-10-12T11:00", who: "Sam", role: "supervisor", type: "QC", what: "QC decision", item: "Part step · 12-02 · 12-02-102 Rear Bumper · 3D printing", change: "", notes: "QC failed: Pinholes", projectId: "x" },
      { at: "2026-10-12T10:00", who: "Sam", role: "supervisor", type: "Status", what: "Changed", item: "Part step · 12-02 · 12-02-102 Rear Bumper · Make Mold", change: "Status: Not started → In progress", notes: "", projectId: "x" },
    ]);
    expect(filterActivity(rows, { ...f, action: "QC" })).toHaveLength(1);
    expect(filterActivity(rows, { ...f, item: "make mold" })).toHaveLength(1);
  });
});
