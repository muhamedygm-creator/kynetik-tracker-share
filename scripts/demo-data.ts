/**
 * Sample day for the Modification TV, built from the real crew and the real builds, so the employee
 * display and leaderboard can be tried out without changing any real build progress.
 *
 *   npm run demo:add      # adds (or refreshes) the sample day around the current time
 *   npm run demo:remove   # removes it
 *
 * - Francis, Toto and Norlen are set to the Modification department (the Owner's choice; this stays on removal).
 * - Their queues get today's tasks named after real part-steps and tasks on 001 and EXT-001. Each task is
 *   linked to its build and stage for the label, never to a work item, so the real part-steps don't change.
 *   They carry the note SAMPLE_NOTE, which is how removal finds them.
 * - The leaderboard needs finished parts this week, which the real data doesn't have yet: build "DEMO"
 *   holds sample finished "Prepare Premold" part-steps with the real part names (8 h standard, as on 001).
 *   It has no workstation, so it never blocks a booking.
 * - Removal also deletes the earlier "(demo)" people (legacy_id 'demo-…').
 * Runs through scripts/lib/sql.ts (DATABASE_URL, or the Management API). Not audited (app.skip_audit).
 */
import { makeCalendar, type Calendar } from "../domain/calendar";
import type { CalendarSettings } from "../domain/settings";
import { addDays, dateOf, type LocalDT } from "../domain/time";
import { lit, redact, sqlRunner } from "./lib/sql";

const SAMPLE_NOTE = "Sample task for the display walkthrough (npm run demo:remove takes it out).";
const DEPARTMENT = "modification";
const STD_H = 8; // "Prepare Premold" standard hours per part on build 001

type Link = [serial: string, stage: string];
interface QueueItem { title: string; hours?: number; days?: number; link: Link }
interface Crew {
  name: string;
  /** sample finished parts on DEMO this week: [work days ago, part, actual hours, rework] */
  history: [number, string, number, number][];
  done?: QueueItem[];
  doing?: QueueItem & { startedHAgo?: number; fromShiftStart?: boolean; overrunH?: number };
  todo?: (QueueItem & { fixedInH?: number })[];
  blocked?: QueueItem[];
}

const CREW: Crew[] = [
  {
    name: "Francis",
    history: [[4, "Front Bumper", 7, 0], [3, "Left Door", 7.5, 0], [2, "Right Door", 8, 0], [1, "Left Rear Fender", 6.5, 0]],
    done: [
      { title: "Left Front Fender: concept & design review", hours: 2, link: ["001", "Prototyping"] },
      { title: "Right Front Fender: concept & design review", hours: 2, link: ["001", "Prototyping"] },
    ],
    doing: { title: "Rear Bumper: plug prep", hours: 3, startedHAgo: 1.5, link: ["EXT-001", "Premold Prep"] },
    todo: [
      { title: "Rear Bumper: mold layup & cure", hours: 2, link: ["EXT-001", "Make Mold"] },
      { title: "Bonnet: surface finish prototype (plug)", hours: 2, link: ["001", "Prepare Premold"] },
    ],
  },
  {
    name: "Toto",
    history: [[4, "Right Rear Fender", 9, 0], [3, "Left Side Skirt", 8, 1], [2, "Right Side Skirt", 7, 0]],
    done: [{ title: "Right Front Fender: build / refine prototype", hours: 1.5, link: ["001", "Prototyping"] }],
    doing: { title: "Right Side Skirt: plug prep", hours: 2, overrunH: 1, link: ["EXT-001", "Premold Prep"] },
    todo: [{ title: "Left Side Skirt: plug prep", hours: 2, link: ["EXT-001", "Premold Prep"] }],
    blocked: [{ title: "Bonnet: build / refine prototype", hours: 2, link: ["001", "Prototyping"] }],
  },
  {
    name: "Norlen",
    history: [[4, "Rear Engine Cover", 8, 0], [3, "Bonnet", 7, 0], [2, "Left Front Fender", 9, 1], [1, "Rear Bumper", 7.5, 0]],
    doing: { title: "Rear Engine Cover: plug prep", days: 2, fromShiftStart: true, link: ["EXT-001", "Premold Prep"] },
    todo: [{ title: "Rear Engine Cover: mold layup & cure", hours: 3, link: ["EXT-001", "Make Mold"] }],
  },
];

