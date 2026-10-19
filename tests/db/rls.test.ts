import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expandParts, rowsFromCsv } from "../../domain/parts-csv";
import { DEFAULT_SETTINGS } from "../../domain/settings";
import { as, createTestDb, makeUser } from "./harness";

let url: string;
let drop: () => Promise<void>;
let owner: string, supervisor: string, viewer: string, stranger: string;

beforeAll(async () => {
  ({ url, drop } = await createTestDb());
  owner = await makeUser(url, "owner@kynetikkoncepts.com", "owner");
  supervisor = await makeUser(url, "super@kynetikkoncepts.com", "supervisor");
  viewer = await makeUser(url, "viewer@kynetikkoncepts.com", "viewer");
  stranger = await makeUser(url, "stranger@example.com");
}, 60_000);

afterAll(async () => {
  await drop?.();
});

const count = (rows: { n: string }[]) => Number(rows[0].n);

describe("seed (spec §17)", () => {
  it("loads every v1 value", async () => {
    const r = await as(url, { role: "postgres" }, async (c) => {
      const q = async (sql: string) => count((await c.query(sql)).rows);
      return {
        workstations: await q("select count(*) n from workstations"),
        people: await q("select count(*) n from people"),
        templates: await q("select count(*) n from templates"),
        projects: await q("select count(*) n from projects"),
        tasks: await q("select count(*) n from tasks"),
        baselines: await q("select count(*) n from baselines"),
        workItems: await q("select count(*) n from work_items"),
        tracked: await q("select count(*) n from work_items where tech_id is not null"),
        audit: await q("select count(*) n from audit_log where entity = 'projects'"),
        settings: await q("select count(*) n from settings"),
      };
    });
    expect(r).toEqual({
      workstations: 6, people: 12, templates: 4, projects: 6, tasks: 68, baselines: 68,
      workItems: 336, tracked: 8, audit: 2, settings: 9,
    });
  });

  it("stores shop-local times in Asia/Dubai", async () => {
    const r = await as(url, { role: "postgres" }, (c) =>
      c.query(`select to_char(t.plan_end at time zone 'Asia/Dubai', 'YYYY-MM-DD HH24:MI') e
               from tasks t join projects p on p.id = t.project_id where p.serial = '001' and t.num = 18`));
    expect(r.rows[0].e).toBe("2026-11-30 18:00"); // D9: re-planned on 09:00–18:00
  });

  it("EXT-001 has 4 parts in work in Premold Prep", async () => {
    const r = await as(url, { role: "postgres" }, (c) =>
      c.query(`select count(*) n from work_items w join stages s on s.id = w.stage_id join projects p on p.id = w.project_id
               where p.serial = 'EXT-001' and s.name = 'Premold Prep' and w.status = 'doing'`));
    expect(count(r.rows)).toBe(4);
  });
});

describe("roles", () => {
  it("anon can read nothing", async () => {
    await expect(as(url, { role: "anon" }, (c) => c.query("select * from projects"))).rejects.toThrow(/permission denied/);
    await expect(as(url, { role: "anon" }, (c) => c.query("select * from people_cost"))).rejects.toThrow(/permission denied/);
  });

  it("a signed-in user without an invitation sees no rows", async () => {
    const r = await as(url, { role: "authenticated", userId: stranger }, (c) => c.query("select count(*) n from projects"));
    expect(count(r.rows)).toBe(0);
  });

  it("invitation creates the profile with the invited role", async () => {
    const r = await as(url, { role: "authenticated", userId: supervisor }, (c) => c.query("select public.my_role() r"));
    expect(r.rows[0].r).toBe("supervisor");
  });

  it("viewer reads but cannot write", async () => {
    await as(url, { role: "authenticated", userId: viewer }, async (c) => {
      expect(count((await c.query("select count(*) n from projects")).rows)).toBe(6);
      const u = await c.query("update projects set name = 'x' where serial = '001'");
      expect(u.rowCount).toBe(0);
    });
    await expect(
      as(url, { role: "authenticated", userId: viewer }, (c) =>
        c.query("insert into holidays (day, name) values ('2026-12-02', 'National Day')")),
    ).rejects.toThrow(/row-level security/);
  });

  it("supervisor writes everything and sees salaries (AM-20), but no other cost", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      expect((await c.query("update projects set notes = 'n' where serial = '001'")).rowCount).toBe(1);
      expect(count((await c.query("select count(*) n from people_cost")).rows)).toBe(12);
      expect(count((await c.query("select count(*) n from settings_cost")).rows)).toBe(0);
      expect(count((await c.query("select count(*) n from hour_log_cost")).rows)).toBe(0);
      expect(count((await c.query("select count(*) n from project_labour")).rows)).toBe(0);
      expect((await c.query("update people_cost set base_salary = 1")).rowCount).toBe(12);
    });
  });

  it("owner reads cost", async () => {
    const r = await as(url, { role: "authenticated", userId: owner }, (c) => c.query("select count(*) n from people_cost"));
    expect(count(r.rows)).toBe(12);
  });

  it("only the owner can change roles, and the last owner cannot be demoted", async () => {
    const r = await as(url, { role: "authenticated", userId: supervisor }, (c) =>
      c.query("update profiles set role = 'owner' where user_id = $1", [supervisor]));
    expect(r.rowCount).toBe(0);
    await expect(
      as(url, { role: "authenticated", userId: owner }, (c) => c.query("update profiles set role = 'viewer' where user_id = $1", [owner])),
    ).rejects.toThrow(/at least one active Owner/);
  });
});

describe("company addresses only (2026-10-12)", () => {
  it("refuses an invitation for any other domain, any letter case of the company one is fine", async () => {
    await expect(
      as(url, { role: "authenticated", userId: owner }, (c) => c.query("insert into invitations (email, role) values ('someone@gmail.com', 'viewer')")),
    ).rejects.toThrow(/Only @kynetikkoncepts.com addresses can be invited/);
    await expect(
      as(url, { role: "authenticated", userId: owner }, (c) => c.query("insert into invitations (email, role) values ('x@kynetikkoncepts.com.evil.io', 'viewer')")),
    ).rejects.toThrow(/Only @kynetikkoncepts.com/);
    const r = await as(url, { role: "authenticated", userId: owner }, (c) =>
      c.query("insert into invitations (email, role) values ('New.Person@KynetikKoncepts.com', 'viewer') returning id"));
    expect(r.rowCount).toBe(1);
  });

  it("an outside account gets no profile, and an old outside profile sees nothing", async () => {
    const outsider = await as(url, { role: "postgres" }, async (c) => {
      const id = (await c.query("insert into auth.users (email) values ('old.member@outlook.com') returning id")).rows[0].id as string;
      expect(count((await c.query("select count(*) n from profiles where user_id = $1", [id])).rows)).toBe(0);
      await c.query("insert into profiles (user_id, email, name, role) values ($1, 'old.member@outlook.com', 'Old', 'supervisor')", [id]);
      return id;
    }, true);
    const r = await as(url, { role: "authenticated", userId: outsider }, (c) => c.query("select count(*) n from projects"));
    expect(count(r.rows)).toBe(0);
  });
});

describe("rows, audit & realtime", () => {
  it("bumps version, audits the diff with the actor, and pings realtime without row data", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const before = (await c.query("select version from projects where serial = '002'")).rows[0].version;
      await c.query("update projects set client = 'Acme' where serial = '002'");
      const after = (await c.query("select version from projects where serial = '002'")).rows[0].version;
      expect(after).toBe(before + 1);

      const a = (await c.query("select * from audit_log where entity = 'projects' and action = 'update' order by id desc limit 1")).rows[0];
      expect(a.actor_id).toBe(supervisor);
      expect(a.actor_role).toBe("supervisor");
      expect(a.before).toEqual({ client: "internal" });
      expect(a.after).toEqual({ client: "Acme" });

      await c.query("reset role"); // realtime.sent is the shim's outbox, not readable by users
      const sent = await c.query("select payload, private from realtime.sent order by id desc limit 1");
      expect(sent.rows[0].payload).toEqual({ table: "projects", op: "update" });
      expect(sent.rows[0].private).toBe(false);
    });
  });

  it("optimistic concurrency: a stale version updates nothing", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const { id, version } = (await c.query("select id, version from projects where serial = '01'")).rows[0];
      expect((await c.query("update projects set notes = 'a' where id = $1 and version = $2", [id, version])).rowCount).toBe(1);
      expect((await c.query("update projects set notes = 'b' where id = $1 and version = $2", [id, version])).rowCount).toBe(0);
    });
  });

  it("cost-table audit entries are hidden from the supervisor", async () => {
    await as(url, { role: "authenticated", userId: owner }, (c) => c.query("update people_cost set base_salary = 3000 where person_id = (select id from people where name = 'Tai')"), true);
    const sup = await as(url, { role: "authenticated", userId: supervisor }, (c) => c.query("select count(*) n from audit_log where entity = 'people_cost'"));
    const own = await as(url, { role: "authenticated", userId: owner }, (c) => c.query("select count(*) n from audit_log where entity = 'people_cost'"));
    expect(count(sup.rows)).toBe(0);
    expect(count(own.rows)).toBe(1);
  });
});

