# Kynetik Build Tracker — Project Handoff for Claude Code

> **Purpose of this file:** A complete spec of the existing *Kynetik Build Tracker* (a production/project-management tool for the Kynetik Koncepts car garage), so a team can rebuild or extend it in Claude Code. It covers the product, the data model, every business rule and formula, the UI, and **all current live data values**.
>
> **Source:** Claude artifact `28e04bc1-4f39-4971-b14c-eaa2a44dba67` (single-file HTML/JS app, ~1,400 lines, backed by a shared document DB). Snapshot taken **2026-10-01**.

---

## Contents

1. [What the product is](#1-what-the-product-is)
2. [Glossary](#2-glossary)
3. [Current architecture](#3-current-architecture)
4. [Roles & permissions](#4-roles--permissions)
5. [Data model](#5-data-model)
6. [Working-hours calendar engine](#6-working-hours-calendar-engine)
7. [Scheduling, forecast & health](#7-scheduling-forecast--health)
8. [Parts × stages work tracking](#8-parts--stages-work-tracking)
9. [Technician double-booking rules](#9-technician-double-booking-rules)
10. [Alerts](#10-alerts)
11. [Technician performance scoring](#11-technician-performance-scoring)
12. [Floor log (attendance & hours)](#12-floor-log-attendance--hours)
13. [Cost model](#13-cost-model)
14. [Screens & UI](#14-screens--ui)
15. [User actions & validation messages](#15-user-actions--validation-messages)
16. [Design system](#16-design-system)
17. [Live data snapshot (all values)](#17-live-data-snapshot-all-values)
18. [Known issues & gaps](#18-known-issues--gaps)
19. [Suggested rebuild plan](#19-suggested-rebuild-plan)

---

## 1. What the product is

A shop-floor build tracker for a custom-car / buggy fabrication garage (Dubai, currency **AED**). It manages:

- **Builds** (projects) created from **templates** — each build has **stages**, **tasks** (the planned schedule) and a **parts list**.
- **Parts × stages matrix** — every part is tracked individually through every stage, with a technician, status, start/finish times, rework count and logged hours.
- **Schedule** measured in **working hours** on a configurable shift calendar (default 8h/day, Sunday off), with a **baseline**, **plan** and live **forecast**.
- **Timeline / Gantt** with drag-to-reschedule and automatic re-flow.
- **Technician performance** (on-time, first-time-right, pace → score).
- **Floor log** — daily attendance and hours logged against parts, feeding labour cost.
- **Setup** — crew, workstations, templates, working calendar, booking rules.
- **Conflict prevention** — refuses double-booking of technicians and workstations.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Build / Project** | One job (e.g. a buggy). Has serial, name, client, start date, committed delivery date. |
| **Template** | Blueprint for a build type: stages, tasks with hours, standard hours per part, default parts. |
| **Stage** | A phase (e.g. *Make Mold*), tied to a workstation and a *standard hours per part*. |
| **Task** | A scheduled line in the plan, belongs to a stage, has duration in working hours, lead person. Tasks run sequentially. |
| **Part** | A physical component (e.g. *Bonnet*). Each part passes through each stage. |
| **Work item / part-step** | One part in one stage (`work[stageId][partId]`). The unit of technician tracking. |
| **Workstation** | Physical bay. Types: `modification`, `fitment`, `paint`, `detailing`. |
| **Baseline** | Frozen copy of the original plan (task start/end) used to measure slip. |
| **Plan** | Current scheduled task start/end. |
| **Forecast** | Live projected finish based on progress and remaining work from *now*. |
| **Float** | Working hours between forecast finish and committed delivery (negative = late). |
| **Rework** | Part sent back after Done; counts against first-time-right. |
| **Loaded salary** | Salary × (1 + loading %) — covers visa, insurance, tickets. |

## 3. Current architecture

- **Single HTML file**, vanilla JS (no framework), all CSS inline. Fonts: Google Fonts *Rajdhani* + *DM Mono*.
- **Runtime capabilities:** `db` (shared Firestore-like document DB with `doc()`, `collection()`, `onSnapshot`, `get`, `set`, `delete`) and `user` (`isOwner()`, `can("data.write")`).
- **Realtime:** all collections subscribed with `onSnapshot`; full re-render on every change. Auto re-render every 5 minutes (skipped while a dialog/input is focused).
- **Writes:** serialised through a promise queue (`queue(fn)`) to avoid races; whole project docs are written with `set` (no partial updates).
- **Audit log:** every write action appends `{t, a, d, by}` to `audit/<YYYY-MM>` (keeps last 400 entries).
- **Offline preview mode:** if no DB, uses default settings and shows a warning banner.

### DB collections / documents

| Path | Contents |
|---|---|
| `config/settings` | Working calendar & rules |
| `config/stations` | `{ list: Station[] }` |
| `config/templates` | `{ types: { [key]: Template } }` |
| `people/<id>` | Person |
| `projects/<id>` | Project (stages, tasks, parts, work, baseline embedded) |
| `days/<YYYY-MM-DD>` | `{ attendance: {personId: bool}, logs: Log[] }` |
| `audit/<YYYY-MM>` | `{ entries: AuditEntry[] }` |

## 4. Roles & permissions

| Role | Detection | Can see | Can do |
|---|---|---|---|
| **Owner** | `user.isOwner()` | Everything incl. salaries, rates, labour cost, cost/part | All writes |
| **Supervisor** | Not owner, `can("data.write")` true | Everything **except** costs | All writes |
| **Read-only** | `can("data.write")` false | Non-cost views | Nothing; banner: *"Read-only access. Ask the owner for "Can interact" to make changes."* |

Header shows `Owner · costs visible` or `Supervisor · costs hidden`. Audit entries record `by: "owner" | "supervisor"`.

## 5. Data model

### Settings (`config/settings`) — defaults
```js
{ loadingPct: 25, workingDays: 26, dayHours: 8, restDay: 0 /*Sunday*/,
  shiftStart: "08:00", shiftEnd: "17:00", breakStart: "12:00", breakMins: 60,
  techMode: "stage" /* or "part" */, currency: "AED" }
```

### Station
```ts
{ id: string; name: string; type: "modification"|"fitment"|"paint"|"detailing" }
```

### Template
```ts
{ label: string;
  stages: { name: string; stationType: StationType; partHours: number }[];
  tasks:  { stage: string /*stage name*/; name: string; durH: number }[];
  parts:  string[] }
```

### Person
```ts
{ id; name; crew: string /*station type | "design" | "admin" | ""*/;
  costClass: "production"|"admin"; baseSalary: number /*AED/month*/;
  loadingPct: number; active: boolean }
```

### Project
```ts
{ id; serial; name; type /*template key*/; client; notes;
  startDate: "YYYY-MM-DD"; deliveryDate: "YYYY-MM-DD"|"";
  status: "planned"|"active"|"hold"|"done"; deliveredOn?: date;
  createdAt: ISO; planEnd: "YYYY-MM-DDTHH:mm";
  actual: { labour: number };
  stages: { id; name; stationType; stationId|null; partHours }[];
  parts:  { id; name; notes }[];
  tasks:  Task[]; baseline: { id; start; end }[];
  work:   { [stageId]: { [partId]: WorkItem } } }
```
Project status labels: `planned` → *Not started*, `active` → *In build*, `hold` → *On hold*, `done` → *Delivered*.

### Task
```ts
{ id; num; stageId; name; assignee: personId|null;
  status: "todo"|"doing"|"blocked"|"done"; durH: number; pct: 0-100;
  start; end /*computed*/; pinnedStart: datetime|null;
  actualStart; actualEnd; notes }
```

### WorkItem (part in a stage)
```ts
{ status: "todo"|"doing"|"blocked"|"done"; tech: personId|null;
  start; end; segStart; prevSegs: [start,end][];   // segments for rework
  planH: number|null;    // override of stage standard
  rework: number; reworkLog: { d; why; by }[];
  hours: number; hoursBy: {personId: hours}; cost: number; notes }
```
Status labels/colours: `todo` *Not Started* `#3A3A3A` · `doing` *In Progress* `#E9BE5F` · `blocked` *Blocked* `#C0483B` · `done` *Done* `#5CA96F`.

### Day log entry
```ts
{ personId; projectId; stageId; partId; hours; rate /*hour rate at time of logging*/ }
```

## 6. Working-hours calendar engine

**Everything (durations, standards, actuals, forecasts, variance) is measured in working hours**, not clock hours.

- **Work windows** per day: `[shiftStart, breakStart]` and `[breakStart+breakMins, shiftEnd]` (if break is inside the shift). Default → 08:00–12:00 and 13:00–17:00 = **8h/day**.
- **Rest day:** one weekday (0 = Sunday) has zero hours. Week = 6 days = **48h**.
- Core functions to replicate:
  - `wh(a, b)` — working hours between two datetimes (negative if b < a). Date-only values: start → shift start, end → shift end.
  - `norm(x)` — next moment someone could be working (skips breaks, after-hours, rest days).
  - `addWH(x, h)` — datetime that is `h` working hours after `x`.
  - `firstWork(date)` — next non-rest day.
- Example in UI copy: *"A part started 16:00 and finished 09:00 next day is 2h."*
- Datetimes stored as local `YYYY-MM-DDTHH:mm` strings (no timezone); dates parsed as UTC to avoid DST drift.

## 7. Scheduling, forecast & health

### Schedule (`schedule(p, fromIdx)`)
Tasks sorted by `num`, chained **finish-to-start**:
- Task 1 starts at `norm(startDate)`; each next task starts at `norm(prev.end)`.
- If `pinnedStart` is set, the task starts there instead.
- `end = addWH(start, durH)`; `planEnd` = last task end.
- Task duration: `durH` or legacy `duration (days) × dayHours`.

### Baseline
`setBaseline` copies each task's `{id,start,end}`. Set automatically on create and when a build first goes active. **Re-baseline** button replaces it (warning: slip resets to zero, old plan is lost).

### Effective progress
- Task %: done = 1, todo = 0, else `pct/100`.
- `eff(task) = max(task %, fraction of parts done in the task's stage)`.
- Stage aggregate: hour-weighted % of its tasks, earliest start, latest end.

### Forecast (`fcast`)
Walk tasks in order with a cursor:
- Done task → forecast end = `actualEnd || end`.
- Otherwise remaining = `max(0.5h, durH × (1 − eff))`, starting at `norm(max(cursor, now))`.
- **Delivery forecast** = last forecast end. **Slip** = `wh(baselineEnd, forecast)`. **Float** = `wh(forecast, deliveryDate @ shiftEnd)`. **Elapsed** = working hours from start to min(now, forecast).

### Health
| Health | Rule |
|---|---|
| `done` / `hold` | from project status |
| `unset` | no committed delivery date |
| `late` | float < 0 |
| `risk` | 0 ≤ float ≤ 3 working days (24h) |
| `ok` | float > 24h |

Board sort order: late, risk, unset, ok, hold, done; then by serial.

## 8. Parts × stages work tracking

- Each stage has a **standard hours per part** (`partHours`); a work item can override it with `planH`.
- **Actual hours** = `wh(start, end || now)`.
- **Variance** = actual − standard (red if over, green if under).
- Status changes (`applyStatus`):
  - → `doing`: set start if missing, clear end.
  - → `done`: set start if missing, end = now.
  - → `todo`: clear start, end, segments.
- Rules: can't mark Done or record a finish **without a technician**; times can't be in the future; start ≤ finish; clearing start on a Done part is refused.
- Setting any part/task to non-todo on a `planned` build makes it `active` and sets baseline if missing.
- **Rework:** only on Done items; requires a reason. Increments `rework`, appends to `reworkLog`, pushes the old segment to `prevSegs`, sets `segStart = now`, status back to `doing`. Same technician keeps it.
- **Bulk assign:** assign all unassigned, not-done parts in a stage to one technician, skipping any that would conflict.
- **Parts list editing:** one per line, no duplicates; history is keyed by part ID matched by name — renaming/removing a line **deletes that part's history in every stage**.
- When **all tasks are done**, the project becomes `done` with `deliveredOn = today`.

## 9. Technician double-booking rules

Setting `techMode`:
- `stage` (default) — one **stage** at a time; several parts in the same stage of the same build is allowed (batch work).
- `part` — strictly one part-step in progress per technician.

Occupancy of a work item = its time segments (`prevSegs` + current segment if doing/done). Any assignment, status change, time edit or rework that makes a technician's segments overlap another work item is **refused** with:
> *"Blocked — {Name} is already on {serial} · {stage} · {part} ({from} – {to\|now}). A technician can only work one stage/part at a time. Finish or block that first, or pick someone else."*

A **Blocked** part frees its technician. Technician dropdowns annotate busy people: `Name — busy: {serial} · {stage}`.

**Plan-level clashes** (`clashes`) — checked when moving/editing tasks:
- **Station clash:** two unfinished stages on the same workstation with overlapping scheduled windows (across builds).
- **Person clash:** same task lead on overlapping tasks (same-stage tasks in the same build are exempt in `stage` mode).

## 10. Alerts

Shown on the Board ("Attention"), red (`bad`) first, then amber (`warn`); top 10 shown.

| Severity | Condition | Message pattern |
|---|---|---|
| bad | Forecast late | `{serial} — forecast {dt}, {h} of work past the committed {date}` |
| warn | At risk | `{serial} — only {h} of float left` |
| warn | No parts | `{serial} — no parts list, so stages cannot be tracked by part` |
| bad | Task blocked | `{serial} — task "{name}" is blocked: {notes}` |
| bad | Parts blocked | `{serial} · {stage} — N part(s) blocked` |
| warn | Over standard | `{serial} · {stage} — N part(s) past standard hours` |
| warn | Unassigned in live stage | `{serial} · {stage} — N part(s) with no technician` |
| warn | Parts done, tasks open | `{serial} · {stage} — every part is done but N task(s) still open` |
| bad | Tech double-booked | `{Name} is double-booked — … overlaps …` |
| warn | Plan clash | `{serial} — {what} is double-booked with {other} ({when})` |

## 11. Technician performance scoring

Computed per production person from all work items they own; completed items filtered by finish date within period (7 / **30** default / 90 days / all).

| Metric | Formula |
|---|---|
| Done | completed part-steps in period |
| On time % | done with `actual ≤ standard + 0.01h` ÷ done |
| First time right % | done with `rework = 0` ÷ done |
| Pace % | Σ standard ÷ Σ actual × 100 (120 if actual = 0) |
| Avg h/part | Σ actual ÷ done |
| Logged h/part | Σ floor-log hours ÷ done |
| Cost/part (owner only) | Σ cost ÷ done |
| **Score** | `round(0.4·onTime + 0.3·FTR + 0.3·min(pace,120)/120·100)` — only if **≥ 3** done, else "—" |

Score colours: ≥85 green, ≥70 yellow, ≥55 amber, else red. Detail view: open work, completed in period, rework history.

## 12. Floor log (attendance & hours)

Three sub-tabs: **Day**, **Who's on what**, **This week**.

- **Day:** date picker (prev/next skip rest days). Attendance cards (default In; tap toggles). Tiles: on site, hours logged vs available, parts in work, labour today (owner).
- **Log hours:** person (present only, shows hours left), part being worked (only parts In Progress/Blocked, grouped by build · stage), hours (0.5 step, default = day hours). **Cap: day hours per person per day.**
- **Fill from assignments:** for each present person, splits remaining hours evenly (0.5h rounding, remainder to last) across their In Progress parts.
- **On save** (`commitDay`): reverses old logs, applies new ones to each touched project — `actual.labour += hours × rate`, and work item `hours`, `cost`, `hoursBy[person]`.
- **Who's on what:** per technician: open items, hours queued (remaining standard hours), count per stage name, current in-work list (or "idle"). Warns of unassigned part-steps in live stages.
- **This week:** reads last 7 day docs → days in, hours, utilisation % (`hours ÷ (days × dayHours)`, amber < 70%), cost (owner), builds worked on.

## 13. Cost model

```
loadedMonthly = baseSalary × (1 + loadingPct/100)      // person loading or settings default (25%)
dayRate       = loadedMonthly ÷ workingDays            // default 26
hourRate      = dayRate ÷ dayHours                     // default 8
```
- **Admin** cost class never enters build cost (overhead only); excluded from production lists.
- Rate is **snapshotted into each log** entry at logging time.
- Setup → Crew (owner) shows salary, load, loaded/mo, hour rate, day rate, and totals split production vs admin.

## 14. Screens & UI

Top bar: gold "K" ring logo, **BUILD TRACKER / Kynetik Koncepts**, role indicator. Tabs: **Board · Timeline · Builds · Technicians · Floor log · Setup**.

### Board
- Header with today's date, "8h a day, Sunday off · all durations in working hours", **New build** button.
- 5 tiles: Open builds (n running), Forecast late (n at risk), Parts in work, Parts blocked, Next handover.
- Attention list (alerts, clickable → opens build/stage).
- Build **strips**: serial + name, client, active stages, status pill, float pill; mini timeline (baseline lines, stage segments coloured by station type and filled by %, hatched red forecast overrun, gold "now" line, diamond for committed date); facts: Elapsed x of y, Part-steps, Progress %, Planned finish, Forecast, Committed, Vs baseline.

### Timeline (Gantt)
- Zoom: Hours (72px/day), Day (24), **Week (8, default)**, Month (3). Rows: Stages & tasks / Stages only / By workstation.
- Sticky left column (200px), month header, day/week ticks (rest days red).
- Build row (overall bar), stage rows, task rows with status fill, baseline line, forecast overrun hatch, committed diamond (red if missed).
- **Drag task bars** to move (snaps to days, or hours in Hours zoom); sets `pinnedStart`, re-flows later tasks, refuses if it creates a clash.

### Builds
- List (active → planned → hold → done). Delivered builds show compact strip.
- **Detail:** back button, actions (Start build / Hold / Resume, Parts list, Edit, Re-baseline, Delete), double-booked banner, tiles (Elapsed, Forecast finish, Float, Part-steps done, Labour cost AED [owner] or Tasks).
- Sub-tabs:
  - **Stages & parts** — stage chips with progress bars; selected stage card (workstation, standard, schedule, bulk assign, stage settings, 5 count tiles); parts table (#, Part, Technician, Status, Started, Finished, Std h, Actual h, Var, Rework, Logged h, Rework/Edit); stage tasks table.
  - **Parts matrix** — parts × stages grid, cell coloured by status, shows technician and ↺rework count, click to edit.
  - **Task schedule** — #, Stage, Task, Lead, Status, planned Start/End (editable), Hours, %, Forecast end, Var vs baseline, Edit; Add task.
- **Start build:** status active, start = today (first work day), first task pinned to now, schedule, baseline if missing, first task → doing 10%.

### Technicians
Period selector, 5 tiles (completed, on time, FTR, pace, in work now), ranked table, score explanation banner, per-person drill-down.

### Setup
- **Crew** — add/edit people (name, crew, cost class, salary AED, loading %, active).
- **Workstations** — cards; add/edit/remove (name, type).
- **Templates** — per template: stages table (std h/part, task hours), default parts; edit dialog with text formats `Stage | Task | Working hours`, `Stage | Hours`, parts one per line. Affects new builds only.
- **Working hours & rules** — shift start/end, break start/length, rest day, working days/month, loading %, technician booking mode; summary banner.

### Dialogs
Work item edit, Rework, Parts list, Task (add/edit/delete), Stage settings, Build (new/edit), Template, Person, Workstation, Re-baseline confirm, Delete build confirm.

## 15. User actions & validation messages

| Action | Rule / message |
|---|---|
| New build | Serial required — *"Every build needs a serial."* Copies template stages (auto-picks first station of matching type), tasks, parts. |
| Done without tech | *"Assign a technician before marking this part Done — otherwise the work counts for nobody."* |
| Future time | *"That time is in the future — start and finish record what actually happened."* |
| Start after finish | *"Start can't be after the finish."* / *"Finish can't be before the start."* |
| Task end ≤ start | *"End has to be after start."* (setting end recomputes `durH`, rounded to 0.5h, min 0.5) |
| Rework | Reason required — *"Say what failed — it is the only way the rework history is useful."* |
| Duplicate part | *""{n}" appears twice."* |
| Over-logging | *"{name} already has {x} on {date} — a working day holds 8h."* |
| Shift invalid | *"The shift has to end after it starts."* |
| Write errors | read-only / storage full / too many changes / generic connection message |

## 16. Design system

Dark "carbon & gold" theme.

| Token | Value | | Token | Value |
|---|---|---|---|---|
| `--gold` | `#E9BE5F` | | `--ink` | `#EDEAE3` |
| `--gdim` | `#C8A84B` | | `--grey` | `#8C8C8C` |
| `--carbon` (bg) | `#131313` | | `--grey2` | `#5F5F5F` |
| `--panel` | `#1B1B1B` | | `--ok` | `#5CA96F` |
| `--panel2` | `#222` | | `--warn` | `#D9913F` |
| `--panel3` | `#181818` | | `--bad` | `#C0483B` |
| `--line` | `#2C2C2C` | | `--cool` | `#7FA8C9` |
| `--line2` | `#3A3A3A` | | top bar/nav | `#101010` |

- Fonts: **Rajdhani** (display/body, 400–700), **DM Mono** (labels, numbers, tables, 300–500). Uppercase mono labels with letter-spacing.
- Station-type colours: modification `#E9BE5F`, fitment `#7FA8C9`, paint `#C58B5A`, detailing `#7FB68C`, other `#9A8FB0`.
- Forecast overrun = 45° hatched `#7a2f28 / #5d241e`.
- Cards 10px radius, tiles with coloured left border, pill badges, sticky top bar + nav, mobile breakpoint 640px (sidebar column 140px).

## 17. Live data snapshot (all values)

> Snapshot of the shared DB on **2026-10-01**. Use as seed data.

### 17.1 Settings
```json
{ "breakMins": 60, "breakStart": "12:00", "currency": "AED", "dayHours": 8,
  "loadingPct": 25, "restDay": 0, "shiftEnd": "17:00", "shiftStart": "08:00",
  "techMode": "stage", "workingDays": 26 }
```

### 17.2 Workstations
| ID | Name | Type |
|---|---|---|
| ws1 | Modification 1 | modification |
| ws2 | Modification 2 | modification |
| ws3 | Strip & Fitment 1 | fitment |
| ws4 | Strip & Fitment 2 | fitment |
| ws5 | Paint, Finish & Sanding | paint |
| ws6 | Detailing & Wash | detailing |

### 17.3 Crew (12 people)
All: `active: true`, `costClass: production`, `crew: ""` (not set), `baseSalary: 0` (not entered yet), `loadingPct: 25`.

| ID | Name |
|---|---|
| per-ahmad | Ahmad |
| per-francis | Francis |
| per-hamid | Hamid |
| per-hamza | Hamza |
| per-jazeel | Jazeel |
| per-nino | Nino |
| per-norlen | Norlen |
| per-saeed | Saeed |
| per-shahid | Shahid |
| per-tai | Tai |
| per-toto | Toto |
| per-yan | Yan |

### 17.4 Templates

**Default parts (both templates, 12):** Left Front Fender, Right Front Fender, Bonnet, Front Bumper, Left Door, Right Door, Left Rear Fender, Right Rear Fender, Left Side Skirt, Right Side Skirt, Rear Engine Cover, Rear Bumper.

#### `buggyBuild` — "Buggy build" (6 stages · 18 tasks · 488h = 61 days)
| Stage | Station type | Std h/part | Task | Hours |
|---|---|---|---|---|
| Prototyping | modification | 16 | Concept & design review | 40 |
| | | | Build / refine prototype | 80 |
| Prepare Premold | modification | 8 | Surface finish prototype (plug) | 40 |
| | | | Apply mold release / tooling gelcoat | 16 |
| Make Mold | modification | 16 | Mold layup | 24 |
| | | | Mold cure | 16 |
| | | | Demold & mold QC / repair | 24 |
| Make Parts from Mold | modification | 16 | Parts layup | 32 |
| | | | Parts cure | 16 |
| | | | Demold & trim parts | 24 |
| Painting & Finishing | paint | 16 | Sanding & surface prep | 32 |
| | | | Primer | 16 |
| | | | Paint / color coat | 16 |
| | | | Clear coat & polish | 24 |
| Assembly | fitment | 8 | Fit-check parts | 24 |
| | | | Final assembly | 40 |
| | | | Quality check | 16 |
| | | | Release / handover | 8 |

#### `exteriorParts` — "Exterior parts programme" (5 stages · 5 tasks · 296h = 37 days)
| Stage | Station type | Std h/part | Task | Hours |
|---|---|---|---|---|
| Premold Prep | modification | 8 | Plug prep across all parts | 48 |
| Make Mold | modification | 16 | Mold layup & cure | 64 |
| Make Parts from Mold | modification | 16 | Parts layup, cure & trim | 80 |
| Painting & Finishing | paint | 16 | Prep, primer, colour, clear | 64 |
| Assembly | fitment | 8 | Fit-check & install | 40 |

> ⚠️ Project `01` uses type `clientCar`, which **does not exist** in `config/templates` (legacy). Its stages: Carbon panel production (ws1, 16h/part, task 96h), Strip & fitment (ws3, 16h, 192h), Paint & finish (ws5, 16h, 96h), Detailing & handover (ws6, 8h, 16h). Consider recreating it as a template.

### 17.5 Builds (6)

| Serial | Name | Template | Status | Start | Committed delivery | Planned finish | Stations (by stage) | Client |
|---|---|---|---|---|---|---|---|---|
| **001** | lambo_buggy | buggyBuild | active | 2026-09-21 | **2026-11-18** | 2026-11-30 17:00 | ws1 ×4, ws5, ws3 | internal |
| **EXT-001** | Exterior Parts | exteriorParts | active | 2026-09-21 | — | 2026-11-02 17:00 | none assigned | internal |
| **002** | Exterior parts programme | exteriorParts | planned | 2026-09-23 | — | 2026-11-04 17:00 | ws1 ×3, ws5, ws3 | internal |
| **01** | Client car | clientCar | planned | 2026-09-22 | **2026-10-05** | 2026-11-18 17:00 | ws1, ws3, ws5, ws6 | internal |
| **BUG-KYN** | Buggy Kynetik | buggyBuild | planned | 2026-09-21 | — | 2026-11-30 17:00 | ws1 ×4, ws5, ws3 | internal |
| **BUG-CUS** | Custom Buggy | buggyBuild | planned | 2026-10-05 | — | 2026-12-14 17:00 | ws2 ×4, ws5, ws4 | internal |

All builds: `actual.labour = 0`, no task leads assigned, baseline = plan. `BUG-KYN`, `BUG-CUS`, `EXT-001` notes: *"Imported from the buggy build tracker workbook. Durations are defaults — adjust them."* `01` has **no parts list**. 001 is forecast **late** (planned finish 30 Nov vs committed 18 Nov).

#### Planned task schedules

**001 / BUG-KYN** (identical plan, start 2026-09-21):
| # | Task | Start | End |
|---|---|---|---|
| 1 | Concept & design review | 09-21 08:00 | 09-25 17:00 |
| 2 | Build / refine prototype | 09-26 08:00 | 10-07 17:00 |
| 3 | Surface finish prototype (plug) | 10-08 | 10-13 |
| 4 | Apply mold release / tooling gelcoat | 10-14 | 10-15 |
| 5 | Mold layup | 10-16 | 10-19 |
| 6 | Mold cure | 10-20 | 10-21 |
| 7 | Demold & mold QC / repair | 10-22 | 10-24 |
| 8 | Parts layup | 10-26 | 10-29 |
| 9 | Parts cure | 10-30 | 10-31 |
| 10 | Demold & trim parts | 11-02 | 11-04 |
| 11 | Sanding & surface prep | 11-05 | 11-09 |
| 12 | Primer | 11-10 | 11-11 |
| 13 | Paint / color coat | 11-12 | 11-13 |
| 14 | Clear coat & polish | 11-14 | 11-17 |
| 15 | Fit-check parts | 11-18 | 11-20 |
| 16 | Final assembly | 11-21 | 11-26 |
| 17 | Quality check | 11-27 | 11-28 |
| 18 | Release / handover | 11-30 | 11-30 |

All tasks `todo`.

**BUG-CUS** (start 2026-10-05): same 18 tasks — 10-05→10-09, 10-10→10-21, 10-22→10-27, 10-28→10-29, 10-30→11-02, 11-03→11-04, 11-05→11-07, 11-09→11-12, 11-13→11-14, 11-16→11-18, 11-19→11-23, 11-24→11-25, 11-26→11-27, 11-28→12-01, 12-02→12-04, 12-05→12-10, 12-11→12-12, 12-14→12-14. All `todo`.

**EXT-001:**
| # | Task | Start → End (plan) | Status | Actual |
|---|---|---|---|---|
| 1 | Plug prep across all parts | 09-21 → 09-26 | **done** 100% | 09-21 08:00 → 09-21 17:00 |
| 2 | Mold layup & cure | 09-28 → 10-06 | **doing** 10% | started 09-21 08:00 |
| 3 | Parts layup, cure & trim | 10-07 → 10-17 | todo | |
| 4 | Prep, primer, colour, clear | 10-19 → 10-27 | todo | |
| 5 | Fit-check & install | 10-28 → 11-02 | todo | |

**002:** 1 Plug prep 09-23→09-29 · 2 Mold layup & cure 09-30→10-08 · 3 Parts layup 10-09→10-20 · 4 Prep/primer 10-21→10-29 · 5 Fit-check 10-30→11-04. All `todo`.

**01:** 1 Carbon panel production 09-22→10-05 (96h) · 2 Strip & fitment 10-06→11-02 (192h) · 3 Paint & finish 11-03→11-16 (96h) · 4 Detailing & handover 11-17→11-18 (16h). All `todo`.

#### Part-level work in progress
| Build | Stage | Part | Technician | Status | Start | End |
|---|---|---|---|---|---|---|
| 001 | Prototyping | Left Front Fender | Francis | done | 2026-09-23 08:00 | 2026-09-23 14:59 |
| 001 | Prototyping | Right Front Fender | Toto | done | 2026-09-23 08:00 | 2026-09-23 14:59 |
| 001 | Prototyping | Bonnet | Toto | todo (assigned) | — | — |
| EXT-001 | Premold Prep | Rear Bumper | Francis | doing | 2026-09-21 08:00 | — |
| EXT-001 | Premold Prep | Rear Engine Cover | Norlen | doing | 2026-09-21 08:00 | — |
| EXT-001 | Premold Prep | Left Side Skirt | Toto | doing | 2026-09-21 08:00 | — |
| EXT-001 | Premold Prep | Right Side Skirt | Toto | doing | 2026-09-21 08:00 | — |
| EXT-001 | Assembly | Rear Bumper | Yan | done | 2026-09-29 10:27 | 2026-10-01 08:29 |

All rework = 0, logged hours = 0, cost = 0.

> ⚠️ Data conflict: **Toto** and **Francis** are "doing" on EXT-001 since 09-21 (open-ended) while also completing 001 Prototyping parts on 09-23 — this overlaps under the double-booking rule.

### 17.6 Floor log & audit
- `days/*`: **empty** (no attendance or hours logged yet).
- `audit/2026-09`: `project.create` "01" by owner, 2026-09-21T11:30:45Z.
- `audit/2026-10`: `rebaseline` "002" by owner, 2026-10-01T06:17:18Z.

## 18. Known issues & gaps

1. **Single file, no build tooling, no tests** — hard to maintain at ~1,400 lines.
2. Full re-render of the whole page on every change (innerHTML); loses scroll/focus; 5-min refresh timer.
3. Whole project document rewritten on each edit — concurrent edits by two supervisors can overwrite each other (last write wins).
4. Template key `clientCar` missing from templates; projects can reference deleted templates.
5. "Days a week" shows `7-1` hard-coded — doesn't consider more than one rest day; no public holidays.
6. Some buttons (Edit, Hold, Resume, Delete build) aren't disabled for read-only users (write fails with a toast instead).
7. Parts are matched by **name** when editing the list — renaming wipes history.
8. Datetimes have no timezone; everything assumes the shop's local time (Asia/Dubai).
9. Audit log capped at 400 entries/month; stored inside one doc.
10. Existing data overlaps for Toto/Francis (see 17.5); no "data health" check for legacy conflicts.
11. No crews set and all salaries 0 → cost features show 0.
12. No task dependencies other than sequential finish-to-start; no parallel tasks.
13. No authentication model beyond owner/writer/reader; no per-person technician login.

## 19. Suggested rebuild plan

**Stack suggestion (adjust to team preference):** Next.js / React + TypeScript, Tailwind (port tokens from §16), Postgres (Supabase) or Firestore for realtime, Zod for validation, Vitest for the calendar/schedule engine, Playwright for UI.

**Phases:**
1. **Domain core (pure TS, fully unit-tested):** calendar engine (§6), schedule/forecast/health (§7), work-item status rules (§8), conflict checks (§9), alerts (§10), perf scoring (§11), cost (§13). Port logic 1:1 and lock behaviour with tests using the seed data in §17.
2. **Data layer:** schema for settings, stations, templates, people, projects, stages, parts, tasks, work_items, day_logs, attendance, audit. Normalise `work` into its own table; use row-level updates to avoid overwrite conflicts.
3. **Seed script** loading every value in §17.
4. **Auth & roles:** owner / supervisor / viewer (+ optional technician role); hide cost fields server-side for non-owners.
5. **UI** in this order: Board → Build detail (Stages & parts, Matrix, Tasks) → Timeline (drag) → Floor log → Technicians → Setup.
6. **Fixes from §18** and nice-to-haves: holidays calendar, task dependencies, export to Excel/PDF, mobile technician view, notifications for late/blocked.

**Acceptance checks:** "8h/day, Sunday off" maths matches examples (16:00 → 09:00 next day = 2h); 001 shows *late* vs 18 Nov; EXT-001 shows 4 parts in work in Premold Prep; double-booking refusals fire with the exact messages in §9/§15.
