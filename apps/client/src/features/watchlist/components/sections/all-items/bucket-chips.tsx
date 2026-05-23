import { Link } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import type { WatchlistBucket, WatchlistCounts } from "@ent-mcp/shared/watchlist";
import { WATCHLIST_BUCKETS } from "@ent-mcp/shared/watchlist";
import { cn } from "@/shared/lib/utils";

type ChipKey = "all" | WatchlistBucket;

const BUCKET_LABELS: Record<WatchlistBucket, () => string> = {
  ready: m.watchlist_filter_ready,
  "in-progress": m.watchlist_filter_in_progress,
  awaiting: m.watchlist_filter_awaiting,
  upcoming: m.watchlist_filter_upcoming,
};

const BUCKET_COUNT: Record<WatchlistBucket, keyof WatchlistCounts> = {
  ready: "ready",
  "in-progress": "inProgress",
  awaiting: "awaiting",
  upcoming: "upcoming",
};

interface BucketChipsProps {
  counts: WatchlistCounts;
}

/**
 * Chip strip shown in the watchlist layout header. The active chip is
 * derived from the router-set `data-status=active` attribute so the strip
 * stays in sync with deep links and back/forward navigation without a
 * duplicate piece of state. Adding a new bucket = single edit to
 * `WATCHLIST_BUCKETS` + a new child route file; the chip auto-renders here
 * (V.WL8).
 */
export function BucketChips({ counts }: BucketChipsProps) {
  return (
    <div role="tablist" aria-label={m.watchlist_filter_label()} className="flex flex-wrap gap-2">
      <BucketChipLink chipKey="all" label={m.watchlist_filter_all()} count={counts.total} />
      {WATCHLIST_BUCKETS.map((b) => (
        <BucketChipLink
          key={b}
          chipKey={b}
          label={BUCKET_LABELS[b]()}
          count={counts[BUCKET_COUNT[b]] ?? 0}
        />
      ))}
    </div>
  );
}

interface BucketChipLinkProps {
  chipKey: ChipKey;
  label: string;
  count: number;
}

const CHIP_BASE_CLASS = cn(
  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
  "border-border bg-card text-foreground hover:bg-accent",
  "data-[status=active]:border-primary data-[status=active]:bg-primary",
  "data-[status=active]:text-primary-foreground data-[status=active]:hover:bg-primary",
);

function BucketChipLink({ chipKey, label, count }: BucketChipLinkProps) {
  if (chipKey === "all") {
    return (
      <Link
        to="/watchlist"
        role="tab"
        activeOptions={{ exact: true }}
        activeProps={{ "aria-selected": "true" as const }}
        inactiveProps={{ "aria-selected": "false" as const }}
        className={CHIP_BASE_CLASS}
      >
        {label}
        <ChipCount count={count} />
      </Link>
    );
  }
  return (
    <Link
      to={`/watchlist/${chipKey}`}
      role="tab"
      activeOptions={{ exact: true }}
      activeProps={{ "aria-selected": "true" as const }}
      inactiveProps={{ "aria-selected": "false" as const }}
      className={CHIP_BASE_CLASS}
    >
      {label}
      <ChipCount count={count} />
    </Link>
  );
}

function ChipCount({ count }: { count: number }) {
  return <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>;
}
