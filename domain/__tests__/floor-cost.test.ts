import { describe, expect, it } from "vitest";
import { buildHourRate, crewTotals, rates } from "../cost";
import { checkDayCap, dayDelta, fillFromAssignments, stepDay, utilisation, whosOnWhat } from "../floor";
import { DEFAULT_COST } from "../settings";
import { NOW, buildProjects, cal, settings } from "./fixtures";

describe("floor log (spec §12)", () => {
  it("caps logging at the day hours, with the §15 message", () => {
    expect(checkDayCap("Toto", 6, 2, "2026-10-01", 8)).toBeNull();
    expect(checkDayCap("Toto", 6, 2.5, "2026-10-01", 8)).toBe("Toto already has 6h on 1 Oct — a working day holds 8h.");
  });

  it("fill from assignments splits remaining hours evenly in 0.5h steps, remainder to the last", () => {
    const logs = fillFromAssignments(["a", "b"], { a: 1 }, {
      a: [{ projectId: "p", workItemId: "1" }, { projectId: "p", workItemId: "2" }, { projectId: "p", workItemId: "3" }],
      b: [{ projectId: "p", workItemId: "4" }],
    }, 8, settings.floor);
    expect(logs.map((l) => [l.workItemId, l.hours])).toEqual([["1", 2], ["2", 2], ["3", 3], ["4", 8]]);
  });

  it("utilisation warns below 70%", () => {
    expect(utilisation(28, 5, 8, settings.scoring)).toEqual({ pct: 70, warn: false });
    expect(utilisation(20, 5, 8, settings.scoring)).toEqual({ pct: 50, warn: true });
  });

  it("saving a day reverses old logs and applies new ones", () => {
    const d = dayDelta(
      [{ personId: "a", projectId: "p", workItemId: "1", hours: 4, rate: 10 }],
      [{ personId: "a", projectId: "p", workItemId: "1", hours: 6, rate: 10 }, { personId: "b", projectId: "p", workItemId: "2", hours: 2, rate: 20 }],
    );
    expect(d.items.get("1")).toEqual({ projectId: "p", hours: 2, cost: 20, hoursBy: { a: 2 } });
    expect(d.labour.get("p")).toBe(60);
  });

  it("who's on what: Toto has two parts in work, Ahmad is idle", () => {
    const ps = buildProjects();
    const toto = whosOnWhat("per-toto", ps, cal, NOW);
    expect(toto.inWork.map((x) => x.part)).toEqual(["Left Side Skirt", "Right Side Skirt"]);
    expect(toto.open).toBe(3); // + the assigned Bonnet on 001
    expect(whosOnWhat("per-ahmad", ps, cal, NOW).idle).toBe(true);
  });

  it("day stepping skips Sundays", () => {
    expect(stepDay(cal, "2026-09-26", 1)).toBe("2026-09-28");
    expect(stepDay(cal, "2026-09-28", -1)).toBe("2026-09-26");
  });
});

describe("cost (spec §13)", () => {
  it("loaded monthly → day rate → hour rate", () => {
    const r = rates({ baseSalary: 5200, loadingPct: null, costClass: "production" }, DEFAULT_COST, 8);
    expect(r).toEqual({ loading: 25, loadedMonthly: 6500, dayRate: 250, hourRate: 31.25 });
  });

  it("admin never enters build cost; totals split", () => {
    expect(buildHourRate({ baseSalary: 5200, loadingPct: 25, costClass: "admin" }, DEFAULT_COST, 8)).toBe(0);
    expect(crewTotals([
      { baseSalary: 4000, loadingPct: 25, costClass: "production" },
      { baseSalary: 8000, loadingPct: 0, costClass: "admin" },
    ], DEFAULT_COST, 8)).toEqual({ production: 5000, admin: 8000 });
  });
});
