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
| AM-04 | Modeller splits a part into sub-parts (see AM-23) | New feature | Must | Ready |
| AM-05 | Modelling stage & part data capture | New feature | Must | Ready |
| AM-06 | Mold components count after pre-mold | New feature | Must | Ready |
| AM-07 | Admin QC gate after every stage | New feature | Must | Ready ⚠️ |
| AM-08 | Task times set by admins only, everything tracked | Change | Must | Ready |
| AM-09 | Global "+ New project" and "+ New task" buttons | New feature | Must | Ready ⚠️ |
| AM-10 | Manual add/edit of projects, parts, sub-parts and tasks | Change | Must | Ready |
| AM-11 | Modelling & 3D Printing department & separate leaderboard (see AM-24) | New feature | Should | Ready |
| AM-12 | One combined menu bar (board + menu + dashboard) | UI/UX | Should | Needs details ⚠️ |
| AM-13 | Store data for future planning & benchmarks | New feature | Should | Ready |
| AM-14 | "Floor Station" role & iPad portal | New feature | Must | Ready |
| AM-15 | Requests page for admins (time extension & QC) | New feature | Must | Ready |
| AM-16 | Conveyor-style timeline (TV display + project timeline) | UI/UX | Must | Ready ⚠️ |
| AM-17 | TV banner: lunch & end-of-shift countdowns, quotes | UI/UX | Should | Ready |
| AM-18 | One serial per part; split happens in My Models (see AM-23) | Change | Must | Ready |
| AM-19 | Floor Station looks like the TV display + leaderboard pop-up | UI/UX | Must | Ready |
| AM-20 | Crew: active/inactive and a Deleted (archived) section; salary access | Change | Must | Ready |
| AM-21 | No parent serial on the new-project review screen | Bug/UI | Must | Ready |
| AM-22 | Modelling submission shows in QC and Requests, with full details | Change | Must | Ready |
| AM-23 | "Add sub-parts" in My Models | New feature | Must | Ready |
| AM-24 | New 3D Printing section + "Modelling & 3D Printing" role | New feature | Must | Ready |
| AM-25 | Remove the gap before the "now" line (TV + Floor Station) | UI/UX | Must | Ready |

---

## Items

### AM-01: New exterior-panel workflow (replaces the current template)
- **Type:** Change · **Priority:** Must · **Where:** Projects, parts tracking, templates
- **What I want:** this workflow **replaces** the existing build template. Every part goes through these stages in this order. If the modeller splits a part (AM-04), its sub-parts take over from stage 2:
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
- **The CSV holds original parts only.** Sub-parts are never in the CSV; the modeller creates them later (AM-04).
- **Done when:** a CSV with errors shows the highlighted problems, and a clean CSV creates the project with all its parts in the Modelling stage.

### AM-03: CSV format, fields and validation rules ⚠️
- **Type:** New feature · **Priority:** Must
- **Columns:**

| Column | Required | Rules |
|---|---|---|
| `serial` | Yes | **Unique across the whole system**, never reused. Format `DD-PP-CCC` (design-production-part, e.g. `12-02-101`), **no suffix**. See open question 1. |
| `part_name` | Yes | e.g. Bonnet, Left Front Fender |
| `quantity` | Yes | Whole number ≥ 1. **Each unit becomes a separate trackable part** (open question 3). |
| `material` | Yes | Fixed list: **Carbon fiber · Twill · Forged carbon · Fiberglass** |
| `finish_colour` | Yes | Paint colour (name or code) **or** `Exposed carbon` |
| `finish_sheen` | Yes | Fixed list: **Matte · Satin · Gloss** |

- **Problems to highlight on the review screen:**
  - missing required values
  - a serial that's duplicated in the file or **already in the system**
  - a serial in the wrong format, or with a sub-part suffix
  - extra or missing columns (header must be exactly `serial,part_name,quantity,material,finish_colour,finish_sheen`)
  - quantity that isn't a whole number ≥ 1
  - a material or sheen not in the list
- **Done when:** each rule above shows a clear highlighted message on the review screen.

