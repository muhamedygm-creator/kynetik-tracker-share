"use client";
/**
 * Board helper (v2, docs/ux/DECISIONS.md 2026-10-07): ready-made questions answered from tracker data.
 * No AI and no outside service. Actions change data only after a tap to confirm, through the normal
 * server actions (same permission checks and audit log).
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { planWorkItem } from "@/app/(console)/plan/actions";
import type { BriefPerson, BriefStep, BuildWhy, WaitingStep } from "@/domain/brief";
import { fmtDate, fmtHM } from "@/domain/format";

export interface HelperData {
  canWrite: boolean;
  today: string;
  lastDayName: string;
  people: (BriefPerson & { initials: string })[];
  departments: { id: string; key: string; name: string }[];
  waiting: WaitingStep[];
  builds: BuildWhy[];
  finished: BriefStep[];
  blocked: BriefStep[];
  inProgress: BriefStep[];
}

type Ask = { kind: "free" | "blocked" | "late" | "yesterday" | "waiting" | "help" } | { kind: "person"; id: string } | { kind: "build"; id: string };

const hm = (dt: string | null) => (dt ? dt.slice(11, 16) : "");
const when = (dt: string | null, today: string) => (!dt ? "" : dt.slice(0, 10) === today ? hm(dt) : `${fmtDate(dt)} ${hm(dt)}`);
const HEALTH: Record<string, string> = { late: "late", risk: "at risk", ok: "on track", unset: "no promised date", hold: "on hold", done: "delivered" };

const QUESTIONS: { label: string; ask: Ask }[] = [
  { label: "Who is free today?", ask: { kind: "free" } },
  { label: "What is blocked?", ask: { kind: "blocked" } },
  { label: "Why is a build late?", ask: { kind: "late" } },
  { label: "What is waiting to be planned?", ask: { kind: "waiting" } },
  { label: "What finished yesterday?", ask: { kind: "yesterday" } },
];

/** Plain-words matching: a build serial, a person's name, or a keyword. */
function parse(text: string, d: HelperData): Ask {
  const t = ` ${text.toLowerCase().replace(/[^a-z0-9\- ]/g, " ")} `;
  const build = d.builds.find((b) => t.includes(` ${b.serial.toLowerCase()} `) || t.includes(` ${b.name.toLowerCase()} `));
  if (build) return { kind: "build", id: build.projectId };
  const person = d.people.find((p) => t.includes(` ${p.name.toLowerCase()} `));
  if (person) return { kind: "person", id: person.id };
  if (/ (free|available|idle|spare|nothing to do) /.test(t)) return { kind: "free" };
  if (/ (block|blocked|stuck|waiting for) /.test(t)) return { kind: "blocked" };
  if (/ (late|risk|behind|delay|delayed|overdue) /.test(t)) return { kind: "late" };
  if (/ (finish|finished|done|yesterday|completed) /.test(t)) return { kind: "yesterday" };
  if (/ (wait|waiting|unplanned|plan|assign) /.test(t)) return { kind: "waiting" };
  return { kind: "help" };
}

function labelOf(a: Ask, d: HelperData): string {
  if (a.kind === "person") return `What is next for ${d.people.find((p) => p.id === a.id)?.name}?`;
  if (a.kind === "build") return `How is ${d.builds.find((b) => b.projectId === a.id)?.serial} doing?`;
  return QUESTIONS.find((q) => q.ask.kind === a.kind)?.label ?? "Help";
}

