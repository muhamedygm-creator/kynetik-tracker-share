import { describe, expect, it } from "vitest";
import { alerts } from "../alerts";
import { allItems, planClashes, techDoubleBookings } from "../conflicts";
import { forecast, health } from "../schedule";
import { NOW, buildProjects, cal, people, settings, stations } from "./fixtures";

const run = (alertsOn = settings.health.alerts, maxAlerts = 200) => {
  const projects = buildProjects();
  const builds = projects.map((project) => {
    const f = forecast(project, cal, NOW);
    return { project, forecast: f, health: health(project, f, settings.health, cal.dayHours) };
  });
  return alerts({
    builds, people, cal, now: NOW, settings: { alerts: alertsOn, maxAlerts },
    doubleBookings: techDoubleBookings(allItems(projects), "stage", NOW),
    clashes: planClashes(projects, stations, people, "stage"),
  });
};

describe("alerts (spec §10)", () => {
  const all = run();
  const msgs = all.map((a) => a.message);

  it("001 forecast late, with the v1 message pattern", () => {
    expect(msgs.find((m) => m.startsWith("001 — forecast"))).toMatch(/^001 — forecast \d+ \w{3} \d\d:\d\d, [\d.]+h of work past the committed 18 Nov$/);
  });

  it("01 has no parts list", () => {
    expect(msgs).toContain("01 — no parts list, so stages cannot be tracked by part");
  });

  it("unassigned parts in a live stage", () => {
    expect(msgs).toContain("EXT-001 · Premold Prep — 8 parts with no technician");
  });

  it("legacy double-bookings and the shared Modification 1 are reported", () => {
    expect(msgs.filter((m) => m.startsWith("Toto is double-booked —"))).toHaveLength(2);
    expect(msgs).toContain("Francis is double-booked — 001 · Prototyping · Left Front Fender overlaps EXT-001 · Premold Prep · Rear Bumper");
    expect(msgs.some((m) => /^001 — Modification 1 is double-booked with BUG-KYN · /.test(m))).toBe(true);
  });

  it("red first, then amber; capped at maxAlerts (v1 = 10)", () => {
    const sev = all.map((a) => a.severity);
    expect(sev.indexOf("warn")).toBeGreaterThan(sev.lastIndexOf("bad"));
    expect(run(settings.health.alerts, 10)).toHaveLength(10);
  });

  it("each alert type can be switched off", () => {
    const off = run({ ...settings.health.alerts, planClash: false, techDoubleBooked: false });
    expect(off.some((a) => a.type === "planClash" || a.type === "techDoubleBooked")).toBe(false);
  });
});
