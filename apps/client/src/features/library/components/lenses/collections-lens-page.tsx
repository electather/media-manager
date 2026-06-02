import { useLibraryContent } from "../../hooks/use-library-content";
import { LibraryEmpty } from "../library-empty";
import { CollectionsLens } from "./collections-lens";

/** `/library/collections` — the curated-collections lens. */
export function CollectionsLensPage() {
  const { items, collections, isEmpty, resetFilters } = useLibraryContent();
  if (isEmpty) return <LibraryEmpty onReset={resetFilters} />;
  return <CollectionsLens items={items} collections={collections} />;
}
