# Client Media Data — Design (2026-05-01)

> Caveman ultra. Pseudo-code only. Real impl in plan.
> Successor to `2026-05-01-client-tanstack-db-design.md` (infra). Pilot phase 2 = media feature read-only wiring.

## §G Goal

Wire home page + peek modal to live data via TanStack DB. Single `media` entity collection feeds list + detail. Compact row from list = instant detail render; detail RPC fills gaps. Offline = persisted rows survive reload. ⊥ mutations v2.

## §M Motivation

A. Snappy detail — open peek = render compact row 0ms, fetch missing fields async, no blocking skeleton.
B. Offline shell — persisted home + media rows render before network.
C. Cache coherence — same media id in 3 rows + open peek = 1 entity row, all readers update on detail fetch.
D. Drop mock data — `lib/mock-data.ts`, `findItem`, in-route builders → kill.
E. Server amend — add `media.get`, `media.getMany`. Canonicalize wire shape. `home.*` unchanged.
F. Type unification — kill client-local `MediaDetailItem`. Single shared `MediaDetail` schema, `CompactMediaItem` derived.

## §S Stack

```
existing (phase 1):
  @tanstack/react-db
  @tanstack/query-db-collection
  @tanstack/query-async-storage-persister
  @tanstack/react-query-persist-client
  idb-keyval

phase 2: ⊥ new deps. Reuse phase 1.
```

## §C Constraints

- C1. Sync engine split: `homeLayout` uses `queryCollectionOptions` (single network-fed singleton). `media` + `homeRowItems` use `localOnlyCollectionOptions` — pure write-driven snapshots, ⊥ network refetch (writes flow via sync.ts). Resolves R1 (snapshot-only queryFn unsound under react-query refetch).
- C2. Realtime ⊥ v2.
- C3. Entity collection allowed for `media` (single carve-out). Per-endpoint pattern still default for non-entity domains. Phase 1 C3 remains for jobs/admin/connections.
- C4. Schema (Zod) on optimistic input only — N/A here, read-only phase.
- C5. ⊥ optimistic — phase is read-only.
- C6. Persistence = QueryClient IDB persister + `localOnlyCollectionOptions` IDB hook. Per-collection opt-in via `meta.persist`.
- C7. SW out of scope.
- C8. Feature-first holds: `features/media/data/`, `features/media/lib/` for view models.
- C9. es-toolkit holds. ∀ utility ops via `es-toolkit/*` submodules; ⊥ inline reimpl (`compact`, `omitBy`, `pick`, etc).
- C10. ⊥ TanStack DB import from `@ent-mcp/shared`.
- C11. Pilot scope = home page + peek modal + media routes. ⊥ migrate other features.
- C12. Hydration tracked via `_detailFetchedAt: number | null` field on every `media` row. ⊥ field-presence checks for full-vs-compact.
- C13. ⊥ duplicate media row across collections. Lists hold id refs only.
- C14. `MediaDetail` shared schema = single source of truth. `CompactMediaItem` = `Pick<MediaDetail, ...compactFields>`.
- C15. Server detail mapper sits behind `MediaService.getDetailsTyped` — raw plugin payload normalized to `MediaDetail` shape on server, ⊥ on client.
- C16. Single `MEDIA_ID_REGEX` exported from `@ent-mcp/shared/media`. Consumers: `peekSchema`, `mediaGetInputSchema`, `MediaDetail.id` JSDoc reference. ⊥ inline regex copies.
- C17. `media.getMany` server endpoint shipped this phase but caller deferred to T46 (future use: visible-row prefetch / offline preload). Tests verify endpoint contract; ⊥ client caller in T48.

## §F File Layout

```
packages/shared/src/media/
  enums.ts                 # extend: SeriesStatus, EpisodeStatus, SeasonStatus
  types.ts                 # MediaDetail, DetailSeason, DetailEpisode, MediaImage, etc. ⊥ ClearLogo type — clearLogo is plain str URL.
  schemas.ts               # zod schemas + MEDIA_ID_REGEX + media.get/getMany inputs
  compact.ts               # CompactMediaItem = Pick<MediaDetail,...>
  index.ts                 # barrel exporting MEDIA_ID_REGEX (C16 single source)

packages/shared/src/home/
  types.ts                 # CompactMediaItem re-export from ../media/compact
                           # (back-compat shim for existing home consumers)

apps/server/src/media/
  service.ts               # +getDetailsTyped(id): Promise<MediaDetail>
  mappers.ts               # NEW. raw plugin payload → MediaDetail
  __tests__/mappers.test.ts

apps/server/src/api/procedures/
  media.ts                 # NEW. POST /media/get, POST /media/getMany
                           # registered in router.ts as `.route("/media", mediaApp)`

apps/client/src/features/media/
  data/                    # NEW dir
    media.collection.ts            # entity collection, keyed by id
    home-layout.collection.ts      # hero + row stubs + cursors
    home-row-items.collection.ts   # {rowId, mediaId, position, page}
    media.hooks.ts                 # useMediaRow, useMediaDetail, useHomeLayout, useHomeRow
    sync.ts                        # split server payloads → entity + ref writes
    index.ts                       # barrel
  components/                # existing. wire to hooks. ⊥ rewrite UI.
  lib/
    types.ts               # DELETE local MediaDetailItem. Re-export shared MediaDetail.
    mock-data.ts           # DELETE
    find-item.ts           # DELETE (replaced by useMediaRow + useMediaDetail)
    use-detail-store.ts    # KEEP (mutations stay react-query cache-backed v2)
    peek-schema.ts         # KEEP
    use-peek.ts            # KEEP

apps/client/src/routes/_authenticated/_app/
  index.tsx                # rewrite home — drop mock builders, use useHomeLayout/useHomeRow
  media/$id.tsx            # rewrite — useMediaDetail full-page fallback
```