describe("build functions (phase 3)", () => {
  const payload = {
    serial: "T-100", name: "Test", template_id: "", template_label: "Test", client: "", notes: "", start_date: "2026-10-05",
    delivery_date: "", plan_end: "2026-10-06T13:00:00Z",
    stages: [{ key: "s1", name: "Stage A", station_type: "modification", station_id: "", part_hours: 8, sort: 0 }],
    parts: [{ name: "Bonnet", sort: 0 }, { name: "Roof", sort: 1 }],
    tasks: [{ stage_key: "s1", num: 1, name: "Do it", dur_h: 16, plan_start: "2026-10-05T04:00:00Z", plan_end: "2026-10-06T13:00:00Z" }],
  };

  it("a viewer can't create a build", async () => {
    await expect(as(url, { role: "authenticated", userId: viewer }, (c) => c.query("select public.create_build($1)", [payload])))
      .rejects.toThrow(/row-level security|Read-only/);
  });

  it("a supervisor creates a build with stages × parts work items and a baseline", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const id = (await c.query("select public.create_build($1) id", [payload])).rows[0].id;
      const n = async (t: string) => count((await c.query(`select count(*) n from ${t} where project_id = $1`, [id])).rows);
      expect([await n("stages"), await n("parts"), await n("tasks"), await n("baselines"), await n("work_items")]).toEqual([1, 2, 1, 1, 2]);
      await c.query("select public.add_parts($1, $2)", [id, ["Door"]]);
      expect(await n("work_items")).toBe(3);
      await c.query("select public.add_stage($1, 'Stage B', 'paint', null, 4)", [id]);
      expect(await n("work_items")).toBe(6);
    });
  });

  it("rework keeps the old segment, logs the reason, and refuses a stale version", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const w = (await c.query(`update work_items set status = 'done', tech_id = (select id from people where name = 'Tai'),
        start_at = '2026-09-28T04:00Z', seg_start = '2026-09-28T04:00Z', end_at = '2026-09-28T08:00Z'
        where id = (select id from work_items where status = 'todo' and tech_id is null limit 1) returning id, version`)).rows[0];
      await expect(c.query("select public.rework_item($1, $2, 'x', now())", [w.id, w.version - 1])).rejects.toThrow(/Someone else changed this/);
    });
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const w = (await c.query(`update work_items set status = 'done', start_at = '2026-09-28T04:00Z', seg_start = '2026-09-28T04:00Z', end_at = '2026-09-28T08:00Z'
        where id = (select id from work_items where status = 'todo' and tech_id is null limit 1) returning id, version`)).rows[0];
      await c.query("select public.rework_item($1, $2, 'Pinholes', '2026-10-01T05:00Z')", [w.id, w.version]);
      const after = (await c.query("select status, rework, end_at from work_items where id = $1", [w.id])).rows[0];
      expect(after).toMatchObject({ status: "doing", rework: 1, end_at: null });
      expect(count((await c.query("select count(*) n from work_segments where work_item_id = $1", [w.id])).rows)).toBe(1);
      expect(count((await c.query("select count(*) n from rework_log where work_item_id = $1 and reason = 'Pinholes'", [w.id])).rows)).toBe(1);
    });
  });
});

describe("task queue & departments (phase 3.5)", () => {
  it("seeds five departments (Modelling added 2026-10-12) with everyone unassigned", async () => {
    const r = await as(url, { role: "postgres" }, async (c) => ({
      depts: count((await c.query("select count(*) n from departments")).rows),
      assigned: count((await c.query("select count(*) n from people where department_id is not null")).rows),
    }));
    expect(r).toEqual({ depts: 5, assigned: 0 });
  });

  it("supervisor manages the queue; viewer only reads; positions are unique per person", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const nino = (await c.query("select id from people where name = 'Nino'")).rows[0].id;
      await c.query("insert into queue_tasks (person_id, title, dur_value, dur_unit, position) values ($1, 'Sand bonnet', 3, 'hours', 'a0')", [nino]);
      await expect(c.query("insert into queue_tasks (person_id, title, dur_value, position) values ($1, 'Dup', 1, 'a0')", [nino]))
        .rejects.toThrow(/queue_tasks_person_id_position_key/);
    });
    await expect(as(url, { role: "authenticated", userId: viewer }, async (c) => {
      const nino = (await c.query("select id from people where name = 'Nino'")).rows[0].id;
      await c.query("insert into queue_tasks (person_id, title, dur_value, position) values ($1, 'x', 1, 'b0')", [nino]);
    })).rejects.toThrow(/row-level security/);
  });

  it("queue changes are audited and ping realtime", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const yan = (await c.query("select id from people where name = 'Yan'")).rows[0].id;
      await c.query("insert into queue_tasks (person_id, title, dur_value, position) values ($1, 'Polish doors', 2, 'a0')", [yan]);
      const a = (await c.query("select actor_role, action from audit_log where entity = 'queue_tasks' order by id desc limit 1")).rows[0];
      expect(a).toEqual({ actor_role: "supervisor", action: "insert" });
      await c.query("reset role");
      expect((await c.query("select payload from realtime.sent order by id desc limit 1")).rows[0].payload).toEqual({ table: "queue_tasks", op: "insert" });
    });
  });

  it("display links stay owner-only (they hold the token hash)", async () => {
    await as(url, { role: "authenticated", userId: owner }, (c) =>
      c.query("insert into displays (name, token_hash, department_id) values ('Paint bay TV', 'h1', (select id from departments where key = 'paint'))"), true);
    const sup = await as(url, { role: "authenticated", userId: supervisor }, (c) => c.query("select count(*) n from displays"));
    expect(count(sup.rows)).toBe(0);
    await expect(as(url, { role: "anon" }, (c) => c.query("select * from displays"))).rejects.toThrow(/permission denied/);
  });
});

describe("floor log (phase 4)", () => {
  // One open part-step for each of two different technicians.
  const doing = `select distinct on (w.tech_id) w.id, w.tech_id from work_items w join projects p on p.id = w.project_id
    where p.serial = 'EXT-001' and w.status = 'doing' order by w.tech_id, w.id limit 2`;

  it("a supervisor saves a day; the rate is snapshotted but only the owner can read it", async () => {
    await as(url, { role: "postgres" }, (c) => c.query("update people_cost set base_salary = 5200, loading_pct = 25 where person_id in (select tech_id from work_items where status = 'doing')"), true);
    const items = (await as(url, { role: "postgres" }, (c) => c.query(doing))).rows;
    await as(url, { role: "authenticated", userId: supervisor }, (c) =>
      c.query("select public.commit_day('2026-10-01', $1, $2)", [
        JSON.stringify(items.map((i) => ({ person_id: i.tech_id, present: true }))),
        JSON.stringify(items.map((i) => ({ person_id: i.tech_id, work_item_id: i.id, hours: 4 }))),
      ]), true);
    const sup = await as(url, { role: "authenticated", userId: supervisor }, async (c) => ({
      logs: count((await c.query("select count(*) n from hour_logs where day = '2026-10-01'")).rows),
      costs: count((await c.query("select count(*) n from hour_log_cost")).rows),
    }));
    expect(sup).toEqual({ logs: 2, costs: 0 });
    const own = await as(url, { role: "authenticated", userId: owner }, (c) =>
      c.query("select c.rate, c.cost from hour_log_cost c join hour_logs l on l.id = c.log_id where l.day = '2026-10-01'"));
    // 5200 × 1.25 ÷ 26 ÷ 8 = 31.25 per hour; 4h → 125
    expect(own.rows.map((r) => [Number(r.rate), Number(r.cost)])).toEqual([[31.25, 125], [31.25, 125]]);
  });

  it("saving again keeps the original rate for unchanged logs", async () => {
    await as(url, { role: "postgres" }, (c) => c.query("update people_cost set base_salary = 10400"), true);
    const items = (await as(url, { role: "postgres" }, (c) => c.query(doing))).rows;
    await as(url, { role: "authenticated", userId: supervisor }, (c) =>
      c.query("select public.commit_day('2026-10-01', '[]', $1)", [JSON.stringify(items.map((i) => ({ person_id: i.tech_id, work_item_id: i.id, hours: 6 })))]), true);
    const own = await as(url, { role: "authenticated", userId: owner }, (c) =>
      c.query("select c.rate, c.cost from hour_log_cost c join hour_logs l on l.id = c.log_id where l.day = '2026-10-01'"));
    expect(own.rows.map((r) => [Number(r.rate), Number(r.cost)])).toEqual([[31.25, 187.5], [31.25, 187.5]]);
  });

  it("refuses more than a working day per person, and refuses viewers", async () => {
    const [i] = (await as(url, { role: "postgres" }, (c) => c.query(doing))).rows;
    await expect(as(url, { role: "authenticated", userId: supervisor }, (c) =>
      c.query("select public.commit_day('2026-10-02', '[]', $1)", [JSON.stringify([{ person_id: i.tech_id, work_item_id: i.id, hours: 9 }])])))
      .rejects.toThrow(/a working day holds 8h/);
    await expect(as(url, { role: "authenticated", userId: viewer }, (c) => c.query("select public.commit_day('2026-10-02', '[]', '[]')")))
      .rejects.toThrow(/Read-only access/);
  });
});

