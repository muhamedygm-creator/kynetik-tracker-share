# UX audit — Kynetik Build Tracker (MVP)

**Date:** 7 Oct 2026 · **How:** walked every screen on an exact local copy of the live code (same commit as production, `939b631`), with the seed data and the sample Modification day. Signed in as **Viewer** and **Supervisor** (never Owner, so no costs appear). Laptop = 1440×900, phone = 390×844, TVs = 1920×1080. Screenshots are in [`screens/`](screens/).

**Who it hurts:** **O** = Owner · **S** = Supervisor · **T** = technician watching the TV · **N** = new user.
**Severity:** **High** = blocks a daily job or gives a wrong picture · **Medium** = slows people down or confuses · **Low** = polish.

Speed note: timings below come from a development build, which is several times slower than production, so they are not a verdict. Real numbers get measured on the preview link in Step 4.

---

## Top 10 (fix first)

| # | Problem | Who | Sev |
|---|---|---|---|
| 1 | Board **Attention** list is flooded with double-booking lines; the two late builds are easy to miss | O S | High |
| 2 | On a phone, **build pages and the Floor log are wider than the screen** (content cut off) | S | High |
| 3 | On a phone, **only 4 of 9 tabs are visible** and nothing hints that the bar scrolls | S N | High |
| 4 | TV **leaderboard is empty or "warming up" for half the week** (it resets Monday and needs 3 finished parts) | T | High |
| 5 | Updating one part from the floor takes **Edit → dialog → fields → Save** (no quick status change) | S | High |
| 6 | **3 of 4 department TVs are blank** ("No one is assigned to this department yet") | T O | Medium |
| 7 | **Every Timeline bar is red-hatched**, so red no longer means "look here" | O S | Medium |
| 8 | **Developer wording** in the app: "Coming in phase 4", "comes in phase 5", "(D9)" | O S N | Medium |
| 9 | **Low-contrast text**: faded grey 2.6:1 and small red text 3.3:1 (WCAG needs 4.5:1) | all | Medium |
| 10 | **No help or explanations** for words like part-step, float, baseline, FTR, pace | N | Medium |

---

## Found during the audit: sample data noise (fix before anything else)

The sample leaderboard history I added on build **DEMO** (2 Oct) overlaps the real crew's open Premold Prep part-steps on EXT-001. The app (correctly) reports each overlap as a double-booking. Result on the audit copy (the live site has the same sample, so the same effect):

- Board **Attention** (capped at 10 lines): 8 are double-booking warnings, 5 of them caused by DEMO. Other alerts can be pushed out of the list.
- Board **Data health**: 16 overlap records, 13 of them DEMO.
- EXT-001 build page: a long red "Double-booked" paragraph, mostly DEMO.

**Proposed fix (needs your yes, it touches live data):** remove the sample history (`demo:remove`), or move the leaderboard sample to people with no open part-steps. The real Toto/Francis overlap from v1 (D4) stays reported, as agreed. Screens: [01](screens/01-board-laptop.png), [04](screens/04-build-detail-laptop.png).

---

## Everywhere (all console screens)

| Problem | Who | Sev | Screen |
|---|---|---|---|
| Phone: the tab bar shows Board, Timeline, Builds and half of Task queue. Technicians, Floor log, Setup, Settings and Audit are hidden off-screen with no arrow or fade. | S N | High | [02](screens/02-board-phone.png) |
| Phone: no "home" summary sized for a phone; every page is the laptop page squeezed. | S | Medium | [02](screens/02-board-phone.png) |
| Small tap targets: up to 77 controls under 32 px on the Task queue, 27 on a build page. Hard with gloves or dirty hands. | S | Medium | [08](screens/08-queue-laptop.png) |
| Contrast: faded grey (`--grey2`, 2.6:1) is used for forecast values and hints; red (`--bad`, 3.3:1) for small "late", "Delete" and "blocked" text. Both fail WCAG AA for small text. | all | Medium | [01](screens/01-board-laptop.png) |
| Jargon with no explanation: part-step, float, baseline, committed, FTR, pace, "std h", "var". | N | Medium | [04](screens/04-build-detail-laptop.png), [12](screens/12-technicians.png) |
| Hours everywhere ("409.4h late", "113.4h of 351.7h"). Days or dates are easier to grasp at a glance. | O S | Low | [01](screens/01-board-laptop.png) |
| Mixed action styles: outlined buttons in one place, plain gold text links ("Edit Duplicate") in another, red text "Delete" in a third. | all | Low | [08](screens/08-queue-laptop.png) |
| No search (build serial, part name, person) anywhere. | O S | Low | — |

