import { describe, expect, it } from "vitest";
import { makeCalendar } from "../calendar";
import { DEFAULT_SETTINGS, dayHours } from "../settings";
import { localToUtc, utcToLocal } from "../time";
import { V1_CALENDAR } from "./fixtures";

const cal = makeCalendar({ calendar: V1_CALENDAR, holidays: [] }); // v1: 08:00–17:00, break 12:00 +60, Sunday off

describe("working hours (spec §6)", () => {
  it("16:00 → 09:00 next day is 2 working hours (v1 UI example)", () => {
    expect(cal.wh("2026-09-22T16:00", "2026-09-23T09:00")).toBe(2);
  });

  it("a default day is 8h in two windows, the break doesn't count", () => {
    expect(cal.dayHours).toBe(8);
    expect(cal.wh("2026-09-22T08:00", "2026-09-22T17:00")).toBe(8);
    expect(cal.wh("2026-09-22T11:30", "2026-09-22T13:30")).toBe(1);
  });

  it("Sunday has zero hours; a week is 48h", () => {
    expect(cal.wh("2026-09-27T08:00", "2026-09-27T17:00")).toBe(0); // Sunday
    expect(cal.wh("2026-09-21", "2026-09-27")).toBe(48);
  });

  it("date-only: start → shift start, end → shift end", () => {
    expect(cal.wh("2026-09-21", "2026-09-21")).toBe(8);
  });

  it("is negative when b is before a", () => {
    expect(cal.wh("2026-09-23T09:00", "2026-09-22T16:00")).toBe(-2);
  });

  it("norm skips break, after-hours and rest days", () => {
    expect(cal.norm("2026-09-22T12:15")).toBe("2026-09-22T13:00");
    expect(cal.norm("2026-09-22T17:00")).toBe("2026-09-23T08:00");
    expect(cal.norm("2026-09-26T18:00")).toBe("2026-09-28T08:00"); // Sat evening → Monday
    expect(cal.norm("2026-09-22T10:00")).toBe("2026-09-22T10:00");
  });

  it("addWH ends at the shift end, not the next morning", () => {
    expect(cal.addWH("2026-09-21T08:00", 40)).toBe("2026-09-25T17:00");
    expect(cal.addWH("2026-09-21T08:00", 4)).toBe("2026-09-21T12:00");
    expect(cal.addWH("2026-09-21T16:00", 2)).toBe("2026-09-22T09:00");
    expect(cal.addWH("2026-09-21T08:00", 0)).toBe("2026-09-21T08:00");
  });

  it("firstWork / next / previous work day", () => {
    expect(cal.firstWork("2026-09-27")).toBe("2026-09-28");
    expect(cal.firstWork("2026-09-28")).toBe("2026-09-28");
    expect(cal.nextWorkDay("2026-09-26")).toBe("2026-09-28");
    expect(cal.prevWorkDay("2026-09-28")).toBe("2026-09-26");
  });
});

describe("calendar settings (v2)", () => {
  it("D9 default: 09:00–18:00, lunch 13:00–14:00 = 8h; 16:00 → 09:00 next day is still 2h", () => {
    const c = makeCalendar(DEFAULT_SETTINGS);
    expect(c.dayHours).toBe(8);
    expect(c.wh("2026-10-05T16:00", "2026-10-06T09:00")).toBe(2);
    expect(c.norm("2026-10-05T13:30")).toBe("2026-10-05T14:00");
    expect(c.addWH("2026-10-05T09:00", 8)).toBe("2026-10-05T18:00");
  });

  it("more than one rest day: Friday and Sunday off", () => {
    const c = makeCalendar({ calendar: { ...V1_CALENDAR, restDays: [0, 5] }, holidays: [] });
    expect(c.wh("2026-09-21", "2026-09-27")).toBe(40);
    expect(c.norm("2026-09-25T08:00")).toBe("2026-09-26T08:00");
  });

  it("public holidays are whole days off (D3)", () => {
    const c = makeCalendar({ calendar: V1_CALENDAR, holidays: ["2026-12-02"] });
    expect(c.isWorkDay("2026-12-02")).toBe(false);
    expect(c.addWH("2026-12-01T16:00", 2)).toBe("2026-12-03T09:00");
  });

  it("shift 07:00–16:00 still gives 8h with the break inside; day hours follow the shift (D2)", () => {
    const calendar = { ...V1_CALENDAR, shiftStart: "07:00", shiftEnd: "16:00" };
    expect(dayHours(calendar)).toBe(8);
    const c = makeCalendar({ calendar, holidays: [] });
    expect(c.addWH("2026-09-21T07:00", 8)).toBe("2026-09-21T16:00");
    expect(c.norm("2026-09-21T16:30")).toBe("2026-09-22T07:00");
  });

  it("a break outside the shift doesn't split it", () => {
    const calendar = { ...V1_CALENDAR, breakStart: "18:00" };
    expect(dayHours(calendar)).toBe(9);
    expect(makeCalendar({ calendar, holidays: [] }).dayHours).toBe(9);
  });
});

describe("time zone edges", () => {
  it("Dubai is UTC+4", () => {
    expect(utcToLocal("2026-09-21T04:00:00Z", "Asia/Dubai")).toBe("2026-09-21T08:00");
    expect(localToUtc("2026-09-21T08:00", "Asia/Dubai")).toBe("2026-09-21T04:00:00.000Z");
  });
});
