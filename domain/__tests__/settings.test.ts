import { describe, expect, it } from "vitest";
import { CalendarSettings, DEFAULT_SETTINGS, SETTINGS_SCHEMAS, parseSection } from "../settings";

describe("settings", () => {
  it("every v1 default passes its schema", () => {
    for (const [key, schema] of Object.entries(SETTINGS_SCHEMAS)) {
      expect(schema.safeParse(DEFAULT_SETTINGS[key as keyof typeof SETTINGS_SCHEMAS]).success, key).toBe(true);
    }
  });

  it("a shift that ends before it starts is refused with the §15 message", () => {
    const r = CalendarSettings.safeParse({ ...DEFAULT_SETTINGS.calendar, shiftStart: "17:00", shiftEnd: "08:00" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("The shift has to end after it starts.");
  });

  it("missing or invalid stored values fall back to the v1 defaults", () => {
    expect(parseSection("health", { maxAlerts: 5 }).maxAlerts).toBe(5);
    expect(parseSection("health", { maxAlerts: 5 }).riskFloatDays).toBe(3);
    expect(parseSection("calendar", { shiftStart: "nope" })).toEqual(DEFAULT_SETTINGS.calendar);
  });
});
