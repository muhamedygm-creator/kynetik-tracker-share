"use client";
/**
 * Build board (docs/ROADMAP.md v1.3): one column per stage; each part sits in the first stage it hasn't
 * finished. Status changes from the pill in two taps; a tap on the card opens the details drawer.
 * New workflow (DECISIONS 2026-10-14): the pill menu of a step In Progress or waiting for QC also offers
 * "Passed QC" (after a confirmation, the part moves to the next stage) and "Failed QC" (rework, with a reason).
 */
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { setWorkItemStatus } from "@/app/(console)/builds/actions";
import { boardQc } from "@/app/(console)/builds/qc-actions";
import { MoldCount, QcDecision, SubmitQcButton } from "@/components/qc/decision";
import { openNextStage } from "@/components/qc/next-stage";
import { btn } from "@/components/ui/dialog";
import { Drawer } from "@/components/ui/drawer";
import { input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { ReworkForm, WorkItemForm, type Common, type ItemView } from "./workspace";

type Status = ItemView["status"];
export interface BoardStage { id: string; name: string; stdH: number; colour: string; station: string | null }

const ORDER: Status[] = ["doing", "blocked", "todo", "done"];
const PILL: Record<Status, { bg: string; fg: string }> = {
  todo: { bg: "var(--chip)", fg: "var(--ink)" },
  doing: { bg: "var(--gold)", fg: "var(--on-accent)" },
  blocked: { bg: "var(--bad)", fg: "var(--on-accent)" },
  done: { bg: "var(--ok)", fg: "var(--on-accent)" },
};
const QC_PILL = { bg: "var(--warn)", fg: "var(--on-accent)" };
const h = (x: number) => `${Math.round(x * 10) / 10}h`;

function StatusMenu({ item, c, onError, onQc }: { item: ItemView; c: Common; onError: (m: string | null) => void; onQc: (pass: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<React.CSSProperties>({});
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  // The board scrolls sideways, which would clip a menu inside it: place the menu on the page instead,
  // below the pill, or above it when there is no room below.
  const toggle = (btn: HTMLElement) => {
    const r = btn.getBoundingClientRect();
    const right = window.innerWidth - r.right;
    setPos(window.innerHeight - r.bottom > 340 ? { top: r.bottom + 4, right } : { bottom: window.innerHeight - r.top + 4, right });
    setOpen((o) => !o);
  };
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const shut = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("scroll", shut, true);
    return () => { document.removeEventListener("pointerdown", close); window.removeEventListener("scroll", shut, true); };
  }, [open]);
  const p = item.qcSince ? QC_PILL : PILL[item.status];
  // New workflow: Done comes from QC approval, so the menu offers no Done.
  const options = (["todo", "doing", "blocked", "done"] as Status[]).filter((s) => !c.gated || s !== "done");
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button type="button" disabled={!c.canWrite || pending} onClick={(e) => toggle(e.currentTarget)} aria-haspopup="menu" aria-expanded={open}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-[0.8rem] font-bold disabled:cursor-default"
        style={{ background: p.bg, color: p.fg, opacity: pending ? 0.6 : 1 }}>
        {pending ? "Saving…" : item.qcSince ? "Waiting for QC" : c.statusLabels[item.status].label}{c.canWrite && !pending && <span aria-hidden>▾</span>}
      </button>
      {open && (
        <div role="menu" className="fixed z-50 min-w-52 rounded-lg border border-line2 bg-panel3 p-1 shadow-xl" style={pos}>
          {options.map((s) => (
            <button key={s} role="menuitemradio" aria-checked={item.status === s}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-panel2 aria-checked:bg-panel2"
              onClick={() => {
                setOpen(false);
                if (s === item.status) return;
                start(async () => { const r = await setWorkItemStatus(item.id, item.version, c.projectId, s); onError(r.error ?? null); });
              }}>
              <span className="h-3 w-3 rounded-full" style={{ background: PILL[s].bg, border: s === "todo" ? "1px solid var(--line2)" : undefined }} />
              {c.statusLabels[s].label}
            </button>
          ))}
          {c.gated && (item.status === "doing" || item.qcSince) && (
            <>
              <div className="my-1 border-t border-line" />
              <button role="menuitem" className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-panel2" onClick={() => { setOpen(false); onQc(true); }}>
                <span className="text-ok" aria-hidden>✓</span>Passed QC → next stage
              </button>
              <button role="menuitem" className="flex min-h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm hover:bg-panel2" onClick={() => { setOpen(false); onQc(false); }}>
                <span className="text-bad" aria-hidden>✕</span>Failed QC
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PartCard({ item, c, colour, onOpen, onError, onQc }: { item: ItemView; c: Common; colour: string; onOpen: () => void; onError: (m: string | null) => void; onQc: (pass: boolean) => void }) {
  const over = item.start && item.status !== "done" && item.std > 0 && item.actual > item.std;
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpen())}
      className="grid min-w-0 cursor-pointer gap-2.5 rounded-lg border border-line2 bg-panel2 p-3 transition-colors hover:border-gold/60 focus-visible:border-gold focus-visible:outline-none">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0 font-semibold leading-snug">
          {item.partName}
          {item.component && <span className="block font-mono text-xs font-normal text-gold">{item.component}</span>}
        </span>
        {item.techName ? (
          <span title={item.techName} className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-on-colour" style={{ background: colour }}>{item.techName[0]}</span>
        ) : <span className="shrink-0 rounded-full border border-dashed border-line2 px-2 py-0.5 text-xs text-grey">Unassigned</span>}
      </div>
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-grey">
          {item.techName || "—"}
          {c.gated && !item.std
            ? <> · {item.start ? `${h(item.actual)} · ` : ""}no time set</>
            : item.start ? <span className={over ? "text-bad" : ""}> · {h(item.actual)} of {h(item.std)}</span> : <> · {h(item.std)}</>}
          {item.rework > 0 && <span className="text-warn"> · ↺{item.rework}</span>}
        </span>
        <StatusMenu item={item} c={c} onError={onError} onQc={onQc} />
      </div>
      {item.status === "blocked" && item.notes && <p className="text-xs text-bad">{item.notes}</p>}
      {item.qcSince && <p className="text-xs text-warn">Waiting for QC since {item.qcSince}{(item.attempt ?? 1) > 1 ? ` · attempt ${item.attempt}` : ""}</p>}
      {item.blocker && <p className="text-xs text-grey">{item.blocker}</p>}
    </div>
  );
}

export function StageBoard({ stages, parts, items, c, techColour, moldCounts = [] }: {
  stages: BoardStage[]; parts: { id: string; name: string }[]; items: ItemView[]; c: Common; techColour: Record<string, string>;
  /** Parts whose pre-mold passed QC and still need their mold component count (AM-06). */
  moldCounts?: { partId: string; label: string }[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [rework, setRework] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qc, setQc] = useState<{ item: ItemView; pass: boolean } | null>(null);
  // Mold production can hold several steps per part (one per mold component, amends AM-06).
  const at = new Map<string, ItemView[]>();
  for (const w of items) at.set(`${w.stageId}|${w.partId}`, [...(at.get(`${w.stageId}|${w.partId}`) ?? []), w]);
  const current = new Map<string, ItemView[]>(stages.map((s) => [s.id, []]));
  const finished: ItemView[] = [];
  for (const p of parts) {
    const own = stages.flatMap((s) => at.get(`${s.id}|${p.id}`) ?? []);
    const now = own.find((w) => w.status !== "done");
    if (now) current.get(now.stageId)!.push(...own.filter((w) => w.stageId === now.stageId && w.status !== "done"));
    else if (own.length) finished.push(own.at(-1)!);
  }
  const sorted = (xs: ItemView[]) => [...xs].sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
  const item = items.find((x) => x.id === open) ?? null;
  const colourOf = (w: ItemView) => (w.tech ? techColour[w.tech] ?? "#c9c9c9" : "#c9c9c9");

  if (!parts.length) {
    return <p className="rounded-xl border border-dashed border-line2 p-6 text-sm text-grey">This build has no parts list yet, so there is nothing to track per part. Add parts with <b className="text-ink">Parts list</b> above; each part then moves through every stage here.</p>;
  }
  return (
    <div className="grid gap-3">
      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-lg border border-bad bg-panel p-3 text-sm">
          <span className="text-bad">{error}</span>
          <button className="text-grey hover:text-ink" onClick={() => setError(null)} aria-label="Dismiss">✕</button>
        </div>
      )}
      {c.canWrite && moldCounts.length > 0 && (
        <div className="grid gap-3 rounded-lg border border-warn/60 bg-panel p-3">
          <p className="text-sm"><span className="font-semibold text-warn">Mold components needed.</span> Pre-mold passed QC; set how many components each mold needs so Mold production can start.</p>
          {moldCounts.map((m) => <MoldCount key={m.partId} partId={m.partId} label={m.label} />)}
        </div>
      )}
      <div className="grid auto-cols-[minmax(260px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-2">
        {stages.map((s) => {
          const list = sorted(current.get(s.id) ?? []);
          return (
            <section key={s.id} aria-label={s.name} className="flex min-h-[320px] flex-col gap-2.5 rounded-xl border border-line bg-panel p-3">
              <header className="border-b border-line pb-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="flex min-w-0 items-center gap-2 font-semibold"><span className="h-3 w-1.5 shrink-0 rounded-full" style={{ background: s.colour }} /><span className="truncate">{s.name}</span></h3>
                  <span className="shrink-0 font-mono text-xs text-grey">{list.length}</span>
                </div>
                <div className="mt-0.5 font-mono text-[0.7rem] text-grey">{c.gated ? "time set per step by an admin" : `${h(s.stdH)} per part`}{s.station ? ` · ${s.station}` : ""}</div>
              </header>
              {list.map((w) => <PartCard key={w.id} item={w} c={c} colour={colourOf(w)} onOpen={() => { setOpen(w.id); setRework(false); }} onError={setError} onQc={(pass) => setQc({ item: w, pass })} />)}
              {!list.length && <p className="rounded-lg border border-dashed border-line2 p-3 text-center text-xs text-grey">Parts arrive here when the stage before finishes them.</p>}
            </section>
          );
        })}
        <section aria-label="Finished" className="flex min-h-[320px] flex-col gap-2 rounded-xl border border-line bg-panel/60 p-3">
          <header className="border-b border-line pb-2">
            <div className="flex items-baseline justify-between gap-2"><h3 className="font-semibold text-ok">✓ Finished</h3><span className="font-mono text-xs text-grey">{finished.length}</span></div>
            <div className="mt-0.5 font-mono text-[0.7rem] text-grey">every stage done</div>
          </header>
          {finished.map((w) => (
            <button key={w.id} onClick={() => { setOpen(w.id); setRework(false); }} className="min-h-11 rounded-lg border border-line2 bg-panel2 px-3 text-left text-sm hover:border-gold/60">{w.partName}</button>
          ))}
          {!finished.length && <p className="p-3 text-center text-xs text-grey">Nothing finished in every stage yet.</p>}
        </section>
      </div>

      <Modal open={!!qc} onClose={() => setQc(null)} title={qc?.pass ? "Passed QC?" : "Failed QC"}>
        {qc && <BoardQc key={`${qc.item.id}:${qc.pass}`} item={qc.item} pass={qc.pass}
          next={stages[stages.findIndex((s) => s.id === qc.item.stageId) + 1]?.name ?? null} onDone={() => setQc(null)} />}
      </Modal>

      <Drawer open={!!item} onClose={() => setOpen(null)} eyebrow={item ? item.stageName : ""} title={item ? `${item.partName}${item.component ? ` · ${item.component}` : ""}` : ""}
        footer={!item || !c.canWrite || rework ? undefined
          : item.qcSince ? <QcDecision itemId={item.id} techName={item.techName} onDone={() => setOpen(null)} compact />
          : c.gated && item.status === "doing" ? <SubmitQcButton itemId={item.id} onDone={() => setOpen(null)} />
          : item.status === "done" ? <button className={btn.ghost} onClick={() => setRework(true)}>Send back for rework</button>
          : undefined}>
        {item && (rework
          ? <ReworkForm item={item} c={c} onDone={() => setOpen(null)} />
          : <WorkItemForm key={`${item.id}:${item.version}`} item={item} c={c} onDone={() => setOpen(null)} />)}
      </Drawer>
    </div>
  );
}

/** Confirm a pass (the part moves to the next stage) or record what failed (rework for the same person). */
function BoardQc({ item, pass, next, onDone }: { item: ItemView; pass: boolean; next: string | null; onDone: () => void }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const name = `${item.partName}${item.component ? ` · ${item.component}` : ""}`;
  const go = () => start(async () => { const r = await boardQc(item.id, pass, reason); if (r.error) setError(r.error); else { router.refresh(); onDone(); if (pass) openNextStage(item.id); } });
  return (
    <div className="grid gap-4">
      {pass ? (
        <p>Has <b>{name}</b> passed QC? {item.stageName} will be marked done{next ? <> and the part moves to <b>{next}</b></> : " and the part is finished"}.</p>
      ) : (
        <label className="grid gap-1">
          <span className="text-sm">What failed on <b>{name}</b> ({item.stageName})? It goes back to {item.techName || "the same person"} as rework.</span>
          <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} className={input} autoFocus />
        </label>
      )}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={btn.ghost} disabled={pending} onClick={onDone}>Cancel</button>
        <button className={pass ? btn.primary : btn.danger} disabled={pending || (!pass && !reason.trim())} onClick={go}>
          {pending ? "Saving…" : pass ? "Yes, passed" : "Send back for rework"}
        </button>
      </div>
    </div>
  );
}