### AM-04: Modeller splits a part into sub-parts after modelling ⚠️
- **Type:** New feature · **Priority:** Must · **Where:** Modelling stage, part detail
- **Note:** **AM-18 and AM-23 replace the split steps in this item.** The modeller splits in My Models **before** submitting for QC, sub-parts are `serial-A/-B/-C`, and modelling data stays on the original part. Where they differ, follow AM-23.
- **Why:** we only find out a part needs splitting once it has been modelled, so sub-parts are **created in the tracker**, not in the CSV.
- **What I want:**
  - When a modeller completes a part's model, they get a **"Split into sub-parts"** option and enter how many pieces and a name for each (e.g. Front Bumper → Left Section, Centre Section, Right Section).
  - The tracker gives each sub-part the **parent serial plus a suffix** (e.g. `12-02-105-A / -B / -C`, open question 2).
  - Once split, the **original part is no longer used**. It leaves the active workflow and is kept only as history (which project it came from and how it was split).
  - The **sub-parts carry on through the rest of the workflow** (3D printing onwards), each with its own technician, status and QC.
  - Sub-parts take the original part's material and finish by default; editable.
  - **One level only:** a sub-part can't be split again.
  - The split goes through **admin QC** with the modelling QC (AM-07).
- **Done when:** a modeller can split a modelled part, the sub-parts appear with suffixed serials and continue from 3D printing, and the original part no longer shows in active work.

### AM-05: Modelling stage & part data capture
- **Type:** New feature · **Priority:** Must · **Where:** Modelling stage, part detail
- **Who:** the **Modelling department** (separate people). Modellers enter the data themselves, then an admin QCs it (AM-07).
- **Fields per part when its model is finished.** If the part is split, the data stays on the original part only, and sub-parts don't need their own (AM-23):

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
- **What I want:** projects, parts, sub-parts and tasks can all be **added and edited manually** at any time, as well as through the CSV. Manual entry follows the same rules as the CSV: unique serials and fixed lists. Sub-parts are only created by splitting a modelled part (AM-04), but their names, material and finish can be edited.
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

### AM-14: "Floor Station" role & iPad portal
- **Type:** New feature · **Priority:** Must · **Where:** new user role + new single page
- **What I want:**
  - A new role called **Floor Station**. The account is invited by email like other users and is used on **one shared iPad** in the workshop.
  - After login, the Floor Station sees **one page only**, with no menu and no access to anything else.
  - **The page:** every employee across **all departments**, with their tasks. The page has:
    - a **filter by department**
    - a **search by name**
    - **active tasks** clearly highlighted
  - **Tapping a task** opens two actions:
    1. **Request time extension**
    2. **Request QC**
  - After choosing an action, a **notes box** (optional free text) appears, then **Send**.
  - **No PIN.** The request is recorded against the employee the task is assigned to.
  - **After sending,** show a confirmation plus a reminder: **"Don't forget to also send Mr. Diaa a message on WhatsApp."** This is text only, with no WhatsApp link or integration.
  - The Floor Station **can't see costs or salaries**, and can't change tasks, times or anything else. It can only send requests.
- **Done when:** a Floor Station login shows only this page, filtering and search work, both requests can be sent with notes, and the reminder appears after each send.

### AM-15: Requests page for admins (time extension & QC)
- **Type:** New feature · **Priority:** Must · **Where:** admin app, new **Requests** page in the menu
- **What I want:**
  - A separate **Requests** page lists every request from the Floor Station. Each one shows the type (**Time extension** or **QC**), the employee's name, the task, project and part, the notes, and when it was sent.
  - **Notification:** a **badge with the count** on the Requests menu item, plus a **sound**, whenever a new request arrives. The sound plays while the admin app is open.
  - **Only admins and the Owner** can act on requests.
  - **Time extension request:**
    - The employee just asks. The **admin decides how much time to add**.
    - **Approved:** the admin enters the extra time, it's **added to the task's allocated time**, and it **doesn't count against** the employee.
    - **Not approved:** the allocated time stays as it is, the task stays open, and anything beyond the allocated time counts as **delay**.
  - **QC request:**
    - **Approved:** the task passes QC and **moves to the next stage or task** (same as AM-07).
    - **Not approved:** the task stays open and the clock keeps running (rework rules from AM-07).
  - The admin can add a **reply note** when approving or rejecting.
  - Every request and decision is kept in the history (who, when, what) for the performance data (AM-13).
- **Done when:** a request sent from the iPad appears on the Requests page within seconds, with a badge and a sound, and approving or rejecting it updates the task as described.