describe("week planner & TV notices (v1)", () => {
  it("plan tasks carry a priority that defaults to normal and only accepts normal/urgent", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const toto = (await c.query("select id from people where name = 'Toto'")).rows[0].id;
      const r = await c.query("insert into queue_tasks (person_id, title, dur_value, position) values ($1, 'Trim', 1, 'a0') returning priority", [toto]);
      expect(r.rows[0].priority).toBe("normal");
      await expect(c.query("update queue_tasks set priority = 'later' where person_id = $1", [toto])).rejects.toThrow(/check constraint/);
    });
  });

  it("supervisors post notices; viewers read them; anonymous can't read", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, (c) =>
      c.query("insert into notices (department_id, icon, title, daily_at) values ((select id from departments where key = 'modification'), '🔍', 'Quality check', '16:00')"), true);
    const v = await as(url, { role: "authenticated", userId: viewer }, (c) => c.query("select count(*) n from notices"));
    expect(count(v.rows)).toBe(1);
    await expect(as(url, { role: "authenticated", userId: viewer }, (c) => c.query("insert into notices (title) values ('x')"))).rejects.toThrow(/row-level security/);
    await expect(as(url, { role: "anon" }, (c) => c.query("select * from notices"))).rejects.toThrow(/permission denied/);
  });
});

describe("v2: minutes and templates", () => {
  it("task durations keep whole minutes", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const toto = (await c.query("select id from people where name = 'Toto'")).rows[0].id;
      const r = await c.query("insert into queue_tasks (person_id, title, dur_value, position) values ($1, 'Tool check', $2, 'a9') returning dur_value", [toto, 25 / 60]);
      expect(Math.round(Number(r.rows[0].dur_value) * 60)).toBe(25);
    });
  });

  it("a supervisor saves a build as a template in one go; a viewer can't", async () => {
    const tpl = { key: "t-copy", label: "Copy", from_project: "", parts: ["Bonnet", "Roof"],
      stages: [{ name: "Make Mold", station_type: "modification", part_hours: 8, tasks: [{ name: "Layup", dur_h: 11 }, { name: "Cure", dur_h: 16 }] }] };
    await expect(as(url, { role: "authenticated", userId: viewer }, (c) => c.query("select public.create_template($1)", [tpl]))).rejects.toThrow(/row-level security|Read-only/);
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const id = (await c.query("select public.create_template($1) id", [tpl])).rows[0].id;
      const n = async (t: string) => count((await c.query(`select count(*) n from ${t} where template_id = $1`, [id])).rows);
      expect([await n("template_stages"), await n("template_tasks"), await n("template_parts")]).toEqual([1, 2, 2]);
    });
  });

  it("crew profiles take a work type and a contract that can't end before it starts", async () => {
    await as(url, { role: "authenticated", userId: supervisor }, async (c) => {
      const r = await c.query("update people set employment = 'project_based', contract_from = '2026-10-01', contract_to = '2026-11-30' where name = 'Norlen' returning employment");
      expect(r.rows[0].employment).toBe("project_based");
    });
    await expect(as(url, { role: "authenticated", userId: supervisor }, (c) => c.query("update people set employment = 'freelance' where name = 'Norlen'"))).rejects.toThrow(/check constraint/);
    await expect(as(url, { role: "authenticated", userId: supervisor }, (c) =>
      c.query("update people set contract_from = '2026-10-01', contract_to = '2026-09-01' where name = 'Norlen'"))).rejects.toThrow(/people_contract_order/);
  });
});

describe("amends 2026-10-12: serial-numbered parts", () => {
  const TEMPLATE = readFileSync(join(__dirname, "../../public/templates/KYNETIK_PARTS_TEMPLATE.csv"), "utf8");
  const drafts = () => {
    const r = rowsFromCsv(TEMPLATE);
    if (!r.ok) throw new Error(r.error);
    return expandParts(r.value, DEFAULT_SETTINGS.labels).map((d) => ({
      key: d.key, parent_key: d.parentKey, serial: d.serial, name: d.name, description: d.description, material: d.material,
      finish_colour: d.finishColour, finish_sheen: d.finishSheen, unit_no: d.unitNo, sort: d.sort,
    }));
  };
  let pid = "";

  it("has the Modelling department and the 10-stage Exterior panels template; the old ones are archived", async () => {
    const r = await as(url, { role: "postgres" }, async (c) => ({
      dept: (await c.query("select name from departments where key = 'modelling'")).rows.map((x) => x.name),
      stages: (await c.query("select ts.name, ts.station_type from template_stages ts join templates t on t.id = ts.template_id where t.key = 'exteriorPanels' order by ts.sort")).rows,
      offered: (await c.query("select key from templates where not archived")).rows.map((x) => x.key),
    }));
    expect(r.dept).toEqual(["Modelling"]);
    expect(r.stages.map((s) => s.name)).toEqual([
      "Modelling", "3D printing", "Prototyping", "Pre-mold production", "Mold production", "Carbon fibre component production",
      "Fitment", "Paint preparation & painting", "Sanding & polishing", "Assembly",
    ]);
    expect(r.stages.map((s) => s.station_type)).toEqual(["modelling", "modification", "modification", "modification", "modification", "modification", "fitment", "paint", "paint", "fitment"]);
    expect(r.offered).toEqual(["exteriorPanels"]);
  });

  it("creates a project from the template CSV: 6 trackable parts × 10 stages", async () => {
    pid = await as(url, { role: "authenticated", userId: owner }, async (c) => (await c.query(
      "select create_panel_project($1) id", [{ serial: "12-02", name: "Panels", start_date: "2026-10-12", parts: drafts() }],
    )).rows[0].id as string, true);
    const r = await as(url, { role: "postgres" }, async (c) => ({
      gated: (await c.query("select gated from projects where id = $1", [pid])).rows[0].gated,
      parts: (await c.query("select serial, (select serial from parts p2 where p2.id = p.parent_id) parent, unit_no from parts p where project_id = $1 order by sort", [pid])).rows,
      work: count((await c.query("select count(*) n from work_items where project_id = $1", [pid])).rows),
      folderWork: count((await c.query("select count(*) n from work_items w join parts p on p.id = w.part_id where p.serial = '12-02-105'")).rows),
    }));
    expect(r.gated).toBe(true);
    expect(r.parts.map((x) => [x.serial, x.parent, x.unit_no])).toEqual([
      ["12-02-101", null, null], ["12-02-102", null, null], ["12-02-103", null, null], ["12-02-105", null, null],
      ["12-02-110-1", null, 1], ["12-02-110-2", null, 2],
    ]);
    expect(r.work).toBe(60);
    expect(r.folderWork).toBe(10);
  });

  it("never reuses a serial, even after its part is deleted", async () => {
    await as(url, { role: "authenticated", userId: owner }, (c) => c.query("delete from parts where serial = '12-02-103'"), true);
    await expect(as(url, { role: "authenticated", userId: owner }, (c) =>
      c.query("select add_panel_parts($1, $2)", [pid, JSON.stringify([{ key: "x", serial: "12-02-103", name: "Again", material: "Twill", finish_colour: "Red", finish_sheen: "Gloss" }])])),
    ).rejects.toThrow(/12-02-103 has already been used/);
  });

  it("allows one level of sub-parts only, and refuses a bad serial or list value", async () => {
    await as(url, { role: "authenticated", userId: owner }, async (c) => {
      const bumper = (await c.query("select id from parts where serial = '12-02-105'")).rows[0].id;
      await c.query("select add_panel_parts($1, $2)", [pid, JSON.stringify([
        { key: "a", parent_id: bumper, serial: "12-02-105-A", name: "Front Bumper 1 of 2", material: "Twill", finish_colour: "Nardo Grey", finish_sheen: "Satin" },
      ])]);
    }, true);
    await expect(as(url, { role: "authenticated", userId: owner }, async (c) => {
      const sub = (await c.query("select id from parts where serial = '12-02-105-A'")).rows[0].id;
      await c.query("insert into parts (project_id, parent_id, serial, name) values ($1, $2, '12-02-105-A-1', 'Too deep')", [pid, sub]);
    })).rejects.toThrow(/Only one level of sub-parts/);
    await expect(as(url, { role: "authenticated", userId: owner }, (c) =>
      c.query("insert into parts (project_id, serial, name) values ($1, '12-2-101', 'Bad')", [pid]))).rejects.toThrow(/parts_serial_check/);
    await expect(as(url, { role: "authenticated", userId: owner }, (c) =>
      c.query("insert into parts (project_id, serial, name, material) values ($1, '12-02-120', 'Bad', 'Kevlar')", [pid]))).rejects.toThrow(/parts_material_check/);
  });

  it("splitting a part into sub-parts makes it a folder: its own steps go, the sub-parts get theirs", async () => {
    await as(url, { role: "authenticated", userId: owner }, async (c) => {
      const bonnet = (await c.query("select id from parts where serial = '12-02-101'")).rows[0].id;
      await c.query("select add_panel_parts($1, $2)", [pid, JSON.stringify([
        { key: "a", parent_id: bonnet, serial: "12-02-101-A", name: "Bonnet - Front", material: "Carbon fiber", finish_colour: "Exposed carbon", finish_sheen: "Gloss" },
        { key: "b", parent_id: bonnet, serial: "12-02-101-B", name: "Bonnet - Rear", material: "Carbon fiber", finish_colour: "Exposed carbon", finish_sheen: "Gloss" },
      ])]);
    }, true);
    const r = await as(url, { role: "postgres" }, async (c) => ({
      folder: count((await c.query("select count(*) n from work_items w join parts p on p.id = w.part_id where p.serial = '12-02-101'")).rows),
      subs: count((await c.query("select count(*) n from work_items w join parts p on p.id = w.part_id where p.serial like '12-02-101-_'")).rows),
    }));
    expect(r).toEqual({ folder: 0, subs: 20 });
  });

  it("a viewer can't create a project", async () => {
    await expect(as(url, { role: "authenticated", userId: viewer }, (c) =>
      c.query("select create_panel_project($1)", [{ serial: "13-02", start_date: "2026-10-12", parts: [] }]))).rejects.toThrow(/row-level security/);
  });
});

