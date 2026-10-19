import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { dashboardTips, headline, hoursByType, stageHours, weeklyOnTime } from "../dashboard";
import { DEFAULT_SETTINGS } from "../settings";
import type { Project, WorkItem } from "../types";

const cal = makeCalendar(DEFAULT_SETTINGS); // 09–18, lunch 13–14
const s = { ...DEFAULT_SETTINGS.scoring, onTimeToleranceH: 0 };
const NOW = "2026-10-07T12:00";
const wi = (o: Partial<WorkItem> & { id: string; stageId: string }): WorkItem => ({
  partId: "p", status: "done", tech: "t", start: null, end: null, segStart: null, prevSegs: [], planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, ...o,
});
const p: Project = {
  id: "P", serial: "S", name: "N", status: "active", startDate: "2026-09-01", deliveryDate: null, deliveredOn: null, parts: [], tasks: [], baseline: {},
  stages: [
    { id: "m", name: "Make Mold", stationType: "modification", stationId: null, partHours: 4 },
    { id: "q", name: "Paint", stationType: "paint", stationId: null, partHours: 8 },
  ],
  work: [
    wi({ id: "1", stageId: "m", start: "2026-10-05T09:00", end: "2026-10-05T15:00" }), // 5h vs 4h, late
    wi({ id: "2", stageId: "m", start: "2026-10-06T09:00", end: "2026-10-06T16:00", rework: 1 }), // 6h vs 4h, late
    wi({ id: "3", stageId: "q", start: "2026-09-29T09:00", end: "2026-09-29T12:00" }), // 3h vs 8h, on time (last week)
    wi({ id: "4", stageId: "q", start: "2026-09-30T09:00", end: "2026-09-30T13:00" }), // 4h vs 8h, on time
    wi({ id: "5", stageId: "q", status: "doing", start: "2026-10-07T09:00" }),
  ],
};

describe("dashboard", () => {
  it("headline numbers over finished steps", () => {
    const h = headline([p], cal, NOW, "2026-09-28", s);
    expect([h.done, h.onTimePct, h.ftrPct, h.actualH, h.standardH]).toEqual([4, 50, 75, 18, 24]);
    expect(Math.round(h.pacePct!)).toBe(133);
  });

  it("on-time share per week, oldest first", () => {
    expect(weeklyOnTime([p], cal, NOW, "2026-10-05", 3, s)).toEqual([
      { monday: "2026-09-21", done: 0, onTimePct: null },
      { monday: "2026-09-28", done: 2, onTimePct: 100 },
      { monday: "2026-10-05", done: 2, onTimePct: 0 },
    ]);
  });

  it("hours per department and per stage, with tips from the overruns", () => {
    expect(hoursByType([p], cal, NOW, "2026-09-28")).toEqual([{ type: "modification", hours: 11 }, { type: "paint", hours: 7 }]);
    const st = stageHours([p], cal, NOW, "2026-09-28");
    expect(st).toEqual([{ stage: "Make Mold", n: 2, planned: 4, actual: 5.5 }, { stage: "Paint", n: 2, planned: 8, actual: 3.5 }]);
    expect(dashboardTips(st, s)).toEqual([
      "Make Mold: finished steps took 5h 30m on average against 4h planned (2 steps). Plan more time for it, or raise the template hours.",
      "Paint: finished steps took 3h 30m against 8h planned. The plan may be too generous; the time could go to late builds.",
    ]);
  });
});
