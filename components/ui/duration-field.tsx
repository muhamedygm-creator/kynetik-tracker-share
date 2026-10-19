"use client";
/**
 * Task time (AM-28): an amount and a unit, Minutes, Hours or Days (a day = the working hours of one shift).
 * The value is always handed on as working hours rounded to the minute. In Hours the box also takes "2h 30m",
 * "90m", "1.5" or "2:30"; − / + step by 5 minutes, 15 minutes or half a day.
 */
import { useEffect, useState } from "react";
import { fmtHM } from "@/domain/format";
import { MAX_TASK_H, MIN_TASK_H, parseDuration, toMinute } from "@/domain/queue";

type Unit = "min" | "h" | "d";

const pickUnit = (h: number, dayH: number): Unit =>
  h < 1 ? "min" : dayH > 0 && h >= dayH && Math.abs(Math.round(h / dayH * 2) / 2 - h / dayH) < 1e-6 ? "d" : "h";

const show = (h: number, u: Unit, dayH: number) =>
  u === "min" ? String(Math.round(h * 60)) : u === "d" ? String(Math.round((h / dayH) * 100) / 100) : fmtHM(h).replace(" min", "m");

const read = (t: string, u: Unit, dayH: number): number | null => {
  if (u === "h") return parseDuration(t);
  const n = Number(t.trim().replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  const h = toMinute(u === "min" ? n / 60 : n * dayH);
  return h >= MIN_TASK_H && h <= MAX_TASK_H ? h : null;
};

export function DurationField({ hours, onChange, disabled, label = "Duration", id, dayHours = 0, name }: {
  hours: number; onChange: (h: number) => void; disabled?: boolean; label?: string; id?: string;
  /** Working hours in one day; 0 hides the Days unit. */
  dayHours?: number;
  /** Also submit the hours with a form under this name. */
  name?: string;
}) {
  const [unit, setUnit] = useState<Unit>(() => pickUnit(hours, dayHours));
  const [text, setText] = useState(show(hours, unit, dayHours));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(show(hours, unit, dayHours)); setBad(false); }, [hours, unit, dayHours]);

  const commit = (t: string) => {
    const h = read(t, unit, dayHours);
    if (h === null) { setBad(true); return; }
    setBad(false);
    setText(show(h, unit, dayHours));
    onChange(h);
  };
  const step = unit === "min" ? 5 / 60 : unit === "d" ? dayHours / 2 : 0.25;
  const nudge = (d: number) => onChange(toMinute(Math.min(MAX_TASK_H, Math.max(MIN_TASK_H, (Math.round(hours / step) + d) * step || MIN_TASK_H))));
  const box = "grid h-11 w-11 shrink-0 place-items-center rounded-md border border-line2 text-xl disabled:opacity-40";
  const hint = unit === "min" ? "Whole minutes, e.g. 45." : unit === "d" ? `Days of ${fmtHM(dayHours)}, e.g. 1 or 1.5.` : "e.g. 2h 30m, 90m or 1.5.";
  return (
    <div className="grid gap-1">
      <span className="label">{label}</span>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={box} disabled={disabled || hours <= step} onClick={() => nudge(-1)} aria-label="Less">−</button>
        <input id={id} value={text} disabled={disabled} inputMode={unit === "h" ? "text" : "decimal"} aria-label={`${label} amount`} aria-invalid={bad}
          onChange={(e) => { setText(e.target.value); setBad(false); }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commit((e.target as HTMLInputElement).value); } }}
          className={`min-h-11 w-24 rounded-md border bg-panel2 px-2 text-center font-mono text-lg text-ink outline-none focus:border-gold ${bad ? "border-bad" : "border-line2"}`} />
        <select value={unit} disabled={disabled} aria-label={`${label} unit`} onChange={(e) => setUnit(e.target.value as Unit)}
          className="min-h-11 rounded-md border border-line2 bg-panel2 px-2 text-ink">
          <option value="min">Minutes</option>
          <option value="h">Hours</option>
          {dayHours > 0 && <option value="d">Days</option>}
        </select>
        <button type="button" className={box} disabled={disabled} onClick={() => nudge(1)} aria-label="More">+</button>
        {name && <input type="hidden" name={name} value={String(hours)} />}
      </div>
      <span className={`text-xs ${bad ? "text-bad" : "text-grey"}`}>{bad ? "That time can't be read. At least 5 minutes." : `${hint} Total ${fmtHM(hours, dayHours)}.`}</span>
    </div>
  );
}
