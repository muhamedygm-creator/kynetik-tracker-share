import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { applyQueueStatus, checkStart, dayRow, daySegments, durationH, durationLabel, layoutQueue, parseDuration, queueOnTime, type QueueTask } from "../queue";
import { DEFAULT_SETTINGS } from "../settings";
import { fmtHM } from "../format";

// D9 calendar: 09:00–18:00, lunch 13:00–14:00, Sunday off. Fri 2 Oct 2026; Sat 3; Sun 4 (rest); Mon 5.
const cal = makeCalendar(DEFAULT_SETTINGS);
let n = 0;
const task = (over: Partial<QueueTask>): QueueTask => ({
  id: `t${++n}`, personId: "nino", title: "Task", durValue: 3, durUnit: "hours", status: "todo",
  fixedStart: null, actualStart: null, actualEnd: null, position: `a${n}`, ...over,
});
const at = (ps: ReturnType<typeof layoutQueue>, id: string) => ps.find((p) => p.task.id === id)!;

describe("queue scheduling (Phase 3.5)", () => {
  it("durations: hours, or days × working hours in a day", () => {
    expect(durationH({ durValue: 3, durUnit: "hours" }, 8)).toBe(3);
    expect(durationH({ durValue: 2, durUnit: "days" }, 8)).toBe(16);
    expect(durationLabel({ durValue: 2, durUnit: "days" })).toBe("2 days");
    expect(durationLabel({ durValue: 3, durUnit: "hours" })).toBe("3h");
  });

  it("an hours task fills only its hours and the next starts where it ends", () => {
    const a = task({ durValue: 3, position: "a0" }), b = task({ durValue: 2, position: "a1" });
    const p = layoutQueue([b, a], cal, "2026-10-05T09:00");
    expect([at(p, a.id).start, at(p, a.id).end]).toEqual(["2026-10-05T09:00", "2026-10-05T12:00"]);
    expect([at(p, b.id).start, at(p, b.id).end]).toEqual(["2026-10-05T12:00", "2026-10-05T15:00"]); // lunch skipped
  });

  it("a 2-day task from 09:00 fills today's row and tomorrow's (Day 1 of 2)", () => {
    const t = task({ durValue: 2, durUnit: "days" });
    const p = at(layoutQueue([t], cal, "2026-10-05T09:00"), t.id);
    expect(p.end).toBe("2026-10-06T18:00");
    expect(p.segments.map((s) => [s.date, s.start.slice(11), s.end.slice(11), s.day, s.days, s.continues])).toEqual([
      ["2026-10-05", "09:00", "18:00", 1, 2, true],
      ["2026-10-06", "09:00", "18:00", 2, 2, false],
    ]);
  });

  it("a task longer than the rest of the day fills the row to 18:00 and continues", () => {
    const t = task({ durValue: 4 });
    const p = at(layoutQueue([t], cal, "2026-10-05T16:00"), t.id);
    expect(p.segments.map((s) => [s.start, s.end])).toEqual([["2026-10-05T16:00", "2026-10-05T18:00"], ["2026-10-06T09:00", "2026-10-06T11:00"]]);
  });

  it("crossing the rest day skips Sunday", () => {
    const t = task({ durValue: 6 });
    const p = at(layoutQueue([t], cal, "2026-10-03T15:00"), t.id); // Saturday afternoon
    expect(p.segments.map((s) => s.date)).toEqual(["2026-10-03", "2026-10-05"]);
    expect(p.end).toBe("2026-10-05T12:00");
  });

  it("overrun: an unfinished task past its time keeps growing to now and pushes the rest", () => {
    const cur = task({ status: "doing", durValue: 2, actualStart: "2026-10-05T09:00", position: "a0" });
    const next = task({ durValue: 1, position: "a1" });
    const p = layoutQueue([cur, next], cal, "2026-10-05T12:30");
    expect(at(p, cur.id)).toMatchObject({ overrun: true, plannedEnd: "2026-10-05T11:00", end: "2026-10-05T12:30", current: true });
    expect([at(p, next.id).start, at(p, next.id).end]).toEqual(["2026-10-05T12:30", "2026-10-05T14:30"]);
  });

  it("reorder → reschedule: moving the 3h task to the top puts it first, the 2-day task after it", () => {
    const twoDay = task({ durValue: 2, durUnit: "days", position: "a0" });
    const three = task({ durValue: 3, position: "a1" });
    const before = layoutQueue([twoDay, three], cal, "2026-10-05T10:00");
    expect(at(before, twoDay.id).start).toBe("2026-10-05T10:00");
    const moved = { ...three, position: "Zz" }; // a key before "a0"
    const after = layoutQueue([twoDay, moved], cal, "2026-10-05T10:00");
    expect([at(after, three.id).start, at(after, three.id).end]).toEqual(["2026-10-05T10:00", "2026-10-05T13:00"]); // ends as lunch starts
    expect([at(after, twoDay.id).start, at(after, twoDay.id).end]).toEqual(["2026-10-05T14:00", "2026-10-07T13:00"]); // 4h + 8h + 4h
  });

  it("the current task goes first on the clock, wherever it sits in the list", () => {
    const todo = task({ position: "a0" });
    const cur = task({ status: "doing", actualStart: "2026-10-05T09:00", durValue: 2, position: "a1" });
    const p = layoutQueue([todo, cur], cal, "2026-10-05T10:00");
    expect(at(p, todo.id).start).toBe("2026-10-05T11:00");
  });

  it("fixed start means 'not before'; if the queue runs late it is pushed and flagged (D13)", () => {
    const a = task({ durValue: 4, position: "a0" });
    const fixedLater = task({ durValue: 1, fixedStart: "2026-10-05T16:00", position: "a1" });
    const p1 = layoutQueue([a, fixedLater], cal, "2026-10-05T09:00");
    expect(at(p1, fixedLater.id)).toMatchObject({ start: "2026-10-05T16:00", lateStart: false });
    const fixedEarly = { ...fixedLater, fixedStart: "2026-10-05T10:00" };
    const p2 = layoutQueue([a, fixedEarly], cal, "2026-10-05T09:00");
    expect(at(p2, fixedLater.id)).toMatchObject({ start: "2026-10-05T14:00", lateStart: true });
  });

  it("a blocked task takes no time; the next one moves up (D12)", () => {
    const blocked = task({ status: "blocked", position: "a0" });
    const next = task({ durValue: 2, position: "a1" });
    const p = layoutQueue([blocked, next], cal, "2026-10-05T09:00");
    expect(at(p, blocked.id)).toMatchObject({ blocked: true, start: "2026-10-05T09:00", end: "2026-10-05T09:00", segments: [] });
    expect(at(p, next.id).start).toBe("2026-10-05T09:00");
  });

  it("done tasks sit at their actual times and don't take future time", () => {
    const done = task({ status: "done", actualStart: "2026-10-05T09:00", actualEnd: "2026-10-05T10:30", position: "a0" });
    const next = task({ position: "a1" });
    const p = layoutQueue([done, next], cal, "2026-10-05T11:00");
    expect(at(p, done.id).segments[0]).toMatchObject({ start: "2026-10-05T09:00", end: "2026-10-05T10:30" });
    expect(at(p, next.id).start).toBe("2026-10-05T11:00");
  });

  it("day row: today's segments in clock order, '+N more' for tasks starting after today", () => {
    const a = task({ durValue: 6, position: "a0" }), b = task({ durValue: 3, position: "a1" }), c = task({ durValue: 1, position: "a2" });
    const row = dayRow(layoutQueue([a, b, c], cal, "2026-10-05T09:00"), "2026-10-05");
    expect(row.items.map((x) => x.placed.task.id)).toEqual([a.id, b.id]); // b runs 16:00 → next day 10:00
    expect(row.more).toBe(1);
  });

  it("one task in progress at a time (§9 wording)", () => {
    const open = task({ title: "Sand bonnet", status: "doing", actualStart: "2026-10-05T09:00" });
    const other = task({ title: "Primer" });
    expect(checkStart("Nino", [open, other], other.id, "2026-10-05T10:00")).toBe(
      "Blocked — Nino is already on Sand bonnet (5 Oct 09:00 – now). A technician can only work one stage/part at a time. Finish or block that first, or pick someone else.",
    );
    expect(checkStart("Nino", [open, other], open.id, "2026-10-05T10:00")).toBeNull();
  });

  it("status side-effects and on-time", () => {
    const t = applyQueueStatus(task({ durValue: 2 }), "doing", "2026-10-05T09:00");
    const done = applyQueueStatus(t, "done", "2026-10-05T11:00");
    expect([done.actualStart, done.actualEnd]).toEqual(["2026-10-05T09:00", "2026-10-05T11:00"]);
    expect(queueOnTime(done, cal, 0.01)).toBe(true);
    expect(queueOnTime({ ...done, actualEnd: "2026-10-05T11:30" }, cal, 0.01)).toBe(false);
    expect(daySegments("2026-10-05T13:00", "2026-10-05T14:00", cal)).toEqual([]); // lunch only
  });
});

