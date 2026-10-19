# Kynetik Build Tracker v2 — Plan (for approval)

Status: **approved 2026-10-01.** Phases 1–3 done; Phase 3.5 done 2026-10-02 (in review). Next: Phase 4.

## 0. Decisions (Owner answers, 2026-10-01)

| # | Question | Decision |
|---|---|---|
| D1 | Hosting | Supabase cloud (DB, Auth, Realtime, Storage) + Vercel. Local dev uses the Supabase CLI (Docker). |
| D2 | Day hours | **Derived from the shift**: (shiftEnd − shiftStart) − break inside the shift. Drives hour rate and the per-person daily logging cap. |
| D3 | Public holidays | Whole days off, list starts empty, Owner adds them. `workingDaysPerMonth` (cost) stays a fixed setting (26). |
| D4 | Seed overlap (Toto/Francis) | Seed exactly as v1; overlap is reported in a "Data health" panel, not auto-fixed. |
| D5 | Parts list editing | Edited by part id; renaming keeps history; removing a part asks for confirmation, then deletes its history. |
| D6 | Users | Email magic-link invites. First Owner: the repo owner's email (set via `OWNER_EMAIL`). |
| D7 | Clash in `warn` mode | Change is allowed, a warning is shown, and the clash appears in Board → Attention. |
| D8 | Scope | Task dependencies / parallel tasks, technician logins and PDF export are **deferred**. |
| D9 | Employee day (2026-10-02) | 09:00–18:00 with lunch 13:00–14:00 (8h) **replaces 08:00–17:00 everywhere**: builds, forecasts, costs, queues and TV. The v1 builds are re-planned on it (same days and order; tasks end 18:00). Recorded actual times are unchanged. |
| D10 | Linked queue task | A queue task linked to a part-step shares its status: starting or finishing either one updates the other, with that technician, under the v1 rules. |
| D11 | Leaderboard counting | Score = §11 on part-steps. Task-count badges (🚀, 🔥) count every finished queue task. |
| D12 | Blocked queue task | Takes no time; stays as a red marker; the next task moves up (v1: Blocked frees the technician). |
| D13 | Fixed start | Means "not before". If the queue runs late, the task starts when the previous ends and shows "late start". |
| D14 | 🔥 streak | 3 working days in a row with at least one task finished on time (editable). |
| D15 | Today leaderboard | Keep the §11 minimum of 3. People under it show as "warming up" with badges but no number. |

### Phase 2 interpretations (spec silent or ambiguous). I1, I2 and I4 confirmed by the Owner on 2026-10-02; the rest are pending

| # | Where | What the code does |
|---|---|---|
| I1 | §8 actual hours after a rework | **Confirmed:** only time worked (earlier segments + the current one). The time a part sat Done before rework doesn't count. |
| I2 | §10 "past standard hours" | **Confirmed:** counts parts **In Progress** over standard (Done parts over standard are history, shown in the table, not alerted). |
| I3 | §10 "unassigned in live stage" | A stage is live when any of its parts or tasks is In Progress. |
| I4 | §10 tech double-booked | **Confirmed:** one alert per overlapping pair of part-steps (Toto has two in the seed). |
| I5 | §10 plan clash `({when})` | The overlap window, "d Mon – d Mon". |
| I6 | §7 forecast cursor | Starts at the first task's planned start, so a future build forecasts from its plan, a past one from now. |
| I7 | §7 pinned start | Normalised to working time (a pin on a Sunday starts Monday 08:00). |
| I8 | §8 wording not in spec | "A Done part needs its start time — …" and "Only a Done part can be sent back for rework." |
| I9 | §10 "no parts list" | Not raised for delivered builds. |
| I10 | §9 conflict times | Shown as "21 Sep 08:00 – now". |

Source of truth for behaviour: [`KYNETIK_BUILD_TRACKER.md`](./KYNETIK_BUILD_TRACKER.md) (the spec). Brief: [`CLAUDE_CODE_PROMPT.md`](./CLAUDE_CODE_PROMPT.md).

---

## 1. Architecture

