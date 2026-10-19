import { describe, expect, it } from "vitest";
import { allItems, busyLabel, conflictMessage, findTechConflict, occupancy, planClashes, techDoubleBookings } from "../conflicts";
import { applyStatus } from "../work";
import { NOW, buildProjects, byId, people, stations } from "./fixtures";

const projects = buildProjects();
const world = allItems(projects);
const ref = (projectId: string, itemId: string) => {
  const project = byId(projects, projectId);
  return { project, item: project.work.find((w) => w.id === itemId)! };
};
const pid = (name: string) => people.find((p) => p.name === name)!.id;

describe("technician double-booking (spec §9)", () => {
  it("occupancy: earlier segments + current one while doing/done; Blocked frees the tech", () => {
    const w = ref("EXT-001", "EXT-001/Premold Prep/Rear Bumper").item;
    expect(occupancy(w, NOW)).toEqual([{ start: "2026-09-21T08:00", end: NOW, open: true }]);
    expect(occupancy({ ...w, status: "blocked" }, NOW)).toEqual([]);
  });

  it("refuses a clash with the exact §9 message", () => {
    // Put Norlen (open on EXT-001 since 21 Sep) on a 001 part from 30 Sep.
    const cand = ref("001", "001/Prototyping/Bonnet");
    const next = { ...cand, item: applyStatus({ ...cand.item, tech: pid("Norlen") }, "doing", "2026-09-30T08:00") };
    const c = findTechConflict(next, world, "stage", NOW)!;
    expect(conflictMessage(c, people)).toBe(
      "Blocked — Norlen is already on EXT-001 · Premold Prep · Rear Engine Cover (21 Sep 08:00 – now). " +
        "A technician can only work one stage/part at a time. Finish or block that first, or pick someone else.",
    );
  });

  it("starting a part right now next to someone's open job is refused (open segments run on)", () => {
    const cand = ref("001", "001/Prototyping/Bonnet");
    const next = { ...cand, item: applyStatus({ ...cand.item, tech: pid("Norlen") }, "doing", NOW) };
    expect(findTechConflict(next, world, "stage", NOW)?.b.item.id).toBe("EXT-001/Premold Prep/Rear Engine Cover");
  });

  it("starting after someone's finished job doesn't clash", () => {
    const cand = ref("EXT-001", "EXT-001/Make Mold/Rear Bumper");
    const next = { ...cand, item: applyStatus({ ...cand.item, tech: pid("Yan") }, "doing", NOW) };
    expect(findTechConflict(next, world, "stage", NOW)).toBeNull();
  });

  it("stage mode allows batch parts in one stage; part mode does not", () => {
    // Toto is on both side skirts of EXT-001 Premold Prep at once.
    const cand = ref("EXT-001", "EXT-001/Premold Prep/Left Side Skirt");
    const onlyExt = world.filter((r) => r.project.id === "EXT-001");
    expect(findTechConflict(cand, onlyExt, "stage", NOW)).toBeNull();
    expect(findTechConflict(cand, onlyExt, "part", NOW)?.b.item.id).toBe("EXT-001/Premold Prep/Right Side Skirt");
  });

  it("a Blocked part frees its technician", () => {
    const cand = ref("001", "001/Prototyping/Bonnet");
    const blockedWorld = world.map((r) => (r.item.tech === pid("Norlen") ? { ...r, item: { ...r.item, status: "blocked" as const } } : r));
    const next = { ...cand, item: applyStatus({ ...cand.item, tech: pid("Norlen") }, "doing", "2026-09-30T08:00") };
    expect(findTechConflict(next, blockedWorld, "stage", NOW)).toBeNull();
  });

  it("finds the legacy v1 overlaps: Toto and Francis (§17.5, D4)", () => {
    const found = techDoubleBookings(world, "stage", NOW);
    const names = found.map((c) => people.find((p) => p.id === c.tech)!.name).sort();
    expect(names).toEqual(["Francis", "Toto", "Toto"]); // Toto overlaps both side skirts
  });

  it("dropdown annotates busy people", () => {
    expect(busyLabel({ id: pid("Norlen"), name: "Norlen" }, world)).toBe("Norlen — busy: EXT-001 · Premold Prep");
    expect(busyLabel({ id: pid("Ahmad"), name: "Ahmad" }, world)).toBe("Ahmad");
  });
});

describe("plan clashes", () => {
  it("001 and BUG-KYN share Modification 1 on the same dates", () => {
    const clashes = planClashes(projects, stations, people, "stage");
    const pair = clashes.find((c) => c.kind === "station" && [c.a.serial, c.b.serial].sort().join() === "001,BUG-KYN");
    expect(pair?.resourceName).toBe("Modification 1");
  });

  it("the same task lead on overlapping tasks clashes, except same-stage tasks in stage mode", () => {
    const ps = buildProjects();
    const a = byId(ps, "002"), b = byId(ps, "BUG-CUS");
    a.tasks[1].assignee = "per-tai"; // 30 Sep – 8 Oct
    b.tasks[0].assignee = "per-tai"; // 5 – 9 Oct
    const c = planClashes([a, b], stations, people, "stage").filter((x) => x.kind === "person");
    expect(c).toHaveLength(1);
    expect(c[0].resourceName).toBe("Tai");
  });
});
