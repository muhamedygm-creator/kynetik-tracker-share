"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { removePhoto, savePerson, setPersonStatus, uploadPhoto } from "@/app/(console)/setup/crew/actions";
import { AddQueueTask } from "@/components/queue/board";
import { btn } from "@/components/ui/dialog";
import { ActionForm, Field, input, type Result } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";

export interface CrewRow {
  id: string; version: number; name: string; initials: string; photoUrl: string | null; departmentId: string | null;
  departmentName: string | null; colour: string; costClass: "production" | "admin";
  /** the stored Active switch */
  active: boolean;
  queued: number;
  /** part steps not done that are assigned to the person */
  openSteps: number;
  employment: "full_time" | "project_based"; contractFrom: string | null; contractTo: string | null; contractEnded: boolean;
  phone: string; skills: string; notes: string; projectIds: string[];
  /** the person's numbers over the default scoring period */
  stats: { done: number; onTimePct: number | null; ftrPct: number | null; score: number | null; inWork: number };
  /** salary: Owner and Supervisors (AM-20); the rates: Owner only */
  cost?: { baseSalary: number; loadingPct: number | null; hourRate: number | null; dayRate: number | null; loadedMonthly: number | null };
}

const TAG = { full_time: "Full time", project_based: "Project based" } as const;
type Filter = "all" | "full_time" | "project_based" | "unassigned" | "ended";
const FILTERS: Record<Filter, { label: string; test: (r: CrewRow) => boolean }> = {
  all: { label: "Everyone", test: () => true },
  full_time: { label: "Full time", test: (r) => r.employment === "full_time" },
  project_based: { label: "Project based", test: (r) => r.employment === "project_based" },
  unassigned: { label: "No department", test: (r) => r.active && !r.contractEnded && !r.departmentId },
  ended: { label: "Contract ended", test: (r) => r.contractEnded },
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmt = (d: string) => `${+d.slice(8, 10)} ${MONTHS[+d.slice(5, 7) - 1]}`;
const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x)}%`);
function Stat({ k, v }: { k: string; v: string }) {
  return <div><dt className="text-[0.7rem] text-grey">{k}</dt><dd className="font-mono text-base">{v}</dd></div>;
}

/** Square-crop in the browser and shrink to a 512 px JPEG (well under 1 MB). */
async function squareJpeg(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const side = Math.min(img.width, img.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  canvas.getContext("2d")!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 512, 512);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't read that image."))), "image/jpeg", 0.85));
}

function Avatar({ r, size = 40 }: { r: Pick<CrewRow, "initials" | "photoUrl" | "colour">; size?: number }) {
  return r.photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={r.photoUrl} alt="" width={size} height={size} className="rounded-full object-cover" />
  ) : (
    <span className="inline-flex items-center justify-center rounded-full font-bold text-on-colour" style={{ width: size, height: size, background: r.colour }}>{r.initials}</span>
  );
}

function PhotoControl({ r, onMsg }: { r: CrewRow; onMsg: (m: { ok?: string; error?: string }) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <input ref={file} type="file" accept="image/*" className="hidden" onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        start(async () => {
          try {
            const blob = await squareJpeg(f);
            const fd = new FormData();
            fd.set("photo", new File([blob], "photo.jpg", { type: "image/jpeg" }));
            onMsg(await uploadPhoto(r.id, r.version, fd));
          } catch (err) {
            onMsg({ error: (err as Error).message });
          }
        });
      }} />
      <button className={`${btn.link} text-xs`} disabled={pending} onClick={() => file.current?.click()}>{pending ? "Uploading…" : r.photoUrl ? "Change photo" : "Add photo"}</button>
      {r.photoUrl && <button className="text-xs text-grey hover:text-bad" disabled={pending} onClick={() => start(async () => onMsg(await removePhoto(r.id, r.version)))}>Remove</button>}
    </span>
  );
}

function EmploymentFields({ r, builds }: { r: CrewRow | null; builds: { id: string; label: string }[] }) {
  const [kind, setKind] = useState(r?.employment ?? "full_time");
  const [projects, setProjects] = useState<string[]>(r?.projectIds ?? []);
  return (
    <div className="grid gap-3 rounded-md border border-line2 p-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Work type">
        {(["full_time", "project_based"] as const).map((k) => (
          <label key={k} className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm ${kind === k ? "border-gold bg-gold/10" : "border-line2 text-grey"}`}>
            <input type="radio" name="employment" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />{TAG[k]}
          </label>
        ))}
      </div>
      {kind === "project_based" && <>
        <div className="grid grid-cols-2 gap-3">
          <Field label="From"><input type="date" name="contractFrom" defaultValue={r?.contractFrom ?? ""} className={`${input} font-mono`} /></Field>
          <Field label="Until" hint="After this date they leave the planner and the TVs."><input type="date" name="contractTo" defaultValue={r?.contractTo ?? ""} className={`${input} font-mono`} /></Field>
        </div>
        <input type="hidden" name="projectIds" value={projects.join(",")} />
        <div className="grid gap-1.5"><span className="label">Builds</span>
          <div className="flex flex-wrap gap-1.5">
            {builds.map((b) => {
              const on = projects.includes(b.id);
              return <button type="button" key={b.id} onClick={() => setProjects((x) => (on ? x.filter((y) => y !== b.id) : [...x, b.id]))}
                className={`min-h-9 rounded-full border px-3 text-sm ${on ? "border-gold bg-gold/10 text-ink" : "border-line2 text-grey hover:text-ink"}`}>{b.label}</button>;
            })}
          </div>
        </div>
      </>}
    </div>
  );
}

