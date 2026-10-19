# Fix & Redesign: Reports Section (bugs + user journey)

**Date:** 17 Oct 2026 · **Owner:** Joey · **Replaces:** AM-30 (filters). Do this instead of AM-30.

> **Paste to Claude Code:** "Read `REPORTS_FIX_PROMPT.md` and fix the Reports section as described. Start with Step 1 (audit), show me the bug list, then fix everything. Show before/after screenshots and a sample PDF for every tab before deploying, and deploy only after I say 'yes'."

---

## Step 0: Fix the PDF crash first (HTTP 500)

Clicking **Export PDF** on the live site gives **"This page isn't working · HTTP ERROR 500"** at `kynetik-managment-tool.vercel.app`. The server-side PDF code is crashing.
1. Read the error in **Vercel → Logs**. I'll paste it if you can't access it.
2. Find the cause. Likely suspects:
   - headless Chrome/Puppeteer, which doesn't run on Vercel serverless without `@sparticuz/chromium`
   - a function **timeout** or **memory** limit
   - a missing font, file or environment variable
3. Choose the **most reliable approach for Vercel**. Preferred: build the PDF **in the browser** (e.g. `@react-pdf/renderer`, or jsPDF with SVG charts), so no server is needed. Or use a server PDF library that doesn't need Chrome.
4. The export must **never show a blank error page**. If something fails, show a friendly message in the app ("PDF couldn't be created, try CSV or try again") and log the details.
5. Prove it works on the **preview link**: export a PDF from each tab and show me the files or screenshots of every page.

## Step 1: Audit first (don't change code yet)

Open **Reports** on staging/preview and walk through **every tab** (Employees, Parts, Projects, Activity log) and **every export** (CSV + PDF), the way a manager would. Use Playwright screenshots. List every bug and confusing moment, then fix them all in Step 3. These are the ones I already know about:

| # | Problem I see | Expected |
|---|---|---|
| B1 | **The PDF has no performance summary and no charts.** Only a table comes out, or nothing. | Every PDF has a summary page with headline numbers **and charts**, then the detail tables (see Step 4). |
| B2 | **Parts and Projects are filtered through the employee.** Picking a part shows only one technician's rows. | A part shows **every stage and every technician** who worked on it. Employee isn't a filter on the Parts tab. |
| B3 | **The time filter is mixed with the other filters**: When, Month, From and To all show at once, plus a hint. | Time sits in its **own section**, with **one** date control (Step 2). |
| B4 | **Material · Finish column is empty.** | Show the part's material and finish, e.g. "Forged carbon · Matte". |
| B5 | **Durations like `186:39` are unclear** (hours? minutes?). | Show `186h 39m`. Anything **over its allocated time is red**, with a "+178h over" note. |
| B6 | **"Parts" and "Part steps" tiles show the same number and the meaning isn't clear.** | Tiles that match each tab (Step 3), each with a one-line explanation on hover. |
| B7 | **Not-started rows appear for "This month"** with no dates. | Define what "in this period" means (Step 2) and apply it the same way everywhere. |
| B8 | **Needs an Apply click** to update. | Results update instantly when any filter changes. |
| B9 | **Export PDF crashes with HTTP 500** on the live site. | See Step 0. |
| B11 | **"+ New project" button sits on every page** next to "+ New task". | **Remove** the global "+ New project" button. Keep **"+ New task"** on every page. "New project" stays available **only on the Projects/Builds page**. |
| B12 | **The crew performance CSV gives times in minutes only.** | Keep the minutes columns and **add hours columns** (see Step 3b). |
| B10 | **Previous filter changes never reached the live site.** The old filter bar is still showing. | After fixing, deploy to preview, show me, then deploy to production after my "yes". Confirm the live site shows the new version. |

---

## Step 2: One filter design for all tabs

The filter area has **two clearly separate zones**:

```
┌ WHEN ───────────────────────────────────────────────────────────────┐
│ [Today] [This week] [This month●] [Last month] [Custom ▾]            │
│ Showing 1–17 Oct 2026                                                │
└─────────────────────────────────────────────────────────────────────┘
┌ WHAT ─────────────────────────────────────────────────── (per tab) ┐
│ [Project ▾] [Part 🔍] [Stage ▾] [Status ▾]   + More                   │
│ Active: (001 lambo_buggy ✕) (Prototyping ✕)  Clear all               │
└─────────────────────────────────────────────────────────────────────┘
 42 results                                          [Export CSV] [Export PDF]
```

**WHEN (time): use the standard date-range picker found in most modern apps.**
- **One field** shows the current range, e.g. **`📅 This month · 1–17 Oct 2026 ▾`**.
- Clicking it opens **one pop-up**:
  - **left side:** quick choices, **Today · Yesterday · This week · Last week · This month · Last month · Last 3 months · This year · Custom**
  - **right side:** a **two-month calendar**. Click the start day, then the end day, and the range highlights. Arrows move between months.
  - **bottom:** **Cancel** and **Apply** (the only Apply button on the page)
- Picking a quick choice applies it straight away and closes the pop-up.
- **Remove** the When dropdown, the Month, From and To boxes, and the hint text.
- **Meaning of "in this period":** an item is included if it had **any activity** in the period (assigned, started, QC requested or decided, finished, or worked on). Add a small toggle, **"Include not started"**, off by default.

