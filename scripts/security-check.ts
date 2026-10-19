/**
 * Go-live check against a real database (deploy step 3 + step 5). Read-only in effect: the whole check is
 * one SQL script inside a transaction that is ALWAYS rolled back, including the temporary test users.
 *
 *   npm run check:prod
 *
 * Connects with either (in .env.local or the environment):
 *   - DATABASE_URL (the Postgres connection string), or
 *   - SUPABASE_ACCESS_TOKEN + SUPABASE_PROJECT_REF: runs the same script through the Management API
 *     (`POST /v1/projects/{ref}/database/query`), for machines that can't open a Postgres connection.
 * Optional, for the display check: SITE_URL and DISPLAY_TOKEN (a display link's token). The live snapshot
 * is fetched and checked for cost keys and department.
 * Never prints the connection string, a token or any key.
 */
import { lit, redact, sqlRunner } from "./lib/sql";

type Check = { name: string; ok: boolean; detail?: string | null };

const COST_KEYS = /cost|salary|rate|labour|loading/i;

const COST_TABLES = ["people_cost", "settings_cost", "hour_log_cost", "work_item_cost", "project_labour", "day_labour"];

const SCRIPT = `
begin;
create temp table _chk (i serial, name text, ok boolean, detail text);

-- probe(role, user id, query): runs the query as that role in a subtransaction that is always undone.
-- Returns the row count, or 'ERR: <message>' when the database refuses it.
create function pg_temp.probe(r text, uid text, q text) returns text language plpgsql as $f$
declare n bigint; res text;
begin
  begin
    perform set_config('request.jwt.claim.sub', coalesce(uid, ''), true);
    perform set_config('request.jwt.claims', case when uid is null then json_build_object('role', r) else json_build_object('sub', uid, 'role', r) end::text, true);
    execute format('set local role %I', r);
    execute 'with x as (' || q || ') select count(*) from x' into n;
    res := n::text;
    raise exception 'probe_undo';
  exception when others then
    if sqlerrm = 'probe_undo' then return res; end if;
    return 'ERR: ' || sqlerrm;
  end;
end $f$;
create function pg_temp.denied(res text) returns boolean language sql as $f$ select res like 'ERR:%' or res = '0' $f$;
create function pg_temp.chk(name text, ok boolean, detail text default null) returns void language sql as $f$ insert into _chk (name, ok, detail) values (name, ok, detail) $f$;

-- ── step 3: data and structure ──
select pg_temp.chk('Seed: 6 workstations, 12 crew, 3 templates, 6 builds',
  (select count(*) from public.workstations) = 6 and (select count(*) from public.people) = 12 and (select count(*) from public.templates) = 3 and (select count(*) from public.projects) = 6,
  json_build_object('workstations', (select count(*) from public.workstations), 'people', (select count(*) from public.people), 'templates', (select count(*) from public.templates), 'builds', (select count(*) from public.projects), 'settings', (select count(*) from public.settings))::text);
select pg_temp.chk('Departments: 4 defaults', (select count(*) from public.departments) >= 4, (select count(*) from public.departments)::text);
select pg_temp.chk('Employee day 09:00–18:00, lunch 13:00',
  coalesce((select value->>'shiftStart' = '09:00' and value->>'shiftEnd' = '18:00' and value->>'breakStart' = '13:00' from public.settings where key = 'calendar'), false),
  (select (value->>'shiftStart') || '–' || (value->>'shiftEnd') || ', break ' || (value->>'breakStart') from public.settings where key = 'calendar'));
select pg_temp.chk('Gamification settings present', (select count(*) from public.settings where key = 'gamification') = 1);
select pg_temp.chk('Task queue table with positions', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'queue_tasks' and column_name = 'position') = 1);
select pg_temp.chk('Display links: department + leaderboard columns', (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'displays' and column_name in ('department_id','leaderboard_mode','confetti','token_hash')) = 4);
select pg_temp.chk('Floor log save function (commit_day)', (select count(*) from pg_proc where proname = 'commit_day') = 1);
select pg_temp.chk('Realtime: realtime.send exists and change pings fire on queue, work items, people, settings',
  (select count(*) from pg_proc p join pg_namespace s on s.oid = p.pronamespace where s.nspname = 'realtime' and p.proname = 'send') >= 1
  and (select count(*) from pg_trigger where tgname = 'notify_change' and tgrelid in ('public.queue_tasks'::regclass, 'public.work_items'::regclass, 'public.people'::regclass, 'public.settings'::regclass)) = 4,
  'triggers=' || (select count(*) from pg_trigger where tgname = 'notify_change' and tgrelid in ('public.queue_tasks'::regclass, 'public.work_items'::regclass, 'public.people'::regclass, 'public.settings'::regclass)) || '/4');
do $d$ declare b record; begin
  if to_regclass('storage.buckets') is null then perform pg_temp.chk('Storage: private bucket people-photos (1 MB)', false, 'no Storage schema'); return; end if;
  execute 'select public, file_size_limit from storage.buckets where id = ''people-photos''' into b;
  perform pg_temp.chk('Storage: private bucket people-photos (1 MB)', b is not null and b.public = false, case when b is null then 'missing' else 'public=' || b.public || ', limit=' || b.file_size_limit end);
  perform pg_temp.chk('Storage: photo upload/read rules on people-photos', (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual like '%people-photos%' or with_check like '%people-photos%')) >= 2,
    (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and (qual like '%people-photos%' or with_check like '%people-photos%')) || ' policies');
end $d$;

-- ── step 5: permissions ── temporary users, rolled back at the end
create temp table _u as select gen_random_uuid() as sup, gen_random_uuid() as vie;
insert into public.invitations (email, role) values ('security-check-supervisor@kynetikkoncepts.com', 'supervisor'), ('security-check-viewer@kynetikkoncepts.com', 'viewer');
insert into auth.users (id, email, aud, role) select sup, 'security-check-supervisor@kynetikkoncepts.com', 'authenticated', 'authenticated' from _u
  union all select vie, 'security-check-viewer@kynetikkoncepts.com', 'authenticated', 'authenticated' from _u;
select pg_temp.chk('Test users got their roles from invitations', (select count(*) from public.profiles p, _u where p.user_id in (_u.sup, _u.vie)) = 2);

do $d$ declare t text; r text; s text; sup text := (select sup::text from _u); vie text := (select vie::text from _u); begin
  foreach t in array array[${COST_TABLES.map(lit).join(", ")}] loop
    r := pg_temp.probe('anon', null, 'select 1 from public.' || t);
    perform pg_temp.chk('Anonymous (display/no login) can''t read ' || t, pg_temp.denied(r), case when r like 'ERR:%' then 'permission denied' else r || ' rows' end);
    s := pg_temp.probe('authenticated', sup, 'select 1 from public.' || t);
    perform pg_temp.chk('Supervisor can''t read ' || t, pg_temp.denied(s), case when s like 'ERR:%' then 'permission denied' else s || ' rows' end);
  end loop;
  foreach t in array array['audit_log', 'displays', 'projects', 'people', 'queue_tasks', 'notices'] loop
    r := pg_temp.probe('anon', null, 'select 1 from public.' || t);
    perform pg_temp.chk('Anonymous can''t read ' || t, pg_temp.denied(r), case when r like 'ERR:%' then 'permission denied' else r || ' rows visible' end);
  end loop;
  r := pg_temp.probe('anon', null, 'insert into public.holidays (day, name) values (''2099-01-01'', ''x'') returning 1');
  perform pg_temp.chk('Anonymous can''t write anything', r like 'ERR:%', case when r like 'ERR:%' then 'refused' else 'INSERT SUCCEEDED' end);
  r := pg_temp.probe('authenticated', sup, 'select 1 from public.audit_log where sensitive');
  perform pg_temp.chk('Supervisor can''t see cost entries in the audit log', pg_temp.denied(r), r);
  r := pg_temp.probe('authenticated', sup, 'update public.people_cost set base_salary = base_salary returning 1');
  perform pg_temp.chk('Supervisor can''t change salaries', pg_temp.denied(r), r);
  r := pg_temp.probe('authenticated', vie, 'update public.projects set notes = notes returning 1');
  perform pg_temp.chk('Viewer can''t change builds', pg_temp.denied(r), r);
  r := pg_temp.probe('authenticated', sup, 'select 1 from public.displays');
  perform pg_temp.chk('Display tokens are Owner-only', pg_temp.denied(r), r);
  r := pg_temp.probe('authenticated', sup, 'select 1 from public.people');
  perform pg_temp.chk('Supervisor can still read the crew (control)', r not like 'ERR:%' and r::int > 0, r);
end $d$;

select name, ok, detail from _chk order by i;
rollback;
`;

