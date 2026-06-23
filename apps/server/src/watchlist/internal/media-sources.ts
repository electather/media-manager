import {
  boundedParamsSchema,
  voidParamsSchema,
  watchlistItemsParamsSchema,
  watchlistMoodItemsParamsSchema,
  type BoundedParams,
  type VoidParams,
  type WatchlistItemsParams,
  type WatchlistMoodItemsParams,
} from "@nama/shared/media";
import type { AnyMediaSourceRegistration, MediaSourceRegistration } from "../../media";
import { itemsCfg, itemsSource, toItemsParams, type ItemsParams } from "../sources/items";
import { moodItemsCfg, moodItemsSource, type MoodParams } from "../sources/mood-items";
import { recentlyCfg, recentlySource, type RecentlyParams } from "../sources/recently";
import { tonightCfg, tonightSource } from "../sources/tonight";
import { clampLimit } from "./context";

/**
 * Surface four watchlist sections as `MediaSourceRegistration`s for `/api/media` resolver
 * (design §A4) to compose home + watchlist registry. Wiring stays in `watchlist` (V.A1).
 * Shared policy: `rateLimit: "read"` (§A7), `cursorOnNull: "firstPage"` (V.CU1).
 * Cursor mode: `"keyset"` for all EXCEPT `watchlist-items` flips to `"offset"` on
 * non-recent sort or bucket/mood filter; resolver decodes `stages.cursorMode` per-request.
 */
const itemsRegistration: MediaSourceRegistration<WatchlistItemsParams, ItemsParams> = {
  sourceId: "watchlist-items",
  rateLimit: "read",
  paramSchema: watchlistItemsParamsSchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  build: (_ctx, params, cursor) => {
    const itemsParams = toItemsParams({ ...params, limit: clampLimit(params.limit) });
    return { source: itemsSource(itemsParams), cfg: itemsCfg(itemsParams, cursor) };
  },
};

const moodItemsRegistration: MediaSourceRegistration<WatchlistMoodItemsParams, MoodParams> = {
  sourceId: "watchlist-mood-items",
  rateLimit: "read",
  paramSchema: watchlistMoodItemsParamsSchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  build: (_ctx, params, cursor) => {
    const moodParams: MoodParams = { moodId: params.moodId, limit: clampLimit(params.limit) };
    return { source: moodItemsSource, cfg: moodItemsCfg(moodParams, cursor) };
  },
};

const recentlyRegistration: MediaSourceRegistration<BoundedParams, RecentlyParams> = {
  sourceId: "watchlist-recently",
  rateLimit: "read",
  paramSchema: boundedParamsSchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  // Bounded preview — no cursor; the section discards the page cursor.
  build: (_ctx, params, _cursor) => ({
    source: recentlySource,
    cfg: recentlyCfg({ limit: params.limit }),
  }),
};

const tonightRegistration: MediaSourceRegistration<VoidParams, void> = {
  sourceId: "watchlist-tonight",
  rateLimit: "read",
  paramSchema: voidParamsSchema,
  cursorMode: "keyset",
  cursorOnNull: "firstPage",
  // Bounded candidate set — no params, no cursor. NOTE: the resolver yields the
  // FLAT enriched candidate page here; the hero/alternate `pick` + 5-min cache
  // stay envelope-side (`tonight/section.ts`) and are NOT replicated by a plain
  // `listRows` (design §A3 bounded sources / V.TN1) — the cutover handles where
  // that split lands.
  build: (_ctx, _params, _cursor) => ({ source: tonightSource, cfg: tonightCfg() }),
};

/** Registration map keyed by `sourceId`, one per watchlist section source. */
export const watchlistMediaSources: Record<string, AnyMediaSourceRegistration> = {
  "watchlist-items": itemsRegistration,
  "watchlist-mood-items": moodItemsRegistration,
  "watchlist-recently": recentlyRegistration,
  "watchlist-tonight": tonightRegistration,
};
