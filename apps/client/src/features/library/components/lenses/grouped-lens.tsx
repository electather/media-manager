import {
  SectionHead,
  SectionHeadCount,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import type { LibraryGroup } from "../../lib/grouping";
import { LibraryGrid } from "../library-grid";

/** Renders pre-computed groups as stacked sections, each a header over a poster grid. */
export function GroupedLens({ groups }: { groups: LibraryGroup[] }) {
  return (
    <div className="flex flex-col gap-12">
      {groups.map((group) => (
        <section key={group.key}>
          <SectionHead>
            <SectionHeadHeading>
              <SectionHeadTitle>
                {group.label}
                <SectionHeadCount value={group.items.length} />
              </SectionHeadTitle>
            </SectionHeadHeading>
          </SectionHead>
          <LibraryGrid items={group.items} />
        </section>
      ))}
    </div>
  );
}
