/**
 * PDF reports (amends AM-26, AM-27, Reports fix 2026-10-17), drawn on the server with @react-pdf/renderer, so the
 * charts are SVG drawn into the file (nothing to wait for in a browser). Every page has a header with the Kynetik
 * mark, the report name, the filters and range used, "Generated on … by …" and "Page X of Y". Page 1 is the summary
 * (the tab's tiles and its charts); the detail tables follow, their column headers repeated on every page.
 * Helvetica is the brand's body face and is built into PDF readers; headings are uppercase with tracking (Broche
 * isn't embeddable here). Light paper for printing; Vintage Yellow only for hairlines, tags and numerals.
 * Never costs or salaries.
 */
import { Document, G, Line, Page, Path, Rect, StyleSheet, Svg, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { ReactNode } from "react";
import { fmtDate } from "@/domain/format";
import { fmtStamp, leaveSummary, weekOf, type PerfRow, type PerfSummary, type WeekPoint } from "@/domain/performance";
import { fmtDur, materialFinish, overNote, type ActivityRow, type PartReport, type ProjectReport } from "@/domain/reports";
import { MONOGRAM } from "./brand-paths";

const INK = "#202020", GREY = "#6b6b6b", LINE = "#d9d9d9", GOLD = "#E9BE5F", GOLD_INK = "#9a7a2e", SOFT = "#f4f4f4", BAR2 = "#bdbdbd", BAD = "#b3473b";

const s = StyleSheet.create({
  page: { paddingTop: 78, paddingBottom: 30, paddingHorizontal: 32, fontFamily: "Helvetica", fontSize: 8.5, color: INK },
  header: { position: "absolute", top: 18, left: 32, right: 32, borderBottomWidth: 1, borderBottomColor: GOLD, paddingBottom: 6 },
  headRow: { flexDirection: "row", alignItems: "center" },
  brand: { marginLeft: 8, fontSize: 9, letterSpacing: 2.2, textTransform: "uppercase" },
  title: { marginLeft: "auto", fontSize: 10, letterSpacing: 1.6, textTransform: "uppercase" },
  sub: { flexDirection: "row", marginTop: 5, fontSize: 7.5, color: GREY },
  h1: { fontSize: 15, letterSpacing: 2.4, textTransform: "uppercase", marginBottom: 2 },
  h2: { fontSize: 9.5, letterSpacing: 1.8, textTransform: "uppercase", color: GOLD_INK, marginTop: 12, marginBottom: 6 },
  muted: { color: GREY },
  mono: { fontFamily: "Courier" },
  table: { borderTopWidth: 0.5, borderTopColor: LINE },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: LINE, minHeight: 15, alignItems: "center" },
  th: { fontSize: 7, color: GREY, textTransform: "uppercase", letterSpacing: 0.6, paddingVertical: 4, paddingHorizontal: 3 },
  td: { paddingVertical: 3, paddingHorizontal: 3 },
  tiles: { flexDirection: "row", gap: 8, marginTop: 6 },
  tile: { flexGrow: 1, flexBasis: 0, borderWidth: 0.5, borderColor: LINE, borderTopWidth: 2, borderTopColor: GOLD, padding: 6 },
});

/** The built-in PDF fonts can't draw every character: swap the few the app uses for ones they can. */
const pdfText = (t: string) => t.replace(/→/g, "›").replace(/−/g, "-").replace(/✕/g, "x").replace(/[^\x20-\x7E -ÿ–—‘’“”•…›]/g, "?");

function Mark({ size = 18 }: { size?: number }) {
  return (
    <Svg viewBox={MONOGRAM.viewBox} width={size} height={size}>
      <G transform={MONOGRAM.transform ?? undefined}>{MONOGRAM.paths.map((d, i) => <Path key={i} d={d} fill={MONOGRAM.fill ?? GOLD} />)}</G>
    </Svg>
  );
}

export interface Stamp { title: string; from: string; to: string; generatedAt: string; by: string; filters: string }

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const when = (x: string) => `${+x.slice(8, 10)} ${MONTHS[+x.slice(5, 7) - 1]} ${x.slice(0, 4)} ${x.slice(11, 16)}`;