### AM-16: Conveyor-style timeline (TV display + project timeline) ⚠️
- **Type:** UI/UX · **Priority:** Must · **Where:** department TV display and the project timeline (open question 11)
- **What happens now:** a fixed 09:00–18:00 grid with a "now" line that moves left to right across it.
- **What I want:**
  - The **"now" line stays fixed on the left** of the timeline, just after the employee names.
  - The **timeline moves right to left** as time passes, feeding the tasks into the "now" line, until **18:00**. Past time leaves on the left.
  - **Colours:**
    - a task **within its allocated time is green**
    - once its time is over it **turns red**
    - other states keep sensible defaults: not started grey, waiting for QC blue, done faded
  - **Lunch break:** shown in **orange or yellow** on the timeline during lunch time (e.g. 13:00–14:00).
  - Apply the **same time structure** to the project timeline in the admin app.
- **Done when:** on the TV the "now" line never moves, tasks slide towards it during the day, they change from green to red when their time runs out, and the project timeline behaves the same way.

### AM-17: TV banner (lunch & end-of-shift countdowns, quotes)
- **Type:** UI/UX · **Priority:** Should · **Where:** top banner of the department TV display
- **What I want:**
  - **Main content, shown most of the time:** the **countdown to lunch break**, e.g. "Lunch break in 23 min".
  - **During lunch:** the banner turns **orange or yellow** and shows that it's lunch time, with a countdown to the end of lunch. When lunch ends, show a **"Lunch time is up, back to it!"** message.
  - **From 17:30:** show a **30-minute countdown to the end of the shift** (18:00).
  - **From time to time:** rotate in short **motivational or funny-but-motivational quotes**. The countdown stays the main message and gets most of the screen time. Admins can edit the quote list in Settings.
- **Done when:** the banner shows the right countdown at each time of day, changes colour for lunch, shows the end-of-shift countdown from 17:30, and rotates quotes without hiding the countdown for long.

### AM-18: One serial per part (split happens in My Models)
- **Type:** Change · **Priority:** Must · **Where:** parts list, Modelling stage, part detail. **Updates AM-04. AM-23 has the split details.**
- **What I want:**
  - **No parent serial anywhere** in the app. Every part has **one serial** shown on it.
  - A split part's pieces each have their own serial: **the original serial + a letter** (`12-02-105-A`, `-B`, `-C`).
  - The split is done **by the modeller before submitting for QC** (AM-23), **not** asked of the admin after QC. The admin approves the model and the split together.
  - After a split, the **original part is removed from the active parts list**, and the sub-parts replace it there. They continue from 3D printing with their own technician, status and QC. The original is kept only in history.
  - **Remove the part name section:** see open question 14.
- **Done when:** no parent serial is shown anywhere, and an approved split shows only the lettered sub-parts in the parts list.

### AM-19: Floor Station looks like the TV display + leaderboard pop-up
- **Type:** UI/UX · **Priority:** Must · **Where:** Floor Station (iPad) page. **Updates AM-14.**
- **What I want:**
  - Lay the page out **like the TV display**: every employee listed one under another, each row with the **live "now" line** and their tasks moving in (same conveyor timeline as AM-16 and AM-25).
  - **Only the task bars can be tapped.** Tapping one opens the two actions from AM-14 (Request time extension, Request QC, with notes). Nothing else on the page responds to taps.
  - **Keep** the search by name and the filter by department.
  - **Remove the leaderboard panel** from the page. Add a **leaderboard icon** that opens a **pop-up**:
    - the **live leaderboard for all production departments**, **sorted and grouped by department**
    - **Modelling & 3D Printing are not included** (they have their own leaderboard)
    - a clear **Close** button to go back to the page
- **Done when:** the iPad page looks and moves like the TV display, only tasks are tappable, and the leaderboard opens and closes as a pop-up grouped by department.

### AM-20: Crew: active/inactive and a Deleted (archived) section; salary access
- **Type:** Change · **Priority:** Must · **Where:** Crew section and Task Queue
- **What I want:**
  - Each employee profile has a status: **Active** or **Inactive**.
    - **Inactive** employees are hidden from the TV, the Floor Station and task assignment, but stay listed in Crew.
  - **Delete** (admins and Owner): this **doesn't erase anything**. The employee moves to a **"Deleted accounts" (archived) section on the same Crew page**.
    - Their history, tasks, times, QC results and scores are **kept forever** for reports and performance data.
    - An archived employee can be viewed, and restored if needed.
  - **Open tasks:** before an employee is set to Inactive or deleted, the app warns about their open tasks and asks the admin to **reassign them** (or leave them unassigned).
  - **Salaries:** **Admins and the Owner** can **view and change** salaries. All other roles (Supervisors, Floor Station, Modelling & 3D Printing, displays) **can't see them**. Enforce this on the server, not only in the screen.
  - Every status change, deletion, restore and salary change is recorded in the audit log.
