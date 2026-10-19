# Amend: Simpler Reports Filter Bar (AM-30)

**Date:** 17 Oct 2026 · **Owner:** Joey · **Status:** Ready for the builder

This file holds only this one change. Build just this, and don't change anything else.

## AM-30: Simpler Reports filter bar

- **Type:** UI/UX · **Priority:** Must · **Where:** Reports (all 4 tabs) and the Crew performance export. Refines AM-26 and AM-27.
- **What happens now:** a "period" dropdown plus Month, From and To boxes all show at once, with a hint explaining which one counts. There are 6 filter boxes, and nothing updates until you press Apply. It's confusing.
- **What I want:**

```
 Period:  [Today] [This week] [This month●] [Last month] [Custom ▾]        Showing 1–31 Oct 2026 · 42 tasks
 [Employee: All ▾] [Department: All ▾]  [+ More filters]
 Active:  (Francis ✕) (Paint ✕)   Clear all                                 [Export CSV] [Export PDF]
```

1. **One date control:** a row of quick buttons, Today · This week · This month · Last month · Custom. Only one can be selected.
   - Custom opens one calendar pop-up: pick a start and end day, or tap a month name to select that whole month. It replaces the separate Month, From and To boxes.
   - Remove the "Month is used with…" hint, since there's nothing left to explain.
2. **Show the result in words:** e.g. "Showing 1–30 Sep 2026 · Francis · 18 tasks", so it's always clear what's selected.
3. **Fewer boxes at first:** show only Employee and Department.
   - Employee allows picking several people, with search and Select all.
   - Put Project, Part, Stage and Status behind "+ More filters".
4. **Active filters as chips:** each one shows as a small chip with an ✕ to remove it, plus "Clear all".
5. **No Apply button:** results update as soon as a filter changes, with a short loading indicator.
6. **Export uses what's on screen:** Export CSV and Export PDF always use the current filters, and the file name includes the range.
7. **Remember the last choice:** the default is This month, and the last used filters are remembered per person.
8. **Works on iPad and phone:** on narrow screens the filters fold into one "Filters" button that opens a panel.

- **Done when:** someone can pick "Last month + Francis" in 2 taps and see the results without pressing Apply, and the screen never shows Month, From and To at the same time.

## Prompt for the builder

Read this file and redesign the Reports filter bar exactly as described. Apply the same filter bar to the Crew performance export. Change nothing else. Show me a preview with before/after screenshots, and deploy only after I say "yes".
