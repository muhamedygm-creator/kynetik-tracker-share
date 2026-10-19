# Roadmap — from MVP to a product the team enjoys

**Status:** v1 steps 1–5 built on 7 Oct 2026 (on the review branch, not live until "ship it"); step 6 (daily email) waits for SMTP; step 7 (photos) not started. Building starts on "start building"; nothing reaches the live site before "ship it".
**Inputs:** [`docs/ux/AUDIT.md`](ux/AUDIT.md) (what's wrong today), [`docs/ux/DECISIONS.md`](ux/DECISIONS.md) (what the Owner chose), the four sketches (listed at the end), and the remaining phases in [`docs/PLAN.md`](PLAN.md) §6.

**Who it's for:** Owner, supervisors and admins on **laptop and iPad**; technicians through the **TVs**. Internal only: no client view.
**Target feel:** Monday / Asana. Visual, direct manipulation, colour that means something, in the carbon & gold brand.
**Must-win test for every v1 screen:** *plan a person's day in 1 minute.*

---

## 1. Every idea, scored

Impact and effort are 1–5. **Quick win** = high impact, small effort. **Big** = high impact, large effort. Effort assumes one change at a time with previews and tests (Step 4).

| # | Idea | Impact | Effort | Size | Where |
|---|---|---|---|---|---|
| 1 | New app shell: left menu instead of 9 tabs, iPad layout, plain words, no "phase 4" text, contrast fixes | 5 | 3 | Medium | **v1** |
| 2 | Builds home: grouped table, tappable status and health pills, "Today at a glance", late builds first, overlaps grouped | 5 | 3 | Medium | **v1** |
| 3 | Build board: stage columns, part cards, one-tap status, details drawer (parts table stays as a tab) | 5 | 4 | Big | **v1** |
| 4 | **Week planner** with Day zoom: drag tasks between times, days and people; drag the edge to change hours; tap for details; undo | 5 | 4 | Big | **v1** |
| 5 | **TV v2**: person cards with progress rings, current task with time left, playful leaderboard, finished today, day-progress bar | 5 | 3 | Medium | **v1** |
| 6 | **Lunch countdown** on the TV (13:00–14:00 from the calendar setting) | 4 | 1 | Quick win | **v1** |
| 7 | **Department notices**: Owner and supervisors post messages and timed checks ("Quality check in 25 min"); rotate on the TV | 4 | 2 | Quick win | **v1** |
| 8 | **Daily summary email at 18:15** to the Owner (needs SMTP/Resend first) | 4 | 2 | Quick win | **v1** |
| 9 | Help built in: short hints, a glossary tooltip, empty states that say what to do | 4 | 2 | Quick win | **v1** (inside 1–5) |
| 10 | Photos per part (internal, Owner and supervisors, from the iPad) | 3 | 3 | Medium | **v1 stretch** |
| 11 | Leaderboard that isn't empty on Mondays (rolling 7 days, or "last week" until 3 parts) | 4 | 1 | Quick win | **v1** (inside 5) |
| 12 | Admin types: Office / HR admin and Accounts (Accounts sees costs, a rule change) | 4 | 3 | Medium | v2 |
| 13 | End-of-day confirmation for supervisors (attendance, hours, finished work) on the iPad | 4 | 3 | Medium | v2 |
| 14 | Edit shift, rest days and holidays in Settings (PLAN §6 phase 5) | 3 | 3 | Medium | v2 |
| 15 | Late and blocked alerts by email | 3 | 2 | Quick win | v2 (after 8) |
| 16 | Timeline redesign: readable labels, red only for real trouble, jump to today | 3 | 3 | Medium | v2 |
| 17 | Weekly report and Excel export | 3 | 3 | Medium | v2 |
| 18 | Global search (build, part, person) | 3 | 2 | Quick win | v2 |
| 19 | Workstations and Templates editors (PLAN §6 phase 5) | 3 | 3 | Medium | v2 |
| 20 | Audit log filters | 2 | 1 | Quick win | v2 |
| 21 | Weak Wi-Fi: keep the last data on screen, retry saves, "offline" badge | 3 | 4 | Big | Final |
| 22 | QR codes on parts (scan to open the part) | 2 | 3 | Medium | Final (once parts are labelled) |
| 23 | WhatsApp notifications | 2 | 4 | Big | Final (needs a WhatsApp Business account) |
| 24 | Technician logins, task dependencies, parallel tasks (deferred D8) | 3 | 5 | Big | Final |
| 25 | Client progress page / PDF | — | — | — | **Dropped** (internal app only) |
| 26 | Other languages / right-to-left | — | — | — | **Dropped** (English only) |

What I challenged on the way: help is folded into every screen rather than a separate project; WhatsApp waits until email alerts prove useful; QR codes only make sense once parts carry physical labels; the client page was cut by the Owner.

---

## 2. v1 — the next 2–4 weeks

Order matters: the shell comes first because every other screen sits inside it. Each step ships behind a preview link with before/after screenshots; nothing goes live before "ship it".

| Step | Item | Size | Depends on |
|---|---|---|---|
| 1 | App shell + design system clean-up + plain wording | Medium | — |
| 2 | Builds home (replaces Board and Builds list) | Medium | 1 |
| 3 | Build board (new default view of a build) | Big | 1 |
| 4 | Week planner with Day zoom (replaces Task queue) | Big | 1 |
| 5 | TV v2 + lunch countdown + notices + Monday-proof leaderboard | Medium | — (can run in parallel with 2–4) |
| 6 | Daily summary email at 18:15 | Quick win | SMTP (Resend) set up |
| 7 | Photos per part (stretch) | Medium | 3 |

### v1.1 App shell and wording

**Story.** As a supervisor on an iPad, I want one clear menu and plain words, so I can find any screen without guessing.
**Acceptance checks**
- Left menu with: Builds, Week plan, Crew, Floor log, Technicians, Timeline, Settings (Settings only for roles that may open it). On an iPad in portrait it collapses to icons with labels on long-press; at phone width it becomes a top bar. No hidden tabs.
- No internal wording anywhere: no "phase 4/5", no "(D9)", no decision codes. A test fails the build if these strings appear in the UI.
- All small text meets 4.5:1 contrast (secondary text and red text tokens updated, see DESIGN_SYSTEM.md).
- Every tap target is at least 44 × 44 px on iPad.
- A "?" next to jargon (part step, forecast, promised, pace, first time right) opens a one-line explanation.
**Screens:** layout/nav on every console page; `components/nav.tsx`, `app/globals.css`, `components/ui/*`.

### v1.2 Builds home

**Story.** As the Owner, I open the app and know in 5 seconds which builds are late and why.
**Acceptance checks**
- Top row "Today at a glance": late against promise, parts being worked on, parts blocked, next handover. Plain words, no hours.
- Builds grouped by status (In build, Not started, On hold, Done) as a table: serial + name, stage now, Health pill (Late / At risk / On track / No date set), progress bar, parts done, forecast, promised, crew avatars.
- Late shown as a date in red ("forecast 14 Dec, promised 18 Nov"), not "173.4h late". Builds that haven't started never show "late hours" of work.
- Attention list: late builds first; double-bookings grouped per person ("Toto · 2 overlaps"), max 5 lines with "show all".
- Data health moves to its own page, linked from a small counter.
- Tapping a row opens that build's board. Supervisors can change status from the pill without opening a dialog.
**Screens:** `/board` and `/builds` merge into **Builds**.

### v1.3 Build board

**Story.** As a supervisor walking the floor with an iPad, I update a part in 2 taps.
**Acceptance checks**
- Default view of a build: one column per stage (with its standard hours); each part is a card showing who, status pill and time in stage.
- Tap the status pill → choose status → saved (the same rules as today: technician required for Done, double-booking refused with today's message).
- Drag a card to the next stage when that stage starts (moves the part forward; refused with a clear message if the rules don't allow it).
- Tap a card → details drawer: technician, times, notes, rework, history. No full-page dialog.
- Tabs: Stages (board) · Parts table (today's table, slimmer) · Tasks · Activity.
- Delete build moves into a "More" menu with a typed confirmation.
- Works at 1024 × 768 (iPad landscape) without sideways scrolling of the page.
**Screens:** `/builds/[id]`, `components/build/*`.

### v1.4 Week planner (must-win)

**Story.** As a supervisor, I plan a person's day (and week) in 1 minute by dragging work into their row.
**Acceptance checks**
- Week view per department: people as rows, Mon–Sat as columns, working hours only (lunch as a line). Day zoom shows one day in half-hour steps.
- Left panel "Work to do": open parts and tasks, most-late build first; workshop tasks without a build allowed.
- Drag a task to another time, day or person; drag its right edge to change hours (half-hour steps); later tasks move along (today's queue rule, D12/D13).
- Tap a task → details drawer: name, hours (− / +), status, Urgent/Normal, notes for the technician, "Back to Work to do".
- Hours per person per week ("30 of 48 h"), red when overbooked. Undo for the last change.
- Linked part-steps keep sharing status with the build (D10). Changes reach the TV within seconds.
- Measured: a new supervisor plans one person's next day in under 60 seconds in a usability check.
**Screens:** `/queue` becomes **Week plan**; `components/queue/*`; `domain/queue.ts` gains week layout helpers (pure, tested).

### v1.5 TV v2, lunch countdown, notices

**Story.** As a technician, I glance at the TV from my bay and see what I'm on, how long is left, what's next, and anything I must know.
**Acceptance checks**
- Layout per the approved sketch: header (department, rotating notice, big clock), person cards with a progress ring and their day strip, current task gold with "x min left", finished in green, blocked in red, leaderboard at the side with medals, badges and lines, "Finished today", week tiles, day-progress bar.
- Calmer scale: readable at 4–5 m on a 55" TV, and nothing cut off from 1366 × 768 to 4K.
- 12:55: "Lunch in 5 min" notice. 13:00–14:00: full-screen countdown with what each person picks up after lunch. Times come from the calendar setting.
- Notices: Owner and supervisors add messages per department with optional start/end and countdown target (e.g. quality check 16:00); they rotate every 8 s.
- Leaderboard never empty early in the week (rolling 7 days or last week until someone reaches 3 parts; Owner picks in Settings).
- Department with no people shows a designed screen with the department's builds instead of one sentence.
- No cost, rate or salary ever in the display data (existing allow-list and test stay).
**Screens:** `/display/[token]`, `components/display/kiosk.tsx`, `domain/display.ts`, Settings → Notices, new `notices` table (RLS: Owner and supervisors write, display reads via the snapshot).

### v1.6 Daily summary email

**Story.** As the Owner, at 18:15 I get one email that tells me how today went and what's planned for tomorrow.
**Acceptance checks**
- Sent 18:15 Dubai on working days to the Owner (more recipients later).
- Contents: finished today (by person), late builds (with promised vs forecast date), blocked parts with reason, who was off, tomorrow's plan per department. No costs unless sent to the Owner only.
- Branded HTML that reads well on a phone; a plain-text fallback.
- Skips rest days and holidays. A "Send me a test" button in Settings.
**Prerequisite:** SMTP via Resend (pending the API key and sender address).
**Screens:** Settings → Daily summary; a scheduled job (Supabase cron or Vercel cron).

### v1.7 Photos per part (stretch)

**Story.** As a supervisor, I take a photo of a part from the iPad so the Owner sees progress without walking the floor.
**Acceptance checks**
- On a part card or drawer: Add photo (camera or library), tag Before / During / After, compressed in the browser.
- Gallery on the part and on the build's Activity tab.
- Owner and supervisors only; private storage with signed links (as crew photos today).
**Screens:** build board drawer, Activity tab; new storage bucket `part-photos`.

---

## 3. v2 — after v1 is in use

Admin types (Office / HR admin, Accounts with costs, needs a PLAN.md §0 rule change and new RLS) · end-of-day confirmation on the iPad · shift, rest days and holidays editor · email alerts for late/blocked · Timeline redesign · weekly report and Excel export · global search · Workstations and Templates editors · audit filters.

## 4. Final product

Weak Wi-Fi resilience (offline badge, retry, cached screens) · QR codes on parts · WhatsApp notifications · technician logins · task dependencies and parallel tasks.

## 5. Not doing

Client-facing page or PDF · other languages and right-to-left.

---

## Sketches

- Workspace (menu, builds table, build board): https://claude.ai/artifact/3P1QmfSrQuu3CZZ649qtXY
- Week planner (must-win): https://claude.ai/artifact/KZNm36wekM2aqNgDCnhexZ
- TV v2 (approved): https://claude.ai/artifact/BNY32hmE67pJhd6nxH67Ar
- Client page (dropped, kept for reference): https://claude.ai/artifact/L41zyWk51DsduUyMjvfnvM
