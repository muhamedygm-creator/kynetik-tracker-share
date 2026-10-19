import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { DEFAULT_SETTINGS } from "../settings";
import { masterCounts, masterFilter, masterSort, snapMove, timelineRange } from "../timeline";
import type { Project, WorkItem } from "../types";

const cal = makeCalendar(DEFAULT_SETTINGS); // 09–18, lunch 13–14, Sunday off
const px = DEFAULT_SETTINGS.timeline.pxPerDay; // hours 72 · day 24 · week 8 · month 3

describe("timeline drag", () => {
  it("snaps to whole days and starts at the shift start", () => {
    expect(snapMove("2026-10-05T14:00", 24 * 2, "day", px, cal)).toBe("2026-10-07T09:00");
    expect(snapMove("2026-10-05T14:00", 8 * 3 + 3, "week", px, cal)).toBe("2026-10-08T09:00"); // 27px ≈ 3.4 days → 3
  });

  it("a drop on a rest day moves to the next working day", () => {
    expect(snapMove("2026-10-02T09:00", 24 * 2, "day", px, cal)).toBe("2026-10-05T09:00"); // Fri + 2 = Sun → Mon
  });

  it("a tiny drag doesn't move the task", () => {
    expect(snapMove("2026-10-05T14:00", 5, "day", px, cal)).toBe("2026-10-05T14:00");
  });

  it("in the Hours zoom it snaps to whole hours on working time", () => {
    expect(snapMove("2026-10-05T09:00", 3 * 3, "hours", px, cal)).toBe("2026-10-05T12:00"); // 3px = 1h
    expect(snapMove("2026-10-05T12:00", 3, "hours", px, cal)).toBe("2026-10-05T14:00"); // 13:00 is lunch → 14:00
  });

  it("range pads the earliest and latest dates", () => {
    expect(timelineRange(["2026-10-05T09:00", null, "2026-11-30T18:00"], "2026-10-02T10:00")).toEqual({ from: "2026-09-29", to: "2026-12-07" });
  });
});

const wi = (o: Partial<WorkItem> & { id: string }): WorkItem => ({
  stageId: "s", partId: "p", status: "todo", tech: null, start: null, end: null, segStart: null, prevSegs: [], planH: null, rework: 0, reworkLog: [], notes: "", hours: 0, hoursBy: {}, ...o,
});
const proj = (id: string, status: Project["status"], work: WorkItem[], deliveredOn: string | null = null): Project => ({
  id, serial: id, name: id, status, startDate: "2026-09-01", deliveryDate: null, deliveredOn, stages: [], parts: [], tasks: [], baseline: {}, work,
});

describe("timeline master view", () => {
  it("counts builds by status, blocked steps, this week's finishes and who is at work", () => {
    const c = masterCounts({
      builds: [
        { project: proj("A", "active", [wi({ id: "1", status: "blocked" }), wi({ id: "2", status: "doing", tech: "toto" }), wi({ id: "3", status: "done", end: "2026-10-06T10:00" })]), health: "late" },
        { project: proj("B", "hold", [wi({ id: "4", status: "done", end: "2026-10-02T10:00" })]), health: "hold" },
        { project: proj("C", "planned", []), health: "unset" },
        { project: proj("D", "done", [wi({ id: "5", status: "done", end: "2026-10-05T12:00" })], "2026-10-05"), health: "done" },
      ],
      queue: [{ personId: "norlen", status: "doing" }, { personId: "nino", status: "todo" }],
      crewIds: ["toto", "norlen", "nino"],
      monday: "2026-10-05",
    });
    expect(c).toEqual({ active: 1, hold: 1, planned: 1, late: 1, blockedSteps: 1, blockedBuilds: 1, doneThisWeek: 2, deliveredThisWeek: 1, atWork: 2, crew: 3 });
  });

  it("puts late and blocked builds first, keeping the board order otherwise", () => {
    const rows = [
      { id: "a", health: "ok" as const, blocked: 0 }, { id: "b", health: "risk" as const, blocked: 1 },
      { id: "c", health: "ok" as const, blocked: 0 }, { id: "d", health: "late" as const, blocked: 0 },
    ];
    expect(masterSort(rows).map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("filters by the status chips", () => {
    const b = { status: "active" as const, health: "late" as const, blocked: 0 };
    expect(["all", "active", "hold", "late", "blocked"].map((f) => masterFilter(f as never, b))).toEqual([true, true, false, true, false]);
  });
});
