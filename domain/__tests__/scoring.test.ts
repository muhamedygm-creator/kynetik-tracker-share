import { describe, expect, it } from "vitest";
import { inPeriod, leaderboard, scoreBand, techStats } from "../scoring";
import type { Project, WorkItem } from "../types";
import { NOW, cal, people, settings } from "./fixtures";

const s = settings.scoring;
const w = (i: number, over: Partial<WorkItem>): WorkItem => ({
  id: `w${i}`, stageId: "st", partId: `p${i}`, status: "done", tech: "t", start: null, end: null, segStart: null, prevSegs: [],
  planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, ...over,
});
const project = (work: WorkItem[]): Project => ({
  id: "x", serial: "X", name: "", status: "active", startDate: "2026-09-21", deliveryDate: null, deliveredOn: null,
  stages: [{ id: "st", name: "Stage", stationType: "modification", stationId: null, partHours: 8 }],
  parts: [], tasks: [], baseline: {}, work,
});

describe("technician scoring (spec §11)", () => {
  // Three 8h-standard parts: 8h (on time), 4h (on time), 12h (late, reworked).
  const items = [
    w(1, { start: "2026-09-28T08:00", end: "2026-09-28T17:00", hoursBy: { t: 8 } }),
    w(2, { start: "2026-09-29T08:00", end: "2026-09-29T12:00" }),
    w(3, { start: "2026-09-29T13:00", end: "2026-09-30T17:00", rework: 1 }),
    w(4, { status: "doing", start: "2026-10-01T08:00" }),
  ];
  const r = techStats({ id: "t" }, [project(items)], cal, NOW, 30, s);

  it("metrics", () => {
    expect(r.done).toBe(3);
    expect(r.onTimePct).toBeCloseTo(66.667, 2);
    expect(r.ftrPct).toBeCloseTo(66.667, 2);
    expect(r.pacePct).toBeCloseTo((24 / 24) * 100);
    expect(r.avgActualH).toBe(8);
    expect(r.loggedHPerPart).toBeCloseTo(8 / 3);
    expect(r.inWork).toBe(1);
    expect(r.costPerPart).toBeNull(); // no cost data for non-owners
  });

  it("score = round(0.4·onTime + 0.3·FTR + 0.3·min(pace,120)/120·100)", () => {
    expect(r.score).toBe(Math.round(0.4 * (200 / 3) + 0.3 * (200 / 3) + 0.3 * (100 / 120) * 100));
  });

  it("no score below the minimum completed part-steps", () => {
    expect(techStats({ id: "t" }, [project(items.slice(0, 2))], cal, NOW, 30, s).score).toBeNull();
    expect(techStats({ id: "t" }, [project(items.slice(0, 2))], cal, NOW, 30, { ...s, minDone: 2 }).score).not.toBeNull();
  });

  it("pace is 120 when actual is 0, and capped in the score", () => {
    const zero = [1, 2, 3].map((i) => w(i, { start: "2026-09-28T08:00", end: "2026-09-28T08:00" }));
    const z = techStats({ id: "t" }, [project(zero)], cal, NOW, 30, s);
    expect(z.pacePct).toBe(120);
    expect(z.score).toBe(100);
  });

  it("period filter by finish date; 0 = all time", () => {
    expect(inPeriod("2026-09-25T10:00", NOW, 7)).toBe(true);
    expect(inPeriod("2026-09-24T10:00", NOW, 7)).toBe(false);
    expect(inPeriod("2020-01-01T10:00", NOW, 0)).toBe(true);
  });

  it("colour bands 85 / 70 / 55", () => {
    expect([90, 85, 84, 70, 69, 55, 54].map((x) => scoreBand(x, s))).toEqual(["green", "green", "yellow", "yellow", "amber", "amber", "red"]);
  });

  it("leaderboard: production people only", () => {
    const rows = leaderboard([...people, { id: "adm", name: "Office", crew: "admin", costClass: "admin", active: true }], [], cal, NOW, 30, s);
    expect(rows).toHaveLength(12);
  });
});
