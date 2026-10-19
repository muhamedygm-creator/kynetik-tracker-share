import { describe, expect, it } from "vitest";
import { modelComplete, modelProblems, modelSummary, parseMeasure } from "../model";
import { leaderboard } from "../scoring";
import { DEFAULT_SETTINGS } from "../settings";
import type { Person, Project, WorkItem } from "../types";
import { cal } from "./fixtures";

const typed = (over: Partial<Record<string, string>> = {}) => ({ lengthM: "1.42", widthM: "0,98", heightM: "0.12", weightG: "2450", surfaceM2: "1.21", volumeM3: "0.0124", ...over });

describe("model data (AM-05)", () => {
  it("reads numbers with a dot or a comma, above 0", () => {
    expect(parseMeasure("0,98")).toBe(0.98);
    expect(parseMeasure("")).toBeNull();
    expect(parseMeasure("0")).toBe("bad");
    expect(parseMeasure("12 cm")).toBe("bad");
    expect(modelProblems(typed())).toEqual({});
    expect(modelProblems(typed({ weightG: "2.4kg" }))).toEqual({ weightG: "Weight is a number above 0, in g." });
  });

  it("is complete only with every measurement and the render", () => {
    const m = { lengthM: 1.42, widthM: 0.98, heightM: 0.12, weightG: 2450, surfaceM2: 1.21, volumeM3: 0.0124, renderPath: "a.jpg", at: null };
    expect(modelComplete(m)).toBe(true);
    expect(modelComplete({ ...m, renderPath: null })).toBe(false);
    expect(modelComplete({ ...m, volumeM3: null })).toBe(false);
    expect(modelSummary(m)).toBe("1.42 × 0.98 × 0.12 m · 2,450 g · 1.21 m² · 0.0124 m³");
    expect(modelSummary(null)).toBeNull();
  });
});

describe("Modelling has its own leaderboard (AM-11)", () => {
  const w = (id: string, stageId: string, tech: string): WorkItem => ({
    id, stageId, partId: "p", status: "done", tech, start: "2026-10-12T09:00", end: "2026-10-12T11:00", segStart: "2026-10-12T09:00",
    prevSegs: [], planH: 2, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {},
  });
  const p: Project = {
    id: "x", serial: "12-02", name: "", status: "active", startDate: "2026-10-12", deliveryDate: null, deliveredOn: null, tasks: [], baseline: {},
    stages: [
      { id: "m", name: "Modelling", stationType: "modelling", stationId: null, partHours: 0 },
      { id: "f", name: "Fitment", stationType: "fitment", stationId: null, partHours: 0 },
    ],
    parts: [{ id: "p", name: "Bonnet" }],
    work: [w("1", "m", "yan"), w("2", "f", "toto"), w("3", "f", "yan")],
  };
  const people: Person[] = [
    { id: "yan", name: "Yan", crew: "", costClass: "production", active: true },
    { id: "toto", name: "Toto", crew: "", costClass: "production", active: true },
  ];
  it("counts only the board's own stage", () => {
    const now = "2026-10-12T17:00";
    const modelling = leaderboard(people, [p], cal, now, 7, DEFAULT_SETTINGS.scoring, (s) => s.stationType === "modelling");
    expect(modelling.map((r) => [r.name, r.done])).toEqual([["Yan", 1], ["Toto", 0]]);
    const production = leaderboard(people, [p], cal, now, 7, DEFAULT_SETTINGS.scoring, (s) => s.stationType !== "modelling");
    expect(production.find((r) => r.name === "Yan")?.done).toBe(1);
    expect(production.find((r) => r.name === "Toto")?.done).toBe(1);
  });
});

describe("sub-parts (AM-23)", () => {
  it("names and serials: original + letter, unit pieces too", async () => {
    const { subSerial, defaultSubNames, splitProblem } = await import("../model");
    expect([0, 1, 2].map((i) => subSerial("12-02-105", i))).toEqual(["12-02-105-A", "12-02-105-B", "12-02-105-C"]);
    expect(subSerial("12-02-110-1", 0)).toBe("12-02-110-1-A");
    expect(defaultSubNames("Front Bumper", 3)).toEqual(["Front Bumper 1 of 3", "Front Bumper 2 of 3", "Front Bumper 3 of 3"]);
    expect(splitProblem(["a"])).toMatch(/2 to 26/);
    expect(splitProblem(["a", " "])).toMatch(/needs a name/);
    expect(splitProblem([])).toBeNull();
    expect(splitProblem(["a", "b"])).toBeNull();
  });
});
