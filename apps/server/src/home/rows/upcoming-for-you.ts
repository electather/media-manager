import { makeBoundedRow } from "../internal/pipeline";
import { loadCanonicalItems, ROW_PAGE_SIZE } from "./_shared";
import { upcomingForYouSource } from "../sources/upcoming";

/**
 * Bounded row (single page) for upcoming releases from calendar plugin.
 * Decorates cards with episode payload; deduping in upcomingForYouSource.
 */
const provider = makeBoundedRow({
  rowId: "upcomingForYou",
  kind: "upcomingForYou",
  titleKey: "home_row_upcomingForYou_header",
  capability: "calendar",
  source: upcomingForYouSource,
  project: (ctx, rows) =>
    loadCanonicalItems(ctx, rows.slice(0, ROW_PAGE_SIZE), {
      decorate: (item, hit) => {
        if (hit.episode) item.episode = hit.episode;
      },
    }),
});

export default provider;