/** Page frame: the full header on every page. */
function Frame({ stamp, children }: { stamp: Stamp; children: ReactNode }) {
  return (
    <Page size="A4" orientation="landscape" style={s.page} wrap>
      <View style={s.header} fixed>
        <View style={s.headRow}>
          <Mark />
          <Text style={s.brand}>Kynetik Koncepts</Text>
          <Text style={s.title}>{stamp.title}</Text>
        </View>
        <View style={s.sub}>
          <Text style={{ maxWidth: "62%" }}>{pdfText(stamp.filters)}</Text>
          <Text style={{ marginLeft: "auto" }} render={({ pageNumber, totalPages }) => `Generated on ${when(stamp.generatedAt)} by ${pdfText(stamp.by)} · Page ${pageNumber} of ${totalPages}`} />
        </View>
      </View>
      {children}
    </Page>
  );
}

// ───────────── charts (SVG: single hue + grey, red only for failures) ─────────────

const PAD = { l: 30, r: 8, t: 10, b: 22 };
const nice = (v: number) => {
  if (v <= 0) return 1;
  const e = 10 ** Math.floor(Math.log10(v)), n = v / e;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * e;
};
type Series = { name: string; colour: string; values: (number | null)[] };
/** Axis top: a round number, at least 2 so count axes never show "0, 1, 1". */
const axisTop = (series: Series[], max?: number) => max ?? nice(Math.max(2, ...series.flatMap((x) => x.values.map((v) => v ?? 0))));
const tickText = (t: number, unit: string) => `${Number.isInteger(t) ? t : Math.round(t * 10) / 10}${unit}`;

function Legend({ series }: { series: Series[] }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
      {series.map((sr) => (
        <View key={sr.name} style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <View style={{ width: 7, height: 7, backgroundColor: sr.colour }} /><Text style={{ fontSize: 7, color: GREY }}>{sr.name}</Text>
        </View>
      ))}
    </View>
  );
}

/** Vertical bars, one group per label. */
export function BarChart({ labels, series, unit = "", max, w = 360, h = 150 }: { labels: string[]; series: Series[]; unit?: string; max?: number; w?: number; h?: number }) {
  const top = axisTop(series, max);
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
  const gw = iw / Math.max(1, labels.length), bw = Math.min(18, (gw * 0.7) / series.length);
  const y = (v: number) => PAD.t + ih - (v / top) * ih;
  const every = Math.max(1, Math.ceil(labels.length / 12));
  return (
    <View>
      <Svg width={w} height={h}>
        {[0, top / 2, top].map((t, i) => (
          <G key={i}>
            <Line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth={0.5} />
            <Text x={PAD.l - 4} y={y(t) + 2.5} style={{ fontSize: 6 }} fill={GREY} textAnchor="end">{tickText(t, unit)}</Text>
          </G>
        ))}
        {labels.map((l, i) => (
          <G key={`${l}-${i}`}>
            {series.map((sr, k) => {
              const v = sr.values[i];
              if (v === null || v === undefined || v <= 0) return null;
              const x = PAD.l + i * gw + (gw - bw * series.length) / 2 + k * bw;
              return <Rect key={k} x={x} y={y(Math.min(v, top))} width={bw - 1} height={Math.max(0, PAD.t + ih - y(Math.min(v, top)))} fill={sr.colour} />;
            })}
            {i % every === 0 && <Text x={PAD.l + i * gw + gw / 2} y={h - 8} style={{ fontSize: 6 }} fill={GREY} textAnchor="middle">{pdfText(l.slice(0, 16))}</Text>}
          </G>
        ))}
      </Svg>
      {series.length > 1 && <Legend series={series} />}
    </View>
  );
}