const REMOVE = `
delete from public.queue_tasks where notes = ${lit(SAMPLE_NOTE)};
delete from public.projects where legacy_id = 'demo-build';
delete from public.people where legacy_id like 'demo-%';
`;

/** Shop wall-clock now as LocalDT. */
function shopNow(tz: string): LocalDT {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** The working moment `h` working hours before `x` (1-minute steps). */
function backWH(cal: Calendar, x: LocalDT, h: number): LocalDT {
  let t = x;
  for (let i = 0; i < 60 * 24 * 10 && cal.wh(t, x) < h; i++) {
    const [d, hm] = t.split("T");
    const m = Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) - 1;
    t = m < 0 ? `${addDays(d, -1)}T23:59` : `${d}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }
  return t;
}

function buildSql(calendar: CalendarSettings, holidays: string[]): string {
  const cal = makeCalendar({ calendar, holidays });
  const tz = calendar.timezone;
  const ts = (x: LocalDT) => `(${lit(x.replace("T", " "))}::timestamp at time zone ${lit(tz)})`;
  const rawNow = shopNow(tz);
  const today = cal.isWorkDay(dateOf(rawNow)) ? dateOf(rawNow) : cal.prevWorkDay(dateOf(rawNow));
  const dayStart = cal.atShiftStart(today);
  const now = cal.isWorkDay(dateOf(rawNow)) ? cal.norm(rawNow) : cal.atShiftEnd(today);
  const workDaysAgo = (n: number) => { let d = today; for (let i = 0; i < n; i++) d = cal.prevWorkDay(d); return d; };
  const max = (a: LocalDT, b: LocalDT) => (a > b ? a : b);

  const out: string[] = ["begin;", "set local app.skip_audit = 'on';", REMOVE];
  const person = (name: string) => `(select id from public.people where name = ${lit(name)})`;
  const missing = CREW.map((c) => `(select count(*) from public.people where name = ${lit(c.name)}) <> 1`).join(" or ");
  out.push(`do $d$ begin if ${missing} then raise exception 'Francis, Toto and Norlen must each exist exactly once in people'; end if; end $d$;`);
  out.push(`update public.people set department_id = (select id from public.departments where key = ${lit(DEPARTMENT)}) where name in (${CREW.map((c) => lit(c.name)).join(", ")});`);

  // Sample history for the leaderboard: build DEMO, one "Prepare Premold" stage, real part names.
  const monday = workDaysAgo(4);
  const planStart = cal.atShiftStart(monday);
  const parts = CREW.flatMap((c) => c.history.map(([, part]) => part));
  if (new Set(parts).size !== parts.length) throw new Error("A part is used twice in the sample history.");
  const taskH = (parts.length * STD_H) / CREW.length;
  const planEnd = cal.addWH(planStart, taskH);
  out.push(`insert into public.projects (legacy_id, serial, name, client, notes, start_date, status, plan_end, template_label)
    values ('demo-build', 'DEMO', 'Sample history for the leaderboard', '', 'Sample finished parts so the Modification TV leaderboard has scores. Remove with npm run demo:remove.', ${lit(monday)}, 'active', ${ts(planEnd)}, '');`);
  const proj = `(select id from public.projects where legacy_id = 'demo-build')`;
  out.push(`insert into public.stages (legacy_id, project_id, name, station_type, part_hours, sort) select 'demo', ${proj}, 'Prepare Premold', 'modification', ${STD_H}, 0;`);
  const stage = `(select id from public.stages where project_id = ${proj})`;
  out.push(`insert into public.tasks (legacy_id, project_id, stage_id, num, name, status, dur_h, pct, plan_start, plan_end, actual_start)
    select 'demo', ${proj}, ${stage}, 1, 'Surface finish prototype (plug)', 'doing', ${taskH}, 80, ${ts(planStart)}, ${ts(planEnd)}, ${ts(planStart)};`);
  parts.forEach((name, i) => out.push(`insert into public.parts (legacy_id, project_id, name, sort) select 'demo-${i}', ${proj}, ${lit(name)}, ${i};`));
  const part = (name: string) => `(select id from public.parts where project_id = ${proj} and name = ${lit(name)})`;

  for (const c of CREW) {
    for (const [ago, partName, hours, rework] of c.history) {
      const start = cal.atShiftStart(workDaysAgo(ago));
      const end = cal.addWH(start, hours);
      // One stretch of work: start → end (work_segments only holds earlier, closed stretches).
      out.push(`insert into public.work_items (project_id, stage_id, part_id, status, tech_id, start_at, seg_start, end_at, rework)
        values (${proj}, ${stage}, ${part(partName)}, 'done', ${person(c.name)}, ${ts(start)}, ${ts(start)}, ${ts(end)}, ${rework});`);
    }

    // Today's queue (fractional keys a0, a1, …; the unique key refuses a clash with a real task).
    let pos = 0;
    const q = (item: QueueItem, status: string, extra: Record<string, string> = {}) => {
      const [serial, stageName] = item.link;
      const project = `(select id from public.projects where serial = ${lit(serial)})`;
      const cols = ["person_id", "title", "dur_value", "dur_unit", "status", "position", "notes", "project_id", "stage_id", ...Object.keys(extra)];
      const vals = [person(c.name), lit(item.title), String(item.days ?? item.hours ?? 1), lit(item.days ? "days" : "hours"), lit(status), lit(`a${pos++}`),
        lit(SAMPLE_NOTE), project, `(select id from public.stages where project_id = ${project} and name = ${lit(stageName)})`, ...Object.values(extra)];
      out.push(`insert into public.queue_tasks (${cols.join(", ")}) values (${vals.join(", ")});`);
    };

    let doingStart: LocalDT | null = null;
    if (c.doing) {
      const d = c.doing;
      const hours = d.hours ?? (d.days ?? 1) * cal.dayHours;
      if (d.fromShiftStart) doingStart = dayStart;
      else if (d.overrunH) doingStart = max(dayStart, backWH(cal, now, hours + d.overrunH));
      else doingStart = max(dayStart, backWH(cal, now, d.startedHAgo ?? 1));
    }
    // Finished tasks fill the day from shift start up to the current task (or now), in proportion.
    const done = c.done ?? [];
    const room = cal.wh(dayStart, doingStart ?? now), planned = done.reduce((s, x) => s + (x.hours ?? 1), 0);
    let t = dayStart;
    if (room >= 0.5) for (const item of done) {
      const end = cal.addWH(t, ((item.hours ?? 1) / planned) * room);
      q(item, "done", { actual_start: ts(t), actual_end: ts(end) });
      t = end;
    }
    if (c.doing && doingStart) q(c.doing, "doing", { actual_start: ts(doingStart) });
    for (const b of c.blocked ?? []) q(b, "blocked");
    for (const item of c.todo ?? []) q(item, "todo", item.fixedInH !== undefined ? { fixed_start: ts(cal.addWH(now, item.fixedInH)) } : {});
  }

  out.push(`select (select count(*) from public.people p join public.departments d on d.id = p.department_id where d.key = ${lit(DEPARTMENT)}) people,
    (select count(*) from public.queue_tasks where notes = ${lit(SAMPLE_NOTE)}) queue, (select count(*) from public.work_items where project_id = ${proj}) part_steps;`);
  out.push("commit;");
  return out.join("\n");
}

async function main() {
  const run = sqlRunner();
  if (process.argv.includes("--remove")) {
    await run(`begin; set local app.skip_audit = 'on'; ${REMOVE} commit; select 1;`);
    console.log("Sample day removed (sample queue tasks, the DEMO build and any \"(demo)\" people). Department assignments stay as set.");
    return;
  }
  const [row] = await run("select value from public.settings where key = 'calendar'");
  const holidays = (await run("select day::text as day from public.holidays")).map((r) => String(r.day));
  const calendar = row?.value as CalendarSettings | undefined;
  if (!calendar) throw new Error("No calendar settings found. Run the seed first.");
  const [res] = await run(buildSql(calendar, holidays));
  console.log(`Sample day added: ${res?.people} people in Modification, ${res?.queue} sample queue tasks, ${res?.part_steps} sample finished parts on DEMO.`);
  console.log("Re-run npm run demo:add to refresh it around the current time; npm run demo:remove takes it out.");
}

main().catch((e) => { console.error("❌", redact((e as Error).message)); process.exit(1); });
