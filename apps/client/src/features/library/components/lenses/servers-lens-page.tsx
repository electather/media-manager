import { useLibraryContent } from "../../hooks/use-library-content";
import { LibraryEmpty } from "../library-empty";
import { ServersLens } from "./servers-lens";

/** `/library/server` — the per-server availability lens. */
export function ServersLensPage() {
  const { items, isEmpty, resetFilters } = useLibraryContent();
  if (isEmpty) return <LibraryEmpty onReset={resetFilters} />;
  return <ServersLens items={items} />;
}
