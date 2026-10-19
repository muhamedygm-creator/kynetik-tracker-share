import { describe, expect, it } from "vitest";
import { MSG } from "../messages";
import type { WorkItem } from "../types";
import {
  actualH, applyStatus, bulkAssign, diffPartsList, durationFromEnd, projectAfterChange, renamePart, rework, standardH,
  startBuild, validateWorkItem,
} from "../work";
import { NOW, buildProjects, byId, cal } from "./fixtures";

const item = (over: Partial<WorkItem> = {}): WorkItem => ({
  id: "w", stageId: "s", partId: "p", status: "todo", tech: null, start: null, end: null, segStart: null, prevSegs: [],
  planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, ...over,
});

describe("part-step tracking (spec §8)", () => {
  it("EXT-001 shows 4 parts in work in Premold Prep", () => {
    const p = byId(buildProjects(), "EXT-001");
    expect(p.work.filter((w) => w.stageId === "EXT-001/Premold Prep" && w.status === "doing")).toHaveLength(4);
  });

  it("standard = override or stage standard; actual = working hours start → finish/now", () => {
    expect(standardH(item(), { partHours: 16 })).toBe(16);
    expect(standardH(item({ planH: 6 }), { partHours: 16 })).toBe(6);
    expect(actualH(item({ start: "2026-09-23T08:00", end: "2026-09-23T14:59" }), cal, NOW)).toBeCloseTo(5 + 59 / 60);
    expect(actualH(item({ start: "2026-09-30T16:00" }), cal, NOW)).toBe(2);
  });

  it("after a rework, actual counts only time worked, not the time it sat Done (I1)", () => {
    const reworked = item({
      start: "2026-09-28T08:00", prevSegs: [["2026-09-28T08:00", "2026-09-28T12:00"]], segStart: "2026-09-30T13:00", status: "doing",
    });
    expect(actualH(reworked, cal, "2026-09-30T15:00")).toBe(4 + 2);
  });

  it("applyStatus sets and clears times like v1", () => {
    const d = applyStatus(item({ tech: "t" }), "doing", NOW);
    expect([d.start, d.end]).toEqual([NOW, null]);
    const done = applyStatus(d, "done", "2026-10-01T11:00");
    expect([done.start, done.end]).toEqual([NOW, "2026-10-01T11:00"]);
    const back = applyStatus(done, "doing", "2026-10-01T12:00");
    expect(back.end).toBeNull();
    const reset = applyStatus(done, "todo", NOW);
    expect([reset.start, reset.end, reset.segStart, reset.prevSegs]).toEqual([null, null, null, []]);
  });

  it("refuses with the exact §15 messages", () => {
    const base = item();
    expect(validateWorkItem(base, item({ status: "done", end: NOW }), NOW)).toBe(MSG.doneWithoutTech);
    expect(MSG.doneWithoutTech).toBe("Assign a technician before marking this part Done — otherwise the work counts for nobody.");
    expect(validateWorkItem(base, item({ tech: "t", status: "doing", start: "2026-10-02T08:00" }), NOW)).toBe(
      "That time is in the future — start and finish record what actually happened.",
    );
    const bad = item({ tech: "t", status: "done", start: "2026-09-30T10:00", end: "2026-09-29T10:00" });
    expect(validateWorkItem(base, bad, NOW, "start")).toBe("Start can't be after the finish.");
    expect(validateWorkItem(base, bad, NOW, "end")).toBe("Finish can't be before the start.");
    const doneItem = item({ tech: "t", status: "done", start: "2026-09-29T10:00", end: "2026-09-30T10:00" });
    expect(validateWorkItem(doneItem, { ...doneItem, start: null }, NOW)).toBe(MSG.clearStartOnDone);
    expect(validateWorkItem(base, doneItem, NOW)).toBeNull();
  });

  it("rework: Done only, needs a reason, keeps the tech, starts a new segment", () => {
    const done = item({ tech: "t", status: "done", start: "2026-09-29T08:00", segStart: "2026-09-29T08:00", end: "2026-09-29T12:00" });
    expect(rework(done, "  ", "owner", NOW)).toEqual({ ok: false, error: "Say what failed — it is the only way the rework history is useful." });
    expect(rework(item(), "x", "owner", NOW).ok).toBe(false);
    const r = rework(done, "Pinholes in gelcoat", "owner", NOW);
    expect(r.ok && r.value).toMatchObject({
      status: "doing", tech: "t", rework: 1, segStart: NOW, end: null,
      prevSegs: [["2026-09-29T08:00", "2026-09-29T12:00"]], reworkLog: [{ at: NOW, why: "Pinholes in gelcoat", by: "owner" }],
    });
  });

  it("bulk assign skips assigned, done and clashing parts", () => {
    const items = [item({ id: "a" }), item({ id: "b", tech: "x" }), item({ id: "c", status: "done" }), item({ id: "d" })];
    const r = bulkAssign(items, "s", "t", (n) => n.id === "d");
    expect(r.assigned.map((w) => w.id)).toEqual(["a"]);
    expect(r.skipped.map((w) => w.id)).toEqual(["d"]);
  });

  it("parts list: one per line, no duplicates, unchanged names keep their id (D5)", () => {
    const existing = [{ id: "1", name: "Bonnet" }, { id: "2", name: "Left Door" }];
    expect(diffPartsList(existing, "Bonnet\nbonnet")).toEqual({ ok: false, error: '"bonnet" appears twice.' });
    const r = diffPartsList(existing, " Bonnet \n\nRoof\n");
    expect(r.ok && r.value).toEqual({ keep: [{ id: "1", name: "Bonnet" }], add: ["Roof"], remove: [{ id: "2", name: "Left Door" }] });
    const renamed = renamePart(existing, "2", "Left Front Door");
    expect(renamed.ok && renamed.value[1]).toEqual({ id: "2", name: "Left Front Door" });
    expect(renamePart(existing, "2", "bonnet").ok).toBe(false);
  });

  it("a planned build goes active (with baseline) when work starts; delivered when every task is done", () => {
    const p = byId(buildProjects(), "002");
    const started = { ...p, baseline: {}, work: p.work.map((w, i) => (i === 0 ? { ...w, status: "doing" as const } : w)) };
    const r = projectAfterChange(started, "2026-10-01");
    expect(r.status).toBe("active");
    expect(Object.keys(r.baseline)).toHaveLength(5);
    const finished = projectAfterChange({ ...p, status: "active", tasks: p.tasks.map((t) => ({ ...t, status: "done" as const })) }, "2026-10-01");
    expect([finished.status, finished.deliveredOn]).toEqual(["done", "2026-10-01"]);
  });

  it("editing a task end recomputes hours (0.5h steps, min 0.5h)", () => {
    expect(durationFromEnd({ start: "2026-09-21T08:00" }, "2026-09-21T08:00", cal)).toEqual({ ok: false, error: "End has to be after start." });
    expect(durationFromEnd({ start: "2026-09-21T08:00" }, "2026-09-22T09:10", cal)).toEqual({ ok: true, value: 9 });
    expect(durationFromEnd({ start: "2026-09-21T08:00" }, "2026-09-21T08:05", cal)).toEqual({ ok: true, value: 0.5 });
  });

  it("start build: active, first task pinned to now and doing at 10%", () => {
    const p = startBuild(byId(buildProjects(), "BUG-CUS"), cal, NOW);
    expect(p.status).toBe("active");
    expect(p.startDate).toBe("2026-10-01");
    expect(p.tasks[0]).toMatchObject({ start: NOW, status: "doing", pct: 10, pinnedStart: NOW });
    expect(p.tasks[1].start).toBe(cal.norm(p.tasks[0].end!));
  });
});

