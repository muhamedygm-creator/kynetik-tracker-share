import { describe, expect, it } from "vitest";
import { absenceSpan, absentOn, awayLabel, calendarsFor, type Absence } from "../attendance";
import { makeCalendar } from "../calendar";
import { DEFAULT_SETTINGS } from "../settings";

const input = { calendar: DEFAULT_SETTINGS.calendar, holidays: ["2026-10-22"] };
const cal = makeCalendar(input);
// DEFAULT_SETTINGS: Monday–Saturday, Sunday off. 2026-10-16 is a Friday.
const leave = (over: Partial<Absence>): Absence => ({
  id: "a", personId: "p", kind: "annual", startsOn: "2026-10-16", days: 2, endsOn: "2026-10-17", backOn: "2026-10-19", note: "", cancelled: false, ...over,
});

describe("attendance and absences (AM-29)", () => {
  it("counts working days, skipping rest days and holidays, and finds the day back", () => {
    expect(absenceSpan(cal, "2026-10-16", 2)).toEqual({ startsOn: "2026-10-16", endsOn: "2026-10-17", backOn: "2026-10-19" });
    // Sunday 18 Oct is skipped; the holiday on 22 Oct is skipped too.
    expect(absenceSpan(cal, "2026-10-17", 4)).toEqual({ startsOn: "2026-10-17", endsOn: "2026-10-21", backOn: "2026-10-23" });
    // Starting on a rest day moves to the next working day.
    expect(absenceSpan(cal, "2026-10-18", 1).startsOn).toBe("2026-10-19");
  });

  it("knows who is away on a day, with the label for the TV", () => {
    const a = leave({});
    expect(absentOn([a], "p", "2026-10-17")).toBe(a);
    expect(absentOn([a], "p", "2026-10-19")).toBeUndefined();
    expect(absentOn([{ ...a, cancelled: true }], "p", "2026-10-17")).toBeUndefined();
    expect(awayLabel(a)).toBe("Annual leave · back 19 Oct");
  });

  it("takes absence days out of the person's calendar; unexcused only for planning", () => {
    const sick = calendarsFor(input, cal, [leave({ kind: "sick" })]);
    expect(sick.away("p").isWorkDay("2026-10-16")).toBe(false);
    expect(sick.score("p").isWorkDay("2026-10-16")).toBe(false);
    expect(sick.away("q")).toBe(cal);
    const skipped = calendarsFor(input, cal, [leave({ kind: "unexcused" })]);
    expect(skipped.away("p").isWorkDay("2026-10-16")).toBe(false);
    expect(skipped.score("p").isWorkDay("2026-10-16")).toBe(true); // counts against them
  });
});
