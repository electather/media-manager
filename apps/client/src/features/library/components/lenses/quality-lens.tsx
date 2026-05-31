import { useMemo } from "react";
import { groupByQuality } from "../../lib/grouping";
import type { LibraryItem } from "../../lib/types";
import { GroupedLens } from "./grouped-lens";

/** Technical-tier view: one section per quality tag (4K HDR → Atmos), titles within. */
export function QualityLens({ items }: { items: LibraryItem[] }) {
  const groups = useMemo(() => groupByQuality(items), [items]);
  return <GroupedLens groups={groups} />;
}
