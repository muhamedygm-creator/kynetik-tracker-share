# Amends: Next Round of Edits

**Status:** Ready for the builder. Items marked ⚠️ have an open point (see *Open questions*).
**Date:** 12 Oct 2026
**Owner:** Joey

> This file lists the changes for this round only. It is not a description of the current app. Check the current app and code before building.

---

## Summary

| ID | Title | Type | Priority | Status |
|---|---|---|---|---|
| AM-01 | New exterior-panel workflow (replaces current template) | Change | Must | Ready |
| AM-02 | New project from CSV, with a review screen | New feature | Must | Ready ⚠️ |
| AM-03 | CSV format, fields and validation rules | New feature | Must | Ready ⚠️ |
| AM-04 | Parts & sub-parts (parent = folder) | New feature | Must | Ready ⚠️ |
| AM-05 | Modelling stage & part data capture | New feature | Must | Ready |
| AM-06 | Mold components count after pre-mold | New feature | Must | Ready |
| AM-07 | Admin QC gate after every stage | New feature | Must | Ready ⚠️ |
| AM-08 | Task times set by admins only, everything tracked | Change | Must | Ready |
| AM-09 | Global "+ New project" and "+ New task" buttons | New feature | Must | Ready ⚠️ |
| AM-10 | Manual add/edit of projects, parts, sub-parts and tasks | Change | Must | Ready |
| AM-11 | Modelling department & separate leaderboard | New feature | Should | Ready |
| AM-12 | One combined menu bar (board + menu + dashboard) | UI/UX | Should | Needs details ⚠️ |
| AM-13 | Store data for future planning & benchmarks | New feature | Should | Ready |

---

## Items

### AM-01: New exterior-panel workflow (replaces the current template)
- **Type:** Change · **Priority:** Must · **Where:** Projects, parts tracking, templates
- **What I want:** this workflow **replaces** the existing build template. Every part and sub-part goes through these stages in this order:
  1. Modelling
  2. 3D printing
  3. Prototyping
  4. Pre-mold production → *admin enters the number of mold components (AM-06)*
  5. Mold production
  6. Carbon fibre component production
  7. Fitment
  8. Paint preparation & painting
  9. Sanding & polishing
  10. Assembly (installation on the car)
- **Rules:**
  - Each part or sub-part has its **own technician and status in every stage**.
  - A part can't move to the next stage until the current one passes **admin QC** (AM-07).
- **Not covered by this workflow:** other jobs (polishing, sanding, cleaning and so on) are added as tasks with "+ New task" (AM-09).
- **Done when:** a new project uses these 10 stages, and the old template is no longer offered for new projects.

### AM-02: New project from CSV, with a review screen ⚠️
- **Type:** New feature · **Priority:** Must · **Where:** "+ New project"
- **What I want:** "+ New project" gives two options:
  1. **Upload CSV.** The CSV is prepared outside the tracking system, in a separate chat, using the template `KYNETIK_PARTS_TEMPLATE.csv`.
  2. **Create manually** (AM-10).
- **Review screen after upload:** before anything is created, show every row in a table and **highlight the problems** (rules in AM-03).
  - The admin can fix values in the table or re-upload the file.
  - Nothing is created until the admin confirms.
- **Done when:** a CSV with errors shows the highlighted problems, and a clean CSV creates the project with all parts and sub-parts in the Modelling stage.

### AM-03: CSV format, fields and validation rules ⚠️
- **Type:** New feature · **Priority:** Must
- **Columns:**

| Column | Required | Rules |
|---|---|---|
| `serial` | Yes | **Unique across the whole system**, never reused. Format: see open question 1. |
| `parent_serial` | Sub-parts only | Must match the `serial` of a parent row in the same file. Blank for normal parts. |
| `part_name` | Yes | e.g. Bonnet, Left Front Fender |
| `description` | No | Free text |
| `quantity` | Yes | Whole number ≥ 1. **Each unit becomes a separate trackable part** (open question 3). |
| `material` | Yes | Fixed list: **Carbon fiber · Twill · Forged carbon · Fiberglass** |
| `finish_colour` | Yes | Paint colour (name or code) **or** `Exposed carbon` |
| `finish_sheen` | Yes | Fixed list: **Matte · Satin · Gloss** |

