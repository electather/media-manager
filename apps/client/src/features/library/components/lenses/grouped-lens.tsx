import type { LibraryGroup } from "../../lib/grouping";
import { LibraryGrid } from "../library-grid";
import { LibrarySectionHeader } from "./library-section-header";

/** Renders pre-computed groups as stacked sections, each a header over a poster grid. */
export function GroupedLens({ groups }: { groups: LibraryGroup[] }) {
  return (
    <div className="flex flex-col gap-12">
      {groups.map((group) => (
        <section key={group.key}>
          <LibrarySectionHeader label={group.label} count={group.items.length} />
          <LibraryGrid items={group.items} />
        </section>
      ))}
    </div>
  );
}
