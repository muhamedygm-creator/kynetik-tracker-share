import { describe, expect, it } from "vitest";
import { parsePrint, printComplete, printProblems, printSummary } from "../print";

describe("print data (AM-24)", () => {
  it("reads grams and minutes as numbers above 0, slices as a whole number", () => {
    expect(parsePrint("320,5", false)).toBe(320.5);
    expect(parsePrint("0", false)).toBe("bad");
    expect(parsePrint("", false)).toBeNull();
    expect(parsePrint("4", true)).toBe(4);
    expect(parsePrint("2.5", true)).toBe("bad");
    expect(printProblems({ filamentG: "x", minutes: "540", slices: "0" })).toEqual({
      filamentG: "Filament is a number above 0, in g.", slices: "Slice components is a whole number, 1 or more.",
    });
  });
  it("needs all three values before QC, and summarises them", () => {
    expect(printComplete({ filamentG: 320, minutes: 540, slices: null })).toBe(false);
    expect(printComplete({ filamentG: 320, minutes: 540, slices: 4 })).toBe(true);
    expect(printSummary({ filamentG: 320, minutes: 540, slices: 4 })).toBe("320 g · 540 min · 4 slices");
    expect(printSummary(null)).toBeNull();
  });
});