## §I Interfaces

### I.shared.MediaDetail — `packages/shared/src/media/types.ts`

```ts
// MEDIA_ID_REGEX = single source per C16. peekSchema + mediaGetInputSchema reuse.
MEDIA_ID_REGEX = /^(movie|tv):\d+$/;

MediaImage = { "16/9"?: str; "2/3"?: str; "1/1"?: str };
MediaProgress = { watched: num; total: num };
EpisodeProgress = { watched: num; total: num };
UpcomingEpisode = { season: num; episode: num; airsAt: num /*ms epoch*/; name?: str };
StreamLink = { source: str; url?: str };

EpisodeStatus = "available" | "requested" | "unavailable" | "partial" | "upcoming";
SeasonStatus = EpisodeStatus;
SeriesStatus = "ongoing" | "finished";

DetailEpisode = {
  id: str;             // `<mediaId>:s<S>e<E>`
  season: num;
  episode: num;
  title: str;
  airDate: str;        // ISO 8601 date ("2024-05-12"). Client formats via Intl.RelativeTimeFormat.
  runtime: num;        // minutes
  status: EpisodeStatus;
};

DetailSeason = {
  id: str;             // `<mediaId>:s<S>`
  season: num;
  title: str;
  episodeCount: num;
  airedCount: num;
  status: SeasonStatus;
  counts: { available?: num; requested?: num; unavailable?: num; upcoming?: num };
  episodes: DetailEpisode[];
};

MediaDetail = {
  // === compact subset (also returned by home.* endpoints) ===
  id: str;             // `movie:550` | `tv:1396`
  tmdbId: str;
  mediaType: "movie" | "tv";
  title: str;
  year?: num;
  poster?: str;
  backdrop?: str;
  clearLogo?: str;     // url
  status?: "available" | "requested" | "processing" | "unavailable" | "unknown";
  matchReason?: str;
  rating?: num;
  userRating?: num;
  genres?: str[];
  overview?: str;
  progress?: MediaProgress;
  episodeProgress?: EpisodeProgress;
  episode?: UpcomingEpisode;

  // === detail-only fields ===
  runtime?: str;       // human-formatted "2h 19m" / "5 seasons"
  ageRating?: str;
  votes?: num;
  audienceScore?: num;
  criticScore?: num;
  tags?: str[];
  director?: str;
  cast?: str[];
  seriesStatus?: SeriesStatus;
  nextAirDate?: str;
  streamLink?: StreamLink;
  trailerUrl?: str;
  seasons?: DetailSeason[];   // tv only
};
```

### I.shared.compact — `packages/shared/src/media/compact.ts`

```ts
COMPACT_FIELDS = [
  "id", "tmdbId", "mediaType", "title", "year", "poster", "backdrop",
  "clearLogo", "status", "matchReason", "rating", "userRating", "genres",
  "overview", "progress", "episodeProgress", "episode",
] as const;

CompactMediaItem = Pick<MediaDetail, typeof COMPACT_FIELDS[number]>;

// runtime helper for server — strip detail-only fields before send.
toCompact(d: MediaDetail): CompactMediaItem
```

### I.shared.schemas — `packages/shared/src/media/schemas.ts`

```ts
mediaDetailSchema       = zod schema mirroring MediaDetail
compactMediaItemSchema  = mediaDetailSchema.pick(COMPACT_FIELDS reduced to {})
mediaGetInputSchema     = z.object({ id: z.string().regex(MEDIA_ID_REGEX) }).strict()  // C16
mediaGetManyInputSchema = z.object({ ids: z.array(z.string().regex(MEDIA_ID_REGEX)).max(100) }).strict()
mediaGetOutputSchema    = mediaDetailSchema
mediaGetManyOutputSchema= z.object({ items: z.array(mediaDetailSchema) })
```

### I.server.media.procedure — `apps/server/src/api/procedures/media.ts`

