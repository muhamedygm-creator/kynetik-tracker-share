import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { performanceCsv, performanceRows, performanceSummaryCsv, rangeFor, rangeLabel, summaries, weekly, type PerfQueueTask } from "../performance";
import { DEFAULT_SETTINGS } from "../settings";
import type { Project, WorkItem } from "../types";

const cal = makeCalendar(DEFAULT_SETTINGS);
const item = (over: Partial<WorkItem>): WorkItem => ({
  id: "w", stageId: "s1", partId: "p", status: "todo", tech: "t", start: null, end: null, segStart: null, prevSegs: [],
  planH: 2, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, ...over,
});
const project = (work: WorkItem[]): Project => ({
  id: "x", serial: "12-02", name: "", status: "active", startDate: "2026-10-12", deliveryDate: null, deliveredOn: null, gated: true,
  stages: [{ id: "s1", name: "3D printing", stationType: "modelling", stationId: null, partHours: 0, step: "printing" }],
  parts: [{ id: "p", name: "Bonnet", serial: "12-02-101" }], tasks: [], baseline: {}, work,
});
const task = (over: Partial<PerfQueueTask>): PerfQueueTask => ({
  id: "q", personId: "t", title: "Print bonnet", durValue: 2.5, durUnit: "hours", status: "done", fixedStart: null,
  actualStart: null, actualEnd: null, position: "a0", projectId: "x", stageId: "s1", workItemId: "w",
  createdAt: "2026-10-12T08:30", createdBy: "Supervisor", ...over,
});
const base = { people: [{ id: "t", name: "Tai", department: "Modelling" }], calFor: () => cal, dayHours: 8, toleranceH: 0.01, now: "2026-10-16T12:00" };

describe("crew performance log (AM-26)", () => {
  // Started 12 Oct 09:00, finished 12 Oct 12:00 = 3h effective; allocated 2h + 30 min extension = 2h 30m; failed QC once.
  const w = item({ status: "done", start: "2026-10-12T09:00", end: "2026-10-12T12:00" });
  const rows = performanceRows({
    ...base, projects: [project([w])], queue: [task({})],
    requests: [{ kind: "extension", queueTaskId: "q", workItemId: null, sentAt: "2026-10-12T10:00", status: "approved", decidedAt: "2026-10-12T10:05", reply: "", extraH: 0.5 }],
    reviews: [
      { workItemId: "w", submittedAt: "2026-10-12T11:00", decidedAt: "2026-10-12T11:10", result: "rejected", reason: "Layer lines" },
      { workItemId: "w", submittedAt: "2026-10-12T11:50", decidedAt: "2026-10-12T12:00", result: "approved", reason: "" },
    ],
    from: "2026-10-12", to: "2026-10-18",
  });

  it("builds one time-stamped row per task with allocation, extensions, QC and variance", () => {
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({
      employee: "Tai", partSerial: "12-02-101", stage: "3D printing", assignedOn: "2026-10-12T08:30", assignedBy: "Supervisor",
      allocatedMin: 120, extensions: 1, extensionMin: 30, totalAllocatedMin: 150, effectiveMin: 180, varianceMin: 30,
      qcResult: "Failed then passed", onTime: false, status: "Finished", finishedAt: "2026-10-12T12:00",
    });
    expect(r.qcRequestedAt).toEqual(["2026-10-12T11:00", "2026-10-12T11:50"]);
    expect(r.qcFailures).toEqual([{ at: "2026-10-12T11:10", reason: "Layer lines" }]);
  });

  it("leaves out work outside the range", () => {
    expect(performanceRows({ ...base, projects: [project([w])], queue: [task({ createdAt: "2026-10-12T08:30" })], requests: [], reviews: [], from: "2026-11-01", to: "2026-11-30" })).toEqual([]);
  });

  it("summarises per employee and per week, and writes an Excel-friendly CSV", () => {
    const [sm] = summaries(rows, base.people, [], cal, "2026-10-12", "2026-10-18");
    expect(sm).toMatchObject({ finished: 1, onTimePct: 0, firstTimeQcPct: 0, allocatedMin: 150, effectiveMin: 180, extensions: 1 });
    expect(weekly(rows, "2026-10-12", "2026-10-18")).toEqual([{ week: "2026-10-12", allocatedH: 2.5, effectiveH: 3, onTimePct: 0, firstTimeQcPct: 0 }]);
    const csv = performanceCsv(rows);
    expect(csv.startsWith("﻿Employee,Department,Project")).toBe(true);
    expect(csv).toContain("2026-10-12 08:30,Supervisor,120,2.00,1,30,0.50,150,2.50");
    expect(csv).toContain(",180,3.00,30,0.50,No,Finished");
    const sum = performanceSummaryCsv([sm], rows).split("\r\n");
    expect(sum[0]).toContain("Employee,Department,Tasks,Tasks finished,Total allocated (h),Total effective (h),Variance (h)");
    expect(sum[1]).toContain("Tai,");
    expect(sum[1]).toContain(",1,1,2.50,3.00,0.50,0,0,1,");
  });

  it("works out the date presets", () => {
    expect(rangeFor("week", "2026-10-16")).toEqual({ from: "2026-10-12", to: "2026-10-16" });
    expect(rangeFor("month", "2026-10-17")).toEqual({ from: "2026-10-01", to: "2026-10-17" });
    expect(rangeFor("yesterday", "2026-10-17")).toEqual({ from: "2026-10-16", to: "2026-10-16" });
    expect(rangeFor("lastWeek", "2026-10-17")).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(rangeFor("last3Months", "2026-05-31")).toEqual({ from: "2026-02-28", to: "2026-05-31" });
    expect(rangeFor("last3Months", "2026-01-15")).toEqual({ from: "2025-10-15", to: "2026-01-15" });
    expect(rangeFor("year", "2026-10-17")).toEqual({ from: "2026-01-01", to: "2026-10-17" });
    expect(rangeFor("lastMonth", "2026-10-16")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(rangeFor("pickMonth", "2026-10-16", { month: "2026-02" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(rangeFor("custom", "2026-10-16", { from: "2026-10-10", to: "2026-10-01" })).toBeNull();
  });
});

describe("range in words (AM-30)", () => {
  it("reads like a sentence", () => {
    expect(rangeLabel("2026-10-16", "2026-10-16")).toBe("16 Oct 2026");
    expect(rangeLabel("2026-09-01", "2026-09-30")).toBe("1–30 Sep 2026");
    expect(rangeLabel("2026-09-28", "2026-10-04")).toBe("28 Sep – 4 Oct 2026");
    expect(rangeLabel("2026-12-28", "2027-01-03")).toBe("28 Dec 2026 – 3 Jan 2027");
  });
});
