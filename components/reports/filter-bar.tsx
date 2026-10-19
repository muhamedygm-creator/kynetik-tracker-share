"use client";
/**
 * Reports filter bar (Reports fix 2026-10-17, replacing AM-30), shared by the four Reports tabs and the Crew
 * performance export. Two zones:
 *   · WHEN: one field showing the range ("This month · 1–17 Oct 2026"). It opens one pop-up: quick choices on the
 *     left (a click applies and closes), a two-month calendar on the right (first day, then last day), Cancel and
 *     Apply at the bottom (the only Apply on the page). "Include not started" sits beside it (off by default);
 *   · WHAT: only the filters that suit the tab (`fields`), the rarer ones behind "+ More"; active filters as chips
 *     with ✕ and "Clear all".
 * Every other change updates at once. The count sits beside Export CSV / Export PDF, which use exactly what's on
 * screen; the files are fetched here so a failure shows a message on the page, never an error page. The last
 * filters are remembered per person and per tab in this browser (default This month). On an iPad or phone both
 * zones fold into one "Filters" button that opens a side panel.
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { rangeFor, rangeLabel, type RangePreset } from "@/domain/performance";
import { Drawer } from "@/components/ui/drawer";

export type Option = { value: string; label: string; group?: string; project?: string };
export type Field = {
  key: string;
  label: string;
  kind: "multi" | "select" | "search";
  options: Option[];
  /** Behind "+ More". */
  more?: boolean;
  placeholder?: string;
};
type Filters = Record<string, string>;

const PERIODS: [RangePreset, string][] = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["lastWeek", "Last week"], ["month", "This month"],
  ["lastMonth", "Last month"], ["last3Months", "Last 3 months"], ["year", "This year"],
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WHEN_KEYS = ["range", "from", "to", "ns"];

const box = "min-h-10 rounded-md border border-line2 bg-panel2 px-3 text-sm text-ink";

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent | TouchEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("mousedown", on); document.addEventListener("touchstart", on); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", on); document.removeEventListener("touchstart", on); document.removeEventListener("keydown", esc); };
  }, [open, close]);
  return ref;
}

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

function Month({ y, m, from, to, today, onTap }: { y: number; m: number; from: string; to: string; today: string; onTap: (d: string) => void }) {
  const first = (new Date(Date.UTC(y, m, 1)).getUTCDay() + 6) % 7; // Monday first
  return (
    <div className="w-[15.5rem]">
      <div className="mb-1 text-center text-sm">{MONTHS[m]} {y}</div>
      <div className="grid grid-cols-7 gap-0.5 text-center font-mono text-[0.65rem] text-grey">{["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <span key={i}>{d}</span>)}</div>
      <div className="grid grid-cols-7 gap-0.5">
        {Array.from({ length: first }, (_, i) => <span key={`b${i}`} />)}
        {Array.from({ length: daysIn(y, m) }, (_, i) => {
          const d = `${y}-${pad(m + 1)}-${pad(i + 1)}`;
          const ends = d === from || d === to;
          const inside = !!from && !!to && d > from && d < to;
          return (
            <button key={d} type="button" onClick={() => onTap(d)} aria-pressed={ends} aria-label={d}
              className={`h-8 rounded-md font-mono text-xs ${ends ? "bg-gold text-on-accent" : inside ? "bg-gold/15 text-ink" : d === today ? "border border-line2 text-ink" : "text-ink hover:bg-panel2"}`}>{i + 1}</button>
          );
        })}
      </div>
    </div>
  );
}

/** The date-range pop-up: quick choices, a two-month calendar, Cancel and Apply. */
function RangePicker({ preset, from, to, today, onPreset, onCustom, onClose }: {
  preset: string; from: string; to: string; today: string;
  onPreset: (p: RangePreset) => void; onCustom: (from: string, to: string) => void; onClose: () => void;
}) {
  const [a, setA] = useState(from), [b, setB] = useState(to), [picking, setPicking] = useState(false);
  // Show the month before the end of the range and the month of its end.
  const end = to || today;
  const [y, setY] = useState(+end.slice(0, 4) - (+end.slice(5, 7) === 1 ? 1 : 0));
  const [m, setM] = useState((+end.slice(5, 7) + 10) % 12);
  const next = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 };
  const shift = (n: number) => { const t = y * 12 + m + n; setY(Math.floor(t / 12)); setM(((t % 12) + 12) % 12); };
  const tap = (d: string) => {
    if (!picking) { setA(d); setB(d); setPicking(true); return; }
    if (d < a) { setB(a); setA(d); } else setB(d);
    setPicking(false);
  };
  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-wrap gap-1 sm:w-36 sm:flex-col sm:border-r sm:border-line sm:pr-3" role="group" aria-label="Quick choices">
          {PERIODS.map(([k, l]) => (
            <button key={k} type="button" onClick={() => onPreset(k)} aria-pressed={preset === k}
              className={`min-h-9 rounded-md px-2.5 text-left text-sm ${preset === k ? "bg-gold/15 text-ink" : "text-grey hover:bg-panel2 hover:text-ink"}`}>{l}</button>
          ))}
          <span className={`min-h-9 rounded-md px-2.5 py-2 text-left text-sm ${preset === "custom" ? "bg-gold/15 text-ink" : "text-grey"}`}>Custom</span>
        </div>
        <div className="grid gap-2">
          <div className="flex items-center justify-between">
            <button type="button" className="h-8 w-8 rounded-md text-grey hover:bg-panel2 hover:text-ink" onClick={() => shift(-1)} aria-label="Earlier months">‹</button>
            <span className="text-xs text-grey" aria-live="polite">{picking ? "Now click the last day." : "Click the first day, then the last day."}</span>
            <button type="button" className="h-8 w-8 rounded-md text-grey hover:bg-panel2 hover:text-ink" onClick={() => shift(1)} aria-label="Later months">›</button>
          </div>
          <div className="flex flex-wrap gap-4">
            <Month y={y} m={m} from={a} to={picking ? a : b} today={today} onTap={tap} />
            <Month y={next.y} m={next.m} from={a} to={picking ? a : b} today={today} onTap={tap} />
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line pt-3">
        <span className="font-mono text-sm">{a && b ? rangeLabel(a, picking ? a : b) : ""}</span>
        <span className="flex gap-2">
          <button type="button" className="min-h-10 rounded-md border border-line2 px-4 text-sm text-grey hover:text-ink" onClick={onClose}>Cancel</button>
          <button type="button" disabled={!a || !b || picking} className="min-h-10 rounded-md bg-gold px-4 font-mono text-xs uppercase tracking-widest text-on-accent disabled:opacity-50"
            onClick={() => onCustom(a, b)}>Apply</button>
        </span>
      </div>
    </div>
  );
}

