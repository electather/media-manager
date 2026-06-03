import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { useLibraryFacets } from "../hooks/use-library-facets";
import { useLibraryFilters } from "../hooks/use-library-filters";
import { libraryOwnedTotal } from "../lib/facets";
import { LibraryFilterPopover } from "./library-filter-popover";
import { LibraryLensTabs } from "./library-lens-tabs";

/**
 * The library header region: eyebrow + title and the control bar (lens tabs on
 * the lead edge; filters on the trail edge). Rendered once in the layout, it
 * reads the non-blocking facet totals and the URL filters itself so it stays
 * mounted while the lens routes swap below it. The eyebrow count is the
 * whole-library owned total (sum of the per-kind facet totals), matching the
 * unfiltered facets semantics; it shows nothing until the facets land.
 */
export function LibraryHeader() {
  const { filters, setFilters } = useLibraryFilters();
  const { facetValues, facetCounts } = useLibraryFacets();
  const count = libraryOwnedTotal(facetCounts);

  return (
    <header>
      <SectionHead size="page">
        <SectionHeadHeading>
          <SectionHeadEyebrow size="page">
            {m.library_eyebrow({ count: String(count) })}
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
