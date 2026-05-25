import { Suspense } from "react";
import { Link, useLocation, useSearch } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadCount,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import type {
  MoodId,
  WatchlistBucket,
  WatchlistCounts,
  WatchlistSort,
} from "@ent-mcp/shared/watchlist";
import { MOOD_IDS, WATCHLIST_BUCKETS } from "@ent-mcp/shared/watchlist";
import { MOOD_REGISTRY } from "../lib/mood-registry";
import { useMoods } from "../hooks/use-moods";
import { BucketChips } from "./sections/all-items/bucket-chips";
import { SortSelect } from "./sections/all-items/sort-select";

interface WatchlistHeaderProps {
  counts: WatchlistCounts;
}

const FLAT_BUCKET_PATHS: ReadonlySet<string> = new Set(
  WATCHLIST_BUCKETS.map((b) => `/watchlist/${b}`),
);

const MOOD_ID_SET: ReadonlySet<string> = new Set(MOOD_IDS);

/**
 * Shared page header for the `/watchlist/*` route family. Two render modes:
 *
 * - Mood detail (`/watchlist/moods/:moodId`): breadcrumb +
 *   `SectionHead` (mood label + cluster count + mood note). Chip strip +
 *   sort hidden — neither composes with a mood-scoped grid.
 * - Everything else: title, chip strip, and (on flat sub-routes) sort
 *   dropdown.
 *
 * State lives entirely in the URL (path + `?sort=`).
 */
export function WatchlistHeader({ counts }: WatchlistHeaderProps) {
  const location = useLocation();
  const moodId = matchMoodPath(location.pathname);
  if (moodId) return <MoodHeader moodId={moodId} />;
  const showSort = FLAT_BUCKET_PATHS.has(location.pathname);
  return (
    <header>
      <SectionHead size="page">
        <SectionHeadHeading>
          <SectionHeadEyebrow size="page">{m.watchlist_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle as="h1" size="page">
            {m.watchlist_title()}
          </SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4 pb-6">
        <BucketChips counts={counts} />
        {showSort ? <FlatSortControl bucket={extractBucket(location.pathname)} /> : null}
      </div>
    </header>
  );
}

function matchMoodPath(pathname: string): MoodId | null {
  const prefix = "/watchlist/moods/";
  if (!pathname.startsWith(prefix)) return null;
  const id = pathname.slice(prefix.length);
  return MOOD_ID_SET.has(id) ? (id as MoodId) : null;
}

function MoodHeader({ moodId }: { moodId: MoodId }) {
  const copy = MOOD_REGISTRY[moodId];
  return (
    <header className="flex flex-col gap-2 pt-3 pb-6">
      <Breadcrumb aria-label={m.watchlist_breadcrumb_label()}>
        <BreadcrumbList className="font-mono text-xs uppercase tracking-[0.04em]">
          <BreadcrumbItem>
            <BreadcrumbLink render={<Link to="/watchlist" />}>
              {m.watchlist_breadcrumb_root()}
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{copy.label()}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <SectionHeadTitle as="h1" size="page">
        {copy.label()}
        <Suspense fallback={null}>
          <MoodCount moodId={moodId} />
        </Suspense>
      </SectionHeadTitle>
      <p className="max-w-prose text-base leading-snug text-muted-foreground">{copy.note()}</p>
    </header>
  );
}

function MoodCount({ moodId }: { moodId: MoodId }) {
  const { data } = useMoods();
  const cluster = data.clusters.find((c) => c.moodId === moodId);
  if (!cluster) return null;
  return <SectionHeadCount size="page" value={cluster.count} />;
}

function extractBucket(pathname: string): WatchlistBucket {
  const segment = pathname.slice("/watchlist/".length);
  return segment as WatchlistBucket;
}

interface FlatSortControlProps {
  bucket: WatchlistBucket;
}

/**
 * Reads the current sub-route's `?sort=` so the dropdown reflects the URL.
 * `strict: false` lets the same component sit in the layout above all four
 * flat bucket routes without a per-route prop wire-up.
 */
function FlatSortControl({ bucket }: FlatSortControlProps) {
  const search = useSearch({ strict: false }) as { sort?: WatchlistSort };
  return (
    <label
      htmlFor={`watchlist-sort-${bucket}`}
      className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground"
    >
      <span>{m.watchlist_sort_label()}</span>
      <SortSelect value={search.sort ?? "recent"} />
    </label>
  );
}
