# Claude Code Prompt — New Phase: Employee Day View, Task Queue & Leaderboard

> **How to use:** Paste everything below the line into Claude Code in the `kynetik-Managment-tool` repo. It adds a new phase that runs **before Phase 4** and is the last build phase before deployment. Attach the photo of my notebook sketch with the message if you can.

---

Add a new phase to the plan: **Phase 3.5 — Employee Day View, Task Queue & Leaderboard.** Do it **before Phase 4**. It is the last build phase before we deploy.

Read `KYNETIK_BUILD_TRACKER.md` and `CLAUDE.md` again first. Start in **plan mode**: give me the schema changes, the components, the scheduling rules and any blocking questions in one batch. Wait for my approval before you write code. Update `CLAUDE.md` and the phase plan with this phase.

## Part A — Admin side: per-employee task queue (my backend)

1. **Add task button** on each employee (in the Crew/People page, and in a new **Task Queue** page that lists every employee as a column or row). The task form has:
   - Title (required)
   - Duration as a number + unit: **hours** or **days** (1 day = the working hours in one day from settings)
   - Optional link to a build / stage / part, so it counts in the existing tracking and scores
   - Optional notes and a colour (default = the department colour)
   - Optional fixed start (date + time). If blank, it follows the previous task in the queue.
2. **Drag and drop to set priority** with full control:
   - Reorder tasks inside one employee's queue (top = do first).
   - Drag a task to a **different employee** to reassign it.
   - Keyboard alternative (move up / move down) and a "move to top" action.
   - Edit, duplicate, delete, mark **In progress / Done / Blocked** from the admin side. Employees never do this.
   - Use `@dnd-kit` (or similar) with optimistic UI, and save the order to the DB (a `position` field, with fractional or ordered indexes, so concurrent edits don't fight).
3. **Live reflection:** every add, edit, reorder or status change shows on the employee screens within a couple of seconds through realtime. No refresh needed.
4. **Rules carried over from the spec:** the double-booking check (§9) still applies. A person's queue is sequential, so they never have two tasks at the same time. Every change goes into the audit log.
5. **Departments:** add a proper **Department** field per employee. Defaults: Modification, Strip & Fitment, Paint & Finish, Detailing (matching the station types). They can be edited in Settings. Each department has a name, colour and emoji. Let me assign my 12 crew members to departments from the Crew page. All crew values are blank today, so show "unassigned" until I set them.

## Part B — Scheduling the queue on the clock

- **Employee day window = 09:00 to 18:00** (new default). Put it in Settings as "Employee view hours" and use the same working-hours calendar engine (§6). **Ask me** whether there is a lunch break inside 09:00–18:00 and whether this replaces the old 08:00–17:00 shift for all calculations or only for this view.
- Tasks are laid out back to back from the employee's current task, in queue order, on working hours:
  - A task of a few hours fills only its hours. The **next queued task starts right where it ends**, on the same row.
  - A task longer than what is left of the day **fills the row to 18:00** and continues the next working day (rest days and holidays are skipped). Show a label like "Day 1 of 2" / "continues tomorrow →".
  - A 2-day task starting at 09:00 fills the whole row today and the whole row tomorrow.
- **Overrun:** if a task is still not Done when its planned time is up, keep the bar growing (hatched red, as in §16) and push the rest of that person's queue later.
- Pure functions in `/domain` with unit tests: hours task, days task, a task crossing the end of the day, a task crossing the rest day, overrun push, and reorder → reschedule.

## Part C — Employee Day View (read-only display)

This is a **new screen on the Shop Floor Display** (same no-login display token, no clicks, no costs). Layout, based on my sketch:

```
 DEPARTMENT: PAINT & FINISH  🎨           Thu 02 Oct · 11:42       ⟳ live
 ───────────────────────────────────────────────────────────────────────────
            │ 9   10   11   12   13   14   15   16   17   18
 ───────────┼────────────────────┃───────────────────────────────────────────
 [📷] Toto  │[ Sand bonnet ───────┃──]→[ Primer LF fender ]→[ Clear coat … →
 [📷] Nino  │[ Paint rear bumper (Day 1 of 2) ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━→
 [📷] Yan   │        [ Polish doors ]→[ Next: Mask skirts ]   (idle 09–10)
            │                     ┃ now
```

- **Rows = employees of ONE department only.** Each display link is set to one department in the admin console, e.g. the Paint TV shows only painters. Never show all departments at once.
- **Columns = hours 09:00 → 18:00**, with a gold vertical **"now" line** moving across in real time.
- Each bar shows the task title, the build/part if it is linked, and its duration ("3h" / "2 days"). The colour shows the status: Not started grey, In progress gold, Blocked red, Done green faded. The current task is highlighted.
- Show the upcoming tasks after the current one until the end of the row. If the day is full, end with a small "+N more" chip.
- Each row starts with the employee's **photo**. Until I upload one, show a **placeholder** (initials on a coloured circle). Add photo upload per employee in the admin Crew page (Supabase Storage, cropped square, max ~1 MB).
- Large type readable from 3–5 m, 1080p and 4K landscape, cursor hidden, auto-reconnect, "last updated" clock.

## Part D — Leaderboard (same department display)

On the same employee display, as a side panel or a rotating screen (the admin chooses which):

- **Ranking 1st, 2nd, 3rd…** within the department, using the existing score (§11). The admin can switch the period between today, this week and this month.
- Each entry shows the photo or placeholder, name, rank and score. **Under each name, a row of emoji badges** that make it fun and push people forward. Defaults (all editable in Settings → Gamification: emoji, name, rule, on/off):
  - 🥇 🥈 🥉 top 3
  - 🔥 streak: tasks finished on time several days in a row
  - 🎯 sharpshooter: first-time-right 100% this period
  - ⚡ speedster: best pace in the department
  - 🚀 most tasks finished this week
  - 📈 climber: moved up the most places since last period
  - 🐢 "warming up" for anyone not in the top 3, with a friendly line (rotating funny messages I can edit, e.g. "The turtle won the race once… 👀")
- Keep it **kind**: no red shaming, no negative numbers on screen, and an admin switch to hide the bottom ranks or show only the top 5.
- Small celebration animation (confetti) on the display when someone moves up a rank or finishes a task. The admin can switch it off.

## Acceptance checks
- I add a 3h task and a 2-day task to Nino, drag the 3h task to the top, and within seconds the Paint display shows the 3h bar from now, followed by the 2-day bar running to 18:00 and continuing tomorrow.
- I drag a task from Toto to Yan and it moves rows on the display live.
- A display set to "Paint & Finish" never shows employees from other departments and never shows costs.
- The leaderboard order matches the §11 scores, the badges follow their rules, and photo placeholders appear for employees with no photo.
- Domain unit tests pass. Playwright test: an admin reorder shows up on the display page.

Stop after this phase for my review. Then continue with Phase 4.
