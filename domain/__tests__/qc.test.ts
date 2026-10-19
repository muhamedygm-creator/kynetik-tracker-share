import { describe, expect, it } from "vitest";
import { componentLabel, firstAttemptH, needsMoldCount, nextSteps, panelPlan, qcQueue, reworkH, startBlocker, stepName, waitingQc } from "../qc";
import type { Project, WorkItem } from "../types";
import { cal } from "./fixtures";

const item = (over: Partial<WorkItem>): WorkItem => ({
  id: "w", stageId: "s1", partId: "p", status: "todo", tech: null, start: null, end: null, segStart: null, prevSegs: [],
  planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, ...over,
});
const stages = [
  { id: "s1", name: "Modelling", stationType: "modelling", stationId: null, partHours: 0, step: "modelling" },
  { id: "s4", name: "Pre-mold production", stationType: "modification", stationId: null, partHours: 0, step: "premold" },
  { id: "s5", name: "Mold production", stationType: "modification", stationId: null, partHours: 0, step: "mold" },
  { id: "s6", name: "Carbon fibre component production", stationType: "modification", stationId: null, partHours: 0, step: "carbon" },
];
const project = (work: WorkItem[], gated = true): Project => ({
  id: "x", serial: "12-02", name: "", status: "active", startDate: "2026-10-12", deliveryDate: null, deliveredOn: null,
  stages, parts: [{ id: "p", name: "Bonnet", serial: "12-02-101" }], tasks: [], baseline: {}, work, gated,
});

describe("QC gate (AM-07)", () => {
  it("a stage waits for every earlier stage of the part to be approved", () => {
    const p = project([item({ id: "a", stageId: "s1", status: "doing" }), item({ id: "b", stageId: "s4" })]);
    expect(startBlocker(p, p.work[1])).toBe("This part is still in Modelling. A stage starts once the stage before it has passed QC.");
    expect(startBlocker(p, p.work[0])).toBeNull();
    expect(startBlocker(project(p.work, false), p.work[1])).toBeNull();
  });

  it("Mold production needs its component count first (AM-06)", () => {
    const p = project([item({ id: "a", stageId: "s1", status: "done" }), item({ id: "b", stageId: "s4", status: "done" }), item({ id: "m", stageId: "s5" })]);
    expect(startBlocker(p, p.work[2])).toMatch(/how many mold components/);
    expect(needsMoldCount(p)).toEqual([{ partId: "p", moldItemId: "m" }]);
    const split = project([...p.work.slice(0, 2), item({ id: "m1", stageId: "s5", componentNo: 1, componentTotal: 2 }), item({ id: "m2", stageId: "s5", componentNo: 2, componentTotal: 2 })]);
    expect(needsMoldCount(split)).toEqual([]);
    expect(startBlocker(split, split.work[2])).toBeNull();
    expect(componentLabel(split.work[3])).toBe("Mold component 2 of 2");
    expect(stepName("Bonnet", split.work[3])).toBe("Bonnet · Mold component 2 of 2");
    expect(stepName("Bonnet", split.work[0])).toBe("Bonnet");
    // The next stage waits for every component.
    const half = project([...split.work.slice(0, 2), { ...split.work[2], status: "done" }, split.work[3], item({ id: "c", stageId: "s6" })]);
    expect(startBlocker(half, half.work[4])).toMatch(/still in Mold production/);
  });

  it("a step waiting for QC stays In Progress; the list puts the longest wait first", () => {
    const a = item({ id: "a", status: "doing", qcSince: "2026-10-12T11:00" });
    const b = item({ id: "b", status: "doing", qcSince: "2026-10-12T09:30" });
    expect(waitingQc(a)).toBe(true);
    expect(waitingQc(item({ status: "doing" }))).toBe(false);
    expect(qcQueue([project([a, b, item({ id: "c" })])]).map((x) => x.item.id)).toEqual(["b", "a"]);
  });

  it("keeps rework time apart from the first attempt", () => {
    // First attempt 10:00–12:00 (rejected), rework 14:00–15:00 so far.
    const w = item({ status: "doing", start: "2026-10-12T10:00", segStart: "2026-10-12T14:00", prevSegs: [["2026-10-12T10:00", "2026-10-12T12:00"]], prevSegAttempts: [1], attempt: 2 });
    expect(firstAttemptH(w, cal, "2026-10-12T15:00")).toBe(2);
    expect(reworkH(w, cal, "2026-10-12T15:00")).toBe(1);
    const first = item({ status: "doing", start: "2026-10-12T10:00", segStart: "2026-10-12T10:00" });
    expect(firstAttemptH(first, cal, "2026-10-12T12:00")).toBe(2);
    expect(reworkH(first, cal, "2026-10-12T12:00")).toBe(0);
  });
});

describe("panel plan (AM-08)", () => {
  it("forecasts only from steps an admin put on a queue, and counts the rest", () => {
    const p = project([item({ id: "a", status: "done", end: "2026-10-12T10:00" }), item({ id: "b", stageId: "s4" }), item({ id: "c", stageId: "s5" })]);
    const queue = [{ id: "q1", workItemId: "b", status: "todo" }];
    expect(panelPlan(p, queue, () => "2026-10-14T16:00")).toEqual({ finish: "2026-10-14T16:00", unplanned: 1, planned: 1 });
    expect(panelPlan(p, [], () => null)).toEqual({ finish: null, unplanned: 2, planned: 0 });
  });
});

describe("plan the next stage after QC (2026-10-15)", () => {
  it("offers the part's next stage once it can start, or asks for the mold count", () => {
    const p = project([item({ id: "a", stageId: "s1", status: "done" }), item({ id: "b", stageId: "s4" }), item({ id: "m", stageId: "s5" })]);
    expect(nextSteps(p, "a").steps.map((x) => x.id)).toEqual(["b"]);
    const pre = project([{ ...p.work[0] }, { ...p.work[1], status: "done" }, p.work[2]]);
    expect(nextSteps(pre, "b")).toEqual({ steps: [], moldPartId: "p" });
    const comps = project([pre.work[0], pre.work[1], item({ id: "m1", stageId: "s5", componentNo: 1, componentTotal: 2 }), item({ id: "m2", stageId: "s5", componentNo: 2, componentTotal: 2 }), item({ id: "c", stageId: "s6" })]);
    expect(nextSteps(comps, "b").steps.map((x) => x.id)).toEqual(["m1", "m2"]);
    // One component approved while the other isn't: carbon production can't start yet.
    const half = project([...comps.work.slice(0, 2), { ...comps.work[2], status: "done" }, comps.work[3], comps.work[4]]);
    expect(nextSteps(half, "m1").steps).toEqual([]);
  });

  it("after a split, each sub-part's first stage", () => {
    const p = { ...project([item({ id: "a", stageId: "s1", status: "done" }), item({ id: "x", partId: "pa", stageId: "s4" }), item({ id: "y", partId: "pb", stageId: "s4" })]),
      parts: [{ id: "pa", name: "Bonnet 1 of 2", parentId: "p" }, { id: "pb", name: "Bonnet 2 of 2", parentId: "p" }] };
    expect(nextSteps(p, "a").steps.map((x) => x.id)).toEqual(["x", "y"]);
  });
});
