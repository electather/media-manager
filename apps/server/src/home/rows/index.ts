import type { CompactMediaItem, RowKind } from "@ent-mcp/shared/home";
import type { CatalogService } from "../../catalog";
import type { MediaService } from "../../media/service";
import type { PreferenceEngine } from "../../preferences";
import type { RequestScopedLoader, PluginRequirement } from "../dataloader";
import type { LayoutSignals } from "../signals";

/** Minimal logger shape the row fetchers need. Matches `consola`'s methods. */
export interface RowLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}

import { continueWatchingFetcher } from "./continue-watching";
import { recommendedForYouFetcher } from "./recommended-for-you";
import { trendingNowFetcher } from "./trending-now";
import { newReleasesFetcher } from "./new-releases";
import { becauseYouWatchedFetcher } from "./because-you-watched";
import { upcomingForYouFetcher } from "./upcoming-for-you";
import { yourWatchlistFetcher } from "./your-watchlist";

/**
 * Surface a row fetcher sees. Per V10: the dataloader and `MediaService`
 * facade are the only handles into anything below. Plugin runtime,
 * credentials, and raw DB are deliberately absent.
 *
 * Note that `LayoutSignals` is *not* exposed here. The seed for
 * `becauseYouWatched` is threaded through the cursor (V11); fetchers must
 * not branch on a snapshot they cannot otherwise observe.
 */
export interface RowFetchContext {
  userId: string;
  mediaService: MediaService;
  catalogService: CatalogService;
  preferenceEngine: PreferenceEngine;
  dataloader: RequestScopedLoader;
  logger: RowLogger;
  /**
   * Wall-clock deadline (ms-epoch) for this fetch. `runFetch` injects it as
   * `runFetch start + PER_ROW_TIMEOUT_MS` so downstream `MediaService`
   * methods can short-circuit retry backoffs that would overrun the budget
   * (#135). Optional so direct unit tests can omit it.
   */
  deadlineMs?: number;
}

export interface RowFetchResult {
  items: CompactMediaItem[];
  cursor: string | null;
  /** Set when at least one provider in the aggregate returned an error. */
  partial?: true;
}

export interface RowFetchOptions {
  cursor: string | null;
  limit: number;
}

/**
 * One file per row implements this. `requires` is descriptive and lives for
 * tooling/auto-doc; the authoritative runtime gate is `candidateRows` plus
 * `isEligible`. `fetch` does the work; `isEligible` is the cheap
 * post-`getLayout` gate used by `getRowContent` to fail fast when the user's
 * connection state changed mid-session.
 */
export interface RowFetcher {
  rowId: RowKind;
  title: string;
  requires: PluginRequirement[];
  fetch(ctx: RowFetchContext, opts: RowFetchOptions): Promise<RowFetchResult>;
  /**
   * Cheap presence check for `getRowContent`. Receives the inbound cursor so
   * cursor-pinned rows (today: `becauseYouWatched`) can verify the seed
   * still resolves before greenlighting a fetch — see design §7. Most rows
   * ignore the cursor and check plugin presence only.
   */
  isEligible(userId: string, loader: RequestScopedLoader, cursor: string | null): Promise<boolean>;
}

/** First-page item budget used for inline rows in `getLayout`. */
export const FIRST_PAGE_LIMIT = 20;

/**
 * Registry indexed by `RowKind`. Built once at module load — the layout
 * orchestrator and the row-content procedure share the same registry so a
 * fetcher implementation lives in exactly one place.
 */
export const ROW_FETCHERS: Record<RowKind, RowFetcher> = {
  continueWatching: continueWatchingFetcher,
  recommendedForYou: recommendedForYouFetcher,
  trendingNow: trendingNowFetcher,
  newReleases: newReleasesFetcher,
  becauseYouWatched: becauseYouWatchedFetcher,
  upcomingForYou: upcomingForYouFetcher,
  yourWatchlist: yourWatchlistFetcher,
};

/**
 * Re-exported for `because-you-watched`'s layout-time initial cursor
 * synthesis: layout handler decides the seed (from signals); fetcher only
 * ever reads `cursor.s`. Surface stays single-typed.
 */
export type { LayoutSignals };