- **Done when:** an admin can set Active or Inactive, delete to the archived section and restore from it with all data intact, and only Admins and the Owner see salaries.

### AM-21: No parent serial on the new-project review screen
- **Type:** Bug/UI · **Priority:** Must · **Where:** + New project → Upload CSV → review screen
- **What I want:** the review screen after uploading the CSV shows **no parent serial column or field**. It shows only the CSV columns: serial, part name, quantity, material, finish colour, finish sheen.
- **Done when:** the words "parent serial" don't appear anywhere in the new-project flow.

### AM-22: Modelling submission shows in QC and Requests, with full details
- **Type:** Change · **Priority:** Must · **Where:** My Models, QC section, Requests section. **Updates AM-07 and AM-15.**
- **What I want:**
  - When the modeller has entered all the model data and clicks **Submit for QC**, the submission appears in **both the QC section and the Requests section** (with the badge and sound from AM-15). Today it only goes to QC.
  - It's **one request shown in two places**: approving or rejecting it in either place **clears it from both**.
  - **The QC view shows the full request:**
    - the **render image**, viewable full size
    - every data point: dimensions L × W × H (m), weight (g), surface area (m²), volume (m³)
    - the **sub-parts**, if the modeller split the part (AM-23)
    - the modeller's name, submit time and notes
- **Done when:** a modelling submission appears in QC and Requests at the same time with all its details, and one decision clears both.

### AM-23: "Add sub-parts" in My Models
- **Type:** New feature · **Priority:** Must · **Where:** My Models (Modelling & 3D Printing role). **Replaces the split steps in AM-04 and AM-18.**
- **What I want:**
  - On each part in **My Models**, next to the data fields (dimensions, weight, surface area, volume, render), add an **"Add sub-parts"** button.
  - The modeller enters the **number of sub-parts**. The app then **creates and names them automatically**:
    - **Serial:** original serial + letter: `12-02-105-A`, `12-02-105-B`, `12-02-105-C`
    - **Name:** original name + position, e.g. **"Front Bumper 1 of 3"**, "2 of 3", "3 of 3". The modeller can rename them.
    - Material and finish are copied from the original part.
  - The **modelling data stays on the original part only**. Sub-parts don't need their own measurements or render.
  - The split is done **before Submit for QC**, and the admin approves the model and the split together (AM-22).
  - **After approval:** the sub-parts are **added to the project's main parts list**, the **original part is removed** from the active list (kept in history), and each sub-part continues to 3D printing on its own.
  - One level only: a sub-part can't be split again.
- **Done when:** a modeller can add sub-parts, see them auto-named, submit, and after QC approval the project parts list shows the lettered sub-parts instead of the original.

### AM-24: New 3D Printing section + "Modelling & 3D Printing" role
- **Type:** New feature · **Priority:** Must · **Where:** new 3D Printing section, user roles
- **New role, Modelling & 3D Printing:** one role covers both jobs. Users with this role can access **only My Models and 3D Printing**, nothing else. This replaces the separate modeller access.
- **How the flow works:**
  - When a model (and its sub-parts, if any) **passes QC**, it automatically appears in **3D Printing** as a print job. A split part creates **one print job per sub-part**.
  - On each print job, the user enters:

| Field | Unit |
|---|---|
| Filament amount | grams (g) |
| Printing time | minutes |
| Number of slice components | whole number (recorded only, not tracked separately) |

  - The user then **submits for QC**. Like modelling, it shows in **QC and Requests** (one request, two places).
  - **The 3D-printing QC** is where all the sliced components are **combined and checked** as one complete printed part. When approved, the part moves to **Prototyping**.
  - These values are stored for future planning (AM-13).
- **Leaderboard:** Modelling & 3D Printing has its **own leaderboard**, separate from production (AM-11, AM-19).
- **Done when:** approved models appear in 3D Printing, the three fields can be entered and submitted, QC approval moves the part to Prototyping, and the role sees only these two sections.

### AM-25: Remove the gap before the "now" line (TV + Floor Station)
- **Type:** UI/UX · **Priority:** Must · **Where:** department TV display and Floor Station. **Refines AM-16.**
- **What happens now:** there's an **empty dashed box** between the employee name and the "now" line, so "now" doesn't sit at the start of the timeline.
- **What I want:** the **"now" line sits right at the left edge of the timeline**, directly after the employee name column, with **no gap or empty past area** before it. Tasks start right at the line.
- **Done when:** on both the TV and the iPad the "now" line touches the start of the timeline, and the dashed empty box is gone.