/** Horizontal bars, one row per label (people, parts, projects, types): long names stay readable. */
export function HBarChart({ labels, series, unit = "", max, w = 360 }: { labels: string[]; series: Series[]; unit?: string; max?: number; w?: number }) {
  const rows = labels.slice(0, 14);
  const lw = 92, top = axisTop(series, max), bh = 6, gap = 5, pt = 6;
  const rh = series.length * bh + gap, h = rows.length * rh + 16 + pt;
  const iw = w - lw - 30;
  const x = (v: number) => lw + (Math.min(v, top) / top) * iw;
  return (
    <View>
      <Svg width={w} height={h}>
        {[0, top / 2, top].map((t, i) => (
          <G key={i}>
            <Line x1={x(t)} x2={x(t)} y1={0} y2={h - 12} stroke={LINE} strokeWidth={0.5} />
            <Text x={x(t)} y={h - 3} style={{ fontSize: 6 }} fill={GREY} textAnchor="middle">{tickText(t, unit)}</Text>
          </G>
        ))}
        {rows.map((l, i) => (
          <G key={`${l}-${i}`}>
            <Text x={lw - 4} y={pt + i * rh + (series.length * bh) / 2 + 2.5} style={{ fontSize: 6.5 }} fill={INK} textAnchor="end">{pdfText(l.slice(0, 22))}</Text>
            {series.map((sr, k) => {
              const v = sr.values[i];
              if (v === null || v === undefined) return null;
              return (
                <G key={k}>
                  {v > 0 && <Rect x={lw} y={pt + i * rh + k * bh} width={Math.max(0.5, x(v) - lw)} height={bh - 1} fill={sr.colour} />}
                  <Text x={x(v) + 3} y={pt + i * rh + k * bh + bh - 1.5} style={{ fontSize: 5.5 }} fill={GREY}>{`${Math.round(v * 10) / 10}${unit}`}</Text>
                </G>
              );
            })}
          </G>
        ))}
      </Svg>
      {series.length > 1 && <Legend series={series} />}
      {labels.length > rows.length && <Text style={{ fontSize: 6.5, color: GREY }}>Showing the first {rows.length} of {labels.length}.</Text>}
    </View>
  );
}

