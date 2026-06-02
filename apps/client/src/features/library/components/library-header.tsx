import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { useLibrary } from "../hooks/use-library";
import { useLibraryFilters } from "../hooks/use-library-filters";
import { useLibraryView } from "../hooks/use-library-view";
import { LibraryFilterPopover } from "./library-filter-popover";
import { LibraryLensTabs } from "./library-lens-tabs";

/**
 * The library header region: eyebrow + title and the control bar (lens tabs on
 * the lead edge; filters on the trail edge). Rendered once in the layout, it
 * reads the shared payload and URL filters itself so it stays
 * mounted while the lens routes swap below it.
 */
export function LibraryHeader() {
  const { data } = useLibrary();
  const { filters, setFilters } = useLibraryFilters();
  const { filtered, facetValues, facetCounts } = useLibraryView({ data, filters });

  return (
    <header>
      <SectionHead size="page">
        <SectionHeadHeading>
          <SectionHeadEyebrow size="page">
            {m.library_eyebrow({ count: String(filtered.length) })}
          </SectionHeadEyebrow>
          <SectionHeadTitle as="h1" size="page">
            {m.library_title()}
          </SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4 pb-6">
        <LibraryLensTabs />
        <LibraryFilterPopover
          filters={filters}
          facetValues={facetValues}
          facetCounts={facetCounts}
          onChange={setFilters}
        />
      </div>
    </header>
  );
}