```
                ┌──────────────────────────── Next.js app (one deploy) ───────────────────────────┐
 Owner /        │  /(console)/*   Admin Console (React Server Components + client islands)         │
 Supervisor /   │       │  Server Actions (Zod-validated) ──► domain/ rules ──► Supabase (user JWT) │
 Viewer ───────►│       │                                                     RLS enforces role     │
 (login)        │                                                                                   │
                │  /display/[token]  Shop Floor Display (kiosk, no login)                           │
 TV / tablet ──►│       │  GET /api/display/[token]/snapshot ──► service role ──► DisplaySnapshot   │
 (secret link)  │       │  (token hashed in DB, revocable; snapshot type has NO cost fields)        │
                └───────┼───────────────────────────────────────────────────────────────────────────┘
                        │ realtime "something changed" ping (no data in it)
                ┌───────▼─────────────── Supabase ─────────────────────────────────────────────┐
                │ Postgres (normalised schema, RLS, audit triggers, SECURITY DEFINER for cost)  │
                │ Auth (email magic link / password, invites)   Realtime (broadcast from DB)    │
                │ Storage (brand logo)                                                           │
                └────────────────────────────────────────────────────────────────────────────────┘
```

Key decisions:

- **Stack:** Next.js 15 (App Router) + TypeScript (strict), Tailwind with the §16 tokens, Supabase (Postgres, Auth, Realtime, RLS, Storage), Zod, Vitest, Playwright. One npm package; `domain/` is an isolated folder with its own tsconfig and a lint rule that forbids it importing anything from the app, React, or Supabase.
- **Domain core is pure.** Every function takes a `Settings` object (calendar, booking, health, scoring…) as input, so there are no business constants. The same code runs in Server Actions (to validate and refuse), in the browser (for instant previews like drag-to-reschedule), and in the display snapshot builder.
- **Time.** The DB stores `timestamptz`. The domain works in **shop-local wall-clock minutes** (`YYYY-MM-DDTHH:mm`, as in v1), converted at the edges using the `timezone` setting (default `Asia/Dubai`). This fixes §18-8 without changing any v1 maths.
- **Cost is hidden in the database, not only in the UI.** Cost columns live in **separate owner-only tables** (salary and loading, log rate/cost, cost settings, and audit rows that touch them). RLS means a Supervisor or Viewer query can't return them. Labour cost is **derived** (Σ hours × snapshotted rate), not stored as a running total, so it can't drift. When a Supervisor logs hours, a `SECURITY DEFINER` function snapshots the rate without exposing it.
- **Display security.** The display never uses a user session or the anon key to read data. A Next.js route checks the token's hash, loads data with the service role, applies the display's filters, and returns a `DisplaySnapshot` built only from an allow-listed Zod schema (`.strict()`, no cost keys). Tests prove that no cost field can appear in it.
- **Realtime.** Statement-level triggers on the data tables call `realtime.send()` on a broadcast topic. The message only says which table changed. Console and displays refetch, debounced (~300 ms). If the socket drops: back-off reconnect, a 60 s polling fallback, and a "last updated hh:mm:ss" clock that turns amber when data is stale. There's no 5-minute full re-render (fixes §18-2).
- **Concurrency.** Every edit is a row-level update with an optimistic `version` check. If two supervisors edit the same work item, the second one is told to reload; edits to different rows never conflict (fixes §18-3).
- **Audit.** A generic `AFTER INSERT/UPDATE/DELETE` trigger writes who / role / action / table / row / before → after (JSON diff) to `audit_log`. There's no cap, it's paginated and filterable in the console, and it's partitioned by month if it grows (fixes §18-9). Domain-level actions (e.g. "rebaseline", "rework") also write an explicit audit row with a readable label.

## 2. Database schema (Postgres)

Common to all tables: `id uuid pk default gen_random_uuid()` (seed keeps v1 IDs as `legacy_id text unique`), `created_at`, `updated_at`, `version int`. FKs `on delete` noted where it matters.

**Access & config**
| Table | Columns (key ones) | Read | Write |
|---|---|---|---|
| `profiles` | user_id → auth.users, email, name, role `owner\|supervisor\|viewer`, active | all signed-in | owner |
| `invitations` | email, role, invited_by, accepted_at | owner | owner |
| `settings` | key (`calendar`,`booking`,`health`,`scoring`,`labels`,`brand`,`floor`), value jsonb (Zod-validated per key) | all signed-in | owner, supervisor |
| `settings_cost` | single row: currency, default_loading_pct, working_days_per_month | **owner** | owner |
| `holidays` | date pk, name | all | owner, supervisor |
| `station_types` | key, label, colour, sort | all | owner, supervisor |
| `displays` | name, token_hash, screens jsonb `[{type, seconds, enabled}]`, filters jsonb `{projectIds, stationIds, stationTypes}`, leaderboard `{show, anonymous}`, announcement, revoked_at, last_seen_at | owner | owner |
| `audit_log` | at, actor_id, actor_role, action, entity, entity_id, project_id, before jsonb, after jsonb, sensitive bool | non-sensitive: all · sensitive: **owner** | triggers only |

