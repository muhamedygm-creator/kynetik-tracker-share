import Link from "next/link";
import { NewProject } from "@/components/parts/new-project";
import { PageHead } from "@/components/ui/primitives";
import { requireViewer } from "@/lib/auth";
import { loadWorld } from "@/lib/data/world";

/** + New project (amends AM-02): upload a CSV or type the parts in, review, then create. Owner and Supervisors. */
export default async function NewProjectPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const sp = await searchParams;
  const viewer = await requireViewer(["owner", "supervisor"]);
  const w = await loadWorld(viewer);
  const mode = sp.mode === "manual" ? "manual" : sp.mode === "csv" ? "csv" : null;
  const stages = w.templates.find((t) => t.key === "exteriorPanels")?.stages.map((s) => s.name) ?? [];
  const tab = (m: "csv" | "manual", label: string) => (
    <Link href={`/builds/new?mode=${m}`} aria-current={mode === m ? "page" : undefined}
      className={`min-h-11 border-b-2 px-4 pt-2.5 text-sm ${mode === m ? "border-gold text-ink" : "border-transparent text-grey hover:text-ink"}`}>{label}</Link>
  );
  return (
    <div className="grid gap-4 [&>*]:min-w-0">
      <Link href="/builds" className="label hover:text-gold">← Projects</Link>
      <PageHead eyebrow="Exterior panels workflow" title="New project" />
      <nav aria-label="How to add the parts" className="flex gap-1 border-b border-line">
        {tab("csv", "Upload CSV")}
        {tab("manual", "Create manually")}
      </nav>
      {mode
        ? <NewProject key={mode} mode={mode} today={w.today} materials={w.settings.labels.materials} sheens={w.settings.labels.sheens} stages={stages} />
        : (
          <div className="grid max-w-3xl gap-3 sm:grid-cols-2">
            <Link href="/builds/new?mode=csv" className="grid gap-1 rounded-xl border border-line bg-panel p-5 hover:border-gold">
              <span className="eyebrow">Upload CSV</span>
              <span className="text-sm text-grey">A parts list prepared from KYNETIK_PARTS_TEMPLATE.csv. Every row is checked and shown for review first.</span>
            </Link>
            <Link href="/builds/new?mode=manual" className="grid gap-1 rounded-xl border border-line bg-panel p-5 hover:border-gold">
              <span className="eyebrow">Create manually</span>
              <span className="text-sm text-grey">Type the parts into the same table, with the same checks.</span>
            </Link>
          </div>
        )}
    </div>
  );
}
