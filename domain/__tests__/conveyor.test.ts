import { describe, expect, it } from "vitest";
import { banner, conveyorAxis, countdown, liveTone, nowShare, quoteTurn } from "../conveyor";
import { DEFAULT_SETTINGS } from "../settings";

const c = { hours: 6, pastMin: 20 };
const b = DEFAULT_SETTINGS.gamification.banner;
const H = (h: number, m = 0) => h * 60 + m;
const day = { start: H(9), end: H(18), breaks: [[H(13), H(14)]] as [number, number][], isToday: true };

describe("conveyor axis", () => {
  it("keeps now at the same place whatever the time", () => {
    expect(conveyorAxis(H(9), c).at(H(9))).toBeCloseTo(nowShare(c));
    expect(conveyorAxis(H(15, 37), c).at(H(15, 37))).toBeCloseTo(nowShare(c));
  });
  it("slides a later minute towards now as time passes", () => {
    expect(conveyorAxis(H(12), c).at(H(13))).toBeLessThan(conveyorAxis(H(11), c).at(H(13)));
  });
  it("clamps past and far-future times to the edges and lists the whole hours", () => {
    const a = conveyorAxis(H(10, 30), c);
    expect(a.at(H(8))).toBe(0);
    expect(a.at(H(20))).toBe(1);
    expect(a.hours).toEqual([H(11), H(12), H(13), H(14), H(15), H(16)]);
  });
});

describe("live tone", () => {
  it("green within the allocated time, red once past it", () => {
    expect(liveTone({ status: "doing", qc: false }, H(10), H(11))).toBe("ok");
    expect(liveTone({ status: "doing", qc: false }, H(11, 1), H(11))).toBe("over");
  });
  it("grey not started, blue waiting for QC, faded when done", () => {
    expect(liveTone({ status: "todo", qc: false }, H(10), null)).toBe("todo");
    expect(liveTone({ status: "doing", qc: true }, H(12), H(11))).toBe("qc");
    expect(liveTone({ status: "done", qc: false }, H(12), H(11))).toBe("done");
    expect(liveTone({ status: "blocked", qc: false }, H(12), null)).toBe("blocked");
  });
});

describe("banner", () => {
  it("counts down to lunch, then to its end, then says back to it", () => {
    expect(banner(H(12, 37), day, b)).toEqual({ kind: "lunchSoon", at: H(13) });
    expect(banner(H(13, 20), day, b)).toEqual({ kind: "lunch", until: H(14) });
    expect(banner(H(14, 2), day, b)).toEqual({ kind: "backToIt" });
    expect(banner(H(15), day, b)).toEqual({ kind: "shiftEnds", at: H(18) });
  });
  it("counts down the last 30 minutes of the shift", () => {
    expect(banner(H(17, 29), day, b).kind).toBe("shiftEnds");
    expect(banner(H(17, 30), day, b)).toEqual({ kind: "wrapUp", at: H(18) });
    expect(banner(H(18), day, b).kind).toBe("idle");
  });
  it("is idle on a day that isn't today", () => {
    expect(banner(H(12), { ...day, isToday: false }, b).kind).toBe("idle");
  });
  it("rotates quotes in briefly, never during lunch or the wrap-up", () => {
    const main = banner(H(11), day, b);
    expect(quoteTurn(0, main, b)).toBeNull();
    expect(quoteTurn(55, main, b)).toBe(0);
    expect(quoteTurn(55, banner(H(13, 10), day, b), b)).toBeNull();
    expect(quoteTurn(55, banner(H(17, 45), day, b), b)).toBeNull();
  });
  it("formats countdowns", () => {
    expect(countdown(23)).toBe("23 min");
    expect(countdown(65)).toBe("1 h 05 min");
    expect(countdown(4.15)).toBe("4:09");
  });
});