**WHAT (subject):** each tab shows **only the filters that make sense for it**:

| Tab | Main filters | Under "+ More" |
|---|---|---|
| **Employees** | **Employee only** (pick one, several, or Select all, with search). It shows **every task assigned to them** in the period. | Status (optional) |
| **Parts** | Project, Part (search by serial or name), Stage, Status | Material, Finish |
| **Projects** | Project(s) (multi-select), Status | Department |
| **Activity log** | Who, Action type (assignment, status, QC, extension, absence, split, crew change…), Item search | Project |

**Rules for all tabs:**
- **Smart lists:** picking a Project narrows the Part list to that project's parts. Lists show only values that have data in the period.
- **Active filters** show as chips with ✕, plus **Clear all**.
- Results and tiles **update instantly**, and the result count shows next to the export buttons.
- **Exports always use exactly** what's on screen. The file name includes the tab, the filters and the range, e.g. `Parts_001-lambo_buggy_2026-10-01_to_2026-10-17.pdf`.
- **Memory:** the default is This month, and the last filters used are remembered per person and per tab.
- **Small screens:** on iPad or phone, both zones fold into one **Filters** button that opens a side panel.

---

## Step 3: Each tab shows the right thing

**Employees tab:** pick an employee (or several) and see **all tasks assigned to them** in the period. One row per **task**, grouped by employee. Each employee header shows tasks finished, on-time %, first-time QC pass % and total hours.
- **Tiles:** Employees · Tasks finished · On-time % · First-time QC pass %

**Parts tab (part-centric):** one row per **part**. Each row **expands** to show its stage timeline: **every stage, with its own technician**, assigned/started/QC/finished times, allocated vs effective time, QC attempts and status.
- The **part row** shows: serial, name, project, material · finish, current stage, progress (e.g. 3/10 stages), total allocated vs effective time, and status.
- **Tiles:** Parts · Stages completed · Parts finished · QC attempts (pass/fail)

**Step 3b: crew performance CSV, add hour columns:**
- Keep the existing **minutes** columns.
- Next to each, add an **hours** column as a decimal number with 2 places, so Excel can total them:
  - `Allocated (h)`
  - `Approved extensions (h)`
  - `Total allocated (h)`
  - `Effective working time (h)`
  - `Rework time (h)`
  - `Variance (h)`
- Example: `Effective working time (min) = 150` → `Effective working time (h) = 2.50`.
- **Totals per employee** (total allocated hours, total effective hours, variance) go in the **PDF summary**, and in a separate **`_summary.csv`** file exported alongside the detail file. The detail CSV stays one row per task, with no total rows mixed in.

**Projects tab:** one row per **project**: progress %, parts done/total, planned vs forecast finish, hours by stage/department, delays, and QC failures. Each row **expands** to a stage breakdown.
- **Tiles:** Projects · On track · Late · Average progress

**Activity log:** one row per **event**: time, who (role), action, item, before → after, notes. Newest first, with paging.

**Shared display rules:**
- **Durations:** `2h 30m` / `186h 39m`, never `186:39`.
- **Over time:** red, with a "+Xh over" note.
- **Empty cells:** show "—" with a short reason on hover (e.g. "not started yet"). No blank cells.
- **No results:** a friendly message, e.g. "No part activity in this period. Try 'Last month' or turn on 'Include not started'."

---

## Step 4: The PDF must be a real report

Every tab's **Export PDF** produces:
1. **A header on every page:** Kynetik logo, report name, the filters and date range used, "Generated on [date time] by [name]", and page X of Y.
2. **A summary page** with headline numbers (the tab's tiles) and **at least 2–3 charts**:
   - **Employees:** allocated vs effective hours per person, on-time %, first-time QC pass %, trend by week
   - **Parts:** time per stage (allocated vs effective), QC attempts per stage, parts by status
   - **Projects:** progress per project, planned vs forecast finish, hours by department
   - **Activity log:** actions per day, actions by type
3. **Detail tables** (the same data as the screen, readable, with repeated column headers on each page).

**Make the charts reliable in the PDF.** Render them as **SVG** in the report, or generate the PDF on the server, and **wait until the charts have finished drawing** before creating the PDF. Then test it: generate a PDF for **each tab with sample data** and show me screenshots of every page. **No costs or salaries** in any report.

---

## Step 5: Done when

- [ ] Every bug B1–B8 is fixed and shown with before/after screenshots.
- [ ] Choosing **Part = Rear Bumper** shows **all its stages and all technicians**, not just one person.
- [ ] Time and subject filters are in separate zones. Only one date control is visible at a time, and results update instantly.
- [ ] Each tab shows only its own filters and tiles.
- [ ] The PDF for **each** tab includes the header, summary, charts and tables, with sample PDFs attached.
- [ ] CSV and PDF match exactly what's on screen.
- [ ] Works on laptop and iPad (screenshots of both).
- [ ] "+ New project" is gone from every page except the Projects/Builds page, and "+ New task" is still on every page.
- [ ] The crew CSV has both minutes and hours columns, and the `_summary.csv` gives per-employee totals in hours.
- [ ] Nothing else in the app changed.
