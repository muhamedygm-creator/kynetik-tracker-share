import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { DisplaySnapshot, buildDisplaySnapshot, type DisplayInput } from "../display";
import { DEFAULT_SETTINGS } from "../settings";
import { buildProjects } from "./fixtures";

const cal = makeCalendar(DEFAULT_SETTINGS);
const projects = buildProjects();
const ext = projects.find((p) => p.id === "EXT-001")!;
const paint = { id: "dept-paint", name: "Paint & Finish", emoji: "🎨", colour: "#C58B5A" };
const people = [
  { id: "nino", name: "Nino", initials: "N", photoUrl: null, departmentId: "dept-paint", active: true, costClass: "production" },
  { id: "toto", name: "Toto", initials: "T", photoUrl: "https://x/photo.jpg", departmentId: "dept-paint", active: true, costClass: "production" },
  { id: "ahmad", name: "Ahmad", initials: "A", photoUrl: null, departmentId: "dept-mod", active: true, costClass: "production" },
];
const q = (over: Partial<DisplayInput["queue"][number]>): DisplayInput["queue"][number] => ({
  id: "q", personId: "nino", title: "Task", durValue: 3, durUnit: "hours", status: "todo", fixedStart: null, actualStart: null,
  actualEnd: null, position: "a0", projectId: null, stageId: null, workItemId: null, colour: null, ...over,
});
const input = (over: Partial<DisplayInput> = {}): DisplayInput => ({
  display: { name: "Paint bay TV", leaderboardMode: "side", confetti: true },
  department: paint, brand: { appName: "BUILD TRACKER", company: "Kynetik Koncepts" }, people, projects, cal,
  now: "2026-10-05T10:00", labels: DEFAULT_SETTINGS.labels, scoring: DEFAULT_SETTINGS.scoring, game: DEFAULT_SETTINGS.gamification,
  period: "week", conveyor: DEFAULT_SETTINGS.timeline.conveyor,
  queue: [
    q({ id: "a", title: "Sand bonnet", position: "a0", durValue: 3, projectId: ext.id, workItemId: ext.work[0].id }),
    q({ id: "b", title: "Paint rear bumper", position: "a1", durValue: 2, durUnit: "days" }),
    q({ id: "c", personId: "ahmad", title: "Mold layup" }),
  ],
  ...over,
});

describe("display snapshot", () => {
  const s = buildDisplaySnapshot(input());

  it("shows only the display's department", () => {
    expect(s.rows.map((r) => r.name)).toEqual(["Nino", "Toto"]);
    expect(JSON.stringify(s)).not.toContain("Mold layup");
    expect(s.leaderboard.entries.map((e) => e.name).sort()).toEqual(["Nino", "Toto"]);
  });

  it("acceptance: a 3h bar from now, then the 2-day bar running to 18:00 and continuing", () => {
    const nino = s.rows[0];
    // 3h from 10:00 ends as lunch starts; the 2-day (16h) task runs 14:00–18:00 today, all of Tuesday, Wednesday morning.
    expect(nino.items.map((x) => [x.title, x.start.slice(11), x.end.slice(11), x.dayLabel, x.continues])).toEqual([
      ["Sand bonnet", "10:00", "13:00", null, false],
      ["Paint rear bumper", "14:00", "18:00", "Day 1 of 3", true],
    ]);
    expect(nino.items[0].link).toBe("EXT-001 · Premold Prep · Left Front Fender");
    expect(nino.idleUntil).toBe("2026-10-05T10:00");
    expect(s.rows[1].items).toEqual([]); // Toto: empty queue
  });

  it("never carries cost, salary or rate fields", () => {
    expect(JSON.stringify(s)).not.toMatch(/cost|salary|rate|labour|loading/i);
  });

  it("the schema refuses any field it doesn't list", () => {
    const leaky = { ...s, rows: [{ ...s.rows[0], hourRate: 31.25 }] };
    expect(DisplaySnapshot.safeParse(leaky).success).toBe(false);
    expect(DisplaySnapshot.safeParse({ ...s, cost: 1 }).success).toBe(false);
  });

  it("a display without a department shows nobody", () => {
    expect(buildDisplaySnapshot(input({ department: null })).rows).toEqual([]);
  });

  it("day window and lunch break come from the calendar", () => {
    expect(s.day).toEqual({ date: "2026-10-05", isToday: true, start: "2026-10-05T09:00", end: "2026-10-05T18:00", breaks: [["2026-10-05T13:00", "2026-10-05T14:00"]] });
    const sunday = buildDisplaySnapshot(input({ now: "2026-10-04T10:00" }));
    expect([sunday.day.date, sunday.day.isToday]).toEqual(["2026-10-05", false]);
  });

  it("passes today's notices, lists today's finishes and this week's totals for the department only", () => {
    const done = buildDisplaySnapshot(input({
      now: "2026-10-05T15:00",
      notices: [{ icon: "🔍", title: "Quality check", detail: "Bay 1", at: "2026-10-05T16:00" }],
      queue: [
        q({ id: "d", title: "Mask doors", status: "done", actualStart: "2026-10-05T09:00", actualEnd: "2026-10-05T11:00", priority: "urgent" }),
        q({ id: "e", personId: "ahmad", title: "Other dept", status: "done", actualStart: "2026-10-05T09:00", actualEnd: "2026-10-05T10:00" }),
      ],
    }));
    expect(done.notices).toEqual([{ icon: "🔍", title: "Quality check", detail: "Bay 1", at: "2026-10-05T16:00" }]);
    expect(done.finishedToday).toEqual([{ name: "Nino", title: "Mask doors", at: "2026-10-05T11:00" }]);
    expect(done.week.finished).toBe(1);
    expect(done.rows[0].items[0].urgent).toBe(true);
  });

  it("flags tasks waiting for QC (a Floor Station request), never done ones", () => {
    const r = buildDisplaySnapshot(input({ qcRequested: ["b"] })).rows.find((x) => x.personId === "nino")!;
    expect(r.items.find((x) => x.id === "b")?.qc).toBe(true);
    expect(r.items.find((x) => x.id === "a")?.qc).toBe(false);
  });

  it("carries the conveyor window, banner timings and quotes from settings", () => {
    const s2 = buildDisplaySnapshot(input());
    expect(s2.conveyor).toEqual(DEFAULT_SETTINGS.timeline.conveyor);
    expect(s2.banner.wrapUpMins).toBe(30);
    expect(s2.quotes.length).toBeGreaterThan(0);
  });
});
