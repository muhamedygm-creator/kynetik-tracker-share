import "server-only";
import { alerts } from "@/domain/alerts";
import { allItems, planClashes, techDoubleBookings } from "@/domain/conflicts";
import type { World } from "./world";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "8h a day, Sunday off" — from the working calendar settings. */
export function calendarSummary(w: World) {
  const rest = w.settings.calendar.restDays.map((d) => DAY_NAMES[d]);
  const off = rest.length ? `${rest.join(" & ")} off` : "no rest day";
  const hol = w.settings.holidays.length ? ` · ${w.settings.holidays.length} public holiday(s)` : "";
  return `${w.cal.dayHours}h a day, ${off}${hol}`;
}

export function boardAlerts(w: World) {
  const projects = w.builds.map((b) => b.project);
  const mode = w.settings.booking.techMode;
  const doubleBookings = techDoubleBookings(allItems(projects), mode, w.now);
  return {
    doubleBookings,
    alerts: alerts({
      builds: w.builds.map((b) => ({ project: b.project, forecast: b.forecast, health: b.health })),
      doubleBookings,
      clashes: planClashes(projects, w.stations, w.people, mode),
      people: w.people, cal: w.cal, now: w.now, settings: w.settings.health,
    }),
  };
}