export function LineChart({ labels, values, unit = "%", max = 100, w = 360, h = 150 }: { labels: string[]; values: (number | null)[]; unit?: string; max?: number; w?: number; h?: number }) {
  const iw = w - PAD.l - PAD.r, ih = h - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (labels.length <= 1 ? iw / 2 : (i * iw) / (labels.length - 1));
  const y = (v: number) => PAD.t + ih - (v / max) * ih;
  const pts = values.map((v, i) => (v === null ? null : [x(i), y(v)] as const)).filter(Boolean) as (readonly [number, number])[];
  const d = pts.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)} ${b.toFixed(1)}`).join(" ");
  return (
    <Svg width={w} height={h}>
      {[0, max / 2, max].map((t, i) => (
        <G key={i}>
          <Line x1={PAD.l} x2={w - PAD.r} y1={y(t)} y2={y(t)} stroke={LINE} strokeWidth={0.5} />
          <Text x={PAD.l - 4} y={y(t) + 2.5} style={{ fontSize: 6 }} fill={GREY} textAnchor="end">{`${t}${unit}`}</Text>
        </G>
      ))}
      {d && <Path d={d} stroke={GOLD_INK} strokeWidth={1.5} fill="none" />}
      {pts.map(([a, b], i) => <Rect key={i} x={a - 2} y={b - 2} width={4} height={4} fill={GOLD_INK} />)}
      {labels.map((l, i) => <Text key={`${l}-${i}`} x={x(i)} y={h - 8} style={{ fontSize: 6 }} fill={GREY} textAnchor="middle">{l}</Text>)}
    </Svg>
  );
}

/** Planned vs forecast finish per project on one date axis: a grey dot (planned) and a gold dot (forecast). */
function DateChart({ rows, w = 360 }: { rows: { label: string; planned: string | null; forecast: string | null }[]; w?: number }) {
  const list = rows.slice(0, 14);
  const days = (d: string) => Date.parse(`${d}T00:00:00Z`) / 864e5;
  const all = list.flatMap((r) => [r.planned, r.forecast]).filter(Boolean) as string[];
  if (!all.length) return <Text style={s.muted}>No delivery or forecast dates yet.</Text>;
  const lo = Math.min(...all.map(days)) - 3, hi = Math.max(...all.map(days)) + 3;
  const lw = 92, iw = w - lw - 14, rh = 12, h = list.length * rh + 16;
  const x = (d: string) => lw + ((days(d) - lo) / (hi - lo)) * iw;
  const tick = (v: number) => new Date(v * 864e5).toISOString().slice(0, 10);
  return (
    <View>
      <Svg width={w} height={h}>
        {[lo + 3, (lo + hi) / 2, hi - 3].map((v, i) => (
          <G key={i}>
            <Line x1={x(tick(v))} x2={x(tick(v))} y1={0} y2={h - 12} stroke={LINE} strokeWidth={0.5} />
            <Text x={x(tick(v))} y={h - 3} style={{ fontSize: 6 }} fill={GREY} textAnchor="middle">{fmtDate(tick(v))}</Text>
          </G>
        ))}
        {list.map((r, i) => (
          <G key={`${r.label}-${i}`}>
            <Text x={lw - 4} y={i * rh + 7} style={{ fontSize: 6.5 }} fill={INK} textAnchor="end">{pdfText(r.label.slice(0, 22))}</Text>
            {r.planned && r.forecast && <Line x1={x(r.planned)} x2={x(r.forecast)} y1={i * rh + 5} y2={i * rh + 5} stroke={r.forecast > r.planned ? BAD : LINE} strokeWidth={1} />}
            {r.planned && <Rect x={x(r.planned) - 2.5} y={i * rh + 2.5} width={5} height={5} fill={BAR2} />}
            {r.forecast && <Rect x={x(r.forecast) - 2.5} y={i * rh + 2.5} width={5} height={5} fill={r.planned && r.forecast > r.planned ? BAD : GOLD} />}
          </G>
        ))}
      </Svg>
      <Legend series={[{ name: "Planned finish", colour: BAR2, values: [] }, { name: "Forecast finish", colour: GOLD, values: [] }, { name: "Forecast after planned", colour: BAD, values: [] }]} />
    </View>
  );
}

function Chart({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ width: "49%", marginBottom: 10 }} wrap={false}>
      <Text style={{ fontSize: 8, marginBottom: 4 }}>{title}</Text>
      {children}
    </View>
  );
}
const Charts = ({ children }: { children: ReactNode }) => <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", marginTop: 6 }}>{children}</View>;

// ───────────── tables ─────────────

type Col<T> = { label: string; w: number; get: (r: T) => string; mono?: boolean; bad?: (r: T) => boolean; bold?: (r: T) => boolean };

/** A table whose column headers repeat at the top of every page it runs onto. */
export function Table<T>({ cols, rows }: { cols: Col<T>[]; rows: T[] }) {
  return (
    <View style={s.table}>
      <View style={[s.tr, { backgroundColor: SOFT }]} fixed>
        {cols.map((c) => <Text key={c.label} style={[s.th, { width: `${c.w}%` }]}>{pdfText(c.label)}</Text>)}
      </View>
      {rows.map((r, i) => (
        <View key={i} style={s.tr} wrap={false}>
          {cols.map((c) => (
            <Text key={c.label} style={[s.td, { width: `${c.w}%` }, c.mono ? s.mono : {}, c.bad?.(r) ? { color: BAD } : {}, c.bold?.(r) ? { fontFamily: "Helvetica-Bold" } : {}]}>{pdfText(c.get(r))}</Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Tiles({ items }: { items: [string, string, string?][] }) {
  return (
    <View style={s.tiles}>
      {items.map(([k, v, note]) => (
        <View key={k} style={s.tile}>
          <Text style={{ fontSize: 7, color: GREY, textTransform: "uppercase", letterSpacing: 0.6 }}>{k}</Text>
          <Text style={[s.mono, { fontSize: 14, marginTop: 3 }]}>{v}</Text>
          {note ? <Text style={{ fontSize: 6.5, color: GREY, marginTop: 2 }}>{note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const pct = (v: number | null) => (v === null ? "—" : `${v}%`);
const hrs = (min: number) => Math.round((min / 60) * 10) / 10;
const dash = (x: string | null | undefined) => x || "—";
const effText = (alloc: number, eff: number) => (eff ? `${fmtDur(eff)}${overNote(alloc, eff) ? ` (${overNote(alloc, eff)})` : ""}` : "—");
const isOver = (alloc: number, eff: number) => !!overNote(alloc, eff);
const doc = (stamp: Stamp, children: ReactNode) => (
  <Document title={`${stamp.title} ${stamp.from} to ${stamp.to}`} author="Kynetik Koncepts"><Frame stamp={stamp}>{children}</Frame></Document>
);
const Empty = ({ what }: { what: string }) => <Text style={[s.muted, { marginTop: 12 }]}>No {what} in this period. Try another period or turn on &quot;Include not started&quot;.</Text>;

// ───────────── Employees / Crew performance (AM-26) ─────────────

export function PerformanceDoc({ stamp, people, summary, weeks, rows }: {
  stamp: Stamp; people: { id: string; name: string }[]; summary: PerfSummary[]; weeks: WeekPoint[]; rows: PerfRow[];
}) {
  const fin = rows.filter((r) => r.status === "Finished" && r.finishedAt && r.finishedAt.slice(0, 10) >= stamp.from && r.finishedAt.slice(0, 10) <= stamp.to);
  const qc = fin.filter((r) => r.qcResult);
  const names = summary.map((x) => x.employee);
  return doc(stamp, (
    <>
      <Text style={s.h1}>{stamp.title}</Text>
      {!rows.length ? <Empty what="employee activity" /> : (
        <>
          <Tiles items={[["Employees", String(people.length)], ["Tasks finished", String(fin.length)],
            ["On-time %", fin.length ? `${Math.round((fin.filter((r) => r.onTime).length / fin.length) * 100)}%` : "—", "Within allocated time + tolerance"],
            ["First-time QC pass %", qc.length ? `${Math.round((qc.filter((r) => r.qcResult === "Passed first time").length / qc.length) * 100)}%` : "—", "Finished work with a QC step"]]} />
          <Charts>
            <Chart title="Allocated vs effective hours per person">
              <HBarChart labels={names} unit="h" series={[
                { name: "Allocated", colour: BAR2, values: summary.map((x) => hrs(x.allocatedMin)) },
                { name: "Effective", colour: GOLD, values: summary.map((x) => hrs(x.effectiveMin)) },
              ]} />
            </Chart>
            <Chart title="Trend by week: allocated vs effective hours of finished work">
              <BarChart labels={weeks.map((x) => fmtDate(x.week))} unit="h" series={[
                { name: "Allocated", colour: BAR2, values: weeks.map((x) => Math.round(x.allocatedH * 10) / 10) },
                { name: "Effective", colour: GOLD, values: weeks.map((x) => Math.round(x.effectiveH * 10) / 10) },
              ]} />
            </Chart>
            <Chart title="On-time % per person (finished work)">
              <HBarChart labels={names} unit="%" max={100} series={[{ name: "On time", colour: GOLD, values: summary.map((x) => x.onTimePct) }]} />
            </Chart>
            <Chart title="First-time QC pass % per person">
              <HBarChart labels={names} unit="%" max={100} series={[{ name: "QC first time", colour: GOLD_INK, values: summary.map((x) => x.firstTimeQcPct) }]} />
            </Chart>
          </Charts>

          <Text style={s.h2} break>Summary per employee</Text>
          <Table<PerfSummary> rows={summary} cols={[
            { label: "Employee", w: 14, get: (r) => r.employee }, { label: "Department", w: 12, get: (r) => r.department },
            { label: "Tasks finished", w: 8, get: (r) => String(r.finished), mono: true }, { label: "On time", w: 7, get: (r) => pct(r.onTimePct), mono: true },
            { label: "QC 1st time", w: 8, get: (r) => pct(r.firstTimeQcPct), mono: true }, { label: "Allocated", w: 9, get: (r) => fmtDur(r.allocatedMin), mono: true },
            { label: "Effective", w: 9, get: (r) => fmtDur(r.effectiveMin), mono: true, bad: (r) => isOver(r.allocatedMin, r.effectiveMin) },
            { label: "Variance", w: 8, get: (r) => `${r.effectiveMin >= r.allocatedMin ? "+" : "-"}${fmtDur(Math.abs(r.effectiveMin - r.allocatedMin))}`, mono: true, bad: (r) => isOver(r.allocatedMin, r.effectiveMin) },
            { label: "Ext.", w: 4, get: (r) => String(r.extensions), mono: true }, { label: "Rework", w: 6, get: (r) => fmtDur(r.reworkMin), mono: true },
            { label: "Absence", w: 15, get: (r) => leaveSummary(r.absence) },
          ]} />

          <Text style={s.h2}>Tasks</Text>
          <Table<PerfRow> rows={rows} cols={[
            { label: "Employee", w: 9, get: (r) => r.employee, bold: () => true }, { label: "Project", w: 10, get: (r) => dash(r.project) },
            { label: "Part", w: 12, get: (r) => dash([r.partSerial, r.partName].filter(Boolean).join(" ")) },
            { label: "Stage / task", w: 11, get: (r) => (r.stage && r.stage !== r.task ? `${r.stage} · ${r.task}` : r.task) },
            { label: "Assigned", w: 8, get: (r) => dash(fmtStamp(r.assignedOn)), mono: true }, { label: "Started", w: 8, get: (r) => dash(fmtStamp(r.actualStart)), mono: true },
            { label: "Finished", w: 8, get: (r) => dash(fmtStamp(r.finishedAt)), mono: true }, { label: "Allocated", w: 7, get: (r) => fmtDur(r.totalAllocatedMin), mono: true },
            { label: "Effective", w: 10, get: (r) => effText(r.totalAllocatedMin, r.effectiveMin), mono: true, bad: (r) => isOver(r.totalAllocatedMin, r.effectiveMin) },
            { label: "QC", w: 9, get: (r) => dash(r.qcResult) }, { label: "Status", w: 8, get: (r) => r.status },
          ]} />
        </>
      )}
    </>
  ));
}

// ───────────── Parts ─────────────

export function PartsDoc({ stamp, rows }: { stamp: Stamp; rows: PartReport[] }) {
  const steps = rows.flatMap((r) => r.steps);
  const stages = [...new Set(steps.map((x) => x.stage))];
  const pass = rows.reduce((n, r) => n + r.qcPassed, 0), fail = rows.reduce((n, r) => n + r.qcFailed, 0);
  const statuses = ["Finished", "Waiting for QC", "In progress", "Blocked", "Not started"].filter((x) => rows.some((r) => r.status === x));
  return doc(stamp, (
    <>
      <Text style={s.h1}>{stamp.title}</Text>
      {!rows.length ? <Empty what="part activity" /> : (
        <>
          <Tiles items={[["Parts", String(rows.length), "With activity in the period"], ["Stages completed", String(rows.reduce((n, r) => n + r.stepsFinished, 0)), "Finished in the period"],
            ["Parts finished", String(rows.filter((r) => r.finishedInPeriod).length), "Last stage finished in the period"], ["QC attempts", String(pass + fail), `${pass} passed · ${fail} failed`]]} />
          <Charts>
            <Chart title="Time per stage: allocated vs effective hours">
              <BarChart labels={stages} unit="h" series={[
                { name: "Allocated", colour: BAR2, values: stages.map((st) => hrs(steps.filter((x) => x.stage === st).reduce((n, x) => n + x.allocatedMin, 0))) },
                { name: "Effective", colour: GOLD, values: stages.map((st) => hrs(steps.filter((x) => x.stage === st).reduce((n, x) => n + x.effectiveMin, 0))) },
              ]} />
            </Chart>
            <Chart title="QC attempts per stage">
              <BarChart labels={stages} series={[
                { name: "Passed", colour: GOLD, values: stages.map((st) => steps.filter((x) => x.stage === st).reduce((n, x) => n + x.qcPassed, 0)) },
                { name: "Failed", colour: BAD, values: stages.map((st) => steps.filter((x) => x.stage === st).reduce((n, x) => n + x.qcFailed, 0)) },
              ]} />
            </Chart>
            <Chart title="Parts by status">
              <HBarChart labels={statuses} series={[{ name: "Parts", colour: GOLD, values: statuses.map((x) => rows.filter((r) => r.status === x).length) }]} />
            </Chart>
          </Charts>

          <Text style={s.h2} break>Parts</Text>
          <Table<PartReport> rows={rows} cols={[
            { label: "Serial", w: 10, get: (r) => dash(r.serial), mono: true }, { label: "Part", w: 14, get: (r) => r.part }, { label: "Project", w: 13, get: (r) => r.project },
            { label: "Material · finish", w: 14, get: (r) => dash(materialFinish(r)) }, { label: "Current stage", w: 12, get: (r) => dash(r.currentStage) },
            { label: "Progress", w: 7, get: (r) => `${r.stagesDone}/${r.stagesTotal}`, mono: true }, { label: "Allocated", w: 8, get: (r) => fmtDur(r.allocatedMin), mono: true },
            { label: "Effective", w: 12, get: (r) => effText(r.allocatedMin, r.effectiveMin), mono: true, bad: (r) => isOver(r.allocatedMin, r.effectiveMin) },
            { label: "Status", w: 10, get: (r) => r.status },
          ]} />

          <Text style={s.h2}>Stage timeline of each part</Text>
          <Table<PartReport["steps"][number]> rows={steps} cols={[
            { label: "Part", w: 12, get: (r) => `${r.serial} ${r.part}`.trim(), bold: (r) => r.stageNo === 1 },
            { label: "Stage", w: 13, get: (r) => `${r.stageNo}. ${r.stage}${r.component ? ` · ${r.component}` : ""}` }, { label: "Technician", w: 9, get: (r) => dash(r.technician) },
            { label: "Assigned", w: 8, get: (r) => dash(fmtStamp(r.assignedOn)), mono: true }, { label: "Started", w: 8, get: (r) => dash(fmtStamp(r.started)), mono: true },
            { label: "QC requested", w: 8, get: (r) => dash(fmtStamp(r.qcRequested)), mono: true }, { label: "QC", w: 10, get: (r) => dash(r.qcResult ? `${r.qcResult} (${r.qcAttempts})` : "") },
            { label: "Finished", w: 8, get: (r) => dash(fmtStamp(r.finished)), mono: true }, { label: "Allocated", w: 6, get: (r) => fmtDur(r.allocatedMin), mono: true },
            { label: "Effective", w: 10, get: (r) => effText(r.allocatedMin, r.effectiveMin), mono: true, bad: (r) => isOver(r.allocatedMin, r.effectiveMin) },
            { label: "Status", w: 8, get: (r) => r.status },
          ]} />
        </>
      )}
    </>
  ));
}

// ───────────── Projects ─────────────

export function ProjectsDoc({ stamp, rows }: { stamp: Stamp; rows: ProjectReport[] }) {
  const depts = [...new Set(rows.flatMap((r) => r.byDept.map((d) => d.department)))];
  const stages = rows.flatMap((r) => r.stages.map((x) => ({ ...x, project: r.project })));
  return doc(stamp, (
    <>
      <Text style={s.h1}>{stamp.title}</Text>
      {!rows.length ? <Empty what="project activity" /> : (
        <>
          <Tiles items={[["Projects", String(rows.length)], ["On track", String(rows.filter((r) => ["On track", "At risk", "Finished"].includes(r.health)).length), "At risk included"],
            ["Late", String(rows.filter((r) => r.health === "Late").length), "Forecast after delivery date"], ["Average progress", `${Math.round(rows.reduce((n, r) => n + r.progressPct, 0) / rows.length)}%`, "Stage steps finished"]]} />
          <Charts>
            <Chart title="Progress per project (stage steps finished)">
              <HBarChart labels={rows.map((r) => r.project)} unit="%" max={100} series={[{ name: "Progress", colour: GOLD, values: rows.map((r) => r.progressPct) }]} />
            </Chart>
            <Chart title="Planned vs forecast finish">
              <DateChart rows={rows.map((r) => ({ label: r.project, planned: r.planned, forecast: r.forecast }))} />
            </Chart>
            <Chart title="Hours by department: allocated vs effective">
              <BarChart labels={depts} unit="h" series={[
                { name: "Allocated", colour: BAR2, values: depts.map((d) => hrs(rows.reduce((n, r) => n + (r.byDept.find((x) => x.department === d)?.allocatedMin ?? 0), 0))) },
                { name: "Effective", colour: GOLD, values: depts.map((d) => hrs(rows.reduce((n, r) => n + (r.byDept.find((x) => x.department === d)?.effectiveMin ?? 0), 0))) },
              ]} />
            </Chart>
          </Charts>

          <Text style={s.h2} break>Projects</Text>
          <Table<ProjectReport> rows={rows} cols={[
            { label: "Project", w: 16, get: (r) => r.project }, { label: "Status", w: 9, get: (r) => r.health, bad: (r) => r.health === "Late" },
            { label: "Progress", w: 7, get: (r) => `${r.progressPct}%`, mono: true }, { label: "Parts done", w: 7, get: (r) => `${r.partsDone}/${r.partsTotal}`, mono: true },
            { label: "Start", w: 7, get: (r) => fmtDate(r.start), mono: true }, { label: "Planned", w: 7, get: (r) => (r.planned ? fmtDate(r.planned) : "—"), mono: true },
            { label: "Forecast", w: 7, get: (r) => (r.forecast ? fmtDate(r.forecast) : "—"), mono: true, bad: (r) => !!r.planned && !!r.forecast && r.forecast > r.planned },
            { label: "Allocated", w: 8, get: (r) => fmtDur(r.allocatedMin), mono: true },
            { label: "Effective", w: 12, get: (r) => effText(r.allocatedMin, r.effectiveMin), mono: true, bad: (r) => isOver(r.allocatedMin, r.effectiveMin) },
            { label: "Late steps", w: 6, get: (r) => String(r.delays), mono: true }, { label: "Ext.", w: 4, get: (r) => String(r.extensions), mono: true },
            { label: "QC fails", w: 5, get: (r) => String(r.qcFailures), mono: true }, { label: "Absence d", w: 5, get: (r) => String(r.absenceDays), mono: true },
          ]} />

          <Text style={s.h2}>Stage breakdown</Text>
          <Table<(typeof stages)[number]> rows={stages} cols={[
            { label: "Project", w: 17, get: (r) => r.project }, { label: "Stage", w: 16, get: (r) => r.stage }, { label: "Department", w: 13, get: (r) => r.department },
            { label: "Steps done", w: 8, get: (r) => `${r.stepsDone}/${r.steps}`, mono: true }, { label: "Allocated", w: 9, get: (r) => fmtDur(r.allocatedMin), mono: true },
            { label: "Effective", w: 15, get: (r) => effText(r.allocatedMin, r.effectiveMin), mono: true, bad: (r) => isOver(r.allocatedMin, r.effectiveMin) },
            { label: "Late steps", w: 7, get: (r) => String(r.delays), mono: true }, { label: "Extensions", w: 8, get: (r) => String(r.extensions), mono: true },
            { label: "QC fails", w: 7, get: (r) => String(r.qcFailures), mono: true },
          ]} />
        </>
      )}
    </>
  ));
}

// ───────────── Activity log ─────────────

const PDF_ROWS = 2000;

export function ActivityDoc({ stamp, rows }: { stamp: Stamp; rows: ActivityRow[] }) {
  const days: string[] = [];
  for (let d = stamp.from; d <= stamp.to && days.length < 62; d = new Date(Date.parse(`${d}T00:00:00Z`) + 864e5).toISOString().slice(0, 10)) days.push(d);
  const byDay = days.length <= 31 ? days.map((d) => ({ label: `${+d.slice(8, 10)}`, n: rows.filter((r) => r.at.slice(0, 10) === d).length }))
    : [...new Set(days.map(weekOf))].map((wk) => ({ label: fmtDate(wk), n: rows.filter((r) => weekOf(r.at.slice(0, 10)) === wk).length }));
  const types = [...rows.reduce((mp, r) => mp.set(r.type, (mp.get(r.type) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  return doc(stamp, (
    <>
      <Text style={s.h1}>{stamp.title}</Text>
      {!rows.length ? <Empty what="activity" /> : (
        <>
          <Tiles items={[["Actions", String(rows.length)], ["People", String(new Set(rows.map((r) => r.who)).size)], ["Most common", types[0]?.[0] ?? "—"],
            ["Days with activity", String(new Set(rows.map((r) => r.at.slice(0, 10))).size)]]} />
          <Charts>
            <Chart title={days.length <= 31 ? "Actions per day" : "Actions per week"}>
              <BarChart labels={byDay.map((x) => x.label)} series={[{ name: "Actions", colour: GOLD, values: byDay.map((x) => x.n) }]} />
            </Chart>
            <Chart title="Actions by type">
              <HBarChart labels={types.map(([k]) => k)} series={[{ name: "Actions", colour: GOLD, values: types.map(([, v]) => v) }]} />
            </Chart>
          </Charts>

          <Text style={s.h2} break>Actions, newest first{rows.length > PDF_ROWS ? ` (the latest ${PDF_ROWS}; the CSV has every one)` : ""}</Text>
          <Table<ActivityRow> rows={rows.slice(0, PDF_ROWS)} cols={[
            { label: "When", w: 10, get: (r) => fmtStamp(r.at), mono: true }, { label: "Who", w: 12, get: (r) => `${r.who}${r.role ? ` (${r.role})` : ""}` },
            { label: "Type", w: 8, get: (r) => r.type }, { label: "Action", w: 8, get: (r) => r.what }, { label: "Item", w: 20, get: (r) => r.item },
            { label: "Before → after", w: 26, get: (r) => dash(r.change.slice(0, 200)) }, { label: "Notes", w: 16, get: (r) => dash(r.notes.slice(0, 120)) },
          ]} />
        </>
      )}
    </>
  ));
}

export const toPdf = (el: React.ReactElement) => renderToBuffer(el as Parameters<typeof renderToBuffer>[0]);