## Board

| Problem | Who | Sev | Screen |
|---|---|---|---|
| **Attention** mixes "build is late" with many per-part overlap lines; one person with 5 overlaps produces 5 lines. Late builds should come first and repeats should be grouped ("Toto — 5 overlaps"). | O S | High | [01](screens/01-board-laptop.png) |
| **Data health** sits above the builds and prints raw records in monospace. Useful for cleanup, but it pushes the builds below the fold every day. | O | Medium | [01](screens/01-board-laptop.png) |
| Builds that have **not started** show "409.4h late" and "Elapsed 105.4h of 505.4h". It reads as if work is happening. | O | Medium | [01](screens/01-board-laptop.png) |
| 7 tall cards; answering "which build is late?" needs scrolling. No compact list, sort or filter. | O S | Medium | [01](screens/01-board-laptop.png) |
| Header line "8h a day, Sunday off · all durations in working hours" is useful once, then noise. | O | Low | [01](screens/01-board-laptop.png) |

## Builds list

| Problem | Who | Sev | Screen |
|---|---|---|---|
| Same big cards as the Board, so the two pages feel duplicated. | O S | Low | [03](screens/03-builds-viewer.png) |
| The sample build **DEMO** shows as a real build "In build". | O S | Low | [03](screens/03-builds-viewer.png) |
| Viewer banner is clear ("Read-only access. Ask the Owner for Supervisor access"). Good. | — | — | [03](screens/03-builds-viewer.png) |

## Build detail

| Problem | Who | Sev | Screen |
|---|---|---|---|
| To move one part to "In progress" or "Done": find the row → **Edit** → dialog → status, technician, times → Save. No one-tap status. | S | High | [04](screens/04-build-detail-laptop.png) |
| Phone: page is 978 px wide on a 390 px screen; title, banner and tables are cut off. | S | High | [05](screens/05-build-detail-phone.png) |
| "Double-booked" banner is one long red paragraph; it can't be scanned. | O S | Medium | [04](screens/04-build-detail-laptop.png) |
| **Delete** sits in the main action row next to Edit and Re-baseline, same size. | O S | Medium | [04](screens/04-build-detail-laptop.png) |
| Parts table has 12 columns; "Logged h" and "Rework" are mostly dashes. | S | Low | [04](screens/04-build-detail-laptop.png) |
| Import note "Imported from the buggy build tracker workbook. Durations are defaults — adjust them." is still showing. | O | Low | [04](screens/04-build-detail-laptop.png) |

## Timeline

| Problem | Who | Sev | Screen |
|---|---|---|---|
| Almost every task bar is red-hatched (forecast past plan), so red stops meaning "act now". | O S | Medium | [06](screens/06-timeline-laptop.png) |
| Bar labels are cut to 1–3 letters ("Co…", "M…", "P…"). | O S | Medium | [06](screens/06-timeline-laptop.png) |
| Phone: the name column takes half the width; the chart is a sliver. | S | Medium | [07](screens/07-timeline-phone.png) |
| Two unlabeled button groups (zoom / rows). No "jump to today". | N | Low | [06](screens/06-timeline-laptop.png) |

## Task queue

| Problem | Who | Sev | Screen |
|---|---|---|---|
| Each card carries 8 controls (top, up, down, status, Edit, Duplicate, Delete, drag). Busy, small, and Delete is one tap away from the status menu. | S | Medium | [08](screens/08-queue-laptop.png) |
| Everyone without a department is a row of empty columns ("Empty — drop a task here") that runs off the right edge. Finding one person means scrolling sideways. | S | Medium | [08](screens/08-queue-laptop.png) |
| Phone: columns sit side by side and scroll sideways; one person at a time would fit better. | S | Medium | [09](screens/09-queue-phone.png) |
| The page heading explains the rule well ("Top = do first"; "Changes show on the TVs within seconds"). Good. | — | — | [08](screens/08-queue-laptop.png) |

