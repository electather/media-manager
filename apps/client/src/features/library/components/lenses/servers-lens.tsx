import { LibrarySectionGrid, type LibrarySectionGridProps } from "./library-section-grid";

/**
 * Availability view: one section per media server, listing the titles it hosts.
 * The server expands each title once per server (`json_each`) and stamps the
 * `section` ({ id, label }) onto every row, so `toSectionEntries` splices a
 * server header on each boundary and the shared section grid keys repeats by
 * `id + sectionKey`. A thin pass — the grouping is server-side.
 */
export function ServersLens(props: Omit<LibrarySectionGridProps, "renderHeader">) {
  return <LibrarySectionGrid {...props} />;
}