describe("amends 2026-10-12: QC gate and mold components", () => {
  let pid = "";
  const step = async (serial: string, stage: string) => as(url, { role: "postgres" }, async (c) =>
    (await c.query("select w.id from work_items w join parts p on p.id = w.part_id join stages s on s.id = w.stage_id where p.serial = $1 and s.step = $2 order by w.component_no nulls first", [serial, stage])).rows.map((r) => r.id as string));
  const sup = <T>(fn: (c: import("pg").Client) => Promise<T>, commit = true) => as(url, { role: "authenticated", userId: supervisor }, fn, commit);

  beforeAll(async () => {
    pid = await sup(async (c) => (await c.query("select create_panel_project($1) id", [{
      serial: "14-02", start_date: "2026-10-12",
      parts: [{ key: "a", serial: "14-02-101", name: "Bonnet", material: "Twill", finish_colour: "Exposed carbon", finish_sheen: "Gloss", sort: 0 }],
    }])).rows[0].id as string);
    await as(url, { role: "postgres" }, (c) => c.query("update work_items set tech_id = (select id from people order by name limit 1) where project_id = $1", [pid]), true);
  });

  it("records which stage is which", async () => {
    const r = await as(url, { role: "postgres" }, (c) => c.query("select step from stages where project_id = $1 order by sort", [pid]));
    expect(r.rows.map((x) => x.step)).toEqual(["modelling", "printing", "prototyping", "premold", "mold", "carbon", "fitment", "paint", "sanding", "assembly"]);
  });

  it("a stage can't start before the one before it has passed QC", async () => {
    const [printing] = await step("14-02-101", "printing");
    await expect(sup((c) => c.query("update work_items set status = 'doing', start_at = now() where id = $1", [printing]))).rejects.toThrow(/still in Modelling/);
  });

  it("Done comes only from QC: submit, reject with a reason (rework, same technician), submit again, approve", async () => {
    const [m] = await step("14-02-101", "modelling");
    await sup((c) => c.query("update work_items set status = 'doing', start_at = now() - interval '2 hours', seg_start = now() - interval '2 hours' where id = $1", [m]));
    await expect(sup((c) => c.query("update work_items set status = 'done', end_at = now() where id = $1", [m]))).rejects.toThrow(/approving it in QC/);
    // A Modelling step needs its model data first (AM-05).
    await expect(sup((c) => c.query("select submit_qc($1)", [m]))).rejects.toThrow(/model measurement/);
    await sup((c) => c.query("select save_model_data($1, $2)", [m, { length_m: 1, width_m: 1, height_m: 0.1, weight_g: 900, surface_m2: 1, volume_m3: 0.01, render_path: "r.jpg" }]));
    await sup((c) => c.query("select submit_qc($1)", [m]));
    await expect(sup((c) => c.query("select decide_qc($1, false, ' ')", [m]))).rejects.toThrow(/Say what failed/);
    await sup((c) => c.query("select decide_qc($1, false, 'Surface not smooth')", [m]));
    const after = await as(url, { role: "postgres" }, async (c) => ({
      w: (await c.query("select status, attempt, rework, qc_since from work_items where id = $1", [m])).rows[0],
      segs: (await c.query("select attempt from work_segments where work_item_id = $1", [m])).rows.map((x) => x.attempt),
      reviews: (await c.query("select result, reason, attempt from qc_reviews where work_item_id = $1", [m])).rows,
    }));
    expect(after.w).toMatchObject({ status: "doing", attempt: 2, rework: 1, qc_since: null });
    expect(after.segs).toEqual([1]);
    expect(after.reviews).toEqual([{ result: "rejected", reason: "Surface not smooth", attempt: 1 }]);

    await sup((c) => c.query("select submit_qc($1)", [m]));
    await sup((c) => c.query("select decide_qc($1, true, '')", [m]));
    const done = await as(url, { role: "postgres" }, (c) => c.query("select status, end_at is not null ended from work_items where id = $1", [m]));
    expect(done.rows[0]).toEqual({ status: "done", ended: true });
    const [printing] = await step("14-02-101", "printing");
    await sup((c) => c.query("update work_items set status = 'doing', start_at = now() where id = $1", [printing]));
  });

  it("mold components: set after pre-mold passes QC; each is a step; the next stage waits for all of them", async () => {
    const [premold] = await step("14-02-101", "premold");
    const part = (await as(url, { role: "postgres" }, (c) => c.query("select id from parts where serial = '14-02-101'"))).rows[0].id;
    await expect(sup((c) => c.query("select set_mold_components($1, 3)", [part]))).rejects.toThrow(/Pre-mold production has to pass QC/);
    // Fast-forward the earlier stages as the database owner (approval flag on).
    await as(url, { role: "postgres" }, async (c) => {
      await c.query("select set_config('app.qc_approve', 'on', true)");
      await c.query("update work_items w set status = 'done', start_at = now(), end_at = now() from stages s where s.id = w.stage_id and w.project_id = $1 and s.step in ('printing', 'prototyping', 'premold')", [pid]);
    }, true);
    const [mold] = await step("14-02-101", "mold");
    await expect(sup((c) => c.query("update work_items set status = 'doing', start_at = now() where id = $1", [mold]))).rejects.toThrow(/how many mold components/);
    await sup((c) => c.query("select set_mold_components($1, 3)", [part]));
    const molds = await step("14-02-101", "mold");
    expect(molds).toHaveLength(3);
    const labels = await as(url, { role: "postgres" }, (c) => c.query("select component_no, component_total from work_items where id = any($1) order by component_no", [molds]));
    expect(labels.rows).toEqual([{ component_no: 1, component_total: 3 }, { component_no: 2, component_total: 3 }, { component_no: 3, component_total: 3 }]);
    expect(premold).toBeTruthy();

    await as(url, { role: "postgres" }, async (c) => {
      await c.query("select set_config('app.qc_approve', 'on', true)");
      await c.query("update work_items set status = 'done', start_at = now(), end_at = now() where id = any($1)", [molds.slice(0, 2)]);
    }, true);
    const [carbon] = await step("14-02-101", "carbon");
    await expect(sup((c) => c.query("update work_items set status = 'doing', start_at = now() where id = $1", [carbon]))).rejects.toThrow(/still in Mold production/);
    await expect(sup((c) => c.query("select set_mold_components($1, 2)", [part]))).rejects.toThrow(/can't change/);
  });

  it("old projects are untouched: a step can still be marked Done directly", async () => {
    const r = await sup((c) => c.query(
      "update work_items w set status = 'done', start_at = coalesce(start_at, now() - interval '1 hour'), end_at = now(), tech_id = coalesce(tech_id, (select id from people limit 1)) from projects p where p.id = w.project_id and not p.gated and w.status = 'todo' and w.id = (select w2.id from work_items w2 join projects p2 on p2.id = w2.project_id where not p2.gated and w2.status = 'todo' limit 1)"), false);
    expect(r.rowCount).toBe(1);
  });
});

describe("amends 2026-10-12: Modeller login and model data", () => {
  let modeller = "", other = "", mine = "", theirs = "";
  const sup = <T>(fn: (c: import("pg").Client) => Promise<T>) => as(url, { role: "authenticated", userId: supervisor }, fn, true);
  const mod = <T>(fn: (c: import("pg").Client) => Promise<T>, commit = true) => as(url, { role: "authenticated", userId: modeller }, fn, commit);
  const full = { length_m: 1.42, width_m: 0.98, height_m: 0.12, weight_g: 2450, surface_m2: 1.21, volume_m3: 0.0124 };

  beforeAll(async () => {
    modeller = await makeUser(url, "modeller@kynetikkoncepts.com", "modeller");
    other = await makeUser(url, "modeller2@kynetikkoncepts.com", "modeller");
    const pid = await sup(async (c) => (await c.query("select create_panel_project($1) id", [{
      serial: "15-02", start_date: "2026-10-12", parts: [
        { key: "a", serial: "15-02-101", name: "Bonnet", material: "Twill", finish_colour: "Red", finish_sheen: "Gloss", sort: 0 },
        { key: "b", serial: "15-02-102", name: "Fender", material: "Twill", finish_colour: "Red", finish_sheen: "Gloss", sort: 1 },
      ],
    }])).rows[0].id as string);
    await as(url, { role: "postgres" }, async (c) => {
      const [yan, tai] = (await c.query("select id from people order by name limit 2")).rows.map((r) => r.id);
      await c.query("update profiles set person_id = $1 where user_id = $2", [yan, modeller]);
      await c.query("update profiles set person_id = $1 where user_id = $2", [tai, other]);
      const ids = (await c.query("select w.id, p.serial from work_items w join parts p on p.id = w.part_id join stages s on s.id = w.stage_id where w.project_id = $1 and s.step = 'modelling' order by p.serial", [pid])).rows;
      mine = ids[0].id; theirs = ids[1].id;
      await c.query("update work_items set tech_id = $1 where id = $2", [yan, mine]);
      await c.query("update work_items set tech_id = $1 where id = $2", [tai, theirs]);
    }, true);
  });

  it("reads like a viewer: sees projects, no costs, can't write", async () => {
    await mod(async (c) => {
      expect(count((await c.query("select count(*) n from projects")).rows)).toBeGreaterThan(0);
      expect(count((await c.query("select count(*) n from people_cost")).rows)).toBe(0);
      expect((await c.query("update projects set notes = 'x'")).rowCount).toBe(0);
    }, false);
  });

  it("starts their own Modelling step, saves the model data, and needs every value and the render to submit", async () => {
    await mod((c) => c.query("select start_model_step($1)", [mine]));
    await mod((c) => c.query("select save_model_data($1, $2)", [mine, full]));
    await expect(mod((c) => c.query("select submit_qc($1)", [mine]))).rejects.toThrow(/add the render/);
    await mod((c) => c.query("select save_model_data($1, $2)", [mine, { render_path: "x/render.jpg" }]));
    const part = await as(url, { role: "postgres" }, (c) => c.query("select length_m, weight_g, render_path from parts where serial = '15-02-101'"));
    expect(part.rows[0]).toEqual({ length_m: "1.4200", weight_g: "2450.00", render_path: "x/render.jpg" });
    await mod((c) => c.query("select submit_qc($1)", [mine]));
    const w = await as(url, { role: "postgres" }, (c) => c.query("select status, qc_since is not null waiting from work_items where id = $1", [mine]));
    expect(w.rows[0]).toEqual({ status: "doing", waiting: true });
    // A Modeller's "Ask for QC" also shows on Requests (2026-10-14).
    const r = await as(url, { role: "postgres" }, (c) => c.query("select kind, status, task_title, person_id is not null has_person from requests where work_item_id = $1", [mine]));
    expect(r.rows).toEqual([{ kind: "qc", status: "pending", task_title: "15-02-101 Bonnet: Modelling", has_person: true }]);
  });

  it("the first save starts a step that wasn't started (no Start button)", async () => {
    const st = (sql: string) => as(url, { role: "postgres" }, (c) => c.query(sql, [theirs]));
    expect((await st("select status from work_items where id = $1")).rows[0].status).toBe("todo");
    await as(url, { role: "authenticated", userId: other }, (c) => c.query("select start_model_step($1)", [theirs]), true);
    expect((await st("select status, start_at is not null started from work_items where id = $1")).rows[0]).toEqual({ status: "doing", started: true });
  });

  it("can't touch someone else's step, and can't approve", async () => {
    await expect(mod((c) => c.query("select save_model_data($1, $2)", [theirs, full]))).rejects.toThrow(/Only the modeller on this step/);
    await expect(mod((c) => c.query("select start_model_step($1)", [theirs]))).rejects.toThrow(/Only the modeller on this step/);
    await expect(mod((c) => c.query("select decide_qc($1, true, '')", [mine]))).rejects.toThrow(/Only the Owner and Supervisors/);
    await sup((c) => c.query("select decide_qc($1, true, '')", [mine]));
    // Deciding on the QC page closes the request too.
    const r = await as(url, { role: "postgres" }, (c) => c.query("select status from requests where work_item_id = $1", [mine]));
    expect(r.rows).toEqual([{ status: "approved" }]);
  });
});

describe("amends 2026-10-13: Floor Station and requests", () => {
  let floor = "", pid = "", step = "", stepTask = "", shopTask = "";
  const sup = <T>(fn: (c: import("pg").Client) => Promise<T>) => as(url, { role: "authenticated", userId: supervisor }, fn, true);
  const ipad = <T>(fn: (c: import("pg").Client) => Promise<T>, commit = true) => as(url, { role: "authenticated", userId: floor }, fn, commit);
  const one = async (sql: string, args: unknown[] = []) => (await as(url, { role: "postgres" }, (c) => c.query(sql, args))).rows[0];

  beforeAll(async () => {
    floor = await makeUser(url, "floor@kynetikkoncepts.com", "floor_station");
    pid = await sup(async (c) => (await c.query("select create_panel_project($1) id", [{
      serial: "16-02", start_date: "2026-10-12", parts: [{ key: "a", serial: "16-02-101", name: "Bonnet", material: "Twill", finish_colour: "Red", finish_sheen: "Gloss", sort: 0 }],
    }])).rows[0].id as string);
    await as(url, { role: "postgres" }, async (c) => {
      const tech = (await c.query("select id from people order by name limit 1")).rows[0].id;
      // A step past Modelling (3D printing), in progress, on the technician's queue with 2 h allocated.
      await c.query("select set_config('app.qc_approve', 'on', true)");
      await c.query("update work_items w set status = 'done', tech_id = $2, start_at = now() - interval '1 day', end_at = now() - interval '20 hours' from stages s where s.id = w.stage_id and w.project_id = $1 and s.step = 'modelling'", [pid, tech]);
      step = (await c.query("select w.id from work_items w join stages s on s.id = w.stage_id where w.project_id = $1 and s.step = 'printing'", [pid])).rows[0].id;
      await c.query("update work_items set status = 'doing', tech_id = $2, start_at = now() - interval '1 hour', seg_start = now() - interval '1 hour', plan_h = 2 where id = $1", [step, tech]);
      stepTask = (await c.query("insert into queue_tasks (person_id, title, dur_value, dur_unit, project_id, work_item_id, position, status, actual_start) values ($1, 'Bonnet: 3D printing', 2, 'hours', $2, $3, 'z0', 'doing', now() - interval '1 hour') returning id", [tech, pid, step])).rows[0].id;
      shopTask = (await c.query("insert into queue_tasks (person_id, title, dur_value, dur_unit, position, status, actual_start) values ($1, 'Clean-down', 1, 'hours', 'z1', 'doing', now()) returning id", [tech])).rows[0].id;
    }, true);
  });

  it("reads like a viewer (no costs) and can't change anything directly", async () => {
    await ipad(async (c) => {
      expect(count((await c.query("select count(*) n from queue_tasks")).rows)).toBeGreaterThan(0);
      expect(count((await c.query("select count(*) n from people_cost")).rows)).toBe(0);
      expect((await c.query("update queue_tasks set dur_value = 99")).rowCount).toBe(0);
    }, false);
    await expect(ipad((c) => c.query("insert into requests (kind, task_title) values ('qc', 'x')"), false)).rejects.toThrow(/row-level security|permission denied/);
    await expect(ipad((c) => c.query("select submit_qc($1)", [step]), false)).rejects.toThrow(/Read-only access/);
  });

  it("sends a time extension; a second one for the same task waits for the first", async () => {
    await ipad((c) => c.query("select send_request($1, 'extension', 'Resin needs longer to cure')", [stepTask]));
    await expect(ipad((c) => c.query("select send_request($1, 'extension', '')", [stepTask]))).rejects.toThrow(/already waiting/);
    expect(await one("select kind, notes, status, person_id is not null has_person from requests where queue_task_id = $1", [stepTask]))
      .toEqual({ kind: "extension", notes: "Resin needs longer to cure", status: "pending", has_person: true });
  });

  it("only admins decide; an approved extension adds to the allocated time", async () => {
    const id = (await one("select id from requests where queue_task_id = $1 and kind = 'extension'", [stepTask])).id;
    await expect(ipad((c) => c.query("select decide_request($1, true, '', 1)", [id]))).rejects.toThrow(/Only the Owner and Supervisors/);
    await sup((c) => c.query("select decide_request($1, true, 'OK, one more hour', 1.5)", [id]));
    expect(await one("select dur_value from queue_tasks where id = $1", [stepTask])).toEqual({ dur_value: "3.5000" });
    expect(await one("select plan_h from work_items where id = $1", [step])).toEqual({ plan_h: "3.5000" });
    expect(await one("select status, extra_h, reply from requests where id = $1", [id])).toEqual({ status: "approved", extra_h: "1.5000", reply: "OK, one more hour" });
  });

  it("a QC request puts the step in the QC list; approving it passes QC", async () => {
    await ipad((c) => c.query("select send_request($1, 'qc', '')", [stepTask]));
    expect(await one("select qc_since is not null waiting from work_items where id = $1", [step])).toEqual({ waiting: true });
    const id = (await one("select id from requests where queue_task_id = $1 and kind = 'qc'", [stepTask])).id;
    await sup((c) => c.query("select decide_request($1, true, '', null)", [id]));
    expect(await one("select status from work_items where id = $1", [step])).toEqual({ status: "done" });
    expect(await one("select status from queue_tasks where id = $1", [stepTask])).toEqual({ status: "done" });
  });

  it("a QC request on a workshop task: not approved keeps it open, approved finishes it", async () => {
    await ipad((c) => c.query("select send_request($1, 'qc', 'Area swept')", [shopTask]));
    let id = (await one("select id from requests where queue_task_id = $1 and status = 'pending'", [shopTask])).id;
    await sup((c) => c.query("select decide_request($1, false, 'Floor still wet', null)", [id]));
    expect(await one("select status from queue_tasks where id = $1", [shopTask])).toEqual({ status: "doing" });
    await ipad((c) => c.query("select send_request($1, 'qc', '')", [shopTask]));
    id = (await one("select id from requests where queue_task_id = $1 and status = 'pending'", [shopTask])).id;
    await sup((c) => c.query("select decide_request($1, true, '', null)", [id]));
    expect(await one("select status from queue_tasks where id = $1", [shopTask])).toEqual({ status: "done" });
  });
});

describe("2026-10-14: QC from the project board", () => {
  let pid = "", model = "";
  const sup = <T>(fn: (c: import("pg").Client) => Promise<T>) => as(url, { role: "authenticated", userId: supervisor }, fn, true);
  const one = async (sql: string, args: unknown[] = []) => (await as(url, { role: "postgres" }, (c) => c.query(sql, args))).rows[0];

  beforeAll(async () => {
    pid = await sup(async (c) => (await c.query("select create_panel_project($1) id", [{
      serial: "17-02", start_date: "2026-10-14", parts: [{ key: "a", serial: "17-02-101", name: "Bonnet", material: "Twill", finish_colour: "Red", finish_sheen: "Gloss", sort: 0 }],
    }])).rows[0].id as string);
    model = (await one("select w.id from work_items w join stages s on s.id = w.stage_id where w.project_id = $1 and s.step = 'modelling'", [pid])).id;
    await as(url, { role: "postgres" }, (c) => c.query("update work_items set tech_id = (select id from people order by name limit 1) where id = $1", [model]), true);
  });

  it("refuses a step not started, and a model without its record", async () => {
    await expect(sup((c) => c.query("select board_qc($1, true, '')", [model]))).rejects.toThrow(/Set it In Progress first/);
    await sup((c) => c.query("select start_model_step($1)", [model]));
    await expect(sup((c) => c.query("select board_qc($1, true, '')", [model]))).rejects.toThrow(/No model record yet/);
    expect(await one("select status, qc_since from work_items where id = $1", [model])).toEqual({ status: "doing", qc_since: null });
  });

  it("fails with a reason (rework), then passes once the model record is saved", async () => {
    await expect(sup((c) => c.query("select board_qc($1, false, '')", [model]))).rejects.toThrow(/Say what failed/);
    await sup((c) => c.query("select board_qc($1, false, 'Wrong wheelbase')", [model]));
    expect(await one("select status, rework, attempt from work_items where id = $1", [model])).toEqual({ status: "doing", rework: 1, attempt: 2 });
    await sup((c) => c.query("select save_model_data($1, $2)", [model, { length_m: 1, width_m: 1, height_m: 0.1, weight_g: 900, surface_m2: 1, volume_m3: 0.01, render_path: "x/r.jpg" }]));
    await sup((c) => c.query("select board_qc($1, true, '')", [model]));
    expect(await one("select status from work_items where id = $1", [model])).toEqual({ status: "done" });
    expect(await one("select count(*)::int n from qc_reviews where work_item_id = $1 and result is not null", [model])).toEqual({ n: 2 });
  });
});

describe("2026-10-15: sub-parts in My Models (AM-23) and QC notes (AM-22)", () => {
  let mod = "", pid = "", bumper = "", unit = "";
  const sup = <T>(fn: (c: import("pg").Client) => Promise<T>) => as(url, { role: "authenticated", userId: supervisor }, fn, true);
  const asMod = <T>(fn: (c: import("pg").Client) => Promise<T>) => as(url, { role: "authenticated", userId: mod }, fn, true);
  const one = async (sql: string, args: unknown[] = []) => (await as(url, { role: "postgres" }, (c) => c.query(sql, args))).rows[0];
  const full = { length_m: 1.4, width_m: 0.9, height_m: 0.2, weight_g: 2400, surface_m2: 1.2, volume_m3: 0.012, render_path: "x/b.jpg" };

  beforeAll(async () => {
    mod = await makeUser(url, "modeller3@kynetikkoncepts.com", "modeller");
    pid = await sup(async (c) => (await c.query("select create_panel_project($1) id", [{
      serial: "18-02", start_date: "2026-10-15", parts: [
        { key: "a", serial: "18-02-105", name: "Front Bumper", material: "Twill", finish_colour: "Nardo Grey", finish_sheen: "Satin", sort: 0 },
        { key: "b", serial: "18-02-110-1", name: "Mirror Cap", material: "Fiberglass", finish_colour: "Black", finish_sheen: "Gloss", unit_no: 1, sort: 1 },
      ],
    }])).rows[0].id as string);
    await as(url, { role: "postgres" }, async (c) => {
      const person = (await c.query("select id from people order by name limit 1 offset 2")).rows[0].id;
      await c.query("update profiles set person_id = $1 where user_id = $2", [person, mod]);
      const ids = (await c.query("select w.id, p.serial from work_items w join parts p on p.id = w.part_id join stages s on s.id = w.stage_id where w.project_id = $1 and s.step = 'modelling' order by p.serial", [pid])).rows;
      bumper = ids[0].id; unit = ids[1].id;
      await c.query("update work_items set tech_id = $1 where id = any($2)", [person, [bumper, unit]]);
    }, true);
  });

  it("plans a split: 2 to 26 named pieces; nothing is created (no serial used) until QC approves", async () => {
    await asMod((c) => c.query("select start_model_step($1)", [bumper]));
    await expect(asMod((c) => c.query("select save_split($1, $2)", [bumper, JSON.stringify(["Only one"])]))).rejects.toThrow(/2 to 26/);
    await asMod((c) => c.query("select save_split($1, $2)", [bumper, JSON.stringify(["Front Bumper 1 of 3", "Front Bumper 2 of 3", "Front Bumper 3 of 3"])]));
    expect(await one("select jsonb_array_length(split_plan) n from parts where serial = '18-02-105'")).toEqual({ n: 3 });
    expect(await one("select count(*)::int n from serial_registry where serial like '18-02-105-%'")).toEqual({ n: 0 });
  });

  it("asks for QC with a note; the note is on the review and the request", async () => {
    await asMod((c) => c.query("select save_model_data($1, $2)", [bumper, full]));
    await asMod((c) => c.query("select submit_qc($1, $2)", [bumper, "Split for the mould"]));
    expect(await one("select notes from qc_reviews where work_item_id = $1", [bumper])).toEqual({ notes: "Split for the mould" });
    expect(await one("select notes, status from requests where work_item_id = $1", [bumper])).toEqual({ notes: "Split for the mould", status: "pending" });
    await expect(asMod((c) => c.query("select save_split($1, '[]')", [bumper]))).rejects.toThrow(/waiting for QC/);
  });

  it("approval creates the lettered sub-parts with their own steps from 3D printing; the original leaves the active list", async () => {
    await sup((c) => c.query("select decide_qc($1, true, '')", [bumper]));
    const subs = (await as(url, { role: "postgres" }, (c) => c.query(
      "select serial, name, material, finish_sheen, (select count(*)::int from work_items w where w.part_id = p.id) steps from parts p where parent_id = (select id from parts where serial = '18-02-105') order by serial"))).rows;
    expect(subs).toEqual([
      { serial: "18-02-105-A", name: "Front Bumper 1 of 3", material: "Twill", finish_sheen: "Satin", steps: 9 },
      { serial: "18-02-105-B", name: "Front Bumper 2 of 3", material: "Twill", finish_sheen: "Satin", steps: 9 },
      { serial: "18-02-105-C", name: "Front Bumper 3 of 3", material: "Twill", finish_sheen: "Satin", steps: 9 },
    ]);
    // The original keeps only its approved Modelling step (history) and its model data.
    expect(await one("select count(*)::int n, bool_and(w.status = 'done') done from work_items w join parts p on p.id = w.part_id where p.serial = '18-02-105'")).toEqual({ n: 1, done: true });
    expect(await one("select split_at is not null split, length_m from parts where serial = '18-02-105'")).toEqual({ split: true, length_m: "1.4000" });
    expect(await one("select status from requests where work_item_id = $1", [bumper])).toEqual({ status: "approved" });
  });

  it("a unit splits on its own (18-02-110-1-A); a part without a plan stays one part", async () => {
    await asMod((c) => c.query("select start_model_step($1)", [unit]));
    await asMod((c) => c.query("select save_split($1, $2)", [unit, JSON.stringify(["Shell", "Base"])]));
    await asMod((c) => c.query("select save_model_data($1, $2)", [unit, full]));
    await asMod((c) => c.query("select submit_qc($1)", [unit]));
    await sup((c) => c.query("select decide_qc($1, true, '')", [unit]));
    expect((await as(url, { role: "postgres" }, (c) => c.query("select serial from parts where serial like '18-02-110-1-%' order by serial"))).rows.map((r) => r.serial))
      .toEqual(["18-02-110-1-A", "18-02-110-1-B"]);
  });
});

describe("2026-10-15: 3D Printing and the Modelling & 3D Printing role (AM-24)", () => {
  let pr = "", other = "", pid = "", job = "", taken = "";
  const sup = <T>(fn: (c: import("pg").Client) => Promise<T>) => as(url, { role: "authenticated", userId: supervisor }, fn, true);
  const asPr = <T>(fn: (c: import("pg").Client) => Promise<T>, commit = true) => as(url, { role: "authenticated", userId: pr }, fn, commit);
  const one = async (sql: string, args: unknown[] = []) => (await as(url, { role: "postgres" }, (c) => c.query(sql, args))).rows[0];

  beforeAll(async () => {
    pr = await makeUser(url, "printer@kynetikkoncepts.com", "modeller");
    other = await makeUser(url, "printer2@kynetikkoncepts.com", "modeller");
    pid = await sup(async (c) => (await c.query("select create_panel_project($1) id", [{
      serial: "19-02", start_date: "2026-10-15", parts: [
        { key: "a", serial: "19-02-101", name: "Bonnet", material: "Twill", finish_colour: "Red", finish_sheen: "Gloss", sort: 0 },
        { key: "b", serial: "19-02-102", name: "Fender", material: "Twill", finish_colour: "Red", finish_sheen: "Gloss", sort: 1 },
      ],
    }])).rows[0].id as string);
    await as(url, { role: "postgres" }, async (c) => {
      const [a, b] = (await c.query("select id from people order by name limit 2 offset 3")).rows.map((r) => r.id);
      await c.query("update profiles set person_id = $1 where user_id = $2", [a, pr]);
      await c.query("update profiles set person_id = $1 where user_id = $2", [b, other]);
      // Both models passed QC.
      await c.query("select set_config('app.qc_approve', 'on', true)");
      await c.query("update work_items w set status = 'done', tech_id = $2, start_at = now() - interval '1 day', end_at = now() - interval '20 hours' from stages s where s.id = w.stage_id and w.project_id = $1 and s.step = 'modelling'", [pid, a]);
      const rows = (await c.query("select w.id from work_items w join stages s on s.id = w.stage_id join parts p on p.id = w.part_id where w.project_id = $1 and s.step = 'printing' order by p.serial", [pid])).rows;
      job = rows[0].id; taken = rows[1].id;
      await c.query("update work_items set tech_id = $1 where id = $2", [b, taken]);
    }, true);
  });

  it("takes an unassigned job by starting it, but not someone else's", async () => {
    await asPr((c) => c.query("select start_print_step($1)", [job]));
    expect(await one("select status, tech_id = (select person_id from profiles where user_id = $2) mine from work_items where id = $1", [job, pr])).toEqual({ status: "doing", mine: true });
    await expect(asPr((c) => c.query("select start_print_step($1)", [taken]))).rejects.toThrow(/Only the person on this print job/);
    await expect(asPr((c) => c.query("select save_print_data($1, $2)", [taken, { print_slices: 2 }]))).rejects.toThrow(/Only the person on this print job/);
  });

  it("needs filament, printing time and slices before QC; the request shows on QC and Requests", async () => {
    await asPr((c) => c.query("select save_print_data($1, $2)", [job, { print_filament_g: 320.5, print_min: 540 }]));
    await expect(asPr((c) => c.query("select submit_qc($1)", [job]))).rejects.toThrow(/slice components/);
    await asPr((c) => c.query("select save_print_data($1, $2)", [job, { print_slices: 4 }]));
    expect(await one("select print_filament_g, print_min, print_slices from parts where serial = '19-02-101'")).toEqual({ print_filament_g: "320.50", print_min: "540.00", print_slices: 4 });
    await asPr((c) => c.query("select submit_qc($1, 'Four slices glued')", [job]));
    expect(await one("select status, notes from requests where work_item_id = $1", [job])).toEqual({ status: "pending", notes: "Four slices glued" });
  });

  it("can't approve; an admin's approval moves the part on to Prototyping", async () => {
    await expect(asPr((c) => c.query("select decide_qc($1, true, '')", [job]))).rejects.toThrow(/Only the Owner and Supervisors/);
    await sup((c) => c.query("select decide_qc($1, true, '')", [job]));
    expect(await one("select status from work_items where id = $1", [job])).toEqual({ status: "done" });
    // The board refuses a print pass without its record.
    await as(url, { role: "postgres" }, (c) => c.query("update work_items set status = 'doing', start_at = now() where id = $1", [taken]), true);
    await expect(sup((c) => c.query("select board_qc($1, true, '')", [taken]))).rejects.toThrow(/No print record yet/);
  });

  it("after approval only an admin corrects the values, and none can be emptied (2026-10-15)", async () => {
    await expect(asPr((c) => c.query("select save_print_data($1, $2)", [job, { print_slices: 5 }]))).rejects.toThrow(/only the Owner or a Supervisor/);
    await sup((c) => c.query("select save_print_data($1, $2)", [job, { print_slices: 5 }]));
    expect(await one("select print_slices from parts where serial = '19-02-101'")).toEqual({ print_slices: 5 });
    await expect(sup((c) => c.query("select save_print_data($1, $2)", [job, { print_min: "" }]))).rejects.toThrow(/keeps its filament/);
    const model = (await one("select w.id from work_items w join stages s on s.id = w.stage_id join parts p on p.id = w.part_id where p.serial = '19-02-101' and s.step = 'modelling'")).id;
    await sup((c) => c.query("select save_model_data($1, $2)", [model, { length_m: 1, width_m: 1, height_m: 0.1, weight_g: 900, surface_m2: 1, volume_m3: 0.01, render_path: "x/r.jpg" }]));
    await expect(sup((c) => c.query("select save_model_data($1, $2)", [model, { render_path: "" }]))).rejects.toThrow(/keeps every measurement/);
  });
});

describe("2026-10-15: Owner preview of Modelling & 3D Printing", () => {
  it("a Submit for QC from the preview also goes to Requests, once, and only for the Owner", async () => {
    const one = async (sql: string, args: unknown[] = []) => (await as(url, { role: "postgres" }, (c) => c.query(sql, args))).rows[0];
    const item = (await one("select w.id from work_items w join stages s on s.id = w.stage_id join parts p on p.id = w.part_id where p.serial = '19-02-102' and s.step = 'printing'")).id;
    await as(url, { role: "postgres" }, (c) => c.query("update work_items set qc_since = now() where id = $1", [item]), true);
    await expect(as(url, { role: "authenticated", userId: supervisor }, (c) => c.query("select preview_qc_request($1, 'x')", [item]), true)).rejects.toThrow(/Only the Owner/);
    await as(url, { role: "authenticated", userId: owner }, (c) => c.query("select preview_qc_request($1, 'From the preview')", [item]), true);
    await as(url, { role: "authenticated", userId: owner }, (c) => c.query("select preview_qc_request($1, 'again')", [item]), true);
    const r = await as(url, { role: "postgres" }, (c) => c.query("select status, notes, sent_by = $2 by_owner from requests where work_item_id = $1", [item, owner]));
    expect(r.rows).toEqual([{ status: "pending", notes: "From the preview", by_owner: true }]);
  });
});

describe("2026-10-15: Crew active, inactive and Deleted accounts (AM-20)", () => {
  const sup = <T>(fn: (c: import("pg").Client) => Promise<T>) => as(url, { role: "authenticated", userId: supervisor }, fn, true);
  const one = async (sql: string, args: unknown[] = []) => (await as(url, { role: "postgres" }, (c) => c.query(sql, args))).rows[0];
  let leaver = "", taker = "", step = "", task = "";

  beforeAll(async () => {
    await as(url, { role: "postgres" }, async (c) => {
      leaver = (await c.query("insert into people (name, department_id) values ('Leaver', (select id from departments where key = 'modification')) returning id")).rows[0].id;
      taker = (await c.query("select id from people where name = 'Nino'")).rows[0].id;
      step = (await c.query("select id from work_items where status = 'todo' limit 1")).rows[0].id;
      await c.query("update work_items set tech_id = $1 where id = $2", [leaver, step]);
      task = (await c.query("insert into queue_tasks (person_id, title, dur_value, dur_unit, position) values ($1, 'Sweep', 1, 'hours', 'q0') returning id", [leaver])).rows[0].id;
    }, true);
  });

  it("a viewer or the Floor Station can't change status", async () => {
    await expect(as(url, { role: "authenticated", userId: viewer }, (c) => c.query("select set_person_status($1, 'inactive')", [leaver]))).rejects.toThrow(/Only the Owner and Supervisors/);
  });

  it("set inactive moves open work to the chosen person", async () => {
    await expect(sup((c) => c.query("select set_person_status($1, 'inactive', $1)", [leaver]))).rejects.toThrow(/someone else/);
    await sup((c) => c.query("select set_person_status($1, 'inactive', $2)", [leaver, taker]));
    expect(await one("select active, archived_at from people where id = $1", [leaver])).toEqual({ active: false, archived_at: null });
    expect(await one("select tech_id = $2 moved from work_items where id = $1", [step, taker])).toEqual({ moved: true });
    expect(await one("select person_id = $2 moved from queue_tasks where id = $1", [task, taker])).toEqual({ moved: true });
  });

  it("delete archives (nothing erased), restore brings the person back; every change is audited", async () => {
    await sup((c) => c.query("select set_person_status($1, 'deleted')", [leaver]));
    expect(await one("select archived_at is not null archived, active from people where id = $1", [leaver])).toEqual({ archived: true, active: false });
    await expect(sup((c) => c.query("select set_person_status($1, 'inactive', $2)", [taker, leaver]))).rejects.toThrow(/active crew member/);
    await sup((c) => c.query("select set_person_status($1, 'restored')", [leaver]));
    expect(await one("select archived_at, active from people where id = $1", [leaver])).toEqual({ archived_at: null, active: false });
    await sup((c) => c.query("select set_person_status($1, 'active')", [leaver]));
    expect(await one("select active from people where id = $1", [leaver])).toEqual({ active: true });
    expect(await one("select count(*)::int n from audit_log where entity = 'people' and entity_id = $1 and action like 'crew_%'", [leaver])).toEqual({ n: 4 });
  });
});

describe("2026-10-16: attendance and absences (AM-29)", () => {
  const sup = <T>(fn: (c: import("pg").Client) => Promise<T>) => as(url, { role: "authenticated", userId: supervisor }, fn, true);
  const one = async (sql: string, args: unknown[] = []) => (await as(url, { role: "postgres" }, (c) => c.query(sql, args))).rows[0];
  let away = "", cover = "", t1 = "", t2 = "", item = "";

  beforeAll(async () => {
    await as(url, { role: "postgres" }, async (c) => {
      [away, cover] = (await c.query("select id from people where active and archived_at is null order by name limit 2 offset 6")).rows.map((r) => r.id);
      item = (await c.query("select id from work_items where status <> 'done' limit 1")).rows[0].id;
      await c.query("update work_items set tech_id = $1 where id = $2", [away, item]);
      t1 = (await c.query("insert into queue_tasks (person_id, title, dur_value, dur_unit, position, work_item_id) values ($1, 'Leave test A', 2, 'hours', 'a0', $2) returning id", [away, item])).rows[0].id;
      t2 = (await c.query("insert into queue_tasks (person_id, title, dur_value, dur_unit, position) values ($1, 'Leave test B', 1, 'hours', 'a1') returning id", [away])).rows[0].id;
    }, true);
  });

  it("marks someone absent: one task reassigned (its part step too), the kept one pinned to the day back", async () => {
    await expect(as(url, { role: "authenticated", userId: viewer }, (c) => c.query(
      "select mark_absent($1, 'sick', '2026-11-02', 2, '2026-11-03', '2026-11-04', '', '[]', null, null)", [away]), true)).rejects.toThrow(/Only the Owner and Supervisors/);
    await sup((c) => c.query("select mark_absent($1, 'annual', '2026-11-02', 2, '2026-11-03', '2026-11-04', 'Booked', $2, $3, '2026-11-04T05:00:00Z')",
      [away, JSON.stringify([{ task: t1, to: cover }]), t2]));
    expect(await one("select person_id = $2 moved from queue_tasks where id = $1", [t1, cover])).toEqual({ moved: true });
    expect(await one("select tech_id = $2 moved from work_items where id = $1", [item, cover])).toEqual({ moved: true });
    expect(await one("select person_id = $2 kept, fixed_start = '2026-11-04T05:00:00Z' pinned from queue_tasks where id = $1", [t2, away])).toEqual({ kept: true, pinned: true });
    expect(await one("select kind, days, back_on::text from absences where person_id = $1", [away])).toEqual({ kind: "annual", days: 2, back_on: "2026-11-04" });
    // A second absence over the same days is refused.
    await expect(sup((c) => c.query("select mark_absent($1, 'sick', '2026-11-03', 1, '2026-11-03', '2026-11-04', '', '[]', null, null)", [away])))
      .rejects.toThrow(/already has an absence/);
  });

  it("refuses hours on an absent day, and allows them once the absence is cancelled", async () => {
    const log = () => as(url, { role: "postgres" }, (c) => c.query(
      "insert into hour_logs (day, person_id, work_item_id, project_id, hours) select '2026-11-03', $1, w.id, w.project_id, 1 from work_items w where w.id = $2", [away, item]), true);
    await expect(log()).rejects.toThrow(/marked absent on 03 Nov/);
    await sup((c) => c.query("update absences set cancelled_at = now() where person_id = $1", [away]));
    await log();
  });
});

describe("2026-10-17: theme switch", () => {
  it("each person sets only their own theme (default Dark), not in the audit log; nothing else", async () => {
    const theme = async (id: string) => (await as(url, { role: "postgres" }, (c) => c.query("select theme from profiles where user_id = $1", [id]))).rows[0].theme;
    expect(await theme(viewer)).toBe("dark");
    const before = (await as(url, { role: "postgres" }, (c) => c.query("select count(*)::int n from audit_log where entity = 'profiles'"))).rows[0].n;
    await as(url, { role: "authenticated", userId: viewer }, (c) => c.query("select set_theme('light')"), true);
    expect(await theme(viewer)).toBe("light");
    expect(await theme(supervisor)).toBe("dark");
    const after = (await as(url, { role: "postgres" }, (c) => c.query("select count(*)::int n from audit_log where entity = 'profiles'"))).rows[0].n;
    expect(after).toBe(before);
    await expect(as(url, { role: "authenticated", userId: viewer }, (c) => c.query("select set_theme('pink')"), true)).rejects.toThrow(/Choose Light, Dark or System/);
    // The direct route stays closed: only the Owner updates profiles.
    await as(url, { role: "authenticated", userId: viewer }, (c) => c.query("update profiles set theme = 'system', role = 'owner' where user_id = $1", [viewer]), true);
    expect(await theme(viewer)).toBe("light");
  });
});
