# Claude Code Kickoff Prompt — Kynetik Build Tracker v2

> **How to use:** Put `KYNETIK_BUILD_TRACKER.md` in the root of an empty project folder. Open Claude Code in that folder and paste everything below the line as your first message.

---

You are building **Kynetik Build Tracker v2**, a production/project-management system for Kynetik Koncepts Car Garage LLC (Dubai, currency AED, timezone Asia/Dubai).

The complete spec of the current v1 app is in **`KYNETIK_BUILD_TRACKER.md`** in this folder: data model, every formula and business rule, the screens, validation messages, design tokens, and a full live data snapshot (§17). **Read the whole file before doing anything.** Treat it as the source of truth for behaviour, and keep every rule and value unless this prompt changes it.

## What to build

One codebase with **two front ends** that share **one backend and one database**:

### 1. Admin Console (my backend dashboard). Login required.
This is where I (Owner) and my supervisors run the shop and **change every variable in the system without touching code.**

- Everything the v1 app does (Board, Timeline with drag-to-reschedule, Builds, Parts × Stages, Task schedule, Technicians, Floor log, Setup). Follow the spec.
- **Full CRUD** for: builds, stages, tasks, parts, work items (technician, status, times, rework), crew, workstations, templates, attendance and hour logs.
- A **Settings / Control Panel** section where every value that is hard-coded in v1 becomes an editable setting stored in the DB, with sensible defaults taken from v1:
  - **Working calendar:** shift start/end, break start/length, rest days (**allow more than one**), **public holidays list**, working days per month, timezone.
  - **Cost:** default loading %, currency, per-person salary and loading, production vs admin class.
  - **Booking rules:** technician mode (one stage / one part at a time), whether workstation clashes block or only warn.
  - **Health & alerts:** "at risk" float threshold (v1 = 3 working days), switch each alert type on/off, max alerts shown (v1 = 10).
  - **Scoring:** weights (v1 = on-time 40 / first-time-right 30 / pace 30), pace cap (120%), minimum completed part-steps (3), score colour bands (85 / 70 / 55), on-time tolerance, utilisation warning (70%), default period (30 days).
  - **Labels & colours:** status names and colours, project status names, station types and their colours, brand name and logo.
  - **Floor display settings:** see below.
- **Roles:** Owner (everything, including costs), Supervisor (everything except cost fields, which must be hidden **on the server**, not only in the UI), Viewer (read-only). Owner can invite users and change their roles.
- **Audit log** of every change (who, what, when, before → after), viewable and filterable in the console.
- **Import / export:** seed from §17 of the spec, plus CSV/Excel export of builds, work items and floor logs.

### 2. Shop Floor Display (for employees). View-only, no interaction.
Shown on TVs or tablets in the workshop. Employees **only watch it. They cannot click, edit or log in.**

- **No login.** Access is through a secret display link/token that the Owner creates, names (e.g. "Paint bay TV") and can revoke in the Admin Console.
- **Never shows costs, salaries or rates**, whatever the settings say. Enforce this on the server.
- Full-screen kiosk layout: large type readable from 3–5 m, dark carbon/gold theme from §16, no buttons, no hover-only information, cursor hidden.
- **Updates in real time** when anything changes in the Admin Console (no manual refresh), with an automatic reconnect and a "last updated" clock.
- **Rotating screens.** The Owner chooses in the console which screens each display shows, in what order, and for how many seconds:
  - Today's board: open builds, progress, forecast vs committed date, late/at-risk highlights.
  - Who's on what: each technician and the build · stage · part they are on now (or idle).
  - Stage progress per build: the parts matrix in colour.
  - Timeline: this week and next.
  - Alerts: blocked parts, late builds.
  - Optional leaderboard: technician scores on/off, with the option to show it without names.
  - Optional announcement/message banner that the Owner types in the console.
- Each display can be filtered to particular builds or workstations (e.g. the paint bay TV shows only paint work).

## Technical requirements

- **Stack (suggested; propose changes if you have a strong reason):** Next.js (App Router) + TypeScript, Tailwind using the tokens in §16, Supabase (Postgres + Auth + Realtime + Row Level Security), Zod, Vitest, Playwright.
- **Domain core as pure TypeScript** in its own package/folder (`/domain`). Covers the calendar engine (§6), scheduling/forecast/health (§7), work-item rules (§8), conflict checks (§9), alerts (§10), scoring (§11) and cost (§13). Every function reads its parameters from settings, never from constants.
- **Unit tests** for the domain core that reproduce v1 behaviour, including:
  - 16:00 → 09:00 next day = 2 working hours.
  - Build 001 shows as **late** against 18 Nov.
  - The double-booking refusal messages match the wording in §9/§15.
- **Normalised schema:** separate tables for work items, tasks, etc., with row-level updates, so two supervisors editing at once don't overwrite each other. This fixes known issue §18-3.
- **Seed script** that loads **every value** in §17 (settings, 6 workstations, 12 crew, 2 templates and the legacy `clientCar` stages turned into a third template, 6 builds, tasks, work items, audit entries).
- Fix the known issues in §18 where it is practical, and list any you left for later.
- Mobile-friendly Admin Console. Display screens optimised for 1080p and 4K landscape.
- `.env.example`, a README with setup/run/deploy steps, and a single command to run locally.

## How to work

1. **Start in plan mode.** Read the spec, then ask me any questions that block you (one batch only). Then give me: the architecture, the database schema, the folder structure, the list of settings with their defaults, and a phased plan. **Wait for my approval before you write code.**
2. Build in phases and **stop for my review after each one**:
   1. Project scaffold, schema, auth/roles, seed data.
   2. Domain core + tests.
   3. Admin Console: Board, Builds, Parts × Stages, Tasks.
   4. Admin Console: Timeline (drag), Floor log, Technicians.
   5. Settings / Control Panel + audit log + import/export.
   6. Shop Floor Display: tokens, rotating screens, realtime, filters.
   7. Hardening: permissions tests (prove the display and Supervisor can never read cost data), Playwright end-to-end tests, deploy guide.
3. Keep a `CLAUDE.md` in the repo with the conventions, commands and decisions you make, and update it as you go.
4. Never invent business rules. If the spec doesn't cover something, ask me.

**Done means:** I can log in as Owner, change any setting (for example the shift to 07:00–16:00, or adding Friday as a holiday) and see schedules, forecasts and the floor TV update straight away, while employees watching the display can only see it and never interact with it or see costs.
