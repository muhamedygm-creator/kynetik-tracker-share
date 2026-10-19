import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { atOffset, insertionPoint, mondayOf, offsetH, plannedH, weekDays } from "../plan";
import { layoutQueue, type QueueTask } from "../queue";
import { DEFAULT_SETTINGS } from "../settings";

// D9 calendar: 09:00–18:00, lunch 13:00–14:00, Sunday off. Mon 5 Oct 2026 … Sat 10 Oct.
const cal = makeCalendar(DEFAULT_SETTINGS);
let n = 0;
const task = (over: Partial<QueueTask>): QueueTask => ({
  id: `t${++n}`, personId: "p", title: "Task", durValue: 2, durUnit: "hours", status: "todo",
  fixedStart: null, actualStart: null, actualEnd: null, position: `a${n}`, ...over,
});

describe("week planner geometry", () => {
  it("finds the Monday and the working days of a week", () => {
    expect(mondayOf("2026-10-07")).toBe("2026-10-05");
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-11")).toBe("2026-10-05"); // Sunday belongs to the week before
    expect(weekDays(cal, "2026-10-05")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
  });

  it("converts times to working-hour offsets and back, skipping lunch", () => {
    expect(offsetH(cal, "2026-10-05", "2026-10-05T09:00")).toBe(0);
    expect(offsetH(cal, "2026-10-05", "2026-10-05T13:30")).toBe(4); // lunch takes no space
    expect(offsetH(cal, "2026-10-05", "2026-10-05T15:00")).toBe(5);
    expect(offsetH(cal, "2026-10-05", "2026-10-05T20:00")).toBe(8);
    expect(atOffset(cal, "2026-10-05", 0)).toBe("2026-10-05T09:00");
    expect(atOffset(cal, "2026-10-05", 4.5)).toBe("2026-10-05T14:30");
    expect(atOffset(cal, "2026-10-05", 8)).toBe("2026-10-05T18:00");
  });

  it("inserts a dropped task before the first waiting task that starts at or after the drop", () => {
    const a = task({ position: "a0" }), b = task({ position: "a1" }), c = task({ position: "a2" });
    const placed = layoutQueue([a, b, c], cal, "2026-10-05T09:00"); // a 09–11, b 11–13, c 14–16
    expect(insertionPoint(placed, "2026-10-05T11:00")).toEqual({ afterId: a.id, beforeId: b.id });
    expect(insertionPoint(placed, "2026-10-05T09:00")).toEqual({ afterId: null, beforeId: a.id });
    expect(insertionPoint(placed, "2026-10-05T17:00")).toEqual({ afterId: c.id, beforeId: null });
  });

  it("counts planned hours inside a window", () => {
    const a = task({ position: "a0", durValue: 6 }), blocked = task({ position: "a1", status: "blocked" });
    const placed = layoutQueue([a, blocked], cal, "2026-10-05T09:00");
    expect(plannedH(cal, placed, "2026-10-05T00:00", "2026-10-06T00:00")).toBe(6);
    expect(plannedH(cal, placed, "2026-10-05T12:00", "2026-10-06T00:00")).toBe(3);
  });
});