**Shop**
| Table | Columns |
|---|---|
| `workstations` | name, station_type → station_types, sort, active |
| `people` | name, crew, cost_class `production\|admin`, active |
| `people_cost` (**owner-only**) | person_id pk, base_salary, loading_pct (null = default) |

**Templates** (now rows instead of one JSON doc)
`templates` (key, label, archived) · `template_stages` (template_id, name, station_type, part_hours, sort) · `template_tasks` (template_stage_id, name, dur_h, sort) · `template_parts` (template_id, name, sort).
`projects.template_id` is `on delete set null` and the project keeps a `template_label` snapshot, so deleting a template never breaks a build (fixes §18-4).

**Builds**
| Table | Columns |
|---|---|
| `projects` | serial unique, name, template_id, template_label, client, notes, start_date, delivery_date, status `planned\|active\|hold\|done`, delivered_on, plan_end |
| `stages` | project_id, name, station_type, station_id (null ok), part_hours, sort |
| `parts` | project_id, name, notes, sort — **history keyed by part id**, so renaming keeps it (fixes §18-7) |
| `tasks` | project_id, stage_id, num, name, assignee → people, status, dur_h, pct, plan_start, plan_end, pinned_start, actual_start, actual_end, notes |
| `baselines` | task_id pk, project_id, start, end, set_at, set_by |
| `work_items` | project_id, stage_id, part_id, **unique(stage_id, part_id)**, status, tech_id, start, end, seg_start, plan_h, rework, notes |
| `work_segments` | work_item_id, tech_id, start, end (v1 `prevSegs`) |
| `rework_log` | work_item_id, at, reason, by |

**Floor log**
| Table | Columns |
|---|---|
| `attendance` | day, person_id, present — pk(day, person_id); a missing row means "In" (v1 default) |
| `hour_logs` | day, person_id, work_item_id, project_id, hours |
| `hour_log_cost` (**owner-only**) | log_id pk, rate, cost — written only by `log_hours()` SECURITY DEFINER |

**Views:** `work_item_hours` (hours, hoursBy per item, from hour_logs; everyone can read) · `work_item_cost`, `project_labour` (owner-only, `security_invoker`).

**RPC (SECURITY DEFINER, role-checked):** `commit_day(day, attendance[], logs[])` replaces v1's reverse-then-apply in one transaction · `log_hours` · `invite_user` · `create_display` (returns the token once) · `revoke_display`.

## 3. Folder structure

```
/domain                 pure TS, no deps beyond date math
  settings.ts           Settings types + DEFAULTS (taken from v1) + Zod schemas
  calendar.ts           windows, wh, norm, addWH, firstWork (§6) — rest days[], holidays
  schedule.ts           schedule, baseline, eff, stageAgg, fcast, health, board sort (§7)
  work.ts               applyStatus, validation, rework, bulk assign, parts-list diff (§8)
  conflicts.ts          occupancy, tech double-booking, plan clashes (§9)
  alerts.ts             all 10 alert types, enable flags, max (§10)
  scoring.ts            technician metrics + score + bands (§11)
  floor.ts              day cap, fill-from-assignments, utilisation (§12)
  cost.ts               loaded/day/hour rate (§13)
  messages.ts           every user-facing message from §9/§15 (single place)
  display.ts            DisplaySnapshot schema (strict, cost-free) + builder
  __tests__/            Vitest; fixtures = §17 seed
/app
  (auth)/login, invite/[code]
  (console)/board, timeline, builds/[id]/{stages,matrix,tasks}, technicians, floor/{day,who,week},
            setup/{crew,workstations,templates}, settings/*, users, audit, displays, import-export
  display/[token]/page.tsx    kiosk
  api/display/[token]/snapshot/route.ts
  api/export/[kind]/route.ts  CSV / XLSX
/lib                    supabase clients (server/browser/service), auth guard, realtime hook, tz edge
/components             ui primitives (tile, pill, card, dialog), gantt, matrix, strips
/supabase
  migrations/           schema, RLS, triggers, RPC
  seed/                 seed.ts (all §17 values) + clientCar → template
/e2e                    Playwright
CLAUDE.md, README.md, .env.example
```

