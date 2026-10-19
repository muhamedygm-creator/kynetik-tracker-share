/**
 * Labour cost (spec §13). Owner-only data; these functions only run where costs are allowed.
 */
import type { CostSettings } from "./settings";

export interface PersonCost {
  baseSalary: number; // per month
  loadingPct: number | null; // null → settings default
  costClass: "production" | "admin";
}

export function rates(p: PersonCost, c: Pick<CostSettings, "defaultLoadingPct" | "workingDaysPerMonth">, dayHours: number) {
  const loading = p.loadingPct ?? c.defaultLoadingPct;
  const loadedMonthly = p.baseSalary * (1 + loading / 100);
  const dayRate = loadedMonthly / c.workingDaysPerMonth;
  const hourRate = dayHours > 0 ? dayRate / dayHours : 0;
  return { loading, loadedMonthly, dayRate, hourRate };
}

/** Admin cost class never enters build cost (overhead only). */
export const buildHourRate = (p: PersonCost, c: Pick<CostSettings, "defaultLoadingPct" | "workingDaysPerMonth">, dayHours: number) =>
  p.costClass === "admin" ? 0 : rates(p, c, dayHours).hourRate;

/** Crew totals split production vs admin (Setup → Crew). */
export function crewTotals(people: PersonCost[], c: Pick<CostSettings, "defaultLoadingPct" | "workingDaysPerMonth">, dayHours: number) {
  const sum = (cls: PersonCost["costClass"]) =>
    people.filter((p) => p.costClass === cls).reduce((s, p) => s + rates(p, c, dayHours).loadedMonthly, 0);
  return { production: sum("production"), admin: sum("admin") };
}
