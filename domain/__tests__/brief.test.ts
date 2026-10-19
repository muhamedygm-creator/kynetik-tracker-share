import { describe, expect, it } from "vitest";
import { morningBrief, type BriefInput } from "../brief";
import { makeCalendar } from "../calendar";
import { fmtHM } from "../format";
import { DEFAULT_SETTINGS } from "../settings";
import type { Project, WorkItem } from "../types";

// D9 calendar: 09:00–18:00, lunch 13:00–14:00, Sunday off. Thu 8 Oct 2026; the last working day is Wed 7 Oct.
const cal = makeCalendar(DEFAULT_SETTINGS);
const NOW = "2026-10-08T08:30";

const item = (o: Partial<WorkItem> & Pick<WorkItem, "id" | "stageId" | "partId">): WorkItem => ({
  status: "todo", tech: null, start: null, end: null, segStart: null, prevSegs: [], planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, ...o,
});

function project(): Project {
  return {
    id: "P1", serial: "EXT-001", name: "Exterior Parts", status: "active", startDate: "2026-10-01", deliveryDate: "2026-10-18", deliveredOn: null,
    stages: [
      { id: "s1", name: "Make Mold", stationType: "modification", stationId: null, partHours: 8 },
      { id: "s2", name: "Painting", stationType: "paint", stationId: null, partHours: 8 },
    ],
    parts: [{ id: "a", name: "Bonnet" }, { id: "b", name: "Bumper" }, { id: "c", name: "Wing" }],
    tasks: [], baseline: {},
    work: [
      item({ id: "w1", stageId: "s1", partId: "a", status: "done", tech: "toto", start: "2026-10-07T09:00", end: "2026-10-07T15:00" }),
      item({ id: "w2", stageId: "s2", partId: "a" }),
      item({ id: "w3", stageId: "s1", partId: "b", status: "doing", tech: "toto", start: "2026-10-07T15:00", segStart: "2026-10-07T15:00" }),
      item({ id: "w4", stageId: "s2", partId: "b" }),
      item({ id: "w5", stageId: "s1", partId: "c", status: "blocked" }),
      item({ id: "w6", stageId: "s2", partId: "c" }),
    ],
  };
}

const input = (over: Partial<BriefInput> = {}): BriefInput => ({
  builds: [{ project: project(), health: "late", forecastFinish: "2026-10-21" }],
  people: [
    { id: "toto", name: "Toto", departmentId: "mod", active: true, production: true },
    { id: "norlen", name: "Norlen", departmentId: "mod", active: true, production: true },
  ],
  departments: [{ id: "mod", key: "modification", name: "Modification" }, { id: "paint", key: "paint", name: "Paint & Finish" }],
  queue: [
    { id: "q1", personId: "toto", title: "Finish bumper mold", durValue: 3, durUnit: "hours", status: "todo", fixedStart: null, actualStart: null, actualEnd: null, position: "a0", projectId: "P1", workItemId: "w3" },
    { id: "q2", personId: "toto", title: "Workshop clean-up", durValue: 6, durUnit: "hours", status: "todo", fixedStart: null, actualStart: null, actualEnd: null, position: "a1", projectId: null, workItemId: null },
  ],
  cal, now: NOW, ...over,
});

describe("morning brief", () => {
  it("recaps the last working day: finished, still in progress, blocked", () => {
    const b = morningBrief(input());
    expect(b.lastDay).toBe("2026-10-07");
    expect(b.finished.map((s) => `${s.serial} ${s.stage} ${s.part} ${s.person}`)).toEqual(["EXT-001 Make Mold Bonnet Toto"]);
    expect(b.inProgress.map((s) => s.part)).toEqual(["Bumper"]);
    expect(b.blocked.map((s) => s.part)).toEqual(["Wing"]);
  });

  it("lays out today per person from their queue, with free time", () => {
    const b = morningBrief(input());
    const toto = b.people.find((p) => p.name === "Toto")!;
    expect(toto.tasks.map((t) => [t.title, t.start, t.end])).toEqual([
      ["Finish bumper mold", "2026-10-08T09:00", "2026-10-08T12:00"],
      ["Workshop clean-up", "2026-10-08T12:00", "2026-10-08T18:00"],
    ]);
    expect(toto.plannedH).toBe(8);
    expect(toto.freeH).toBe(0);
    expect(b.people.find((p) => p.name === "Norlen")!.freeH).toBe(8);
    expect(b.dayStart).toBe("2026-10-08T09:00");
  });

  it("recommends from the data: late build, blocked step, empty department, free people", () => {
    const texts = morningBrief(input()).recommendations.map((r) => r.text);
    expect(texts[0]).toBe("EXT-001 Exterior Parts forecasts 21 Oct against a promise of 18 Oct. Plan its waiting steps first.");
    expect(texts).toContain("EXT-001 · Make Mold · Wing is blocked. Check what it is waiting for.");
    // Bonnet's current step is Painting, and Paint & Finish has nobody in it.
    expect(texts).toContain("Paint & Finish has nobody assigned, and 1 part step is waiting there. Add people to the department under Crew.");
    // Bumper is on Toto's queue and Wing is blocked, so nothing waits in Modification: no "free" line.
    expect(texts.some((t) => t.includes("free"))).toBe(false);
  });

  it("gives the helper its facts: free time, next tasks, waiting steps, why a build is late", () => {
    const b = morningBrief(input());
    const norlen = b.people.find((p) => p.name === "Norlen")!;
    expect(norlen.freeFrom).toBe("2026-10-08T09:00");
    expect(norlen.freeH).toBe(8);
    // Later in the day only the hours left count.
    const late = morningBrief(input({ now: "2026-10-08T15:30" })).people.find((p) => p.name === "Norlen")!;
    expect([late.freeFrom, late.freeH]).toEqual(["2026-10-08T15:30", 2.5]);
    expect(b.people.find((p) => p.name === "Toto")!.freeFrom).toBeNull();
    expect(b.people.find((p) => p.name === "Toto")!.next.map((t) => t.title)).toEqual(["Finish bumper mold", "Workshop clean-up"]);
    // Bonnet waits for Painting (8h stage standard); Bumper is on Toto's queue; Wing is blocked.
    expect(b.waiting.map((w) => [w.part, w.stage, w.hours])).toEqual([["Bonnet", "Painting", 8]]);
    expect(b.builds).toEqual([{
      projectId: "P1", serial: "EXT-001", name: "Exterior Parts", health: "late", forecast: "2026-10-21", promised: "2026-10-18",
      stepsLeft: 5, tasksLeft: 0, waiting: 1, blocked: 1, inProgress: 1, stagesNow: ["Make Mold"],
    }]);
  });

  it("formats working time in hours and minutes", () => {
    expect(fmtHM(2.5)).toBe("2h 30m");
    expect(fmtHM(0.75)).toBe("45 min");
    expect(fmtHM(3)).toBe("3h");
  });
});
