# Design system — Kynetik Build Tracker

**Status:** applied in v1 (7 Oct 2026). Keeps the carbon & gold brand (Brand Guidelines Rev 03) and tidies everything around it so every screen looks and behaves the same. Applies to the console (laptop and iPad) and the TV. Tokens live in `app/globals.css`; components in `components/ui/`.

## 1. Principles

1. **Colour means something.** Gold = brand and "now". Green / amber / red / blue = status only. Never decorative.
2. **Do it where you see it.** Change status on the pill, plan by dragging, edit in a side drawer. No full-page dialogs for small edits.
3. **Plain words.** Dates over hours, names over codes, one short hint where a term is technical.
4. **Built for fingers.** iPad first: 44 px targets, no hover-only actions, drag works with touch.
5. **Calm by default.** One accent per screen, generous space, numbers in mono so they line up.

## 2. Colour tokens

Brand (unchanged): Black `#202020` · Carbon Grey `#353535` · Foster White `#ECECEC` · Vintage Yellow `#E9BE5F` · Olive `#808000`.

| Token | Value | Use | Change |
|---|---|---|---|
| `--carbon` | `#202020` | page ground | — |
| `--panel` / `--panel2` / `--panel3` | `#262626` / `#2c2c2c` / `#1c1c1c` | cards, raised rows, sidebar | — |
| `--line` / `--line2` | `#353535` / `#444444` | borders, dividers | — |
| `--ink` | `#ececec` | main text | — |
| `--grey` | **`#9a9a9a`** | secondary text | was `#8c8c8c` (4.5:1) → 5.0:1 on panels |
| `--grey2` | `#5f5f5f` | lines, disabled icons only. **Never text.** | rule added (2.6:1) |
| `--gold` | `#e9be5f` | accent, current, primary button | — |
| `--ok` | `#5ca96f` | done, on track | — |
| `--warn` | `#d9913f` | at risk | — |
| `--bad` | **`#e8786b`** | red text, red pills and fills (one red) | was `#c0483b` (3.3:1) → 4.9:1+ on all panels |
| `--cool` | `#7fa8c9` | planned, info | — |

**Status set (one everywhere):** Not started = grey `#5b5b5b` pill with ink text · In progress = gold · Blocked = `--bad-text` · Done = green. Pills on gold, green or red use dark text `#1e1e1e` (≥ 5:1).
**Health set (builds):** Late = red · At risk = amber · On track = green · No date set = neutral grey.
**Build colours (planner, TV):** a fixed set of six tones derived from the palette, assigned per build, never reused for status.

## 3. Type

Three faces, never mixed in one line (brand rule):

| Role | Face | Sizes (console) | Notes |
|---|---|---|---|
| Display | Broche (Michroma stand-in) | 28 page title · 20 section · 12 eyebrow | uppercase, tracking .04–.3em, never bold |
| Body | Helvetica (Arimo) | 17 large · **15 base** · 13 small | 600 for names and labels in tables |
| Data | IBM Plex Mono | 15 numbers · 13 dates · 12 meta | `tabular-nums` for columns |

TV scale (1920 × 1080 stage, scales to the screen): clock 76 · department 40 · person name 30 · task 24 · meta 16 · leaderboard name 27 · score 36.

## 4. Space, size, shape

- **Spacing:** 4-point scale: 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40. Page gutter 28 px (laptop), 20 px (iPad), 16 px (phone).
- **Targets:** 44 × 44 px minimum on touch; inline links get 44 px rows.
- **Radius:** 6 pills · 8 buttons and inputs · 12 cards · 16 panels · 22 TV cards.
- **Elevation:** borders first; one soft shadow only for things that float (drawer, menu, dragged card).
- **Layout widths:** sidebar 232 px (72 px collapsed) · content max 1440 px · drawer 380 px.

## 5. Components

| Component | What it is | States |
|---|---|---|
| Sidebar nav | Left menu with icon + label + count; collapses on iPad portrait | current (gold inset bar), hover, focus |
| Page header | Eyebrow · title · one-line status · actions on the right | — |
| Button | Primary (gold), Secondary (outline), Quiet (text). Danger only inside menus with confirmation | hover, pressed, focus, disabled, loading |
| Status pill | Tappable; opens the four statuses; saves on choose | default, open, saving, error (reverts with message) |
| Health pill | Read-only build health | Late, At risk, On track, No date set |
| Group table | Monday-style table grouped by status with a coloured group bar | row hover, selected, empty group hidden |
| Board column + card | Stage column, part card (name, avatar, status pill) | drag, drop target, blocked |
| Planner lane + block | Person row with time grid; block with resize grip | dragging, resizing, selected, overbooked |
| Drawer | Right-side panel for details and edits; Esc / Done closes | — |
| Toast + Undo | Bottom message after any change; Undo for 8 s | info, success, error |
| Empty state | One line on what will appear + one action ("Add the first part") | — |
| Help hint | "?" next to a term → one-sentence explanation | — |
| Avatar | Photo or initial; optional progress ring | — |
| Notice bar (TV) | Icon · text · countdown · rotation dots | rotating, countdown, lunch |
| Tabs / segmented | Underline tabs for views; segmented for zoom and period | selected, focus |

## 6. States and feedback

- **Focus:** 2 px gold outline, 2 px offset, on everything focusable.
- **Disabled:** 45% opacity and `not-allowed`; always with a reason on hover/tap where possible.
- **Loading:** skeleton rows/cards, never a blank page; buttons show a spinner and keep their width.
- **Saved:** toast "Saved" (or the specific change) with Undo where possible.
- **Refused:** the existing spec messages (double-booking, plan clash, "Someone else changed this — reload and try again"), shown next to the thing that failed, not only at the top.
- **Empty:** says what will appear and how to add the first one.

## 7. Wording

- Third person, state the specification, no exclamation marks. Emoji only on the TV leaderboard (Owner's decision).
- Prefer dates to hours in summaries: "forecast 14 Dec, promised 18 Nov".
- Words: **Promised** (was "committed"), **Forecast**, **Plan**, **Part** (a part in a stage), **First time right**, **Pace**. Each technical word has a "?" hint.
- Never show internal labels: phase numbers, decision codes (D9, I1), table names.

## 8. TV rules

- Readable from 4–5 m on 55": nothing below 16 px on the 1080p stage; key text 24 px+.
- Scales to fit width or height (already shipped), so it fits laptops, iPads and 4K.
- No costs, rates or salaries, enforced by the `DisplaySnapshot` allow-list.
- Gold only for "now" (current task, now-line, clock colon); status colours as in §2.

## 9. Next

After the Owner agrees this file, it becomes the "Kynetik UI rules" project skill so every build step follows it.
