# Amend: Light / Dark / System Theme Switch

**Date:** 17 Oct 2026 · **Owner:** Joey · **Status:** Ready for the builder

> **Paste to Claude Code:** "Read `THEME_SWITCH_PROMPT.md` and build only this. Change nothing else. Show me Light and Dark screenshots on a preview link, and deploy only after I say 'yes'."

---

## What to build

- **Where:** in the top navigation bar, near the user menu, add a small **theme button** (sun / moon / monitor icon). It opens three choices:
  - **☀️ Light**
  - **🌙 Dark**
  - **🖥️ System**: follows the computer or phone setting, and switches automatically if that setting changes (e.g. at sunset)
- **Default:** **Dark**, the current Kynetik look, until the person picks something else.
- **Remembered per person:** save the choice to their profile, so it follows them across devices, and also in the browser so the page opens in the right theme **without a white flash** on load.
- **Design a proper light theme**, not just swapped colours:
  - light warm-grey background, white cards, dark text
  - a **darker gold** for accents so it stays readable on white
  - status colours (green, red, orange, blue) still clear in both themes
  - charts, tables, pop-ups, date picker, badges and the leaderboard pop-up all work in both
- **Where it applies:** the admin app, Reports and the **Floor Station** (iPad).
- **Where it doesn't:** the **TV displays always stay dark**, because they're easier to read from a distance on the shop floor. **PDF exports always use a clean light print style**, whatever the screen theme.
- **Check:** text contrast meets accessibility guidelines (WCAG AA) in both themes. Show me screenshots of the main pages in Light and Dark.

## Done when
- [ ] The theme button is in the nav bar with Light / Dark / System. System follows the device and updates live.
- [ ] The choice is remembered per person across devices, with no white flash on load.
- [ ] The light theme is fully designed (readable gold, status colours, charts, pop-ups, tables) and passes WCAG AA contrast.
- [ ] It works in the admin app, Reports and the Floor Station.
- [ ] TV displays stay dark, and PDFs keep the light print style.
- [ ] Nothing else in the app changed.
