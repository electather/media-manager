import type { CanonicalMetadata } from "@nama/shared/catalog";
import type { MediaType } from "@nama/shared/media";
import { keyToId, type MoodId, type WatchlistKey } from "@nama/shared/watchlist";

/**
 * Parity test scenario (US-014..US-017, RISK-103 / design §T): compares pre/post
 * output vs section-parity.json golden fixture. {@link installIncrementingClock}
 * ensures distinct increasing addedAt; stubs block real clock/network.
 */
export const PARITY_USER_ID = "parity-user";

/** Mood queried by the mood-items section (genre-only predicate, V.WL3). */
export const PARITY_MOOD: MoodId = "dark";

/** Limits matching the watchlist API defaults so the fixture mirrors production. */
export const PARITY_ITEMS_LIMIT = 60;
export const PARITY_MOOD_LIMIT = 60;
export const PARITY_RECENTLY_LIMIT = 3;

export interface ParityRowSpec {
  tmdbId: string;
  mediaType: MediaType;
  title: string;
  genres: string[];
  /** Past year → released; a year in the future marks the row "upcoming". */
  year: number;
  runtimeMinutes: number;
  /** Request-provider status (`getStatusBatch`); `"unknown"` is the default. */
  status: string;
  /** Library servers (`getMatchingServers`) — a non-empty list makes the row "ready". */
  servers: { id: string; label: string }[];
  /** When true the row appears in the continue-watching feed → "in-progress". */
  inProgress: boolean;
}

/**
 * Eight movies exercising each section signal: keyset order (addedAt DESC),
 * mood filter (m02/m05/m07 dark genre), tonight rank (m04 in-progress→top;
 * m03/m05/m06 ready; m08 upcoming; m01/m02/m07 unavailable→excluded).
 */
export const PARITY_ROWS: ParityRowSpec[] = [
  {
    tmdbId: "m01",
    mediaType: "movie",
    title: "Alpha",
    genres: ["Comedy"],
    year: 2015,
    runtimeMinutes: 100,
    status: "unknown",
    servers: [],
    inProgress: false,
  },
  {
    tmdbId: "m02",
    mediaType: "movie",
    title: "Bravo",
    genres: ["Horror"],
    year: 2018,
    runtimeMinutes: 95,
    status: "unknown",
    servers: [],
    inProgress: false,
  },
  {
    tmdbId: "m03",
    mediaType: "movie",
    title: "Charlie",
    genres: ["Drama"],
    year: 2019,
    runtimeMinutes: 120,
    status: "unknown",
    servers: [{ id: "jellyfin", label: "Jellyfin" }],
    inProgress: false,
  },
  {
    tmdbId: "m04",
    mediaType: "movie",
    title: "Delta",
    genres: ["Action"],
    year: 2020,
    runtimeMinutes: 110,
    status: "unknown",
    servers: [],
    inProgress: true,
  },
  {
    tmdbId: "m05",
    mediaType: "movie",
    title: "Echo",
    genres: ["Thriller"],
    year: 2021,
    runtimeMinutes: 130,
    status: "unknown",
    servers: [{ id: "plex", label: "Plex" }],
    inProgress: false,
  },
  {
    tmdbId: "m06",
    mediaType: "movie",
    title: "Foxtrot",
    genres: ["Adventure"],
    year: 2022,
    runtimeMinutes: 140,
    status: "unknown",
    servers: [{ id: "jellyfin", label: "Jellyfin" }],
    inProgress: false,
  },
  {
    tmdbId: "m07",
    mediaType: "movie",
    title: "Golf",
    genres: ["Crime"],
    year: 2017,
    runtimeMinutes: 100,
    status: "unknown",
    servers: [],
    inProgress: false,
  },
  {
    tmdbId: "m08",
    mediaType: "movie",
    title: "Hotel",
    genres: ["Science Fiction"],
    year: 2035,
    runtimeMinutes: 150,
    status: "unknown",
    servers: [],
    inProgress: false,
  },
];

export function parityCompositeId(row: Pick<ParityRowSpec, "tmdbId" | "mediaType">): string {
  return keyToId({ tmdbId: row.tmdbId, mediaType: row.mediaType });
}

function findRow(tmdbId: string): ParityRowSpec | undefined {
  return PARITY_ROWS.find((r) => r.tmdbId === tmdbId);
}

/**
 * Canonical metadata for every parity row. Artwork URLs are populated so
 * `enrich`'s artwork hydration short-circuits (no plugin dispatch in tests);
 * unread fields default to a neutral value.
 */
export function buildParityMetadata(): Record<string, CanonicalMetadata> {
  const out: Record<string, CanonicalMetadata> = {};
  for (const row of PARITY_ROWS) {
    out[parityCompositeId(row)] = {
      tmdbId: row.tmdbId,
      mediaType: row.mediaType,
      title: row.title,
      year: row.year,
      runtimeMinutes: row.runtimeMinutes,
      posterUrl: `https://art.test/${row.tmdbId}/poster.jpg`,
      backdropUrl: `https://art.test/${row.tmdbId}/backdrop.jpg`,
      clearLogoUrl: `https://art.test/${row.tmdbId}/logo.png`,
      overview: null,
      originalLanguage: "en",
      genres: row.genres,
      features: null,
      lastRefreshedAt: 0,
      lastAccessedAt: 0,
      createdAt: 0,
    };
  }
  return out;
}

/** Request-status map (`getStatusBatch`); only non-`unknown` statuses are emitted. */
export function buildParityStatusMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of PARITY_ROWS) {
    if (row.status !== "unknown") out[parityCompositeId(row)] = row.status;
  }
  return out;
}

/** Servers for a single row, keyed by tmdbId (the `getMatchingServers` signature). */
export function parityServersFor(tmdbId: string): { id: string; label: string }[] {
  return findRow(tmdbId)?.servers ?? [];
}

/** Continue-watching feed entries that drive the `in-progress` classification. */
export function buildParityContinueWatchingItems(): {
  progressMs: number;
  item: { type: MediaType; durationSec: number; tmdbId: string };
}[] {
  return PARITY_ROWS.filter((r) => r.inProgress).map((r) => ({
    progressMs: 600_000,
    item: { type: r.mediaType, durationSec: 6_000, tmdbId: r.tmdbId },
  }));
}

const PARITY_CLOCK_BASE = Date.UTC(2026, 0, 1);

/**
 * Replaces `Date.now` with incrementing counter so each `addItem` gets
 * distinct, increasing `addedAt` (keyset sort key) within "recently added"
 * window. Returns restore fn for `afterEach`. Does not touch timers.
 */
export function installIncrementingClock(): () => void {
  const original = Date.now;
  let t = PARITY_CLOCK_BASE;
  Date.now = () => t++;
  return () => {
    Date.now = original;
  };
}

/** Seeds the scenario rows via the supplied `addItem`, in deterministic order. */
export async function seedParityRows<Ctx>(
  addItem: (key: WatchlistKey, source: "manual", ctx: Ctx) => Promise<unknown>,
  ctx: Ctx,
): Promise<void> {
  for (const row of PARITY_ROWS) {
    await addItem({ tmdbId: row.tmdbId, mediaType: row.mediaType }, "manual", ctx);
  }
}
