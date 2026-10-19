"use client";
import { useState, useTransition } from "react";
import { saveGamification } from "@/app/(console)/settings/actions";
import { btn } from "@/components/ui/dialog";
import { Field, input } from "@/components/ui/form";
import type { GamificationSettings } from "@/domain/settings";

const RULE: Record<string, string> = {
  gold: "Rank 1", silver: "Rank 2", bronze: "Rank 3",
  streak: "Working days in a row with a task finished on time",
  sharpshooter: "First-time-right 100% this period",
  speedster: "Best pace in the department",
  rocket: "Most tasks finished this week",
  climber: "Most places gained since last period (minimum)",
  warmingUp: "Everyone outside the top 3, with a friendly line",
};

export function GamificationEditor({ value, canWrite }: { value: GamificationSettings; canWrite: boolean }) {
  const [g, setG] = useState(value);
  const [lines, setLines] = useState(value.warmingUp.join("\n"));
  const [quotes, setQuotes] = useState(value.quotes.join("\n"));
  const setBanner = (k: keyof GamificationSettings["banner"], v: number) => setG((x) => ({ ...x, banner: { ...x.banner, [k]: v } }));
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const setBadge = (i: number, patch: Partial<GamificationSettings["badges"][number]>) =>
    setG((x) => ({ ...x, badges: x.badges.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  return (
    <div className="grid gap-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead><tr className="label border-b border-line text-left"><th className="p-2">On</th><th className="p-2">Emoji</th><th className="p-2">Name</th><th className="p-2">Rule</th><th className="p-2">Value</th></tr></thead>
          <tbody>
            {g.badges.map((b, i) => (
              <tr key={b.key} className="border-b border-line last:border-0">
                <td className="p-2"><input type="checkbox" checked={b.on} disabled={!canWrite} onChange={(e) => setBadge(i, { on: e.target.checked })} aria-label={`${b.name} on`} /></td>
                <td className="p-2"><input value={b.emoji} disabled={!canWrite} onChange={(e) => setBadge(i, { emoji: e.target.value })} className={`${input} !w-16 text-center text-lg`} aria-label="Emoji" /></td>
                <td className="p-2"><input value={b.name} disabled={!canWrite} onChange={(e) => setBadge(i, { name: e.target.value })} className={input} aria-label="Name" /></td>
                <td className="p-2 text-grey">{RULE[b.key]}</td>
                <td className="p-2">{b.param !== undefined && (
                  <input type="number" min={1} value={b.param} disabled={!canWrite} onChange={(e) => setBadge(i, { param: Number(e.target.value) })} className={`${input} !w-20 font-mono`} aria-label="Value" />
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Field label="Warming-up lines, one per line" hint="Shown under people outside the top 3, rotating daily. Keep them kind.">
        <textarea rows={5} value={lines} disabled={!canWrite} onChange={(e) => setLines(e.target.value)} className={input} />
      </Field>
      <Field label="TV banner quotes, one per line" hint="Rotated into the TV banner now and then. The lunch and end-of-shift countdowns keep most of the time.">
        <textarea rows={5} value={quotes} disabled={!canWrite} onChange={(e) => setQuotes(e.target.value)} className={input} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Quote every (seconds)" hint="0 = no quotes"><input type="number" min={0} value={g.banner.quoteEverySec} disabled={!canWrite} onChange={(e) => setBanner("quoteEverySec", Number(e.target.value))} className={`${input} font-mono`} /></Field>
        <Field label="Quote shows for (seconds)"><input type="number" min={0} value={g.banner.quoteShowSec} disabled={!canWrite} onChange={(e) => setBanner("quoteShowSec", Number(e.target.value))} className={`${input} font-mono`} /></Field>
        <Field label="End-of-shift countdown (minutes)"><input type="number" min={0} value={g.banner.wrapUpMins} disabled={!canWrite} onChange={(e) => setBanner("wrapUpMins", Number(e.target.value))} className={`${input} font-mono`} /></Field>
        <Field label="“Back to it” after lunch (minutes)"><input type="number" min={0} value={g.banner.backToItMins} disabled={!canWrite} onChange={(e) => setBanner("backToItMins", Number(e.target.value))} className={`${input} font-mono`} /></Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Leaderboard period">
          <select value={g.defaultPeriod} disabled={!canWrite} onChange={(e) => setG({ ...g, defaultPeriod: e.target.value as GamificationSettings["defaultPeriod"] })} className={input}>
            <option value="7d">Last 7 days (rolling)</option><option value="today">Today</option><option value="week">This week (resets Monday)</option><option value="month">This month</option>
          </select>
        </Field>
        <Field label="Show only the top" hint="0 = everyone"><input type="number" min={0} value={g.topN} disabled={!canWrite} onChange={(e) => setG({ ...g, topN: Number(e.target.value) })} className={`${input} font-mono`} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={g.hideBottom} disabled={!canWrite} onChange={(e) => setG({ ...g, hideBottom: e.target.checked })} /> Hide the bottom half</label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={g.confetti} disabled={!canWrite} onChange={(e) => setG({ ...g, confetti: e.target.checked })} /> Confetti on the TVs</label>
      </div>
      {canWrite && (
        <div className="flex items-center gap-3">
          <button className={btn.primary} disabled={pending} onClick={() => start(async () => {
            setMsg(await saveGamification(JSON.stringify({ ...g, warmingUp: lines.split("\n").map((l) => l.trim()).filter(Boolean), quotes: quotes.split("\n").map((l) => l.trim()).filter(Boolean) })));
          })}>{pending ? "Saving…" : "Save gamification"}</button>
          {msg.ok && <span className="text-sm text-ok">{msg.ok}</span>}
          {msg.error && <span role="alert" className="text-sm text-bad">{msg.error}</span>}
        </div>
      )}
    </div>
  );
}
