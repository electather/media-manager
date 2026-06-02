import { LibrarySectionGrid, type LibrarySectionGridProps } from "./library-section-grid";

/**
 * Technical-tier view: one section per quality tier (4K HDR → SD), titles
 * within. The server expands each title once per tier (`json_each`), sorts by
 * descending fidelity, and stamps the `section` ({ id, label }) onto every row,
 * so `toSectionEntries` splices a tier header on each boundary and the shared
 * section grid keys repeats by `id + sectionKey`. A thin pass — the grouping is
 * server-side.
 */
export function QualityLens(props: Omit<LibrarySectionGridProps, "renderHeader">) {
  return <LibrarySectionGrid {...props} />;
}
