import { LibraryCard } from "./library-card";
import type { LibraryItem } from "../lib/types";

/**
 * The poster grid shared by the A→Z, Servers and Quality lenses. Auto-fills
 * columns at a fixed minimum tile width so density scales with the viewport.
 */
export function LibraryGrid({ items }: { items: LibraryItem[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-x-3.5 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))]">
      {items.map((item) => (
        <LibraryCard key={item.id} item={item} />
      ))}
    </div>
  );
}
