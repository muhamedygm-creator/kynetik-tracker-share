"use client";
/**
 * One Modelling step on My models (amends AM-05, AM-23; DECISIONS 2026-10-14): measurements and render are open
 * from the start (the first save or upload starts the clock), optional sub-parts (planned here, created when QC
 * approves the model), then Submit for QC (saves and sends in one tap) with an optional note (QC page and Requests).
 */
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { saveModel, saveSplit, submitModel, uploadRender } from "@/app/(console)/models/actions";
import { btn } from "@/components/ui/dialog";
import { input } from "@/components/ui/form";
import { MODEL_FIELDS, defaultSubNames, modelProblems, parseMeasure, splitProblem, subSerial, type ModelKey } from "@/domain/model";

export interface ModelStep {
  itemId: string;
  serial: string;
  partName: string;
  projectSerial: string;
  projectId: string;
  techName: string;
  status: "todo" | "doing" | "blocked" | "done";
  qcSince: string | null;
  blocker: string | null;
  lastReject: string | null;
  attempt: number;
  values: Record<ModelKey, string>;
  renderUrl: string | null;
  hasRender: boolean;
  /** AM-23: planned sub-part names, when the plan was applied, whether this part can be split, and the sub-parts made. */
  splitPlan: string[] | null;
  splitAt: string | null;
  canSplit: boolean;
  subParts: { serial: string; name: string }[];
}

/** Shrink to at most 1600 px on the long side, JPEG (renders stay readable, uploads stay small). */
async function shrink(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * k);
  canvas.height = Math.round(img.height * k);
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that image."))), "image/jpeg", 0.85));
}

