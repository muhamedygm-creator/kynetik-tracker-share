/**
 * The full modelling request (AM-22), on the QC page and on Requests: the render (opens full size), every
 * measurement, the planned sub-parts, who sent it, when, and their note.
 */
import { MODEL_FIELDS, subSerial } from "@/domain/model";
import type { Part } from "@/domain/types";

export function ModelDetails({ part, renderUrl, sender, sentAt, notes }: {
  part: Part; renderUrl: string | null; sender: string; sentAt: string; notes: string;
}) {
  const m = part.model;
  const plan = part.splitPlan ?? [];
  const n = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: 4 }));
  return (
    <div className="grid gap-3 rounded-lg border border-line2 bg-panel2 p-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
      {renderUrl ? (
        <a href={renderUrl} target="_blank" rel="noreferrer" className="block" title="Open the render full size">
          {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL, short-lived */}
          <img src={renderUrl} alt={`Render of ${part.serial ?? part.name}`} className="aspect-video w-full rounded-md border border-line bg-carbon object-contain" />
          <span className="mt-1 block text-xs text-gold">Open full size</span>
        </a>
      ) : <div className="grid aspect-video place-items-center rounded-md border border-dashed border-line2 text-xs text-grey">No render</div>}
      <div className="grid content-start gap-2">
        <dl className="grid grid-cols-3 gap-x-4 gap-y-1">
          {MODEL_FIELDS.map((f) => (
            <div key={f.key}>
              <dt className="label">{f.label}</dt>
              <dd className="font-mono text-sm">{n(m?.[f.key])} {f.unit}</dd>
            </div>
          ))}
        </dl>
        {plan.length > 0 && (
          <div>
            <div className="label">Split into {plan.length} sub-parts (created on approval)</div>
            <ul className="text-sm">{plan.map((name, i) => <li key={i}><span className="font-mono text-gold">{subSerial(part.serial ?? "", i)}</span> {name}</li>)}</ul>
          </div>
        )}
        <div className="font-mono text-xs text-grey">Sent by {sender} · {sentAt}</div>
        {notes && <p className="rounded-md border border-line bg-panel px-3 py-2 text-sm">“{notes}”</p>}
      </div>
    </div>
  );
}

/** A print job's request (AM-24): the three print values, the model it prints, who sent it, when, and the note. */
export function PrintDetails({ part, model, sender, sentAt, notes }: { part: Part; model: string | null; sender: string; sentAt: string; notes: string }) {
  const pr = part.print;
  const n = (x: number | null | undefined) => (x === null || x === undefined ? "—" : x.toLocaleString("en-US", { maximumFractionDigits: 2 }));
  return (
    <div className="grid gap-2 rounded-lg border border-line2 bg-panel2 p-3">
      <dl className="grid grid-cols-3 gap-x-4">
        <div><dt className="label">Filament</dt><dd className="font-mono text-sm">{n(pr?.filamentG)} g</dd></div>
        <div><dt className="label">Printing time</dt><dd className="font-mono text-sm">{n(pr?.minutes)} min</dd></div>
        <div><dt className="label">Slice components</dt><dd className="font-mono text-sm">{n(pr?.slices)}</dd></div>
      </dl>
      <p className="text-xs text-grey">Check the slices combined as one complete printed part.{model ? ` Model: ${model}.` : ""}</p>
      <div className="font-mono text-xs text-grey">Sent by {sender} · {sentAt}</div>
      {notes && <p className="rounded-md border border-line bg-panel px-3 py-2 text-sm">“{notes}”</p>}
    </div>
  );
}