```ts
mediaApp = new Hono()
  .use("*", requireSession)
  .post("/get", zValidator("json", mediaGetInputSchema), async (c) => {
    userId = sessionUserId(c);
    item = await new MediaService(userId).getDetailsTyped(c.req.valid("json").id);
    if (!item) throw notFound("media.not_found", `unknown id`);
    return c.json(item);
  })
  .post("/getMany", zValidator("json", mediaGetManyInputSchema), async (c) => {
    userId = sessionUserId(c);
    items = await new MediaService(userId).getDetailsBatchTyped(c.req.valid("json").ids);
    return c.json({ items }); // missing ids omitted, ⊥ throw
  });
// C17: getMany endpoint shipped this phase but caller deferred to T46.
// Tests verify contract (auth, validation, omit-missing); ⊥ client caller in T48.
```

router.ts: `+ .route("/media", mediaApp)`

### I.server.MediaService.additions — `apps/server/src/media/service.ts`

```ts
async getDetailsTyped(idOrCombined: str): Promise<MediaDetail | null> {
  raw = await this.getDetails(idOrCombined);  // existing, untyped unknown
  if (!raw) return null;
  return mapToMediaDetail(raw, idOrCombined);  // mappers.ts
}

async getDetailsBatchTyped(ids: str[]): Promise<MediaDetail[]> {
  // Promise.all + mapToMediaDetail. Filter nulls. Per-id failure ⊥ fail batch.
}
```

### I.server.mapper — `apps/server/src/media/mappers.ts`

```ts
mapToMediaDetail(raw: unknown, id: str): MediaDetail
  // raw shape varies by plugin (TMDB, Trakt). Use es-toolkit/predicate isNil for guards.
  // Deterministic: same raw → same MediaDetail. ⊥ Math.random.
  // Seasons: present only when raw includes seasons + episodes. Else seasons=undefined.
  // Status fallback: "unknown" when raw has no availability info.

// Helper for compact extraction (used by home rows already, refactor):
toCompactFromRaw(raw: unknown, id: str): CompactMediaItem
  // delegates to mapToMediaDetail then toCompact()
```

### I.client.collections — `features/media/data/*`

```ts
// media.collection.ts — entity. localOnly per C1: ⊥ react-query refetch overwrite.
mediaCollection = createCollection(
  localOnlyCollectionOptions({
    id: "media.entity",
    getKey: (r) => r.id,
    meta: { persist: true },
    // No queryFn. Writes via sync.ts (writeCompactToMedia / writeFullToMedia).
    // Persistence layer hydrates rows from IDB on mount (handled by db provider).
  }),
);

// Row shape stored in collection:
type MediaRow = MediaDetail & { _detailFetchedAt: number | null };

// home-layout.collection.ts — singleton, network-fed via queryCollectionOptions.
// Sole writer for layout row = queryFn. Sync helpers ⊥ writeUpsert this collection
// (eliminates D4 race). Cursor advancement = optimistic update on layout row.
type HomeLayoutRow = {
  id: "current";
  generatedAt: num;
  hero: { mediaId: str; source: RowKind; reason: HeroReason; resumeUrl: str | null } | null;
  rows: Array<{ rowId: RowKind; title: str; subtitle?: str; cursor: str | null; pagesLoaded: num }>;
};

homeLayoutCollection = createCollection(
  queryCollectionOptions({
    id: "home.layout",
    queryKey: ["home", "layout"],
    queryClient,
    queryFn: async () => {
      const res = await api.home.getLayout.$post({ json: {} });
      // Side effect: hero media goes to entity collection. ⊥ overwrite full row.
      if (res.hero) writeCompactToMedia(res.hero.item);
      return [transformLayout(res)];
    },
    getKey: (r) => r.id,
    meta: { persist: true },
    staleTime: 5 * 60_000,
  }),
);

// home-row-items.collection.ts — localOnly per C1.
// Composite id ⊥ uses page-number (D5). Cursor + write-counter = stable key.
type HomeRowItemRow = {
  id: str; // `${rowId}:${cursorOrFirst}:${position}` — opaque-cursor-safe
  rowId: RowKind;
  mediaId: str;
  position: num; // monotonic across pages
  cursor: str | null; // cursor that fetched this page (null = first page)
};

homeRowItemsCollection = createCollection(
  localOnlyCollectionOptions({
    id: "home.rowItems",
    getKey: (r) => r.id,
    meta: { persist: true },
  }),
);
```

### I.client.sync — `features/media/data/sync.ts`