/** Several values, with search and Select all; grouped when the options carry a group. */
function MultiPick({ field, picked, onChange }: { field: Field; picked: Set<string>; onChange: (s: Set<string>) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const close = useCallback(() => setOpen(false), []);
  const ref = useOutside(open, close);
  const all = field.options;
  const visible = all.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase()));
  const groups = [...new Set(visible.map((o) => o.group ?? ""))];
  const names = [...picked].map((v) => all.find((o) => o.value === v)?.label ?? v);
  return (
    <div className="relative" ref={ref}>
      <button type="button" className={`${box} min-w-40 text-left`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {field.label}: {names.length === 0 ? "All" : names.length <= 2 ? names.join(", ") : `${names.length} chosen`} ▾
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-2 grid w-72 gap-2 rounded-[10px] border border-line2 bg-panel p-3 shadow-2xl">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" className={box} autoFocus aria-label={`Search ${field.label.toLowerCase()}`} />
          <label className="flex items-center gap-2 border-b border-line pb-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" checked={picked.size === 0 || picked.size === all.length} onChange={() => onChange(new Set())} />
            Select all ({all.length})
          </label>
          <div className="grid max-h-64 gap-1 overflow-y-auto">
            {groups.map((g) => (
              <div key={g || "-"} className="grid gap-1">
                {g && <span className="text-xs text-grey">{g}</span>}
                {visible.filter((o) => (o.group ?? "") === g).map((o) => (
                  <label key={o.value} className="flex min-h-8 items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" checked={picked.has(o.value)}
                      onChange={() => { const s = new Set(picked); if (s.has(o.value)) s.delete(o.value); else s.add(o.value); onChange(s.size === all.length ? new Set() : s); }} />
                    {o.label}
                  </label>
                ))}
              </div>
            ))}
            {!visible.length && <span className="text-sm text-grey">{all.length ? "Nothing matches." : "Nothing in this period."}</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Text search (part, item) that waits until typing stops; suggestions narrow to the chosen project. */
function SearchBox({ field, value, project, onChange }: { field: Field; value: string; project: string; onChange: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const t = setTimeout(() => onChange(text), 450);
    return () => clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps
  const ps = project.split(",").filter(Boolean);
  const list = field.options.filter((o) => !ps.length || !o.project || ps.includes(o.project));
  const id = `kk-${field.key}-list`;
  return (
    <>
      <input value={text} onChange={(e) => setText(e.target.value)} placeholder={field.placeholder ?? `${field.label}: search`} className={`${box} w-52`}
        aria-label={field.label} list={list.length ? id : undefined} />
      {list.length > 0 && <datalist id={id}>{list.slice(0, 200).map((o) => <option key={`${o.project}-${o.value}-${o.label}`} value={o.value}>{o.label}</option>)}</datalist>}
    </>
  );
}

/** Saves a fetched file under the name the server gave it. */
function saveBlob(blob: Blob, disposition: string | null, fallback: string) {
  const m = /filename\*=UTF-8''([^;]+)/.exec(disposition ?? "") ?? /filename="([^"]+)"/.exec(disposition ?? "");
  const name = m ? decodeURIComponent(m[1]) : fallback;
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export function FilterBar({ mode, tab, value, today, userId, fields, notStarted = true, count, noun, endpoint, extra = {}, title, summaryCsv = false }: {
  /** url: the page re-renders from the address (Reports); local: only the export and a count (Crew). */
  mode: "url" | "local";
  /** Memory key: filters are remembered per person and per tab. */
  tab: string;
  value: Filters;
  today: string;
  userId: string;
  fields: Field[];
  /** Show the "Include not started" switch. */
  notStarted?: boolean;
  count?: number | null;
  noun: string;
  endpoint: string;
  extra?: Record<string, string>;
  title?: ReactNode;
  /** Export CSV also saves the per-employee `_summary.csv` (Employees, Crew export). */
  summaryCsv?: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const storeKey = `kk.reportFilters.${userId}.${tab}`;
  const keys = useMemo(() => [...WHEN_KEYS, ...fields.map((x) => x.key)], [fields]);
  const clean = (x: Filters) => Object.fromEntries(keys.map((k) => [k, x[k] ?? ""])) as Filters;
  const [f, setF] = useState<Filters>(() => clean({ range: "month", ...Object.fromEntries(Object.entries(value).filter(([, v]) => v)) }));
  const [pending, start] = useTransition();
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [counting, setCounting] = useState(false);
  const [calOpen, setCalOpen] = useState(false);
  const [exporting, setExporting] = useState<"" | "csv" | "pdf">("");
  const [exportError, setExportError] = useState("");
  const [more, setMore] = useState(fields.some((x) => x.more && f[x.key]));
  const [panel, setPanel] = useState(false);
  const closeCal = useCallback(() => setCalOpen(false), []);
  const calRef = useOutside(calOpen, closeCal);

  const range = rangeFor(f.range as RangePreset, today, { from: f.from, to: f.to }) ?? rangeFor("month", today)!;
  const qs = (x: Filters, add: Record<string, string> = {}) => new URLSearchParams(
    Object.fromEntries(Object.entries({ ...extra, ...x, ...add }).filter(([, v]) => v)) as Record<string, string>).toString();

  const commit = useCallback((next: Filters) => {
    setF(next);
    try { localStorage.setItem(storeKey, JSON.stringify(next)); } catch { /* storage unavailable */ }
    if (mode === "url") start(() => router.replace(`${path}?${qs(next)}`, { scroll: false }));
  }, [mode, path, router, storeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k: string, v: string) => commit({ ...f, [k]: v });

  // First visit to this tab with nothing in the address: bring back this person's last filters for it.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (keys.some((k) => value[k])) return;
    try {
      const saved = JSON.parse(localStorage.getItem(storeKey) ?? "null") as Filters | null;
      if (saved && keys.some((k) => saved[k] && !(k === "range" && saved[k] === "month"))) {
        const next = clean(saved);
        setMore(fields.some((x) => x.more && next[x.key]));
        commit(next);
      }
    } catch { /* ignore */ }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Local mode: count what the export would contain.
  useEffect(() => {
    if (mode !== "local") return;
    let live = true;
    setCounting(true);
    fetch(`${endpoint}?${qs(f, { format: "count" })}`).then((r) => r.json()).then((d) => live && setLocalCount(d.tasks ?? null)).catch(() => live && setLocalCount(null)).finally(() => live && setCounting(false));
    return () => { live = false; };
  }, [f, mode, endpoint]); // eslint-disable-line react-hooks/exhaustive-deps

  const busy = pending || counting;
  const n = mode === "url" ? count : localCount;
  const showing = `Showing ${rangeLabel(range.from, range.to)}`;
  const label = (fd: Field, v: string) => fd.options.find((o) => o.value === v)?.label ?? v;
  const chips: { key: string; label: string; clear: () => void }[] = fields.flatMap((fd) => {
    const v = f[fd.key];
    if (!v) return [];
    if (fd.kind !== "multi") return [{ key: fd.key, label: fd.kind === "search" ? `${fd.label} “${v}”` : label(fd, v), clear: () => set(fd.key, "") }];
    const vs = v.split(",").filter(Boolean);
    if (vs.length > 4) return [{ key: fd.key, label: `${vs.length} ${fd.label.toLowerCase()}`, clear: () => set(fd.key, "") }];
    return vs.map((x) => ({ key: `${fd.key}:${x}`, label: label(fd, x), clear: () => set(fd.key, vs.filter((y) => y !== x).join(",")) }));
  });

  const control = (fd: Field) => {
    if (fd.kind === "multi") {
      return <MultiPick key={fd.key} field={fd} picked={new Set(f[fd.key].split(",").filter(Boolean))} onChange={(s) => set(fd.key, [...s].join(","))} />;
    }
    if (fd.kind === "search") return <SearchBox key={fd.key} field={fd} value={f[fd.key]} project={f.project ?? ""} onChange={(v) => set(fd.key, v)} />;
    // A chosen value no longer in the list (another period) stays selectable so it can be seen and cleared.
    const opts = f[fd.key] && !fd.options.some((o) => o.value === f[fd.key]) ? [...fd.options, { value: f[fd.key], label: f[fd.key] }] : fd.options;
    return (
      <select key={fd.key} value={f[fd.key]} onChange={(e) => set(fd.key, e.target.value)} className={box} aria-label={fd.label}>
        <option value="">{fd.label}: All</option>
        {opts.map((o) => <option key={o.value} value={o.value}>{fd.label}: {o.label}</option>)}
      </select>
    );
  };

  const presetName = PERIODS.find(([k]) => k === f.range)?.[1] ?? "Custom";
  const when = (
    <div className="grid gap-2 rounded-lg border border-line p-3" role="group" aria-label="When">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1 w-12">When</span>
        <div className="relative" ref={calRef}>
          <button type="button" className={`${box} flex items-center gap-2 border-gold/60`} aria-expanded={calOpen} aria-haspopup="dialog" onClick={() => setCalOpen(!calOpen)}>
            <svg aria-hidden viewBox="0 0 16 16" className="h-4 w-4 text-gold" fill="none" stroke="currentColor" strokeWidth="1.4"><rect x="2" y="3" width="12" height="11" rx="1.5" /><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3" /></svg>
            <span>{presetName} · {rangeLabel(range.from, range.to)}</span><span aria-hidden>▾</span>
          </button>
          {calOpen && (
            <div role="dialog" aria-label="Choose dates"
              className="absolute left-0 z-40 mt-2 w-max max-w-[calc(100vw-2rem)] rounded-[10px] border border-line2 bg-panel p-3 shadow-2xl max-lg:fixed max-lg:w-auto [@media(pointer:coarse)]:w-auto max-lg:inset-x-3 max-lg:top-16 max-lg:max-h-[85vh] max-lg:overflow-y-auto [@media(pointer:coarse)]:fixed [@media(pointer:coarse)]:inset-x-3 [@media(pointer:coarse)]:top-16 [@media(pointer:coarse)]:max-h-[85vh] [@media(pointer:coarse)]:overflow-y-auto">
              <RangePicker preset={f.range} from={range.from} to={range.to} today={today} onClose={closeCal}
                onPreset={(k) => { commit({ ...f, range: k, from: "", to: "" }); setCalOpen(false); }}
                onCustom={(a, b) => { commit({ ...f, range: "custom", from: a, to: b }); setCalOpen(false); }} />
            </div>
          )}
        </div>
        {notStarted && (
          <label className="ml-auto flex min-h-9 items-center gap-2 text-sm" title="Also show work that has had no activity yet">
            <input type="checkbox" className="h-4 w-4 accent-[var(--gold)]" checked={f.ns === "1"} onChange={(e) => set("ns", e.target.checked ? "1" : "")} />
            Include not started
          </label>
        )}
      </div>
    </div>
  );
  const hasMore = fields.some((x) => x.more);
  const what = (
    <div className="grid gap-2 rounded-lg border border-line p-3" role="group" aria-label="What">
      <div className="flex flex-wrap items-center gap-2">
        <span className="label mr-1 w-12">What</span>
        {fields.filter((x) => !x.more).map(control)}
        {hasMore && <button type="button" className="min-h-10 px-2 text-sm text-gold hover:underline" aria-expanded={more} onClick={() => setMore(!more)}>{more ? "− Less" : "+ More"}</button>}
      </div>
      {more && hasMore && <div className="flex flex-wrap items-center gap-2 sm:pl-[3.75rem]">{fields.filter((x) => x.more).map(control)}</div>}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:pl-[3.75rem]">
          <span className="text-xs text-grey">Active:</span>
          {chips.map((c) => (
            <span key={c.key} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line2 bg-panel2 pl-3 pr-1 text-sm">
              {c.label}
              <button type="button" onClick={c.clear} className="grid h-7 w-7 place-items-center rounded-full text-grey hover:text-ink" aria-label={`Remove ${c.label}`}>✕</button>
            </span>
          ))}
          <button type="button" className="text-sm text-grey underline-offset-2 hover:text-ink hover:underline"
            onClick={() => commit({ ...f, ...Object.fromEntries(fields.map((x) => [x.key, ""])) })}>Clear all</button>
        </div>
      )}
    </div>
  );
  const result = (
    <p className="flex items-center gap-2 text-sm" aria-live="polite">
      {busy && <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-gold" aria-hidden />}
      <span className="font-mono">{n !== null && n !== undefined ? `${n} ${noun}` : ""}</span>
      {busy && <span className="text-xs text-grey">Updating…</span>}
    </p>
  );
  // Files are fetched here so a failure shows a message on the page, never an error page.
  const exportFile = async (format: "csv" | "pdf") => {
    setExporting(format); setExportError("");
    try {
      const formats = format === "csv" && summaryCsv ? ["csv", "summary"] : [format];
      for (const fm of formats) {
        const r = await fetch(`${endpoint}?${qs(f, { format: fm })}`);
        if (!r.ok) throw new Error(await r.text().catch(() => ""));
        saveBlob(await r.blob(), r.headers.get("content-disposition"), `${tab}.${fm === "pdf" ? "pdf" : "csv"}`);
      }
    } catch {
      setExportError(format === "pdf" ? "The PDF couldn't be created. Try the CSV, or try again in a moment." : "The CSV couldn't be created. Try again in a moment.");
    } finally {
      setExporting("");
    }
  };
  const exportsRow = (
    <div className="grid justify-items-end gap-1">
      <div className="flex shrink-0 gap-2">
        <button type="button" disabled={!!exporting} onClick={() => exportFile("csv")}
          className="inline-flex min-h-10 items-center rounded-md border border-gold px-3.5 font-mono text-xs uppercase tracking-widest text-gold hover:bg-gold hover:text-on-accent disabled:opacity-60">{exporting === "csv" ? "Preparing…" : "Export CSV"}</button>
        <button type="button" disabled={!!exporting} onClick={() => exportFile("pdf")}
          className="inline-flex min-h-10 items-center rounded-md bg-gold px-3.5 font-mono text-xs uppercase tracking-widest text-on-accent disabled:opacity-60">{exporting === "pdf" ? "Preparing…" : "Export PDF"}</button>
      </div>
      {exportError && <p role="alert" className="text-sm text-bad">{exportError}</p>}
    </div>
  );
  const active = chips.length + (f.ns === "1" ? 1 : 0);

  return (
    <section className={`grid gap-3 rounded-[10px] border border-line bg-panel p-4 transition-opacity ${pending ? "opacity-90" : ""}`}>
      {title}
      {/* Laptop: both zones in view. */}
      <div className="hidden gap-3 lg:grid [@media(pointer:coarse)]:!hidden">
        {when}
        {what}
        <div className="flex flex-wrap items-center justify-between gap-3">{result}{exportsRow}</div>
      </div>
      {/* iPad and phone: one Filters button that opens a side panel. */}
      <div className="grid gap-3 lg:hidden [@media(pointer:coarse)]:!grid">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button type="button" className={`${box} font-semibold`} onClick={() => setPanel(true)}>Filters{active ? ` (${active})` : ""}</button>
          {exportsRow}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-grey">{showing}{f.ns === "1" ? " · Including not started" : ""}{chips.length ? ` · ${chips.map((c) => c.label).join(" · ")}` : ""}</span>
          {result}
        </div>
      </div>
      <Drawer open={panel} onClose={() => setPanel(false)} title="Filters"
        footer={<button type="button" className="min-h-11 w-full rounded-md bg-gold font-mono text-xs uppercase tracking-widest text-on-accent" onClick={() => setPanel(false)}>Show {n ?? ""} {noun}</button>}>
        <div className="grid gap-4">{when}{what}</div>
      </Drawer>
    </section>
  );
}
