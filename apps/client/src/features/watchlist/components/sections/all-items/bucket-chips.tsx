import { useNavigate } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import type { WatchlistBucket, WatchlistCounts } from "@ent-mcp/shared/watchlist";
import { WATCHLIST_BUCKETS } from "@ent-mcp/shared/watchlist";
import { cn } from "@/shared/lib/utils";

const BUCKET_LABELS: Record<WatchlistBucket, () => string> = {
  ready: m.watchlist_filter_ready,
  awaiting: m.watchlist_filter_awaiting,
  upcoming: m.watchlist_filter_upcoming,
};

const BUCKET_COUNT: Record<WatchlistBucket, keyof WatchlistCounts> = {
  ready: "ready",
  awaiting: "awaiting",
  upcoming: "upcoming",
};

interface BucketChipsProps {
  value: WatchlistBucket | undefined;
  counts: WatchlistCounts;
}

export function BucketChips({ value, counts }: BucketChipsProps) {
  const navigate = useNavigate();
  const setBucket = (next: WatchlistBucket | undefined) => {
    void navigate({
      to: ".",
      search: (prev) => {
        const out = { ...(prev as Record<string, unknown>) };
        if (next) out.bucket = next;
        else delete out.bucket;
        return out;
      },
      replace: false,
      resetScroll: false,
    });
  };
  return (
    <div role="tablist" aria-label={m.watchlist_filter_label()} className="flex gap-2">
      <BucketChip
        active={!value}
        label={m.watchlist_filter_all()}
        count={counts.total}
        onClick={() => setBucket(undefined)}
      />
      {WATCHLIST_BUCKETS.map((b) => (
        <BucketChip
          key={b}
          active={value === b}
          label={BUCKET_LABELS[b]()}
          count={counts[BUCKET_COUNT[b]] ?? 0}
          onClick={() => setBucket(b)}
        />
      ))}
    </div>
  );
}

interface BucketChipProps {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}

function BucketChip({ active, label, count, onClick }: BucketChipProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:bg-accent",
      )}
    >
      {label}
      <span className="font-mono text-[11px] tabular-nums opacity-70">{count}</span>
    </button>
  );
}
