import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { boardSort, forecast, health, projectPct, schedule, stageAgg } from "../schedule";
import { NOW, V1_CALENDAR, buildProjects, byId, cal, settings } from "./fixtures";

const projects = buildProjects();

describe("schedule (spec §7) reproduces every v1 plan in §17", () => {
  for (const p of projects) {
    it(`${p.serial}: task windows and planned finish`, () => {
      const planned = schedule({ startDate: p.startDate, tasks: p.tasks.map((t) => ({ ...t, start: null, end: null })) }, cal);
      expect(planned.tasks.map((t) => [t.start, t.end])).toEqual(p.tasks.map((t) => [t.start, t.end]));
    });
  }

  it("planned finishes match §17.5", () => {
    const ends = Object.fromEntries(projects.map((p) => [p.serial, schedule(p, cal).planEnd]));
    expect(ends).toEqual({
      "001": "2026-11-30T17:00", "EXT-001": "2026-11-02T17:00", "002": "2026-11-04T17:00",
      "01": "2026-11-18T17:00", "BUG-KYN": "2026-11-30T17:00", "BUG-CUS": "2026-12-14T17:00",
    });
  });

  it("a pinned start moves the task and re-flows the ones after it", () => {
    const p = byId(projects, "002");
    const tasks = p.tasks.map((t) => (t.num === 2 ? { ...t, pinnedStart: "2026-10-05T08:00" } : t));
    const out = schedule({ startDate: p.startDate, tasks }, cal).tasks;
    expect(out[1].start).toBe("2026-10-05T08:00");
    expect(out[2].start).toBe(cal.norm(out[1].end!));
  });

  it("changing the shift moves every plan (settings drive the engine)", () => {
    const c = makeCalendar({ calendar: { ...V1_CALENDAR, shiftStart: "07:00", shiftEnd: "16:00" }, holidays: [] });
    const out = schedule(byId(projects, "001"), c);
    expect(out.tasks[0].start).toBe("2026-09-21T07:00");
    expect(out.planEnd).toBe("2026-11-30T16:00");
  });
});

describe("forecast & health", () => {
  const evaluate = (id: string) => {
    const p = byId(projects, id);
    const f = forecast(p, cal, NOW);
    return { p, f, h: health(p, f, settings.health, cal.dayHours) };
  };

  it("001 is late against the committed 18 Nov", () => {
    const { f, h } = evaluate("001");
    expect(h).toBe("late");
    expect(f.floatH!).toBeLessThan(0);
    expect(f.finish! > "2026-11-18T17:00").toBe(true);
  });

  it("001 Prototyping progress counts the 2 of 12 parts done", () => {
    const p = byId(projects, "001");
    expect(stageAgg(p, p.stages[0]).pct).toBeCloseTo(2 / 12);
    expect(projectPct(p)).toBeGreaterThan(0);
  });

  it("builds without a committed date are 'unset'; 01 (due 5 Oct) is late", () => {
    expect(evaluate("EXT-001").h).toBe("unset");
    expect(evaluate("BUG-CUS").h).toBe("unset");
    expect(evaluate("01").h).toBe("late");
  });

  it("done tasks forecast at their actual end; open tasks start from now", () => {
    const { p, f } = evaluate("EXT-001");
    expect(f.tasks[p.tasks[0].id].end).toBe("2026-09-21T17:00");
    expect(f.tasks[p.tasks[1].id].start).toBe(NOW);
  });

  it("health thresholds come from settings (risk ≤ 3 working days = 24h)", () => {
    const p = { status: "active" as const, deliveryDate: "2026-12-01" };
    expect(health(p, { floatH: 24 }, settings.health, 8)).toBe("risk");
    expect(health(p, { floatH: 24.5 }, settings.health, 8)).toBe("ok");
    expect(health(p, { floatH: 0 }, settings.health, 8)).toBe("risk");
    expect(health(p, { floatH: -0.5 }, settings.health, 8)).toBe("late");
    expect(health(p, { floatH: 30 }, { riskFloatDays: 5 }, 8)).toBe("risk");
    expect(health({ ...p, status: "hold" }, { floatH: -5 }, settings.health, 8)).toBe("hold");
  });

  it("board order: late, risk, unset, ok, hold, done; then serial", () => {
    const rows = [
      { serial: "B", health: "ok" as const }, { serial: "A", health: "done" as const },
      { serial: "C", health: "late" as const }, { serial: "A", health: "unset" as const }, { serial: "Z", health: "risk" as const },
    ];
    expect(boardSort(rows, settings.health.boardOrder).map((r) => r.serial + r.health)).toEqual(["Clate", "Zrisk", "Aunset", "Bok", "Adone"]);
  });
});