## 4. Settings and defaults (all editable in Settings / Control Panel)

**Working calendar**
| Setting | Default (v1) |
|---|---|
| timezone | `Asia/Dubai` |
| shiftStart / shiftEnd | 08:00 / 17:00 |
| breakStart / breakMins | 12:00 / 60 |
| restDays (multi) | `[0]` (Sunday) |
| holidays (list of date + name) | empty (D3) |
| workingDaysPerMonth (cost) | 26 |
| dayHours | derived from the shift = 8 (D2), read-only |

**Cost** (owner-only): currency `AED` · defaultLoadingPct `25` · per person: baseSalary `0`, loadingPct `25`, costClass `production|admin`.

**Booking rules:** techMode `stage` (alternative `part`) · stationClash `block` (alternative `warn`) · personClash (task leads) `block` (alternative `warn`).

**Health & alerts:** riskFloatDays `3` (= 24 working hours at 8h/day) · maxAlerts `10` · each of the 10 alert types on/off (all on) · board sort order `late, risk, unset, ok, hold, done`.

**Scoring:** weights onTime `40` / FTR `30` / pace `30` · paceCap `120` · paceWhenNoActual `120` · minDone `3` · bands green ≥ `85`, yellow ≥ `70`, amber ≥ `55`, else red · onTimeToleranceH `0.01` · utilisationWarnPct `70` · defaultPeriodDays `30` · period options `7 / 30 / 90 / all`.

**Floor log:** logStepH `0.5` · daily cap per person = dayHours · attendance default `In` · fill-from-assignments rounding `0.5h`, remainder to the last item.

**Labels & colours:** work/task statuses `todo` Not Started `#3A3A3A`, `doing` In Progress `#E9BE5F`, `blocked` Blocked `#C0483B`, `done` Done `#5CA96F` · project statuses `planned` Not started, `active` In build, `hold` On hold, `done` Delivered · station types modification `#E9BE5F`, fitment `#7FA8C9`, paint `#C58B5A`, detailing `#7FB68C`, other `#9A8FB0` · brand: app name `BUILD TRACKER`, company `Kynetik Koncepts`, logo = gold "K" ring (uploadable).

**Timeline:** default zoom `week`, px/day hours 72 / day 24 / week 8 / month 3, default rows `stages & tasks`.