```ts
import { omitBy } from "es-toolkit/object";
import { isNil } from "es-toolkit/predicate";

// Layout writes flow through homeLayoutCollection.queryFn (sole writer per D4).
// sync.ts owns mediaCollection + homeRowItemsCollection writes only.

splitRowContent(rowId: RowKind, cursorUsed: str | null, res: RowContentResponse): void {
  // V86: media write FIRST, refs SECOND.
  for (const item of res.items) writeCompactToMedia(item);

  const layoutRow = homeLayoutCollection.get("current");
  const rowMeta = layoutRow?.rows.find(r => r.rowId === rowId);
  const startPos = (rowMeta?.pagesLoaded ?? 0) * PAGE_SIZE;

  const refs = res.items.map((item, i) => ({
    id: `${rowId}:${cursorUsed ?? "first"}:${startPos + i}`, // D5: cursor-based, ⊥ page-number
    rowId,
    mediaId: item.id,
    position: startPos + i,
    cursor: cursorUsed,
  }));
  homeRowItemsCollection.utils.writeBatch(refs.map(r => ({ type: "insert", value: r })));

  // Cursor + pagesLoaded advance via queryClient.setQueryData on homeLayout queryKey.
  // ⊥ direct collection writeUpdate (D4: queryCollectionOptions owner only).
  queryClient.setQueryData(["home", "layout"], (prev: HomeLayoutRow[]) => {
    const cur = prev?.[0];
    if (!cur) return prev;
    const nextRows = cur.rows.map(r =>
      r.rowId === rowId
        ? { ...r, cursor: res.cursor, pagesLoaded: r.pagesLoaded + 1 }
        : r,
    );
    return [{ ...cur, rows: nextRows }];
  });
}

writeCompactToMedia(compact: CompactMediaItem): void {
  // V79: ⊥ overwrite full row's detail-only fields.
  // D2 fix: omitBy(isNil) prevents undefined compact fields from nuking
  // existing values. Race with ensureDetail accepted: compact subset is
  // intentionally refreshable (status/progress live-update use case).
  const safeCompact = omitBy(compact, isNil);
  const existing = mediaCollection.get(compact.id);
  if (existing?._detailFetchedAt) {
    mediaCollection.utils.writeUpdate(compact.id, prev => ({ ...prev, ...safeCompact }));
  } else {
    mediaCollection.utils.writeUpsert({ ...safeCompact, _detailFetchedAt: null });
  }
}

writeFullToMedia(full: MediaDetail): void {
  // V80: always sets timestamp. Accepts that any concurrent compact write that
  // landed mid-fetch is overwritten; compact subset will refresh on next list mount.
  mediaCollection.utils.writeUpsert({ ...full, _detailFetchedAt: Date.now() });
}

loadRowPage(rowId: RowKind): Promise<void> {
  const cursor = homeLayoutCollection.get("current")?.rows.find(r => r.rowId === rowId)?.cursor ?? null;
  const res = await api.home.getRowContent.$post({ json: { rowId, cursor } });
  splitRowContent(rowId, cursor, res);
}

ensureDetail(id: str): Promise<void> {
  // V81: dedup via queryClient.fetchQuery. Concurrent N callers → 1 RPC.
  return queryClient.fetchQuery({
    queryKey: ["media", "detail", id],
    queryFn: async () => {
      const full = await api.media.get.$post({ json: { id } });
      writeFullToMedia(full);
      return full;
    },
    staleTime: DETAIL_TTL_MS,  // C20: TTL gate; refetch only when stale.
  });
}

DETAIL_TTL_MS = 60 * 60 * 1000;  // 1h
PAGE_SIZE = 20;
```

### I.client.hooks — `features/media/data/media.hooks.ts`

```ts
useHomeLayout(): {
  layout: HomeLayoutRow | null;
  isLoading: bool;
} = useLiveQuery(q.from(homeLayoutCollection).findOne({ id: "current" }))
    + initial fetch trigger via useEffect → splitLayoutResponse.

useHomeRow(rowId: RowKind): {
  items: MediaRow[];
  cursor: str | null;
  hasMore: bool;
  isLoading: bool;
  loadMore: () => void;
} = {
  // D3 fix: real live-query join via TanStack DB join API (V74 entity-↔-ref).
  // Both refRows AND media rows are reactive — compact-refresh / detail-fill
  // re-renders consumers without ref-row churn.
  joined = useLiveQuery(
    q.from({ ref: homeRowItemsCollection })
     .innerJoin({ media: mediaCollection }, ({ ref, media }) => eq(ref.mediaId, media.id))
     .where(({ ref }) => eq(ref.rowId, rowId))
     .orderBy(({ ref }) => ref.position, "asc")
     .select(({ media }) => media)
  )
  items = compact(joined)  // es-toolkit/array; ⊥ raw .filter(Boolean) (V50/C11/V86).

  layoutRow = useLiveQuery(q.from(homeLayoutCollection).findOne(r => eq(r.id, "current")))
  meta = layoutRow?.rows.find(r => r.rowId === rowId)
  cursor = meta?.cursor ?? null
  hasMore = cursor != null
  loadMore = () => loadRowPage(rowId)  // signature: cursor read from collection
  isLoading via local boolean state on loadMore promise.
}

useMediaRow(id: str): MediaRow | null
  = useLiveQuery(q.from(mediaCollection).findOne({ id }))

useMediaDetail(id: str | null): {
  item: MediaRow | null;
  isHydrating: bool;       // true when row.compact + detail fetch pending
  isFullyLoaded: bool;
} {
  row = useMediaRow(id);
  useEffect(() => {
    if (!id) return;
    ensureDetail(id);  // idempotent + TTL-aware
  }, [id]);
  return {
    item: row,
    isHydrating: !!row && row._detailFetchedAt === null,
    isFullyLoaded: !!row?._detailFetchedAt,
  };
}
```

