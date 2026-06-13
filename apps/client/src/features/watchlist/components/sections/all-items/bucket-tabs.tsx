import * as m from "@/paraglide/messages";
import type { WatchlistBucket } from "@nama/shared/watchlist";
import { WATCHLIST_BUCKETS } from "@nama/shared/watchlist";
import { RouteTab, RouteTabs } from "@/shared/components/route-tabs";

/**
 * The watchlist bucket filter shown in the layout header. Each bucket is a
 * `<RouteTab>` whose active state derives from the router-set
 * `data-status=active` attribute, so the strip stays in sync with deep links
 * and back/forward without a duplicate piece of state. Adding a bucket = one
 * edit to `WATCHLIST_BUCKETS` + a new child route file; the tab auto-renders
 * here (V.WL8). Built on the shared `RouteTabs` so it reads identically to the
 * library lens switcher.
 */
export function BucketTabs() {
  return (
    <RouteTabs aria-label={m.watchlist_filter_label()}>
      <RouteTab
        to="/watchlist"
        title={m.watchlist_bucket_label({ bucket: "all" })}
        subtitle={m.watchlist_filter_note({ bucket: "all" })}
        aria-label={m.watchlist_bucket_chip_aria({ bucket: "all" })}
      />
      {WATCHLIST_BUCKETS.map((bucket: WatchlistBucket) => (
        <RouteTab
          key={bucket}
          to={`/watchlist/${bucket}`}
          title={m.watchlist_bucket_label({ bucket })}
          subtitle={m.watchlist_filter_note({ bucket })}
          aria-label={m.watchlist_bucket_chip_aria({ bucket })}
        />
      ))}
    </RouteTabs>
  );
}