export function ModelCard({ s, canAct, admin = false }: { s: ModelStep; canAct: boolean; admin?: boolean }) {
  const router = useRouter();
  const [v, setV] = useState(s.values);
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const file = useRef<HTMLInputElement>(null);
  const problems = modelProblems(v);
  const complete = MODEL_FIELDS.every((f) => typeof parseMeasure(v[f.key]) === "number") && s.hasRender;
  const dirty = MODEL_FIELDS.some((f) => v[f.key] !== s.values[f.key]);
  const editable = canAct && s.status !== "done" && !s.qcSince && !s.blocker;
  // Owner and Supervisors can still correct a model waiting for QC or approved (DECISIONS 2026-10-15).
  const fixing = canAct && admin && !s.blocker && (s.status === "done" || !!s.qcSince);
  const typing = editable || fixing;
  const act = (fn: () => Promise<{ ok?: string; error?: string }>) => start(async () => { const r = await fn(); setMsg(r); if (!r.error) router.refresh(); });
  const [asking, setAsking] = useState(false);
  const [notes, setNotes] = useState("");

  return (
    <article className="grid gap-4 rounded-xl border border-line bg-panel p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2"><span className="font-mono text-gold">{s.serial}</span><span className="font-semibold">{s.partName}</span></div>
          <div className="text-sm text-grey">{s.projectSerial} · Modelling · {s.techName || "no modeller assigned"}{s.attempt > 1 ? ` · attempt ${s.attempt}` : ""}</div>
        </div>
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${s.qcSince ? "bg-warn text-on-accent" : s.status === "done" ? "bg-ok text-on-accent" : s.status === "doing" ? "bg-gold text-on-accent" : "border border-line2 text-grey"}`}>
          {s.qcSince ? "Waiting for QC" : s.status === "done" ? "Approved" : s.status === "doing" ? "In progress" : s.status === "blocked" ? "Blocked" : "Not started"}
        </span>
      </header>
      {s.lastReject && s.status === "doing" && !s.qcSince && <p className="rounded-md border border-bad/50 px-3 py-2 text-sm text-bad">Sent back by QC: {s.lastReject}</p>}
      {s.blocker && <p className="text-sm text-grey">{s.blocker}</p>}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {MODEL_FIELDS.map((f) => (
            <label key={f.key} className="grid gap-1">
              <span className="label">{f.label} ({f.unit})</span>
              <input value={v[f.key]} onChange={(e) => setV({ ...v, [f.key]: e.target.value })} inputMode="decimal" disabled={!typing}
                className={`${input} font-mono ${problems[f.key] ? "border-bad" : ""}`} aria-invalid={!!problems[f.key]} />
              {problems[f.key] && <span className="text-xs text-bad">{problems[f.key]}</span>}
            </label>
          ))}
        </div>
        <div className="grid content-start gap-2">
          <span className="label">Render</span>
          {s.renderUrl
            // eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, short-lived
            ? <a href={s.renderUrl} target="_blank" rel="noreferrer"><img src={s.renderUrl} alt={`Render of ${s.serial}`} className="aspect-video w-full rounded-md border border-line object-contain bg-panel2" /></a>
            : <div className="grid aspect-video place-items-center rounded-md border border-dashed border-line2 text-xs text-grey">{s.hasRender ? "Render saved" : "No render yet"}</div>}
          {typing && (
            <>
              <input ref={file} type="file" accept="image/*" className="sr-only" onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (!f) return;
                act(async () => { const fd = new FormData(); fd.set("render", new File([await shrink(f)], "render.jpg", { type: "image/jpeg" })); return uploadRender(s.itemId, fd); });
              }} />
              <button type="button" className={btn.ghost} disabled={pending} onClick={() => file.current?.click()}>{s.hasRender ? "Replace render" : "Upload render"}</button>
              <span className="text-xs text-grey">JPEG, PNG or WebP. Resized before upload.</span>
            </>
          )}
        </div>
      </div>

      <SubParts s={s} editable={editable} pending={pending} act={act} />

      {asking && editable && (
        <label className="grid gap-1 rounded-lg border border-line2 bg-panel2 p-3">
          <span className="text-sm">Note for QC (optional)</span>
          <textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} className={input} autoFocus
            placeholder="Anything the admin should know when checking the model." />
        </label>
      )}

      {fixing && <p className="text-xs text-grey">Admin correction: every value and the render must stay filled. Changes are kept in the Audit log.</p>}

      {canAct && (
        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
          {msg.error && <span role="alert" className="mr-auto text-sm text-bad">{msg.error}</span>}
          {msg.ok && !msg.error && <span className="mr-auto text-sm text-ok">{msg.ok}</span>}
          {fixing && <button className={btn.ghost} disabled={pending || !dirty || !!Object.keys(problems).length || !complete} onClick={() => act(() => saveModel(s.itemId, v))}>Save correction</button>}
          {editable && asking && <button className={btn.ghost} disabled={pending} onClick={() => setAsking(false)}>Cancel</button>}
          {editable && (
            <button className={btn.primary} disabled={pending || !complete || !!Object.keys(problems).length} title={!complete ? "Every measurement and the render are needed first." : undefined}
              onClick={() => (asking ? act(async () => {
                // One tap: the measurements are saved (which starts the step) and sent to QC.
                if (dirty || s.status !== "doing") { const r0 = await saveModel(s.itemId, v); if (r0.error) return r0; }
                const r = await submitModel(s.itemId, notes); if (!r.error) setAsking(false); return r;
              }) : setAsking(true))}>
              {asking ? (pending ? "Sending…" : "Send to QC") : "Submit for QC"}
            </button>
          )}
        </footer>
      )}
    </article>
  );
}

/** Sub-parts (AM-23): plan how many pieces and their names; the serials come when QC approves the model. */
function SubParts({ s, editable, pending, act }: {
  s: ModelStep; editable: boolean; pending: boolean; act: (fn: () => Promise<{ ok?: string; error?: string }>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [names, setNames] = useState<string[]>(s.splitPlan ?? defaultSubNames(s.partName, 2));
  if (s.splitAt) {
    return (
      <section className="grid gap-2 rounded-lg border border-ok/40 p-3">
        <span className="label">Split into {s.subParts.length} sub-parts · approved</span>
        <ul className="grid gap-1 text-sm">{s.subParts.map((x) => <li key={x.serial}><span className="font-mono text-gold">{x.serial}</span> {x.name}</li>)}</ul>
      </section>
    );
  }
  if (!s.canSplit) return null;
  const setCount = (n: number) => {
    const k = Math.max(2, Math.min(26, Math.round(n) || 2));
    const auto = defaultSubNames(s.partName, k);
    // Keep names the modeller typed; renumber the automatic ones.
    setNames(auto.map((a, i) => (names[i] && names[i] !== defaultSubNames(s.partName, names.length)[i] ? names[i] : a)));
  };
  const problem = splitProblem(names);
  if (editing) {
    return (
      <section className="grid gap-3 rounded-lg border border-gold/50 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1">
            <span className="label">Number of sub-parts</span>
            <input type="number" min={2} max={26} value={names.length} onChange={(e) => setCount(Number(e.target.value))} className={`${input} !w-24 font-mono`} />
          </label>
          <p className="max-w-[48ch] text-xs text-grey">Named automatically; rename any of them. Material and finish are copied from {s.serial}. The model data stays on {s.serial}.</p>
        </div>
        <ul className="grid gap-2">
          {names.map((n, i) => (
            <li key={i} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-2">
              <span className="font-mono text-sm text-gold">{subSerial(s.serial, i)}</span>
              <input value={n} onChange={(e) => setNames(names.map((x, k) => (k === i ? e.target.value : x)))} className={input} aria-label={`Sub-part ${i + 1} name`} />
            </li>
          ))}
        </ul>
        {problem && <p role="alert" className="text-sm text-bad">{problem}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <button className={btn.ghost} disabled={pending} onClick={() => { setEditing(false); setNames(s.splitPlan ?? defaultSubNames(s.partName, 2)); }}>Cancel</button>
          <button className={btn.primary} disabled={pending || !!problem} onClick={() => act(async () => { const r = await saveSplit(s.itemId, names); if (!r.error) setEditing(false); return r; })}>Save sub-parts</button>
        </div>
      </section>
    );
  }
  if (s.splitPlan?.length) {
    return (
      <section className="grid gap-2 rounded-lg border border-line2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label">Sub-parts · created when QC approves the model</span>
          {editable && (
            <span className="flex gap-2">
              <button className={btn.ghost} disabled={pending} onClick={() => setEditing(true)}>Change</button>
              <button className={btn.ghost} disabled={pending} onClick={() => act(() => saveSplit(s.itemId, []))}>Remove split</button>
            </span>
          )}
        </div>
        <ul className="grid gap-1 text-sm">{s.splitPlan.map((n, i) => <li key={i}><span className="font-mono text-gold">{subSerial(s.serial, i)}</span> {n}</li>)}</ul>
      </section>
    );
  }
  return editable ? (
    <div className="flex flex-wrap items-center gap-3">
      <button className={btn.ghost} disabled={pending} onClick={() => setEditing(true)}>+ Add sub-parts</button>
      <span className="text-xs text-grey">If this part is made in several pieces. Optional.</span>
    </div>
  ) : null;
}