### I.client.wiring — components

```ts
// _authenticated/_app/index.tsx
HomeMockPage → HomePage:
  layout = useHomeLayout()
  return rows.map(stub => <HomeRow rowId={stub.rowId} title={stub.title} />)

<HomeRow rowId={rowId}>:
  { items, hasMore, loadMore, isLoading } = useHomeRow(rowId)
  return <MediaRow ... renderItem={item => <MediaCard item={item} ... />} />

// MediaCard already accepts MediaCardItem = CompactMediaItem & extras.
// MediaRow stays unchanged.

// media-detail-modal.tsx — replace findItem → useMediaDetail(peekId)
MediaDetailModal:
  { peekId, closePeek } = usePeek()
  { item, isHydrating, isFullyLoaded } = useMediaDetail(peekId)
  open = !!peekId
  return Dialog/Drawer with <MediaDetailModalContent item={item} isHydrating />

// media-detail-modal-content.tsx — accept MediaDetail | null.
// When isHydrating: render hero/title from compact, inline skeletons for missing
// (cast/director/scores/seasons).
// kill `useEffect` simulated fetch (line 132-136). Replace with `isHydrating` prop.

// modal-seasons-list.tsx — replace mockData.generateSeasons with item.seasons.
// If item.kind === "tv" && item.seasons === undefined && isHydrating → skeleton.
// If item.seasons === [] post-hydration → null (existing behavior).

// routes/_authenticated/_app/media/$id.tsx — full-page detail
MediaDetailPage:
  { id } = Route.useParams()
  { item, isHydrating } = useMediaDetail(id)
  if (!item && isHydrating) → <FullPageSkeleton />
  if (!item) → <NotFound />
  return <MediaDetailModalContent item={item} isHydrating={...} enableScrollAnimations />
  // (re-use modal content as full-page render. closePeek = navigate back)
```

### I.persistence.policy

| Collection     | Option kind       | `meta.persist` | `staleTime`                      | `refetchInterval` | Reason                                                             |
| -------------- | ----------------- | -------------- | -------------------------------- | ----------------- | ------------------------------------------------------------------ |
| `media`        | `localOnly`       | true           | n/a (TTL via `_detailFetchedAt`) | n/a               | Offline detail; snappy reopen. ⊥ react-query refetch (write-only). |
| `homeLayout`   | `queryCollection` | true           | 5m                               | n/a               | Offline shell + hero. Sole network fetcher.                        |
| `homeRowItems` | `localOnly`       | true           | n/a                              | n/a               | Offline rows. Pages fetched on-demand via `loadRowPage`.           |

Buster bump = `VITE_SHARED_VERSION` bump (SPEC V69). One persister, one buster string, atomic IDB wipe across all collections in QueryClient. `localOnly` collections persist via same persister hook.

## §V Invariants