- **Problems to highlight on the review screen:**
  - missing required values
  - a serial that's duplicated in the file or **already in the system**
  - a serial in the wrong format
  - a `parent_serial` with no matching parent row
  - a sub-part of a sub-part (only one level is allowed)
  - quantity that isn't a whole number ≥ 1
  - a material or sheen not in the list
- **Done when:** each rule above shows a clear highlighted message on the review screen.

### AM-04: Parts & sub-parts ⚠️
- **Type:** New feature · **Priority:** Must
- **Rules:**
  - A sub-part is a row in the CSV placed under its parent. Its serial is the parent serial plus a suffix (open question 2).
  - **One level only:** sub-parts can't have their own sub-parts.
  - A **parent with sub-parts is just a folder.** It doesn't go through stages itself, and its progress is the total of its sub-parts.
  - Every sub-part goes through **all stages** with its own technician and status.
  - The **parent is complete only when all its sub-parts are complete.** Example: a bumper split into 3 pieces is done when all 3 pieces are done.
- **Done when:** the parts list shows each parent with its sub-parts nested underneath, and the parent's progress and completion follow its sub-parts.

### AM-05: Modelling stage & part data capture
- **Type:** New feature · **Priority:** Must · **Where:** Modelling stage, part detail
- **Who:** the **Modelling department** (separate people). Modellers enter the data themselves, then an admin QCs it (AM-07).
- **Fields per part or sub-part when its model is finished:**

| Field | Unit |
|---|---|
| Dimensions: length × width × height | metres (m) |
| Weight | grams (g) |
| Surface area | square metres (m²) |
| Volume | cubic metres (m³) |
| Render image | one image upload (from the 3D render) |

- All fields are required before the part can be submitted for QC.
- **Done when:** a modeller can enter these fields and the render, submit for QC, and the values are stored on the part and visible in its detail.

### AM-06: Mold components count after pre-mold
- **Type:** New feature · **Priority:** Must · **Where:** between Pre-mold and Mold
- **What I want:**
  - When pre-mold passes QC, an **admin enters how many mold components** are needed to complete the mold for that part.
  - Each component becomes a **tracked item in the Mold stage**, with its own technician and status (e.g. "Mold component 2 of 4").
  - The Mold stage for that part is complete only when **all its mold components** pass QC.
- **Done when:** after pre-mold QC the admin is asked for the count, and the Mold stage shows that many trackable components.

### AM-07: Admin QC gate after every stage ⚠️
- **Type:** New feature · **Priority:** Must · **Where:** every stage, plus a new "Waiting for QC" list
- **What I want:**
  - Any completed task or stage is **submitted for QC**. It moves to the next stage only when it's **approved**.
  - **Who can QC:** Owner and admins.
  - A **"Waiting for QC" list** shows everything awaiting approval, with who submitted it and when.
  - **Approve:** the item moves to the next stage.
  - **Reject:** the item goes back to the **same technician** as rework, with a reason.
- **Time rules:**
  - **QC time is included in the technician's allocated time** for the task, so the technician is motivated to find an admin for QC quickly.
  - **Rework time** after a failed QC is tracked separately. It affects the technician's leaderboard score (open question 4) and is saved as reference data for future projects.
- **Done when:** nothing can skip QC, the QC list works, and rework time is recorded separately from the first attempt.

### AM-08: Task times set by admins only; everything tracked
- **Type:** Change · **Priority:** Must
- **What I want:**
  - Once parts and sub-parts are created and assigned to workers, **admins create the tasks and set the allocated time for each one.** There are no automatic or template durations.
  - **Every task is tracked:** allocated time, actual start and finish, QC result, and rework time.
  - Project schedules and forecasts are built only from these admin-set task times.