describe("typed durations (hours and minutes)", () => {
  it("reads the ways people write a duration", () => {
    const cases: [string, number | null][] = [
      ["2h 30m", 2.5], ["2h30", 2.5], ["1h45min", 1.75], ["90m", 1.5], ["90 min", 1.5], ["1.5h", 1.5], ["1,5", 1.5],
      ["2:30", 2.5], ["3", 3], ["45m", 0.75], ["5 min", 1 / 12], ["10 hours", 10],
      ["", null], ["abc", null], ["2 min", null], ["0", null], ["500h", null], ["2:75", null],
    ];
    for (const [text, h] of cases) expect([text, parseDuration(text)]).toEqual([text, h]);
  });

  it("labels hours with minutes", () => {
    expect(durationLabel({ durValue: 2.5, durUnit: "hours" })).toBe("2h 30m");
    expect(durationLabel({ durValue: 0.75, durUnit: "hours" })).toBe("45 min");
  });
});

describe("task time in minutes, hours or days (AM-28)", () => {
  it("reads days as the working hours of one shift", () => {
    expect(parseDuration("1d", 8)).toBe(8);
    expect(parseDuration("1.5 days", 8)).toBe(12);
    expect(parseDuration("1d 2h 30m", 8)).toBe(10.5);
    expect(parseDuration("45 min", 8)).toBe(0.75);
    expect(parseDuration("1d")).toBeNull(); // no day length given
  });

  it("shows 45 min, 2h 30m and 1d 2h", () => {
    expect(fmtHM(0.75, 8)).toBe("45 min");
    expect(fmtHM(2.5, 8)).toBe("2h 30m");
    expect(fmtHM(10, 8)).toBe("1d 2h");
    expect(fmtHM(16.25, 8)).toBe("2d 15m");
    expect(durationLabel({ durValue: 2, durUnit: "days" }, 8)).toBe("2d");
  });
});