- V1. ∀ media row in `mediaCollection` has `_detailFetchedAt: num | null`. ⊥ writes that omit it.
- V2. `writeCompactToMedia` ⊥ overwrites full-row detail-only fields. Refresh path uses `omitBy(isNil)` to strip undefined compact fields before merge — undefined ⊥ nuke existing data.
- V3. `writeFullToMedia` always sets `_detailFetchedAt = Date.now()`. Concurrent compact writes that landed mid-fetch overwritten — accepted (compact subset re-refreshes on next list mount).
- V4. `ensureDetail(id)` idempotent. Single `queryClient.fetchQuery({ queryKey: ["media", "detail", id], staleTime: DETAIL_TTL_MS })` per id. ⊥ two `media.get` RPCs in flight.
- V5. Lists ⊥ duplicate media row data. `homeRowItemsCollection` rows hold `mediaId` only. UI joins via TanStack DB live-query `innerJoin` (V6 phase 1 amend).
- V6. ⊥ render-path branches on `_detailFetchedAt` ∈ component code. Branches on derived `isHydrating` / `isFullyLoaded` from hooks only.
- V7. `MediaDetail` Zod schema = single source of truth. `CompactMediaItem` = `Pick`-derived. Server `home.*` returns compact subset wire shape; client treats received compact as `Partial<MediaDetail>`. ⊥ explicit field expansion to undefined — TS optional handles it.
- V8. Server mapper (`mapToMediaDetail`) deterministic. ⊥ `Math.random`. ⊥ `Date.now()` / wall-clock. CI grep guard.
- V9. Sync write order: `mediaCollection` writes FIRST, `homeRowItemsCollection` writes SECOND. Render-time stale-ref handling: `compact()` from `es-toolkit/array` filters missing entities (⊥ raw `.filter(Boolean)` per C9).
- V10. ⊥ collection imports in components. Components consume hooks only.
- V11. `useDetailStore` (mutations: watched/watchlist/notes/votes/requests) stays react-query cache-backed v2. ⊥ migrate v2.
- V12. Mock files (`mock-data.ts`, `find-item.ts`) deleted in same PR as wiring. ⊥ leave dead code. CI grep guard.
- V13. `MEDIA_ID_REGEX` exported from `@ent-mcp/shared/media` is sole source. `peekSchema` + `mediaGetInputSchema` + `mediaGetManyInputSchema` import it. ⊥ inline copies.
- V14. Detail TTL = 1h. TTL gate site = `ensureDetail` only (via `queryClient.fetchQuery` `staleTime`). ⊥ time math on `_detailFetchedAt` ∈ component or other modules.
- V15. Cold peek (id ⊥ `mediaCollection`): `useMediaDetail` returns `{ item: null, isHydrating: true, isFullyLoaded: false }`. Modal renders full skeleton until `media.get` lands. ⊥ render with empty placeholder fields.
- V16. Persisted media rows can be stale arbitrarily long (offline). On reconnection + mount, list refetches refresh compact subset (via V2); detail refetch on next peek open per V14.
- V17. Layout writes flow through `homeLayoutCollection.queryFn` only. Sync helpers (`splitRowContent`) advance cursor via `queryClient.setQueryData(["home", "layout"], ...)` — TanStack DB collection sees the queryClient cache update + propagates. ⊥ `homeLayoutCollection.utils.writeUpsert` ∈ sync code (avoid D4 dual-writer race).
- V18. `homeRowItems.id` composite = `${rowId}:${cursor ?? "first"}:${position}`. Cursor (opaque per SPEC V36) keys distinct pages without page-number derivation. ⊥ page-number ∈ id.
- V19. `media` + `homeRowItems` collections use `localOnlyCollectionOptions` (no queryFn). `homeLayout` uses `queryCollectionOptions`. C1 codifies. Persistence via `meta.persist=true` honored by both option kinds.

## §T Tasks