export function BoardHelper({ data }: { data: HelperData }) {
  const [thread, setThread] = useState<{ q: string; ask: Ask }[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const today = data.today;

  const ask = (a: Ask, q = labelOf(a, data)) => setThread((t) => [...t.slice(-5), { q, ask: a }]);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest" }); }, [thread.length]);

  return (
    <section className="grid gap-3 rounded-xl border border-line bg-panel p-4" aria-label="Helper">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="eyebrow">Helper</h2>
        <span className="rounded-md border border-line2 px-2 py-0.5 font-mono text-[0.7rem] text-grey">answers from the tracker</span>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map((q) => (
          <button key={q.label} type="button" onClick={() => ask(q.ask)}
            className="min-h-9 rounded-full border border-line2 px-3 text-sm text-ink hover:border-gold focus-visible:outline-2 focus-visible:outline-gold">
            {q.label}
          </button>
        ))}
        <select aria-label="What is next for a person" value="" onChange={(e) => e.target.value && ask({ kind: "person", id: e.target.value })}
          className="min-h-9 rounded-full border border-line2 bg-panel px-3 text-sm text-ink hover:border-gold">
          <option value="">What is next for…</option>
          {data.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>

      {thread.length > 0 && (
        <div className="grid max-h-[32rem] gap-3 overflow-y-auto pr-1">
          {thread.map((m, i) => (
            <div key={i} className="grid gap-2">
              <p className="justify-self-end rounded-xl bg-panel2 px-3 py-2 text-sm">{m.q}</p>
              <div className="rounded-xl border border-line2 px-3 py-2.5 text-sm">
                <Answer ask={m.ask} data={data} today={today} onAsk={ask} onDone={setNote} />
              </div>
            </div>
          ))}
          <div ref={end} />
        </div>
      )}

      {note && <p role="status" className="rounded-lg border border-ok px-3 py-2 text-sm text-ok">{note} The Board has been updated.</p>}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const q = text.trim(); if (!q) return; ask(parse(q, data), q); setText(""); }}>
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Ask about a person, a build or the day"
          placeholder="Ask about a person or a build"
          className="min-h-10 min-w-0 flex-1 rounded-lg border border-line2 bg-panel3 px-3 text-sm placeholder:text-grey focus:border-gold focus:outline-none" />
        <button className="display rounded-md bg-gold px-3 text-[0.65rem] tracking-[0.16em] text-on-accent">Ask</button>
      </form>
      <p className="border-l-2 border-gold pl-2.5 text-xs text-grey">Answers come straight from the tracker. A suggested change happens only after you tap Confirm, and it is recorded in the audit log.</p>
    </section>
  );
}