function PersonForm({ r, departments, builds, seesSalary, onDone }: { r: CrewRow | null; departments: { id: string; name: string; emoji: string }[]; builds: { id: string; label: string }[]; seesSalary: boolean; onDone: () => void }) {
  const action = async (prev: Result, f: FormData) => {
    const res = await savePerson(prev, f);
    if (res.ok) onDone();
    return res;
  };
  return (
    <ActionForm action={action} keepOpen submit={r ? "Save" : "Add crew member"}>
      {r && <input type="hidden" name="id" value={r.id} />}
      {r && <input type="hidden" name="version" value={r.version} />}
      <Field label="Name"><input name="name" defaultValue={r?.name} className={input} autoFocus /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Department">
          <select name="departmentId" defaultValue={r?.departmentId ?? ""} className={input}>
            <option value="">— unassigned —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
          </select>
        </Field>
        <Field label="Cost class" hint="Admin never enters build cost.">
          <select name="costClass" defaultValue={r?.costClass ?? "production"} className={input}><option value="production">production</option><option value="admin">admin</option></select>
        </Field>
      </div>
      <EmploymentFields r={r} builds={builds} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Phone"><input name="phone" defaultValue={r?.phone} inputMode="tel" className={`${input} font-mono`} /></Field>
        <Field label="Skills" hint="Comma separated, e.g. Layup, Trim, Sanding"><input name="skills" defaultValue={r?.skills} className={input} /></Field>
      </div>
      <Field label="Notes"><textarea name="notes" rows={2} defaultValue={r?.notes} className={input} /></Field>
      {seesSalary && (
        <div className="grid grid-cols-2 gap-3 rounded-md border border-gold/40 p-3">
          <p className="label col-span-2 !text-gold">Salary · Owner and Supervisors only</p>
          <Field label="Base salary / month"><input type="number" name="baseSalary" min={0} step={50} defaultValue={r?.cost?.baseSalary ?? 0} className={`${input} font-mono`} /></Field>
          <Field label="Loading %" hint="Empty = the default"><input type="number" name="loadingPct" min={0} step={1} defaultValue={r?.cost?.loadingPct ?? ""} className={`${input} font-mono`} /></Field>
        </div>
      )}
    </ActionForm>
  );
}