---

## Open questions (answer before building the ⚠️ parts)

1. **Serial format:** design (2 digits) + production number (2 digits, first production = `02`) + part code. Please confirm:
   - the separator (e.g. `12-02-101`)
   - whether part codes are always 3 digits (Bonnet `101`, Left fender `102` …)
   - whether `01` is reserved for anything
2. ~~Sub-part suffix~~ **Answered:** letters, `12-02-105-A / -B / -C`.
3. **Quantity > 1:** how do the serials of identical units differ (e.g. `-1`, `-2`)?
4. **Rework and score:** confirm that extra time after a failed QC **lowers** the technician's leaderboard score.
5. **Task links:** confirm that every task goes into an employee's queue and that the project/part link is **optional**.
6. **Menu:** the list and order of items for the single menu bar.
7. **Existing projects** on the old template: leave them as they are, or move them to the new workflow?
8. ~~Modelling data after a split~~ **Answered:** the original part's data is enough.
9. **Quantity and splitting:** if a part has quantity 2 and is split into 3, should every unit get its own set of 3 sub-parts (6 in total)?
10. **Floor Station actions:** only **two** actions (time extension and QC), right? A third was mentioned earlier but never named.
11. **Project timeline (AM-16):** which admin screen gets the conveyor view: the project timeline (Gantt), each project's detail page, or both?
12. **Lunch time:** is lunch always **13:00–14:00**, or should admins set it in Settings?
13. ~~Serials for split parts~~ **Answered:** original serial + letter (`12-02-105-A`, `-B`, `-C`).
14. **"Remove the part name section" (AM-18):** where? From the **CSV** (the name then comes from the part code list, e.g. 101 = Bonnet), or from a **screen in the app** (which one)?
15. **Archived employees:** an Inactive or Deleted employee is hidden from the TV and iPad. Should their past tasks still show on the project timeline? (Assumed: yes, as history.)

---

## Change log

- **13 Oct 2026:** CSV reduced to `serial,part_name,quantity,material,finish_colour,finish_sheen` (no `parent_serial`, no `description`). Sub-parts are no longer in the CSV. The modeller creates them in the tracker after modelling, and the original part is then retired (AM-02, AM-03, AM-04, AM-05 updated).
- **13 Oct 2026 (round 2):** added AM-14 Floor Station, AM-15 Requests page, AM-16 conveyor timeline, AM-17 TV banner and AM-18 one serial per part with a split prompt (AM-18 replaces the suffix idea in AM-04 once open question 13 is answered).
- **14 Oct 2026 (round 3):** added AM-19 to AM-25: the Floor Station in TV style with a leaderboard pop-up, Crew active/inactive and an archived Deleted section, salary access for Admins and the Owner, no parent serial on the review screen, modelling submissions shown in QC and Requests with full details, "Add sub-parts" in My Models (letters suffix, split before QC, data on the original only), the new 3D Printing section with the Modelling & 3D Printing role, and the "now" line moved flush left. Open questions 2, 8 and 13 answered.

---

## Minor edits (added along the way)

| ID | Where | Change | Status |
|---|---|---|---|
| ME-01 | TV display, employee rows | The "Next up later tod…" text is cut off. Show it in full or shorten it (e.g. "Next: 12:37"). | Open |
| ME-02 | TV display, task bars | Very short task bars squash their text (e.g. "F 0."). Hide the text on tiny bars, or show it as a tooltip or label beside the bar. | Open |

---

## Prompt for the builder

> Read `AMENDS_NEXT_ROUND.md` and `KYNETIK_PARTS_TEMPLATE.csv`. Start in plan mode:
> 1. Check the current app and code, then confirm your understanding of each item back to me in plain words, with the screens and data each one touches.
> 2. Propose the data model changes (parts and splits, stages, mold components, QC, task times, modelling data, the Floor Station and Modelling & 3D Printing roles, requests, 3D print jobs, archived employees, salary access) and the build order.
> 3. Ask me the **Open questions** that block you, in one batch.
>
> Build items in priority order, each on its own branch, with a preview link and before/after screenshots. Don't merge or touch the live site until I approve. Skip anything still marked ⚠️ until it's answered.