function Answer({ ask, data, today, onAsk, onDone }: { ask: Ask; data: HelperData; today: string; onAsk: (a: Ask) => void; onDone: (msg: string) => void }): ReactNode {
  const deptKey = (id: string | null) => data.departments.find((d) => d.id === id)?.key;
  switch (ask.kind) {
    case "free": {
      const all = data.people.filter((p) => p.freeFrom && p.freeH >= 0.5).sort((a, b) => b.freeH - a.freeH);
      if (!all.length) return <p>Everyone is planned for the rest of the day.</p>;
      const free = all.filter((p) => p.departmentId);
      const loose = all.filter((p) => !p.departmentId);
      const used = new Set<string>();
      return (
        <ul className="grid gap-2.5">
          {loose.length > 0 && (
            <li className="text-grey">Free but in no department, so no waiting work matches them: {loose.map((p) => p.name).join(", ")}. Add them to a department under Crew.</li>
          )}
          {free.map((p) => {
            const step = data.waiting.find((w) => w.stationType === deptKey(p.departmentId) && !used.has(w.workItemId));
            if (step) used.add(step.workItemId);
            return (
              <li key={p.id} className="grid gap-1">
                <span><b>{p.name}</b> is free from <span className="font-mono">{when(p.freeFrom, today)}</span> ({fmtHM(p.freeH)} today).</span>
                {step ? <PlanStep step={step} person={p} canWrite={data.canWrite} onDone={onDone} />
                  : <span className="text-grey">Nothing is waiting in {p.department}.</span>}
              </li>
            );
          })}
        </ul>
      );
    }
    case "blocked":
      if (!data.blocked.length) return <p>Nothing is blocked.</p>;
      return (
        <ul className="grid gap-1.5">
          {data.blocked.map((s, i) => (
            <li key={i}><BuildLink id={s.projectId} serial={s.serial} /> {s.stage} · {s.part}{s.person ? `, ${s.person}` : ""}. Open the build to see the note and unblock it.</li>
          ))}
        </ul>
      );
    case "late": {
      const late = data.builds.filter((b) => b.health === "late" || b.health === "risk");
      if (!late.length) return <p>No build is late or at risk. Every forecast is inside its promise.</p>;
      return <ul className="grid gap-2.5">{late.map((b) => <li key={b.projectId}><BuildFacts b={b} onAsk={onAsk} /></li>)}</ul>;
    }
    case "build": {
      const b = data.builds.find((x) => x.projectId === ask.id);
      return b ? <BuildFacts b={b} onAsk={onAsk} /> : <p>That build is finished or no longer exists.</p>;
    }
    case "person": {
      const p = data.people.find((x) => x.id === ask.id);
      if (!p) return <p>That person is no longer on the crew.</p>;
      return (
        <div className="grid gap-1.5">
          {p.next.length ? (
            <ul className="grid gap-1">
              {p.next.map((t, i) => (
                <li key={i} className="flex gap-2">
                  <span className="shrink-0 font-mono text-xs leading-5 text-grey">{t.status === "doing" ? "now" : when(t.start, today)}</span>
                  <span>{t.title}{t.serial ? <span className="text-grey"> · {t.serial}</span> : null}{t.status === "blocked" ? <span className="text-bad"> · blocked</span> : null}</span>
                </li>
              ))}
            </ul>
          ) : <p>{p.name} has nothing on the queue.</p>}
          {p.freeH > 0 && <p className="text-grey">{fmtHM(p.freeH)} free today{p.freeFrom ? ` from ${when(p.freeFrom, today)}` : ""}.</p>}
          <Link href={`/plan${deptKey(p.departmentId) ? `?dept=${deptKey(p.departmentId)}` : ""}`} className="text-gold hover:underline">Open {p.name}&apos;s queue →</Link>
        </div>
      );
    }
    case "waiting": {
      if (!data.waiting.length) return <p>Every next step is already on someone&apos;s queue.</p>;
      const groups = new Map<string, WaitingStep[]>();
      for (const w of data.waiting) groups.set(w.stationType, [...(groups.get(w.stationType) ?? []), w]);
      return (
        <ul className="grid gap-2">
          {[...groups].map(([key, list]) => {
            const d = data.departments.find((x) => x.key === key);
            return (
              <li key={key}>
                <b>{d?.name ?? key}</b>: {list.length} step{list.length === 1 ? "" : "s"}, {fmtHM(list.reduce((s, w) => s + w.hours, 0))} of work.
                <span className="text-grey"> Next: {list.slice(0, 3).map((w) => `${w.part}: ${w.stage} (${w.serial})`).join(", ")}.</span>{" "}
                <Link href={`/plan?dept=${key}`} className="text-gold hover:underline">Plan them →</Link>
              </li>
            );
          })}
        </ul>
      );
    }
    case "yesterday":
      if (!data.finished.length) return <p>No part steps were finished on {data.lastDayName}.</p>;
      return (
        <ul className="grid gap-1">
          {data.finished.map((s, i) => (
            <li key={i}><BuildLink id={s.projectId} serial={s.serial} /> {s.stage} · {s.part}{s.person ? `, ${s.person}` : ""} <span className="font-mono text-xs text-grey">{hm(s.at)}</span></li>
          ))}
        </ul>
      );
    default:
      return (
        <div className="grid gap-1.5">
          <p>The helper answers from the tracker. Try one of these, or type a person&apos;s name or a build serial.</p>
          <div className="flex flex-wrap gap-1.5">
            {QUESTIONS.map((q) => <button key={q.label} type="button" onClick={() => onAsk(q.ask)} className="rounded-full border border-line2 px-2.5 py-1 text-xs hover:border-gold">{q.label}</button>)}
          </div>
        </div>
      );
  }
}

