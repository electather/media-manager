import { useLibraryContent } from "../../hooks/use-library-content";
import { LibraryEmpty } from "../library-empty";
import { QualityLens } from "./quality-lens";

/** `/library/quality` — the quality-tier lens. */
export function QualityLensPage() {
  const { items, isEmpty, resetFilters } = useLibraryContent();
  if (isEmpty) return <LibraryEmpty onReset={resetFilters} />;
  return <QualityLens items={items} />;
}
