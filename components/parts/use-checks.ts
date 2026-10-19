"use client";
import { useEffect, useMemo, useState } from "react";
import { takenSerials } from "@/app/(console)/builds/parts-actions";
import { projectSerialOf, validatePartRows, type PartRow, type Problem } from "@/domain/parts-csv";

/**
 * The same checks the server runs, live as the table is edited. Serials already used in the tracker are
 * fetched once per project serial (the server checks again on save).
 */
export function usePartChecks(rows: PartRow[], o: { materials: string[]; sheens: string[]; projectSerial?: string }) {
  const prefix = o.projectSerial ?? projectSerialOf(rows);
  const [used, setUsed] = useState<{ prefix: string; serials: Set<string>; projectTaken: boolean } | null>(null);
  useEffect(() => {
    if (!prefix || used?.prefix === prefix) return;
    let live = true;
    takenSerials(prefix).then((r) => live && setUsed({ prefix, serials: new Set(r.serials), projectTaken: r.projectTaken })).catch(() => {});
    return () => { live = false; };
  }, [prefix, used?.prefix]);

  const problems: Problem[] = useMemo(() => {
    const opts = {
      taken: (s: string) => used?.prefix === prefix && !!used?.serials.has(s.toLowerCase()),
      lists: { materials: o.materials, sheens: o.sheens },
      projectSerial: o.projectSerial ?? null,
    };
    return validatePartRows(rows, opts);
  }, [rows, used, prefix, o.materials, o.sheens, o.projectSerial]);

  return { problems, prefix, projectTaken: !o.projectSerial && used?.prefix === prefix && !!used?.projectTaken, checked: used?.prefix === prefix };
}