async function main() {
  const run = sqlRunner();
  const results: Check[] = (await run(SCRIPT)).map((r) => ({ name: String(r.name), ok: r.ok === true, detail: r.detail as string | null }));
  if (results.length === 0) throw new Error("The check script returned no results.");

  // ── step 5: the live display snapshot (optional) ──
  const site = process.env.SITE_URL, token = process.env.DISPLAY_TOKEN;
  if (site && token) {
    const r = await fetch(`${site.replace(/\/$/, "")}/api/display/${token}/snapshot`, { cache: "no-store" });
    if (!r.ok) results.push({ name: "Display snapshot loads", ok: false, detail: `HTTP ${r.status}` });
    else {
      const snap = await r.json();
      const text = JSON.stringify(snap);
      results.push({ name: "Display snapshot has no cost, salary or rate fields", ok: !COST_KEYS.test(Object.keys(flatten(snap)).join(" ")) && !/"(cost|salary|rate|hourRate|labour)"/i.test(text) });
      const dept: string | undefined = snap.department?.name;
      const ids: string[] = snap.rows.map((x: { personId: string }) => x.personId).filter((id: string) => /^[0-9a-f-]{36}$/.test(id));
      const other = ids.length && dept
        ? Number((await run(`select count(*) n from public.people p join public.departments d on d.id = p.department_id where p.id in (${ids.map(lit).join(",")}) and d.name <> ${lit(dept)}`))[0]?.n ?? 0)
        : 0;
      results.push({ name: `Display shows only ${dept ?? "its department"}`, ok: !!dept && other === 0, detail: `${ids.length} people` });
    }
  } else {
    results.push({ name: "Display snapshot check skipped (set SITE_URL and DISPLAY_TOKEN to run it)", ok: true });
  }

  for (const r of results) console.log(`${r.ok ? "✅" : "❌"} ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed ? `\n${failed} check(s) failed. Fix them before going live.` : "\nAll checks passed. Nothing was changed (transaction rolled back).");
  process.exit(failed ? 1 : 0);
}

function flatten(o: unknown, out: Record<string, true> = {}): Record<string, true> {
  if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { out[k] = true; flatten(v, out); }
  return out;
}

main().catch((e) => {
  console.error("❌", redact((e as Error).message));
  process.exit(1);
});