## Floor log

| Problem | Who | Sev | Screen |
|---|---|---|---|
| Phone: 658 px wide on a 390 px screen; the second attendance column is cut off. | S | High | [11](screens/11-floor-phone.png) |
| Everyone starts as "in · 8h left" before anyone confirms attendance, so saving without checking records a full house. | S O | Medium | [10](screens/10-floor-laptop.png) |
| **Save day** looks disabled (dim gold) even when it works. | S | Low | [10](screens/10-floor-laptop.png) |
| Date picker plus "Go" button: two steps where one would do. | S | Low | [10](screens/10-floor-laptop.png) |

## Technicians

| Problem | Who | Sev | Screen |
|---|---|---|---|
| 8 of 12 rows are all dashes; useful rows are mixed with empty ones. | O S | Low | [12](screens/12-technicians.png) |
| "Logged h/part" is 0h for everyone (no Floor logs yet), which looks like a fault. | O | Low | [12](screens/12-technicians.png) |
| Score formula shown as a paragraph; good for trust, but long. | N | Low | [12](screens/12-technicians.png) |

## Setup and Settings

| Problem | Who | Sev | Screen |
|---|---|---|---|
| Setup: Workstations and Templates say "Coming in phase 4" and lead nowhere. | O N | Medium | [13](screens/13-setup.png) |
| Settings: working day says "Editing … comes in phase 5" and cites "(D9)". Internal plan language. | O | Medium | [14](screens/14-settings.png) |
| Shift, rest days and holidays can't be edited from the app yet. | O | Medium | [14](screens/14-settings.png) |

## Audit log

| Problem | Who | Sev | Screen |
|---|---|---|---|
| No filters (by build, person or date); grows long fast. | O | Low | [15](screens/15-audit.png) |

## Sign-in

| Problem | Who | Sev | Screen |
|---|---|---|---|
| Clean and clear on a phone. Good. | — | — | [16](screens/16-login-phone.png) |
| Until SMTP is set up, the invite email uses Supabase's default link, which lands on a "link" error before the user can request a sign-in link. | N | Medium | — |

## TV displays (1920×1080, read from 3–5 m)

| Problem | Who | Sev | Screen |
|---|---|---|---|
| Leaderboard is "This week" and needs 3 finished parts per person, so **Monday to about Wednesday it shows nobody ranked** (today: all three "warming up"). The screen looks dead half the week. | T | High | [17](screens/17-tv-modification.png) |
| Task titles are cut ("Rear Bumper: plug p…", "Bonnet: sur…"); short tasks become unreadable boxes. | T | Medium | [17](screens/17-tv-modification.png) |
| Second line (build · stage · hours) is about 19 px monospace. Fine at 1–2 m, hard to read at 4–5 m on a 55" TV. | T | Medium | [17](screens/17-tv-modification.png) |
| Departments with no people show one sentence on a black screen. Three TVs look broken. | T O | Medium | [18](screens/18-tv-empty-department.png) |
| Everyone outside the top 3 gets a turtle and a teasing line ("The turtle won the race once… 👀") in front of the whole team. Some will read it as mockery. It also breaks the "no emoji" copy rule. | T | Medium | [17](screens/17-tv-modification.png) |
| The blocked reason is small red text under the name, cut off. | T | Low | [17](screens/17-tv-modification.png) |
| Big clock, "live · updated" dot, gold now-line and "Day 1 of 2" all read well from a distance. Good. | — | — | [17](screens/17-tv-modification.png) |

---

## What already works well

- The carbon and gold look is distinctive and consistent with the brand.
- Clear roles: Viewer banner, "Supervisor · costs hidden" in the header, and costs blocked in the database.
- The Task queue explains itself and updates the TVs within seconds.
- TV layout now fits any screen; the clock and now-line read from across the room.
- Wording on refusals (double-booking, plan clash) is specific and tells people what to do.
