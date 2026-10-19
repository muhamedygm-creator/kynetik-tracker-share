/**
 * Board "Attention" alerts (spec §10): red (bad) first, then amber (warn); each type can be switched off;
 * at most `maxAlerts` shown.
 */
import type { Calendar } from "./calendar";
import { describeItem, type PlanClash, type TechConflict } from "./conflicts";
import { fmtDT, fmtDate, fmtH, plural } from "./format";
import type { Forecast } from "./schedule";
import type { AlertType, HealthSettings } from "./settings";
import type { Health, Person, Project } from "./types";
import type { LocalDT } from "./time";
import { actualH, standardH } from "./work";

export interface Alert {
  type: AlertType;
  severity: "bad" | "warn";
  message: string;
  projectId?: string;
  stageId?: string;
}

export interface AlertInput {
  builds: { project: Project; forecast: Forecast; health: Health }[];
  doubleBookings: TechConflict[];
  clashes: PlanClash[];
  people: Pick<Person, "id" | "name">[];
  cal: Calendar;
  now: LocalDT;
  settings: Pick<HealthSettings, "alerts" | "maxAlerts">;
}

export function alerts(input: AlertInput): Alert[] {
  const { builds, cal, now } = input;
  const out: Alert[] = [];
  const add = (a: Alert) => out.push(a);

  for (const { project: p, forecast: f, health } of builds) {
    if (p.status === "done") continue;
    const S = p.serial;

    if (health === "late" && f.finish && f.floatH !== null && p.deliveryDate) {
      add({ type: "forecastLate", severity: "bad", projectId: p.id,
        message: `${S} — forecast ${fmtDT(f.finish)}, ${fmtH(-f.floatH)} of work past the committed ${fmtDate(p.deliveryDate)}` });
    }
    if (health === "risk" && f.floatH !== null) {
      add({ type: "atRisk", severity: "warn", projectId: p.id, message: `${S} — only ${fmtH(f.floatH)} of float left` });
    }
    if (!p.parts.length) {
      add({ type: "noParts", severity: "warn", projectId: p.id, message: `${S} — no parts list, so stages cannot be tracked by part` });
    }
    for (const t of p.tasks) {
      if (t.status === "blocked") {
        add({ type: "taskBlocked", severity: "bad", projectId: p.id, stageId: t.stageId,
          message: `${S} — task "${t.name}" is blocked: ${t.notes}` });
      }
    }
    for (const st of p.stages) {
      const items = p.work.filter((w) => w.stageId === st.id);
      const where = `${S} · ${st.name}`;
      const blocked = items.filter((w) => w.status === "blocked").length;
      if (blocked) add({ type: "partsBlocked", severity: "bad", projectId: p.id, stageId: st.id, message: `${where} — ${plural(blocked, "part")} blocked` });

      const over = items.filter((w) => w.status === "doing" && actualH(w, cal, now) > standardH(w, st)).length;
      if (over) add({ type: "overStandard", severity: "warn", projectId: p.id, stageId: st.id, message: `${where} — ${plural(over, "part")} past standard hours` });

      const stageTasks = p.tasks.filter((t) => t.stageId === st.id);
      const live = items.some((w) => w.status === "doing") || stageTasks.some((t) => t.status === "doing");
      const unassigned = items.filter((w) => !w.tech && w.status !== "done").length;
      if (live && unassigned) add({ type: "unassigned", severity: "warn", projectId: p.id, stageId: st.id, message: `${where} — ${plural(unassigned, "part")} with no technician` });

      const open = stageTasks.filter((t) => t.status !== "done").length;
      if (p.parts.length && items.length && items.every((w) => w.status === "done") && open) {
        add({ type: "partsDoneTasksOpen", severity: "warn", projectId: p.id, stageId: st.id, message: `${where} — every part is done but ${plural(open, "task")} still open` });
      }
    }
  }

  for (const c of input.doubleBookings) {
    const name = input.people.find((x) => x.id === c.tech)?.name ?? "A technician";
    const a = describeItem(c.a), b = describeItem(c.b);
    add({ type: "techDoubleBooked", severity: "bad", projectId: c.a.project.id,
      message: `${name} is double-booked — ${a.serial} · ${a.stage} · ${a.part} overlaps ${b.serial} · ${b.stage} · ${b.part}` });
  }

  for (const c of input.clashes) {
    const when = `${fmtDate(c.a.start > c.b.start ? c.a.start : c.b.start)} – ${fmtDate(c.a.end < c.b.end ? c.a.end : c.b.end)}`;
    add({ type: "planClash", severity: "warn", projectId: c.a.projectId,
      message: `${c.a.serial} — ${c.resourceName} is double-booked with ${c.b.serial} · ${c.b.label} (${when})` });
  }

  const enabled = out.filter((a) => input.settings.alerts[a.type] !== false);
  const sorted = [...enabled.filter((a) => a.severity === "bad"), ...enabled.filter((a) => a.severity === "warn")];
  return sorted.slice(0, input.settings.maxAlerts);
}
