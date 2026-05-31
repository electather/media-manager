import { useMemo } from "react";
import { groupByServer } from "../../lib/grouping";
import type { LibraryItem } from "../../lib/types";
import { GroupedLens } from "./grouped-lens";

/** Availability view: one section per media server, listing the titles it hosts. */
export function ServersLens({ items }: { items: LibraryItem[] }) {
  const groups = useMemo(() => groupByServer(items), [items]);
  return <GroupedLens groups={groups} />;
}