**Floor display** (per display): name · screens, in order, with seconds each (defaults: Board 20, Who's on what 20, Stage progress 20, Timeline 20, Alerts 15, Leaderboard off) · filters (builds, workstations, station types) · leaderboard `{show: false, anonymous: true}` · announcement text (+ on/off) · stale warning after 120 s.

## 5. Fixes to known issues (§18)

| # | Plan |
|---|---|
| 1 | Real project with tooling and tests. |
| 2 | React with targeted refetch, no full-page re-render or 5-minute timer. |
| 3 | Normalised rows + optimistic `version` checks. |
| 4 | Template FK `set null` + label snapshot; `clientCar` seeded as a real template. |
| 5 | Multiple rest days + public holidays; "days a week" computed. |
| 6 | Write controls are hidden or disabled by role, and RLS refuses the write anyway. |
| 7 | Parts edited by id; renaming keeps history; removing a part asks for confirmation. |
| 8 | timestamptz + shop timezone setting. |
| 9 | Unbounded, paginated audit table. |
| 10 | "Data health" panel lists legacy overlaps (Toto/Francis) without blocking the seed. |
| 11 | Not code — salaries need entering; the Crew page flags people with salary 0. |
| 12 | **Deferred** (D8). |
| 13 | **Deferred** (D8); the display covers "employees see it". |

## 6. Phases (I stop for your review after each one)

1. **Scaffold, schema, auth/roles, seed.** Next.js + Tailwind tokens, Supabase migrations (all tables, RLS, audit trigger, realtime triggers), login + invite flow, role guard, seed script for every §17 value, CLAUDE.md, README, `.env.example`, `npm run dev:all`.
2. **Domain core + tests.** Every module in `/domain` with Vitest, including: 16:00 → 09:00 = 2h; 001 is **late** against 18 Nov; EXT-001 has 4 parts in work in Premold Prep; v1 planned schedules (§17.5) reproduced exactly from durations; double-booking messages match word for word; scoring and cost formulas; multiple rest days and holidays.
3. **Console: Board, Builds (detail, Stages & parts, Parts matrix, Task schedule)** with full CRUD and validation messages.
3.5. **Employee Day View, Task Queue & Leaderboard** (added 2026-10-02, before Phase 4, last build phase before deploy). See §7.
4. **Console: Timeline (drag + re-flow + clash refusal), Floor log (Day / Who's on what / This week), Technicians.**
5. **Settings / Control Panel, Users & roles, Audit log viewer, Import / Export** (seed/import JSON, CSV/XLSX export of builds, work items, floor logs).
6. **Shop Floor Display:** token management, kiosk layout (1080p/4K, cursor hidden, no interaction), rotating screens, filters, leaderboard, announcement, realtime + reconnect + clock.
7. **Hardening:** RLS tests run as owner/supervisor/viewer/anon against a real Postgres (prove Supervisor and display can never read cost), Playwright e2e of the acceptance scenario (change shift to 07:00–16:00 or add a holiday → schedules, forecasts and the TV update), deploy guide (Supabase + Vercel).

## 7. Phase 3.5 — Employee Day View, Task Queue & Leaderboard (approved 2026-10-02, D9–D15)

Brief: `docs/PHASE_EMPLOYEE_VIEW_PROMPT.md`. This phase pulls the display foundation forward from Phase 6: secret links, the display page, the snapshot route, realtime with reconnect, and the clock. The other Phase 6 screens (Today's board, Timeline, Alerts…) stay in Phase 6.

### 7.1 Schema (new migration `20261003000100_queue.sql`)

| Table / change | Columns | Access |
|---|---|---|
| `departments` | key, name, colour `#RRGGBB`, emoji, sort | read: members · write: owner, supervisor |
| `people` + `department_id` | FK → departments, `on delete set null`; null = "unassigned" | as `people` |
| `people` + `photo_path` | Storage object path in the private bucket `people-photos`, or null | as `people` |
| `queue_tasks` | person_id, title, dur_value, dur_unit `hours\|days`, project_id / stage_id / work_item_id (all optional), notes, colour (null = department colour), fixed_start (null = follows previous), **position** (text fractional index, unique per person), status `todo\|doing\|blocked\|done`, actual_start, actual_end, created_by, version | read: members · write: owner, supervisor |
| `displays` + `department_id`, `leaderboard_mode` (`side\|rotate`), `confetti` | one department per display link | owner |
| `settings` key `gamification` | see 7.4 | owner, supervisor |

- New tables get the same triggers as the rest: `touch_row` (version), `audit_row` (audit log), `notify_change` (realtime ping). A helper `private.standard_triggers(table)` attaches them.
- **Reordering** writes only the moved row's `position`, as a fractional key between its two neighbours (`fractional-indexing`). Two supervisors reordering different tasks never overwrite each other; editing the *same* task uses the version check.
- **Moving to another employee** = changing `person_id` + `position` on that row.
- The storage bucket `people-photos` is private. The console reads photos through signed URLs, and the display route signs short-lived URLs server-side. Uploads are cropped square in the browser (512 px JPEG, under 1 MB).
- Seed: the four default departments; the 12 crew start **unassigned**.

### 7.2 Scheduling rules (`domain/queue.ts`, pure, tested)

1. Duration in hours = `dur_value`, or `dur_value × day hours` for days (day hours from the shared calendar, D9).
2. Queue order = `position`. Done tasks show at their actual times and don't occupy the future.
3. **Cursor** starts at the start of the current (In progress) task, else at `now` (normalised to working time; before the day starts, at the day start).
4. **In progress task:** runs from `actual_start` for its duration. If `now` passes its planned end and it isn't Done, the bar keeps growing to `now` (hatched red overrun) and the cursor moves to `now`, which **pushes the rest of the queue later**.
5. **Next tasks:** each starts where the previous ends (`norm(cursor)`) and ends at `addWH(start, hours)` on the working calendar (§6: breaks, rest days and holidays skipped).
6. **Fixed start:** the task starts at `max(fixed start, cursor)`. If the queue runs late it is pushed and flagged "late start" (D13).
7. **Blocked task:** takes no time and shows as a red marker at its place; the next task moves up (D12).
8. **Day split:** a task is cut into one segment per working day it touches, labelled "Day 1 of 2", with "continues tomorrow →" when it runs past the day's end. A 2-day task from 09:00 fills today's row and tomorrow's.
9. **One at a time (§9):** a person can have only one In progress queue task. Starting another is refused with the §9 message. A task linked to a part-step shares its status and goes through the existing part-step rules (D10).
10. **Day row:** for today, segments clipped to the employee day window, an idle gap before the first task, and "+N more" for tasks that don't fit.

Tests: hours task, days task, crossing the day end, crossing the rest day, overrun push, reorder → reschedule, fixed start pushed, one-at-a-time refusal.

### 7.3 Leaderboard & badges (`domain/gamification.ts`, pure, tested)

- **Score** = §11 `techStats` for the period (today, this week, this month), within the display's department. Rank 1st, 2nd, 3rd… by score; people below the minimum part-steps are listed under "warming up" with no number (D11, D15).
- Badges (all editable: emoji, name, on/off, parameter):

| Badge | Rule | Parameter (default) |
|---|---|---|
| 🥇 🥈 🥉 | rank 1–3 | — |
| 🔥 streak | finished at least one task on time on each of the last N working days | N = 3 (D14) |
| 🎯 sharpshooter | first-time-right 100% in the period, at or above the minimum done | — |
| ⚡ speedster | best pace in the department, at or above the minimum done | — |
| 🚀 | most tasks finished this week | — |
| 📈 climber | most places gained vs the previous period of the same length | min gain 1 |
| 🐢 warming up | everyone not in the top 3, with a rotating friendly line | messages list |

- Kind by design: only rank, score and badges are shown, never negative numbers or red. Switches: hide bottom ranks, show only the top N (default all).
- Confetti when someone moves up a rank or finishes a task (the display compares consecutive snapshots). Switch: on by default.

### 7.4 New settings

| Key | Default |
|---|---|
| `calendar.shiftStart` / `shiftEnd` | **09:00 / 18:00** (D9; the employee view uses the shared calendar) |
| `calendar.breakStart` / `breakMins` | **13:00 / 60** (D9) |
| `gamification.badges` | table above |
| `gamification.warmingUp` | 5 friendly lines (editable) |
| `gamification.hideBottom` / `topN` / `confetti` | false / 0 (all) / true |
| `gamification.defaultPeriod` | week |

### 7.5 Components

- **Console › Task Queue** (`/queue`): one column per employee, grouped by department, with photo or initials. `@dnd-kit` sortable across columns: reorder, drag to another employee, keyboard (move up / down, move to top), optimistic UI. The task dialog has add, edit, duplicate, delete and set status.
- **Console › Setup › Crew** (`/setup/crew`): name, department, cost class, active, photo upload with square crop, an **Add task** button, and owner-only salary and loading.
- **Console › Settings**: Departments (name, colour, emoji), Employee view hours, Gamification. These are the first Settings sections; the rest come in Phase 5.
- **Console › Displays**: create (name, department, leaderboard side or rotate, confetti), copy link, revoke.
- **Display** `/display/[token]`:
  - Employee Day View: rows for the department's people; hours 09–18 as columns; a gold now line; bars by status with a highlight on the current task; Day i of n; "+N more"; idle gaps.
  - Leaderboard as a side panel or rotating screen.
  - Header with department, emoji, clock and "⟳ live".
  - No cursor, no interaction, large type, built for 1080p and 4K.
- **Display data**: `GET /api/display/[token]/snapshot` checks the token hash with the service role, filters to the department, and returns a strict Zod `DisplaySnapshot` with no cost keys. Realtime pings trigger a refetch, with a 10 s polling fallback and auto-reconnect.

### 7.6 Tests

- Domain: the cases in 7.2 and 7.3.
- DB: departments and queue RLS; a viewer can't write the queue; position uniqueness.
- Display: the snapshot never contains cost keys or other departments, and a revoked token gets 404.
- Playwright: an admin reorder shows up on the display page.
