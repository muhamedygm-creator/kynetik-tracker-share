import Link from "next/link";
import { Card, PageHead } from "@/components/ui/primitives";
import { describeItem } from "@/domain/conflicts";
import { fmtDT } from "@/domain/format";
import { requireViewer } from "@/lib/auth";
import { boardAlerts } from "@/lib/data/derived";
import { loadWorld } from "@/lib/data/world";

/** Data health: existing overlaps (one technician on two part steps at once). Moved off the home page. */
export default async function HealthPage() {
  const viewer = await requireViewer();
  const w = await loadWorld(viewer);
  const { doubleBookings } = boardAlerts(w);
  const nameOf = (id: string) => w.people.find((p) => p.id === id)?.name ?? "?";
  const byPerson = new Map<string, typeof doubleBookings>();
  for (const c of doubleBookings) byPerson.set(c.tech, [...(byPerson.get(c.tech) ?? []), c]);
  return (
    <div className="grid gap-5">
      <div>
        <Link href="/builds" className="label hover:text-gold">← Builds</Link>
        <PageHead eyebrow="Records to tidy up" title="Data health" />
      </div>
      <p className="max-w-[70ch] text-sm text-grey">
        These records show one person working on two part steps at the same time. New changes that would do this are refused; these came from earlier data.
        Fix each one by finishing, blocking or correcting the times of one side.
      </p>
      {!byPerson.size && <Card className="p-6 text-grey">All clear. Nobody is booked on two part steps at once.</Card>}
      {[...byPerson].map(([tech, list]) => (
        <Card key={tech} className="p-4">
          <h2 className="mb-2 font-semibold">{nameOf(tech)} <span className="font-mono text-xs font-normal text-grey">{list.length} overlap{list.length === 1 ? "" : "s"}</span></h2>
          <ul className="grid gap-1.5 text-sm">
            {list.map((c, i) => {
              const a = describeItem(c.a), b = describeItem(c.b);
              return (
                <li key={i}>
                  <Link className="text-gold hover:underline" href={`/builds/${c.a.project.id}`}>{a.serial} · {a.stage} · {a.part}</Link>
                  {" "}and{" "}
                  <Link className="text-gold hover:underline" href={`/builds/${c.b.project.id}`}>{b.serial} · {b.stage} · {b.part}</Link>
                  <span className="text-grey"> · from {fmtDT(c.seg.start)}</span>
                </li>
              );
            })}
          </ul>
        </Card>
      ))}
    </div>
  );
}
