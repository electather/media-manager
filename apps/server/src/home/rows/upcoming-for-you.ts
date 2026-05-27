import { makeBoundedRow } from "../internal/pipeline";
import { loadCanonicalItems, ROW_PAGE_SIZE } from "./_shared";
import { upcomingForYouSource } from "../sources/upcoming";

/**
 * Upcoming releases tagged off the calendar plugin. Bounded — the row ships
 * a single page. The feed fetch, entry-shape probe, and per-show dedupe live in
 * `upcomingForYouSource.fetchRawSet`; this row projects the bounded slice (so
 * the shared pipeline mints `cursor: null`) and decorates each card with its
 * episode payload.
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
