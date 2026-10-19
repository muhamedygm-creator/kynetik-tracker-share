"use client";
import { useActionState, useRef, useState, useTransition } from "react";
import { deleteDisplay, newDisplayLink, revokeDisplay, saveDisplay } from "@/app/(console)/displays/actions";
import { btn } from "@/components/ui/dialog";
import { Field, input } from "@/components/ui/form";

export interface DeptOption { id: string; name: string; emoji: string; people: number }

export interface DisplayRow {
  id: string; version: number; name: string; departmentId: string | null; departmentName: string | null;
  leaderboardMode: "side" | "rotate" | "off"; confetti: boolean; revoked: boolean; lastSeen: string | null;
}

function CopyLink({ link }: { link: string }) {
  const [copied, setCopied] = useState<"yes" | "select" | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied("yes");
    } catch {
      // iPad Safari and some browsers refuse the clipboard API: fall back to the selection.
      const el = ref.current;
      if (!el) return;
      el.focus(); el.select(); el.setSelectionRange(0, link.length);
      setCopied(document.execCommand?.("copy") ? "yes" : "select");
    }
  }
  return (
    <div className="grid gap-2 rounded-md border border-gold p-3" data-testid="display-link">
      <p className="text-sm">Open this link in the TV&apos;s browser. It is shown only once, so copy it now. If it is lost, use &quot;New link&quot;.</p>
      <div className="flex flex-wrap gap-2">
        <input ref={ref} readOnly value={link} aria-label="TV link" className={`${input} min-w-0 flex-1 font-mono text-xs`} onFocus={(e) => e.currentTarget.select()} />
        <button type="button" className={btn.primary} onClick={copy}>{copied === "yes" ? "Copied" : "Copy link"}</button>
        <a href={link} target="_blank" rel="noopener noreferrer" className={btn.ghost}>Open</a>
      </div>
      {copied === "select" && <p className="text-xs text-grey">The link is selected. Use the browser&apos;s Copy.</p>}
    </div>
  );
}

function EmptyDept({ dept }: { dept?: DeptOption }) {
  if (!dept || dept.people > 0) return null;
  return <p className="text-sm text-warn">Nobody is in {dept.name} yet, so this TV shows an empty screen. Add people to the department under Crew.</p>;
}

export function NewDisplay({ departments }: { departments: DeptOption[] }) {
  const [state, action, pending] = useActionState(saveDisplay, {});
  const [deptId, setDeptId] = useState("");
  return (
    <form action={action} className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Name"><input name="name" placeholder="Paint bay TV" className={input} /></Field>
        <Field label="Department">
          <select name="departmentId" className={input} value={deptId} onChange={(e) => setDeptId(e.target.value)}>
            <option value="" disabled>Pick one</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
          </select>
        </Field>
        <Field label="Leaderboard">
          <select name="leaderboardMode" defaultValue="side" className={input}>
            <option value="side">Side panel</option><option value="rotate">Rotating screen</option><option value="off">Off</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="confetti" defaultChecked /> Confetti</label>
      </div>
      <EmptyDept dept={departments.find((d) => d.id === deptId)} />
      <div className="flex items-center gap-3">
        <button disabled={pending} className={btn.primary}>{pending ? "Creating…" : "Create display link"}</button>
        {state.error && <span role="alert" className="text-sm text-bad">{state.error}</span>}
      </div>
      {state.link && <CopyLink link={state.link} />}
    </form>
  );
}

export function DisplayList({ rows, departments }: { rows: DisplayRow[]; departments: DeptOption[] }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok?: string; error?: string }>({});
  const [fresh, setFresh] = useState<{ id: string; link: string } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  if (!rows.length) return <p className="text-sm text-grey">No displays yet.</p>;
  return (
    <>
      {(msg.ok || msg.error) && <p className={`text-sm ${msg.error ? "text-bad" : "text-ok"}`}>{msg.error ?? msg.ok}</p>}
      <ul className="grid gap-2">
        {rows.map((r) => (
          <li key={r.id} className={`grid gap-2 rounded-md border border-line bg-panel2 p-3 sm:grid-cols-[1fr_auto] ${r.revoked ? "opacity-60" : ""}`}>
            <form action={async (f) => setMsg(await saveDisplay({}, f))} className="grid gap-2 sm:grid-cols-4">
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="version" value={r.version} />
              <input name="name" defaultValue={r.name} className={input} aria-label="Name" />
              <select name="departmentId" defaultValue={r.departmentId ?? ""} className={input} aria-label="Department">
                <option value="" disabled>Pick one</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.emoji} {d.name}</option>)}
              </select>
              <select name="leaderboardMode" defaultValue={r.leaderboardMode} className={input} aria-label="Leaderboard">
                <option value="side">Side panel</option><option value="rotate">Rotating screen</option><option value="off">Off</option>
              </select>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="confetti" defaultChecked={r.confetti} /> Confetti</label>
                <button className={btn.ghost}>Save</button>
              </div>
            </form>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              {confirmId === r.id ? (
                <span className="flex items-center gap-2">
                  <span className="text-xs text-warn">The old link stops working.</span>
                  <button className={btn.primary} disabled={pending} onClick={() => start(async () => {
                    const res = await newDisplayLink(r.id, r.version);
                    setMsg(res); setConfirmId(null);
                    if (res.link) setFresh({ id: r.id, link: res.link });
                  })}>Make new link</button>
                  <button className={btn.ghost} onClick={() => setConfirmId(null)}>Cancel</button>
                </span>
              ) : (
                <button className={btn.ghost} disabled={pending} onClick={() => setConfirmId(r.id)}>New link</button>
              )}
              <span className="font-mono text-xs text-grey">{r.revoked ? "revoked" : r.lastSeen ? `seen ${r.lastSeen}` : "never opened"}</span>
              <button className={r.revoked ? btn.ghost : btn.danger} disabled={pending} onClick={() => start(async () => setMsg(await revokeDisplay(r.id, r.version, !r.revoked)))}>
                {r.revoked ? "Restore" : "Revoke"}
              </button>
              {r.revoked && <button className="text-xs text-bad hover:underline" disabled={pending} onClick={() => start(async () => setMsg(await deleteDisplay(r.id, r.version)))}>Delete</button>}
            </div>
            <div className="sm:col-span-2"><EmptyDept dept={departments.find((d) => d.id === r.departmentId)} /></div>
            {fresh?.id === r.id && <div className="sm:col-span-2"><CopyLink link={fresh.link} /></div>}
          </li>
        ))}
      </ul>
    </>
  );
}