export function CrewTable({ rows, deleted, movable, departments, builds, seesCost, seesSalary, canWrite, currency, links, dayHours = 0 }: {
  rows: CrewRow[]; departments: { id: string; name: string; emoji: string }[]; builds: { id: string; serial: string; name: string }[];
  deleted: { id: string; name: string; initials: string; photoUrl: string | null; department: string }[];
  movable: { id: string; name: string }[];
  seesCost: boolean; seesSalary: boolean; canWrite: boolean; currency: string | null;
  links: { label: string; options: { value: string; label: string }[] }[];
  dayHours?: number;
}) {
  const [edit, setEdit] = useState<CrewRow | "new" | null>(null);
  const [status, setStatus] = useState<{ r: CrewRow; to: "inactive" | "deleted" } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const quick = (id: string, to: "active" | "restored") => start(async () => { const m = await setPersonStatus(id, to, null); setMsg(m); if (!m.error) router.refresh(); });
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const shown = rows.filter((r) => FILTERS[filter].test(r) && (!q || `${r.name} ${r.skills} ${r.departmentName ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  return (
    <>
      {(msg.ok || msg.error) && <p role="status" className={`text-sm ${msg.error ? "text-bad" : "text-ok"}`}>{msg.error ?? msg.ok}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {(Object.keys(FILTERS) as Filter[]).map((k) => {
          const n = rows.filter(FILTERS[k].test).length;
          if (k !== "all" && !n) return null;
          return (
            <button key={k} type="button" onClick={() => setFilter(k)} aria-pressed={filter === k}
              className={`flex min-h-10 items-center gap-2 rounded-full border px-3.5 text-sm ${filter === k ? "border-gold bg-panel2 text-ink" : "border-line2 text-grey hover:text-ink"}`}>
              {FILTERS[k].label}<span className="font-mono text-xs">{n}</span>
            </button>
          );
        })}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or skill" aria-label="Search crew"
          className="min-h-10 min-w-48 flex-1 rounded-full border border-line2 bg-panel3 px-4 text-sm placeholder:text-grey focus:border-gold focus:outline-none sm:max-w-72" />
        {canWrite && <button className={`${btn.primary} ml-auto`} onClick={() => setEdit("new")}>Add person</button>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((r) => {
          const off = !r.active || r.contractEnded;
          return (
            <article key={r.id} className={`grid content-start gap-3 rounded-xl border border-line bg-panel p-4 ${off ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <Avatar r={r} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <h3 className="text-base font-semibold">{r.name}</h3>
                    {r.contractEnded ? <span className="text-xs text-warn">contract ended</span> : !r.active && <span className="text-xs text-grey">inactive</span>}
                  </div>
                  <div className="text-sm text-grey">{r.departmentName ?? "No department"}{r.costClass === "admin" ? " · admin" : ""}</div>
                  {canWrite && <PhotoControl r={r} onMsg={setMsg} />}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <span className="rounded-md border border-gold px-2 py-0.5 font-mono text-[0.7rem] text-gold">{TAG[r.employment]}</span>
                {r.employment === "project_based" && (r.contractFrom || r.contractTo) && (
                  <span className="rounded-md border border-line2 px-2 py-0.5 font-mono text-[0.7rem] text-grey">{r.contractFrom ? fmt(r.contractFrom) : "…"} – {r.contractTo ? fmt(r.contractTo) : "open"}</span>
                )}
                {r.projectIds.map((id) => <span key={id} className="rounded-md border border-line2 px-2 py-0.5 font-mono text-[0.7rem] text-grey">{builds.find((b) => b.id === id)?.serial ?? "build"}</span>)}
                {r.skills.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 5).map((x) => <span key={x} className="rounded-md bg-panel2 px-2 py-0.5 text-[0.75rem]">{x}</span>)}
              </div>
              <dl className="grid grid-cols-4 gap-2 border-t border-line pt-3 text-center">
                <Stat k="Done" v={String(r.stats.done)} />
                <Stat k="On time" v={pct(r.stats.onTimePct)} />
                <Stat k="Right 1st" v={pct(r.stats.ftrPct)} />
                <Stat k="Queue" v={String(r.queued)} />
              </dl>
              {(r.phone || r.notes) && <p className="text-sm text-grey">{r.phone && <span className="font-mono">{r.phone}</span>}{r.phone && r.notes ? " · " : ""}{r.notes}</p>}
              {seesSalary && r.cost && (
                <p className="rounded-md border border-gold/40 px-2.5 py-1.5 font-mono text-xs text-grey">
                  Salary {money(r.cost.baseSalary)}{currency ? ` ${currency}` : ""}/month{seesCost && r.cost.dayRate !== null ? ` · ${money(r.cost.dayRate)}/day · ${money(r.cost.hourRate ?? 0)}/h (Owner only)` : ""}
                </p>
              )}
              {canWrite && (
                <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
                  <button className={btn.ghost} onClick={() => setEdit(r)}>Edit profile</button>
                  <AddQueueTask personId={r.id} name={r.name} links={links} dayHours={dayHours} />
                  <span className="ml-auto flex gap-2">
                    {r.active
                      ? <button className="min-h-10 rounded-md px-2 text-xs text-grey hover:bg-panel2" disabled={pending} onClick={() => setStatus({ r, to: "inactive" })}>Set inactive</button>
                      : <button className="min-h-10 rounded-md px-2 text-xs text-gold hover:bg-panel2" disabled={pending} onClick={() => quick(r.id, "active")}>Set active</button>}
                    <button className="min-h-10 rounded-md px-2 text-xs text-grey hover:bg-panel2 hover:text-bad" disabled={pending} onClick={() => setStatus({ r, to: "deleted" })}>Delete</button>
                  </span>
                </div>
              )}
            </article>
          );
        })}
        {!shown.length && <p className="col-span-full rounded-xl border border-dashed border-line2 p-6 text-center text-sm text-grey">Nobody matches. Clear the search or pick another filter.</p>}
      </div>
      {deleted.length > 0 && (
        <details className="rounded-xl border border-line bg-panel p-4">
          <summary className="cursor-pointer text-sm text-grey">Deleted accounts ({deleted.length}) · history kept for reports and scores</summary>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {deleted.map((d) => (
              <li key={d.id} className="flex items-center gap-3 rounded-lg border border-line2 bg-panel2 p-2.5 opacity-80">
                <Avatar r={{ initials: d.initials, photoUrl: d.photoUrl, colour: "#c9c9c9" }} size={36} />
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{d.name}</span><span className="text-xs text-grey">{d.department}</span></span>
                {canWrite && <button className="min-h-10 rounded-md px-2 text-xs text-gold hover:bg-panel" disabled={pending} onClick={() => quick(d.id, "restored")}>Restore</button>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <Modal open={!!status} onClose={() => setStatus(null)} title={status ? `${status.to === "deleted" ? "Delete" : "Set inactive"} · ${status.r.name}` : ""}>
        {status && <StatusDialog key={`${status.r.id}:${status.to}`} r={status.r} to={status.to} movable={movable.filter((m) => m.id !== status.r.id)}
          onDone={(m) => { setMsg(m); setStatus(null); if (m.ok) router.refresh(); }} />}
      </Modal>
      {seesSalary && rows.some((r) => r.cost && r.cost.baseSalary === 0) && (
        <p className="text-sm text-warn">Some salaries are 0 {currency}, so their labour cost shows as 0 until entered.</p>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === "new" ? "Add crew member" : edit ? `Edit · ${edit.name}` : ""}>
        {edit && <PersonForm key={edit === "new" ? "new" : `${edit.id}:${edit.version}`} r={edit === "new" ? null : edit} departments={departments} builds={builds.map((b) => ({ id: b.id, label: `${b.serial} ${b.name}` }))} seesSalary={seesSalary} onDone={() => setEdit(null)} />}
      </Modal>
    </>
  );
}

/** Set inactive or delete (AM-20): warn about open tasks and move them to someone, or leave them unassigned. */
function StatusDialog({ r, to, movable, onDone }: {
  r: CrewRow; to: "inactive" | "deleted"; movable: { id: string; name: string }[]; onDone: (m: { ok?: string; error?: string }) => void;
}) {
  const [moveTo, setMoveTo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const open = r.queued + r.openSteps;
  return (
    <div className="grid gap-4">
      <p className="text-sm">
        {to === "deleted"
          ? <>{r.name} moves to <b>Deleted accounts</b>. Nothing is erased: their tasks, times, QC results and scores stay for reports, and they can be restored.</>
          : <>{r.name} stays in Crew but leaves the TV, the Floor Station and task assignment.</>}
      </p>
      {open > 0 ? (
        <div className="grid gap-2 rounded-lg border border-warn/60 p-3">
          <p className="text-sm text-warn">{r.name} has {open} open {open === 1 ? "task" : "tasks"}{r.openSteps ? ` (${r.openSteps} part ${r.openSteps === 1 ? "step" : "steps"}${r.queued ? `, ${r.queued} on the task queue` : ""})` : ""}.</p>
          <Field label="Move the open tasks to">
            <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={input}>
              <option value="">Leave them unassigned</option>
              {movable.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          {!moveTo && r.queued > 0 && <p className="text-xs text-grey">Unassigned: part steps lose their technician; queue tasks stay on {r.name}&apos;s queue, hidden, until moved.</p>}
        </div>
      ) : <p className="text-sm text-grey">No open tasks.</p>}
      {error && <p role="alert" className="text-sm text-bad">{error}</p>}
      <div className="flex justify-end gap-2">
        <button className={btn.ghost} disabled={pending} onClick={() => onDone({})}>Cancel</button>
        <button className={to === "deleted" ? btn.danger : btn.primary} disabled={pending} onClick={() => start(async () => {
          const res = await setPersonStatus(r.id, to, moveTo || null);
          if (res.error) setError(res.error); else onDone(res);
        })}>{pending ? "Saving…" : to === "deleted" ? "Delete" : "Set inactive"}</button>
      </div>
    </div>
  );
}