- **Done when:** only admins can set or change allocated times, and every task records allocated vs actual time.

### AM-09: Global "+ New project" and "+ New task" buttons ⚠️
- **Type:** New feature · **Priority:** Must · **Where:** every page and menu of the tracking system
- **What I want:**
  - Two buttons visible at **all times**: **+ New project** (opens AM-02) and **+ New task**.
  - **New task** covers any job, including work outside the panel workflow (polishing, sanding, etc.).
  - Every task goes into an **employee's task queue**.
  - Linking a task to a project or part is optional (open question 5).
- **Done when:** both buttons are present on every page, and a task created from any page appears in the chosen employee's queue.

### AM-10: Manual add/edit of everything
- **Type:** Change · **Priority:** Must
- **What I want:** projects, parts, sub-parts and tasks can all be **added and edited manually** at any time, as well as through the CSV. Manual entry follows the same rules as the CSV: unique serials, fixed lists, one sub-part level.
- **Goal:** a seamless workflow, so manual and CSV routes feel the same.
- **Done when:** every field from the CSV can also be created and edited in the app.

### AM-11: Modelling department & separate leaderboard
- **Type:** New feature · **Priority:** Should
- **What I want:**
  - Add a **Modelling** department.
  - Modelling work is tracked in the system like any other department, but shown on its **own leaderboard**, not the same one as the production departments.
  - The other departments' setup stays **as it is for now**. No printer tracking is needed yet.
- **Done when:** modellers have their own department and leaderboard, and their work is tracked like everyone else's.

### AM-12: One combined menu bar ⚠️
- **Type:** UI/UX · **Priority:** Should
- **What I want:**
  - Bring the **board, menu and dashboard together into one menu line**.
  - The dashboard **keeps the same information it shows today**.
- **Needs:** the list and order of menu items (open question 6).

### AM-13: Store data for future planning & benchmarks
- **Type:** New feature · **Priority:** Should
- **What I want:** collect, organise and keep the data needed to estimate future projects and judge performance:
  - modelling measurements (AM-05)
  - allocated vs actual time per task, stage, part, technician and material
  - QC results and rework time
- For now this only needs to be **stored, organised and viewable/exportable**. Predictions come later.
- **Done when:** this data can be viewed and exported per project, part, stage and technician.

---

## Open questions (answer before building the ⚠️ parts)

1. **Serial format:** design (2 digits) + production number (2 digits, first production = `02`) + part code. Please confirm:
   - the separator (e.g. `12-02-101`)
   - whether part codes are always 3 digits (Bonnet `101`, Left fender `102` …)
   - whether `01` is reserved for anything
2. **Sub-part suffix:** e.g. `12-02-105-A / -B / -C` or `-01 / -02 / -03`?
3. **Quantity > 1:** how do the serials of identical units differ (e.g. `-1`, `-2`)?
4. **Rework and score:** confirm that extra time after a failed QC **lowers** the technician's leaderboard score.
5. **Task links:** confirm that every task goes into an employee's queue and that the project/part link is **optional**.
6. **Menu:** the list and order of items for the single menu bar.
7. **Existing projects** on the old template: leave them as they are, or move them to the new workflow?

---

## Minor edits (added along the way)

| ID | Where | Change | Status |
|---|---|---|---|
| | | | |

---

## Prompt for the builder

> Read `AMENDS_NEXT_ROUND.md` and `KYNETIK_PARTS_TEMPLATE.csv`. Start in plan mode:
> 1. Check the current app and code, then confirm your understanding of each item back to me in plain words, with the screens and data each one touches.
> 2. Propose the data model changes (parts/sub-parts, stages, mold components, QC, task times, modelling data) and the build order.
> 3. Ask me the **Open questions** that block you, in one batch.
>
> Build items in priority order, each on its own branch, with a preview link and before/after screenshots. Don't merge or touch the live site until I approve. Skip anything still marked ⚠️ until it's answered.
