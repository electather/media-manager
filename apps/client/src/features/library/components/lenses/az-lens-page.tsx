import { useLibraryContent } from "../../hooks/use-library-content";
import { LibraryEmpty } from "../library-empty";
import { AzLens } from "./az-lens";

/** `/library` (index) — the alphabetical index lens. */
export function AzLensPage() {
  const { items, isEmpty, resetFilters } = useLibraryContent();
  if (isEmpty) return <LibraryEmpty onReset={resetFilters} />;
  return <AzLens items={items} />;
}
