import { MetadataV1 } from "./metadata";
import { WatchHistoryV1 } from "./watch-history";
import { WatchlistV1 } from "./watchlist";
import { RatingsV1 } from "./ratings";
import { RecommendationsV1 } from "./recommendations";
import { CalendarV1 } from "./calendar";
import { MediaRequestV1 } from "./media-request";
import { IdResolveV1 } from "./id-resolve";
import { UserCommentsV1 } from "./user-comments";
import { WatchProvidersV1 } from "./watch-providers";
import { TrailersV1 } from "./trailers";
import { PlaybackV1 } from "./playback";
import { CollectionV1 } from "./collection";
import { LibraryAvailabilityV1 } from "./library-availability";
import { ContinueWatchingV1 } from "./continue-watching";
import { PlaybackSessionsV1 } from "./playback-sessions";
import { LibraryAdminV1 } from "./library-admin";
import { ArtworkV1 } from "./artwork";

export const CAPABILITY_CATALOG = {
  "metadata@v1": MetadataV1,
  "watchHistory@v1": WatchHistoryV1,
  "watchlist@v1": WatchlistV1,
  "ratings@v1": RatingsV1,
  "recommendations@v1": RecommendationsV1,
  "calendar@v1": CalendarV1,
  "mediaRequest@v1": MediaRequestV1,
  "idResolve@v1": IdResolveV1,
  "userComments@v1": UserCommentsV1,
  "watchProviders@v1": WatchProvidersV1,
  "trailers@v1": TrailersV1,
  "playback@v1": PlaybackV1,
  "collection@v1": CollectionV1,
  "libraryAvailability@v1": LibraryAvailabilityV1,
  "continueWatching@v1": ContinueWatchingV1,
  "playbackSessions@v1": PlaybackSessionsV1,
  "libraryAdmin@v1": LibraryAdminV1,
  "artwork@v1": ArtworkV1,
} as const;

export type CapabilityKey = keyof typeof CAPABILITY_CATALOG;

export function capabilityKey(id: string, version: string): string {
  return `${id}@${version}`;
}

export function getCapability(
  id: string,
  version: string,
): (typeof CAPABILITY_CATALOG)[CapabilityKey] | undefined {
  const key = capabilityKey(id, version) as CapabilityKey;
  return CAPABILITY_CATALOG[key];
}

/** Returns every capability definition in the catalog. Used by the host runtime
 *  to populate its dispatch registry and by tooling (boundary lint, SDK-compat
 *  checks) that needs to enumerate the full set. */
export function listCapabilities(): Array<(typeof CAPABILITY_CATALOG)[CapabilityKey]> {
  return Object.values(CAPABILITY_CATALOG);
}