function BuildLink({ id, serial }: { id: string; serial: string }) {
  return <Link href={`/builds/${id}`} className="rounded-md border border-gold px-1.5 font-mono text-xs text-gold hover:bg-gold hover:text-on-accent">{serial}</Link>;
}

function BuildFacts({ b, onAsk }: { b: BuildWhy; onAsk: (a: Ask) => void }) {
  const parts = [
    b.inProgress ? `${b.inProgress} in progress${b.stagesNow.length ? ` (${b.stagesNow.join(", ")})` : ""}` : null,
    b.blocked ? `${b.blocked} blocked` : null,
    b.waiting ? `${b.waiting} on nobody's queue` : null,
  ].filter(Boolean);
  const tip = b.blocked ? "Clearing the blocked step comes first." : b.waiting ? "Planning the waiting steps is the quickest gain." : b.inProgress ? "The work is moving; check the steps in progress run to plan." : "";
  return (
    <div className="grid gap-1">
      <p>
        <BuildLink id={b.projectId} serial={b.serial} /> {b.name}: {HEALTH[b.health] ?? b.health}.
        {b.forecast ? <> Forecast <span className="font-mono">{fmtDate(b.forecast)}</span></> : " No forecast yet"}
        {b.promised ? <>, promised <span className="font-mono">{fmtDate(b.promised)}</span>.</> : "."}
      </p>
      <p className="text-grey">
        {b.stepsLeft || !b.tasksLeft
          ? `${b.stepsLeft} part step${b.stepsLeft === 1 ? "" : "s"} left${parts.length ? `: ${parts.join(", ")}` : ""}. ${tip}`
          : `No parts list; ${b.tasksLeft} plan task${b.tasksLeft === 1 ? "" : "s"} left. Open the build to update their progress.`}
      </p>
      {b.blocked > 0 && <button type="button" onClick={() => onAsk({ kind: "blocked" })} className="justify-self-start text-gold hover:underline">What is blocked? →</button>}
    </div>
  );
}

function PlanStep({ step, person, canWrite, onDone }: { step: WaitingStep; person: BriefPerson; canWrite: boolean; onDone: (msg: string) => void }) {
  const [state, setState] = useState<"idle" | "confirm" | "done">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const label = `${step.part}: ${step.stage} (${step.serial}, ${fmtHM(step.hours)})`;
  if (!canWrite) return <span className="text-grey">Next waiting step in the department: {label}.</span>;
  if (state === "done") return <span className="text-ok">{msg}</span>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      {state === "idle" ? (
        <button type="button" onClick={() => setState("confirm")} className="rounded-md border border-gold px-2.5 py-1 text-left text-sm text-gold hover:bg-gold hover:text-on-accent">
          Plan {label} for {person.name} at {hm(person.freeFrom)}
        </button>
      ) : (
        <>
          <span className="text-sm">Add it to {person.name}&apos;s queue?</span>
          <button type="button" disabled={pending} onClick={() => start(async () => {
            const r = await planWorkItem(step.workItemId, person.id, person.freeFrom!);
            if (r.error) { setMsg(r.error); setState("idle"); return; }
            setMsg(r.ok ?? "Planned."); setState("done"); onDone(r.ok ?? "Planned."); router.refresh();
          })} className="display rounded-md bg-gold px-3 py-1.5 text-[0.65rem] tracking-[0.16em] text-on-accent disabled:opacity-50">{pending ? "Saving…" : "Confirm"}</button>
          <button type="button" onClick={() => setState("idle")} className="text-sm text-grey hover:text-ink">Cancel</button>
        </>
      )}
      {msg && state === "idle" && <span role="alert" className="text-sm text-bad">{msg}</span>}
    </span>
  );
}