describe("save a build as a template", () => {
  it("copies stages, tasks and parts with planned hours, and actual hours where finished", async () => {
    const { makeCalendar } = await import("../calendar");
    const { DEFAULT_SETTINGS } = await import("../settings");
    const { templateFromBuild } = await import("../work");
    const c = makeCalendar(DEFAULT_SETTINGS); // 09–18, lunch 13–14
    const base = { prevSegs: [], planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, tech: "x", segStart: null };
    const p = {
      id: "P", serial: "S", name: "N", status: "active" as const, startDate: "2026-10-05", deliveryDate: null, deliveredOn: null,
      stages: [{ id: "s1", name: "Make Mold", stationType: "modification", stationId: null, partHours: 8 }],
      parts: [{ id: "a", name: "Bonnet" }, { id: "b", name: "Bumper" }],
      tasks: [
        { id: "t2", num: 2, stageId: "s1", name: "Mold cure", assignee: null, status: "todo" as const, durH: 16, pct: 0, start: null, end: null, pinnedStart: null, actualStart: null, actualEnd: null, notes: "" },
        { id: "t1", num: 1, stageId: "s1", name: "Mold layup", assignee: null, status: "done" as const, durH: 24, pct: 100, start: null, end: null, pinnedStart: null,
          actualStart: "2026-10-05T09:00", actualEnd: "2026-10-06T12:00", notes: "" },
      ],
      baseline: {},
      work: [
        { ...base, id: "w1", stageId: "s1", partId: "a", status: "done" as const, start: "2026-10-05T09:00", end: "2026-10-05T15:00" },
        { ...base, id: "w2", stageId: "s1", partId: "b", status: "todo" as const, start: null, end: null },
      ],
    };
    expect(templateFromBuild(p, "plan", c, "2026-10-07T10:00")).toEqual({
      stages: [{ name: "Make Mold", stationType: "modification", partHours: 8, tasks: [{ name: "Mold layup", durH: 24 }, { name: "Mold cure", durH: 16 }] }],
      parts: ["Bonnet", "Bumper"],
    });
    // Actual: Mold layup took 8h + 3h = 11h; the finished Bonnet step took 5h (09–15 less lunch); Mold cure keeps its plan.
    expect(templateFromBuild(p, "actual", c, "2026-10-07T10:00").stages[0]).toEqual(
      { name: "Make Mold", stationType: "modification", partHours: 5, tasks: [{ name: "Mold layup", durH: 11 }, { name: "Mold cure", durH: 16 }] },
    );
  });
});
