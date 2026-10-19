import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { departmentBoard, periodWindows, streakDays, visibleEntries } from "../gamification";
import type { QueueTask } from "../queue";
import { techStats } from "../scoring";
import { DEFAULT_SETTINGS } from "../settings";
import type { Project, WorkItem } from "../types";

const cal = makeCalendar(DEFAULT_SETTINGS); // 09–18, lunch 13–14, Sunday off
const NOW = "2026-10-08T17:00"; // Thursday
const game = DEFAULT_SETTINGS.gamification;
const scoring = DEFAULT_SETTINGS.scoring;
const people = [{ id: "toto", name: "Toto" }, { id: "nino", name: "Nino" }, { id: "yan", name: "Yan" }, { id: "tai", name: "Tai" }];

let i = 0;
/** A done part-step: `h` working hours on a day, standard 4h. */
const step = (tech: string, day: string, h: number, rework = 0): WorkItem => {
  const start = `${day}T09:00`;
  return {
    id: `w${++i}`, stageId: "st", partId: `p${i}`, status: "done", tech, start, end: cal.addWH(start, h), segStart: start, prevSegs: [],
    planH: null, rework, reworkLog: [], notes: "", hours: 0, hoursBy: {},
  };
};
const project = (work: WorkItem[]): Project => ({
  id: "x", serial: "X", name: "", status: "active", startDate: "2026-09-01", deliveryDate: null, deliveredOn: null,
  stages: [{ id: "st", name: "Paint", stationType: "paint", stationId: null, partHours: 4 }], parts: [], tasks: [], baseline: {}, work,
});
const qdone = (personId: string, day: string, hours: number, took: number): QueueTask => ({
  id: `q${++i}`, personId, title: "t", durValue: hours, durUnit: "hours", status: "done", fixedStart: null,
  actualStart: `${day}T09:00`, actualEnd: cal.addWH(`${day}T09:00`, took), position: `a${i}`,
});

// This week (Mon 5 – Thu 8): Toto 3 on time first-time-right; Nino 3 on time, 1 rework; Yan 3 slow; Tai 1 (warming up).
const work = [
  step("toto", "2026-10-05", 3), step("toto", "2026-10-06", 3), step("toto", "2026-10-07", 4),
  step("nino", "2026-10-05", 4), step("nino", "2026-10-06", 4, 1), step("nino", "2026-10-07", 4),
  step("yan", "2026-10-05", 8), step("yan", "2026-10-06", 8), step("yan", "2026-10-07", 8),
  step("tai", "2026-10-07", 4),
  // last week: Yan was 1st, Toto 3rd
  step("yan", "2026-09-29", 2), step("yan", "2026-09-30", 2), step("yan", "2026-10-01", 2),
  step("toto", "2026-09-29", 8), step("toto", "2026-09-30", 8), step("toto", "2026-10-01", 8),
  step("nino", "2026-09-29", 4), step("nino", "2026-09-30", 4), step("nino", "2026-10-01", 4),
];
const projects = [project(work)];
const queue = [qdone("tai", "2026-10-06", 2, 2), qdone("tai", "2026-10-07", 2, 2), qdone("tai", "2026-10-08", 2, 2), qdone("tai", "2026-10-05", 2, 2)];
const board = departmentBoard({ people, projects, queue, cal, now: NOW, period: "week", scoring, game });
const by = (id: string) => board.find((e) => e.personId === id)!;
const emojis = (id: string) => by(id).badges.map((b) => b.emoji).join("");

describe("department leaderboard (Phase 3.5)", () => {
  it("weeks start Monday; the previous period has the same length", () => {
    const w = periodWindows("week", NOW, cal);
    expect(w.current.from).toBe("2026-10-05T00:00");
    expect(w.previous).toEqual({ from: "2026-09-28T00:00", to: "2026-10-04T23:59" });
    expect(periodWindows("today", NOW, cal).previous.from).toBe("2026-10-07T00:00");
    expect(periodWindows("month", NOW, cal).current.from).toBe("2026-10-01T00:00");
  });

  it("rolling 7 days covers today and the 6 days before, so it is never empty after a weekend", () => {
    const w = periodWindows("7d", NOW, cal);
    expect(w.current).toEqual({ from: "2026-10-02T00:00", to: NOW });
    expect(w.previous).toEqual({ from: "2026-09-25T00:00", to: "2026-10-01T23:59" });
  });

  it("order matches the §11 scores", () => {
    const w = periodWindows("week", NOW, cal).current;
    const scores = people.map((p) => [p.id, techStats(p, projects, cal, NOW, w, scoring).score] as const);
    const expected = scores.filter(([, s]) => s !== null).sort((a, b) => b[1]! - a[1]!).map(([id]) => id);
    expect(board.filter((e) => e.rank !== null).map((e) => e.personId)).toEqual(expected);
    expect(board.map((e) => [e.personId, e.rank])).toEqual([["toto", 1], ["nino", 2], ["yan", 3], ["tai", null]]);
  });

  it("badges follow their rules", () => {
    expect(emojis("toto")).toContain("🥇");
    expect(emojis("toto")).toContain("🎯"); // FTR 100%
    expect(emojis("toto")).toContain("⚡"); // best pace
    expect(emojis("toto")).toContain("📈"); // 3rd → 1st
    expect(emojis("nino")).toContain("🥈");
    expect(emojis("nino")).not.toContain("🎯"); // one rework
    expect(emojis("yan")).toContain("🥉");
    expect(emojis("tai")).toContain("🐢"); // below the minimum of 3 → warming up (D15)
    expect(emojis("tai")).toContain("🚀"); // 4 queue tasks this week (+1 part-step) is the most
    expect(emojis("tai")).toContain("🔥"); // on time Mon–Thu
    expect(by("tai").score).toBeNull();
    expect(by("tai").line).toBeTruthy();
    expect(by("toto").line).toBeNull();
  });

  it("streak: consecutive working days with an on-time finish, skipping the rest day", () => {
    const fin = [{ at: "2026-10-03T10:00", onTime: true }, { at: "2026-10-05T10:00", onTime: true }, { at: "2026-10-06T10:00", onTime: true }];
    expect(streakDays(fin, "2026-10-06T17:00", cal)).toBe(3); // Sat, (Sun off), Mon, Tue
    expect(streakDays(fin, "2026-10-07T10:00", cal)).toBe(3); // today not finished yet: counts back from yesterday
    expect(streakDays([{ at: "2026-10-06T10:00", onTime: false }], "2026-10-06T17:00", cal)).toBe(0);
  });

  it("badges can be switched off", () => {
    const off = { ...game, badges: game.badges.map((b) => (b.key === "rocket" ? { ...b, on: false } : b)) };
    const b2 = departmentBoard({ people, projects, queue, cal, now: NOW, period: "week", scoring, game: off });
    expect(b2.some((e) => e.badges.some((x) => x.key === "rocket"))).toBe(false);
  });

  it("kindness switches: top N, hide the bottom half", () => {
    expect(visibleEntries(board, { topN: 2, hideBottom: false }).map((e) => e.personId)).toEqual(["toto", "nino"]);
    expect(visibleEntries(board, { topN: 0, hideBottom: true }).map((e) => e.personId)).toEqual(["toto", "nino", "yan"]);
    expect(visibleEntries(board, { topN: 0, hideBottom: false })).toHaveLength(4);
  });
});