| #   | Task                                                                                                                                                                                                                                                                                    | Deps       |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Shared: `packages/shared/src/media/types.ts` — add MediaDetail, DetailSeason, DetailEpisode, MediaImage, MediaProgress, etc. ⊥ ClearLogo type. Extend enums.                                                                                                                            | —          |
| 2   | Shared: `packages/shared/src/media/compact.ts` — COMPACT_FIELDS + Pick-derived `CompactMediaItem` + `toCompact` helper (`pick` from es-toolkit/object).                                                                                                                                 | 1          |
| 3   | Shared: `packages/shared/src/media/schemas.ts` — Zod for MediaDetail + compact + media.get/getMany input/output. Export `MEDIA_ID_REGEX` (C16, V13).                                                                                                                                    | 1, 2       |
| 4   | Shared: `packages/shared/src/home/types.ts` — re-export `CompactMediaItem` from media/compact (back-compat). Delete local def. Verify field-by-field equivalence pre-refactor (avoid silent home-server breakage).                                                                      | 2          |
| 5   | Server: `apps/server/src/media/mappers.ts` — `mapToMediaDetail(raw, id)` deterministic (V8). `toCompactFromRaw(raw, id, extras?)` preserving existing extras-merge semantics from `home/compact.ts:toCompact`. CI grep guard: ⊥ `Math.random` / `Date.now()` ∈ mapper file.             | 1          |
| 6   | Server: `apps/server/src/media/service.ts` — add `getDetailsTyped`, `getDetailsBatchTyped`.                                                                                                                                                                                             | 5          |
| 7   | Server: `apps/server/src/api/procedures/media.ts` — POST /get, /getMany. Register `.route("/media", mediaApp)` between `/home` and `.onError(errorHandler)` ∈ `router.ts`.                                                                                                              | 6          |
| 8   | Server: refactor `apps/server/src/home/compact.ts` — replace `toCompact(item, extras)` body to delegate to `toCompactFromRaw`. Snapshot-pin row JSON for known users via fixture seed BEFORE refactor; post-refactor diff = byte-identical or documented intentional drift.             | 5          |
| 9   | Server tests: procedures/**tests**/media.test.ts — auth (401), validation (400), not-found (404), batch missing (omit), >100 ids (400).                                                                                                                                                 | 7          |
| 10  | Client: `features/media/data/media.collection.ts` — `localOnlyCollectionOptions` (C1, V19) + `meta.persist=true`. Verify `meta.persist` honored ∈ local-only path; if not, document workaround.                                                                                         | 3          |
| 11  | Client: `features/media/data/home-layout.collection.ts` — `queryCollectionOptions` singleton w/ `home.getLayout` queryFn. queryFn = sole writer (V17), side-effects `writeCompactToMedia(res.hero.item)`.                                                                               | 3, 10      |
| 12  | Client: `features/media/data/home-row-items.collection.ts` — `localOnlyCollectionOptions` ref collection. Composite id per V18.                                                                                                                                                         | 3, 10      |
| 13  | Client: `features/media/data/sync.ts` — `splitRowContent`, `writeCompactToMedia` (`omitBy(isNil)` per V2), `writeFullToMedia`, `loadRowPage`, `ensureDetail` (`fetchQuery` w/ `staleTime: DETAIL_TTL_MS`).                                                                              | 10, 11, 12 |
| 14  | Client: `features/media/data/media.hooks.ts` — `useHomeLayout`, `useHomeRow` (live-query `innerJoin` per V5/V9, `compact()` from es-toolkit/array), `useMediaRow`, `useMediaDetail`. Imports `RowKind`/`HeroReason` from `@ent-mcp/shared/home`.                                        | 13         |
| 15  | Client: `features/media/lib/types.ts` — delete `MediaDetailItem`, `DetailSeason`, `DetailEpisode`, etc. Re-export from `@ent-mcp/shared/media`. Keep `FeedbackVote`. Update `features/media/index.ts` barrel to re-export shared.                                                       | 1          |
| 16  | Client: `features/media/lib/peek-schema.ts` — import `MEDIA_ID_REGEX` from shared. Delete local `PEEK_ID_REGEX`. Update barrel.                                                                                                                                                         | 3          |
| 17  | Client: rename `kind` → `mediaType` ∀ media components (`modal-seasons-list.tsx`, `seasons-list.tsx`, `modal-action-row.tsx`, `tv-air-info.tsx`, `media-detail-modal-content.tsx`).                                                                                                     | 15         |
| 18  | Client: rewrite `routes/_authenticated/_app/index.tsx` — drop mock builders + local watchlist `useState`. Use `useHomeLayout` + `useHomeRow` + `useDetailStore.watchlist`/`toggleWatchlist`. Keep `MediaCard`/`MediaRow` API.                                                           | 14, 17     |
| 19  | Client: rewrite `media-detail-modal.tsx` — drop `findItem`, use `useMediaDetail(peekId)`. Pass `isHydrating` + `isFullyLoaded` to content.                                                                                                                                              | 14, 17     |
| 20  | Client: update `media-detail-modal-content.tsx` — accept `isHydrating`, drop simulated fetch `useEffect` (lines 132-136), render inline skeletons for `cast`/`director`/`scores`/`seasons` while hydrating.                                                                             | 19         |
| 21  | Client: update `modal-seasons-list.tsx` + `seasons-list.tsx` — drop `mockData.generateSeasons`, read `item.seasons`. Branch on `mediaType === "tv"`.                                                                                                                                    | 19         |
| 22  | Client: rewrite `trailer-overlay.tsx` — drop `findItem` import. Read trailer URL via `useMediaRow` / store. (Currently imports `findItem`; T48-blocking.)                                                                                                                               | 19         |
| 23  | Client: rewrite `routes/_authenticated/_app/media/$id.tsx` — full-page via `useMediaDetail`. `<NotFound />` post-hydration when null.                                                                                                                                                   | 19         |
| 24  | Client: delete `lib/mock-data.ts`, `lib/find-item.ts`. Verify ∀ imports gone via `rg`. CI grep guard for V12.                                                                                                                                                                           | 18-23      |
| 25  | `.fallowrc.json` — add `client-feat-media` zone covering `apps/client/src/features/media/**`. Allow list: `client-feat-requests`, `client-shared-{ui,components,hooks,lib}`, `shared-pkg`. Decide fate of stale `client-feat-media-details` zone (delete or rename).                    | 18         |
| 26  | Tests: `features/media/data/__tests__/sync.test.ts` — splitRowContent ordering (V9), writeCompactToMedia non-overwrite + omitBy-isNil behavior (V2), writeFullToMedia timestamp (V3), ensureDetail TTL skip (V14), ensureDetail concurrent dedup (V4), homeRowItems composite id (V18). | 13         |
| 27  | Tests: `features/media/data/__tests__/media.hooks.test.ts` — useHomeRow live-join correctness, missing-media-row → filtered out (V9 hostile-order), useMediaDetail cold-peek tuple shape (V15).                                                                                         | 14         |
| 28  | Tests: `features/media/__tests__/peek-modal.test.tsx` — instant-render w/ compact (memory #13 regression pattern); cold-URL peek shows full skeleton.                                                                                                                                   | 19, 20     |
| 29  | Tests: shared regex single-source — `peekSchema.parse("movie:550")` succeeds; `MEDIA_ID_REGEX` source equality across `peek-schema.ts` + `mediaGetInputSchema`. (V13)                                                                                                                   | 3, 16      |
| 30  | Tests: mapper static guard — read `mappers.ts` source, assert `⊥ Math.random` + `⊥ Date.now()`. (V8)                                                                                                                                                                                    | 5          |
| 31  | Tests: deletion guard — CI step `rg "from .*mock-data\|from .*find-item"` returns 0 hits post-T48. (V12)                                                                                                                                                                                | 24         |
| 32  | Manual smoke: cold load → progressive render; reload offline → persisted rows; open peek from row → instant + progressive fields; cold-URL peek → skeleton; TV detail shows seasons.                                                                                                    | 18-23      |
| 33  | Changeset `.changeset/<slug>.md` — `@ent-mcp/client: minor`. 1-2 non-technical sentences (memory #11). T47 server-only PR ships internal-only changeset (empty frontmatter). T48 PR ships user-facing entry.                                                                            | 18-23      |
| 34  | Pre-commit: `vp check && vp test` (memory #9).                                                                                                                                                                                                                                          | all        |

## §B Backprop slots

(populated as bugs surface during build)

## §R Risks / Open

- R1. **(resolved → C1)** `localOnlyCollectionOptions` for `media` + `homeRowItems` codified as constraint. `homeLayout` stays `queryCollectionOptions` (network-fed singleton).
- R2. **(resolved → V2)** Concurrent compact-during-detail race: accepted. Compact subset (status/progress) intentionally refreshable; full write at fetch resolution wins. Detail-only fields preserved across compact merge via `omitBy(isNil)`.
- R3. **(resolved → V8 + types)** `airDate` = ISO 8601 string in `DetailEpisode`. Client formats via `Intl.RelativeTimeFormat`.
- R4. **(resolved)** `clearLogo: str` (URL only). UI fallback uses `<ClearLogo text={item.title} url={item.clearLogo}>` per existing `media-card.tsx` pattern.
- R5. `media.get` for ids absent ∈ any plugin → 404 `media.not_found`. Client `routes/_authenticated/_app/media/$id.tsx` shows `<NotFound />` post-hydration. Peek modal (`media-detail-modal.tsx`) closes peek on 404.
- R6. **(resolved → T47 sub-task)** `home.*` row builder refactor risk: snapshot-pin row JSON pre-refactor + assert byte-identical post-refactor. Existing `apps/server/src/home/compact.ts:toCompact(item, extras)` callers preserved — `toCompactFromRaw` honors extras-merge semantics.
- R7. **(resolved → V4)** Concurrent `ensureDetail(id)` dedups via `queryClient.fetchQuery`.
- R8. PersistQueryClientProvider hydration race — TanStack DB collection reads before persister hydrates may show empty for one render. Phase 1 R2 documented acceptable. Same here for media.
- R9. **(resolved → V18)** Cursor-based `homeRowItems.id` removes page-number derivation. Opaque server cursors (SPEC V36) safely key distinct pages.
- R10. Schema validation cost — `mediaDetailSchema.parse` on 4 rows × 20 items = 80 parses on cold load. Skip per phase 1 V70 (server already validated). Dev-only `.assert` if debugging.
- R11. `LayoutHero.item` (compact) split: `homeLayoutCollection.queryFn` calls `writeCompactToMedia(res.hero.item)` as side-effect (V17 sole writer); layout row holds `hero.mediaId` only. Hook `useHomeLayout` joins via `useMediaRow(layout.hero.mediaId)`.
- R12. Live-query `innerJoin` API — TanStack DB v0.x syntax may evolve. Pin version in `package.json` + verify `@tanstack/react-db` join API in TASK-021. If join API absent, fall back to `useLiveQuery` over refs + `useLiveQuery` over media + memoized merge.
- R13. `localOnlyCollectionOptions` `meta.persist` honored — verify in TASK-017 (option key may differ from `queryCollectionOptions`).

## §X Out of Scope

- Mutations (watched, watchlist, notes, votes, requests, season requests). Stays react-query cache-backed via `useDetailStore`. Phase 3.
- Realtime / SSE.
- Service worker / PWA.
- Search / discover route wiring (`discover.*` server stubs stay stubs).
- Trailer URL fetch beyond what `MediaDetail.trailerUrl` carries.
- Pull-to-refresh / manual invalidation UI.
- Image proxy / artwork pipeline (use server URLs as-is).
- Migration of other features (jobs, connections, settings, notifications) into entity-collection pattern. C3 holds for them.
- Cross-row dedup beyond entity-collection sharing (no work required — happens naturally per V5).
- Analytics for detail-fetch hit rate.
