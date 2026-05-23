import { useNavigate } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadActions,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/utils";
import type { WatchlistBucket, WatchlistCounts, WatchlistSort } from "@ent-mcp/shared/watchlist";
import { BucketChips } from "./sections/all-items/bucket-chips";
import { SortSelect } from "./sections/all-items/sort-select";

export type WatchlistHeaderMode = "curated" | "flat";

interface CommonProps {
  counts: WatchlistCounts;
}

interface CuratedProps extends CommonProps {
  mode: "curated";
}

interface FlatProps extends CommonProps {
  mode: "flat";
  bucket?: WatchlistBucket;
  sort: WatchlistSort;
}

type WatchlistHeaderProps = CuratedProps | FlatProps;

/**
 * Page header. `curated` mode (default `/watchlist`) shows the title + pip
 * counts + "View all items" link. `flat` mode (`/watchlist/all`) hides the
 * link and surfaces bucket chips + sort dropdown that push `bucket` / `sort`
 * updates via `navigate({ to: ".", search: ... })`.
 */
export function WatchlistHeader(props: WatchlistHeaderProps) {
  const navigate = useNavigate();
  const counts = props.counts;
  return (
    <header>
      <SectionHead size="page">
        <SectionHeadHeading>
          <SectionHeadEyebrow size="page">{m.watchlist_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle as="h1" size="page">
            {m.watchlist_title()}
            <SectionHeadCount size="page" value={counts.total} />
          </SectionHeadTitle>
        </SectionHeadHeading>
        <SectionHeadActions>
          <div className="flex flex-col items-end gap-1.5 font-mono text-xs tracking-[0.04em] text-muted-foreground">
            <p className="flex items-center justify-end gap-3">
              <span className="inline-flex items-center gap-1.5 text-success">
                <Pip className="bg-success" />
                {m.watchlist_count_ready({ n: String(counts.ready) })}
              </span>
              <span className="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5 text-primary">
                <Pip className="bg-primary" />
                {m.watchlist_count_awaiting({ n: String(counts.awaiting) })}
              </span>
              <span className="text-muted-foreground/40" aria-hidden="true">
                ·
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Pip className="bg-muted-foreground" />
                {m.watchlist_count_upcoming({ n: String(counts.upcoming) })}
              </span>
            </p>
            {props.mode === "curated" ? (
              <Button
                variant="ghost"
                size="sm"
                className="font-sans text-xs"
                onClick={() => {
                  void navigate({ to: "/watchlist/all" });
                }}
              >
                {m.watchlist_view_all_items()}
              </Button>
            ) : null}
          </div>
        </SectionHeadActions>
      </SectionHead>

      {props.mode === "flat" ? (
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4 pb-6">
          <BucketChips value={props.bucket} counts={counts} />
          <label className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground">
            <span>{m.watchlist_sort_label()}</span>
            <SortSelect value={props.sort} />
          </label>
        </div>
      ) : null}
    </header>
  );
}

function Pip({ className }: { className: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-1.5 shrink-0 rounded-full", className)}
    />
  );
}
