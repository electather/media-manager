import { useLibraryContent } from "../../hooks/use-library-content";
import { LibraryEmpty } from "../library-empty";
import { TimelineLens } from "./timeline-lens";

/** `/library/timeline` — the release-decade lens. */
export function TimelineLensPage() {
  const { items, isEmpty, resetFilters } = useLibraryContent();
  if (isEmpty) return <LibraryEmpty onReset={resetFilters} />;
  return <TimelineLens items={items} />;
}
