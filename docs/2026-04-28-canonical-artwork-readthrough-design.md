# Canonical Artwork Inline + Write-Back

Date: 2026-04-28
Status: Draft

## Problem

`canonical_metadata` cols `poster_url`/`backdrop_url`/`clear_logo_url`/`thumb_url`/`overview` mostly null. TMDB `metadata@v1` mapper fills `posterUrl` + `overview` only. Logos/thumbs need `artwork@v1` (multi-source: TMDB + Fanart + TVDB) → never written. Frontend cards POST `/artwork.get` per item → fan-out hits API on every cold render.

## Goal

Row payload carries every artwork URL DB has. Client fetch `/artwork.get` only when slot null. That fetch always hits dispatcher (cached at `mv:` layer) AND writes back to canonical → subsequent ROW reads carry the slot inline → no further `/artwork.get` for that item.

## Non-Goals

- Multi-source picker UI (alt posters/logos by lang). Defer. New RPC when consumer exists.
- HTTP/edge caching. Out of scope.
- Schema for per-language artwork. YAGNI.

## Design

### Two-tier fill

| Tier | Source                                                   | Latency                        | Fills                                             |
| ---- | -------------------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| 1    | TMDB `metadata@v1` mapper @ cold-fill                    | 1 dispatch                     | poster, backdrop, overview → canonical            |
| 2    | `/artwork.get` → dispatcher (`mv:` cache) → patchArtwork | dispatch w/ mv-cache hit cheap | clearLogo (+ poster/backdrop refresh) → canonical |

**Row reads** = canonical only. Slot present → ship inline. Slot null → ship omitted.
**`/artwork.get`** = always dispatch path. `mv:` layer absorbs repeat hits at TTL boundary. Response → patchArtwork fire-and-forget → next row read has slot → no further `/artwork.get`.

### Wire shape

`CompactMediaItem` unchanged. Already has `poster?`, `backdrop?`, `clearLogo?`, `overview?`. Drop `thumb_url` col + no wire field (no consumer).

### Flow

```
artwork.get(items)
  fan = dispatchAggregatePerKind(artwork@v1, items)   // mv: cache layer in front
  for (it, bundle) in fan:
    fireForget catalog.patchArtwork(key(it), top1(bundle))   // back-fill canonical
  return fan
```

No canonical read. Cache layer = existing `mv:` dispatcher cache (per-capability TTL, memory/redis). Patch is best-effort write-back so next _row_ read serves slot inline.

### Patch (idempotent, partial)

```sql
UPDATE canonical_metadata
   SET poster_url     = COALESCE(poster_url, ?),
       backdrop_url   = COALESCE(backdrop_url, ?),
       clear_logo_url = COALESCE(clear_logo_url, ?),
       last_refreshed_at = ?
 WHERE tmdb_id = ? AND media_type = ?
```

`COALESCE` → never clobber filled col. Row absent → 0 rows affected, no-op, no throw.

### Frontend

`useArtworkIfMissing(item, requiredSlots)` → fires query only when item missing one of `requiredSlots`. Card `["poster"]`. Hero `["backdrop","clearLogo"]`. Sidebar `["poster"]`. Above-fold cold render: ~1 fetch per cold item; warm: 0.

## Components

| File                                                        | Change                                                                                                                                                                     |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugins/tmdb/src/mappers.ts`                      | `mapMovie`/`mapShow` lift `backdrop_path` → `backdropUrl`                                                                                                                  |
| `packages/plugins/tmdb/src/images.ts`                       | `buildBackdropUrl(ctx, path)` (TMDB `original` size or w1280)                                                                                                              |
| `apps/server/src/catalog/canonical.ts`                      | drop `thumbUrl` field from `toCanonicalRow` output                                                                                                                         |
| `apps/server/src/db/schema/catalog.ts`                      | drop `thumb_url` col, drizzle migration                                                                                                                                    |
| `apps/server/src/catalog/types.ts`                          | `CanonicalMetadata` drop `thumbUrl`                                                                                                                                        |
| `apps/server/src/catalog/service.ts`                        | new `patchArtwork(key, urls)` w/ COALESCE update                                                                                                                           |
| `packages/shared/src/artwork/schemas.ts`                    | unchanged (no mode param)                                                                                                                                                  |
| `apps/server/src/artwork/service.ts`                        | `getArtwork`: dispatch (mv-cache) → fire-forget patchArtwork. No canonical read.                                                                                           |
| `apps/server/src/home/canonical-artwork-fill.ts`            | new `fillMissingArtwork(catalog, items)` — batched canonical lookup, in-place fill of `poster`/`backdrop`/`clearLogo`                                                      |
| `apps/server/src/home/layout.ts`                            | `runFetch` calls `fillMissingArtwork` after every successful row fetch so upstream-only items (Trakt `recommendations@v1`, etc.) inherit canonical artwork before the wire |
| `apps/client/src/hooks/use-artwork.ts`                      | add `useArtworkIfMissing(item, requiredSlots, opts)`                                                                                                                       |
| `apps/client/src/components/home/{card,hero,sidebar-*}.tsx` | swap `useArtwork` → `useArtworkIfMissing` w/ explicit slot list                                                                                                            |

## Data flow

```
COLD HOME ROW
  client → row.fetch
    catalog.getDiscoverFeed → snapshot? hydrateFromCanonical
                            ↓ miss
    media.discoverFeed → metadata@v1 → writeMetadata(toCanonicalRow)
                                          poster, backdrop ◄ TMDB
                                          clearLogo = null
    runFetch (home/layout.ts) → fillMissingArtwork(catalog, items)
                                  // batched getMetadataBatch over (mediaType,tmdbId)
                                  // backfills poster/backdrop/clearLogo from canonical
                                  // for rows whose upstream plugin (e.g. Trakt
                                  // recommendations@v1) supplied no artwork
  server → CompactMediaItem { poster, backdrop, overview, [clearLogo if canonical has it] }

CARD RENDER
  needs = ["poster", "backdrop", "clearLogo"]   // hero
  if needs.every(s => item[s]) → render, no fetch
  else → useArtworkIfMissing → POST /artwork.get

ARTWORK.GET
  dispatchAggregatePerKind (mv: cache hit / miss → plugin)
  fireForget patchArtwork → canonical fills missing slot
  next row read for same key serves slot inline → no /artwork.get
```

## Failure semantics

| Scenario                         | Behaviour                                                                                       |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| metadata@v1 reject on cold-fill  | row not written; existing path                                                                  |
| TMDB mapper backdrop null        | row inserted, backdrop_url null, lazy fill                                                      |
| canonical row stale URL          | accept; nightly metadata-refresh rewrites at 30d; `mv:` cache TTL bounds /artwork.get freshness |
| dispatch reject one key          | per-key error map (existing); other keys unaffected                                             |
| patchArtwork throw               | `consola.error("[artwork] patch failed", e)`, 200 to client                                     |
| patchArtwork: row absent (race)  | 0 rows updated, no error, next read writes                                                      |
| 2 concurrent gets, same cold key | first hits plugin, second hits `mv:` cache; first patch claims a per-key write-back window, the second is suppressed for that window. The second bundle is byte-identical (same `mv:` cache entry) so the suppressed patch is redundant. The one exception is a partial first bundle or a differing `languages` set — then the suppressed patch could have filled a new slot, and that slot is deferred until the window expires (≤ `WRITE_BACK_DEDUP_MS`). See Concurrency. |
| caller exceeds per-user rate limit | 429 + `Retry-After: N` header + `{ code: "mcp.rate_limited" }` body; TMDB call skipped. Bucket capacity 60, refill 1/s, charged per unique canonical lookup in batch. |

## Schema migration

```ts
ALTER TABLE canonical_metadata DROP COLUMN thumb_url;
```

Drizzle migration. No data backfill needed (col was mostly null anyway).

## Concurrency

`patchArtwork` per-key fire-and-forget. SQLite single-writer queues. `INSERT OR REPLACE` on metadata writes preserves `created_at` via existing `COALESCE`. Patch never overwrites filled URL (COALESCE), so concurrent patches are always *correct*.

They are not free, though: the canonical row is shared across all users, so N viewers of the same hot title in the same instant would each fire a redundant COALESCE UPDATE against the one row, scaling WAL traffic with concurrent viewers. To bound that, the artwork service keeps a process-wide write-back dedup window (`WRITE_BACK_DEDUP_MS`, currently 60s): the first fulfilled dispatch for a canonical key claims the window and patches; later dispatches for the same key inside the window skip the patch. A failed patch releases the claim so the next read can retry — best-effort write-back is preserved. The window is purely a write-amplification guard; correctness still rests on COALESCE, so no DB lock is needed.

The dedup state is process-local. Under the SQLite single-writer assumption there is one server instance, so the window suppresses all redundant patches. If the deployment ever fans out to N instances, each holds its own window → at most N patches per key per window — still correct (COALESCE), just less aggressively deduped.

The window keys on the canonical title only, not on which slots a bundle fills. Most suppressed patches are genuinely redundant: a second dispatch for the same `(ids, type, languages)` reads the identical `mv:` cache entry, so its bundle — and therefore its `top1` slot set — is byte-identical to the one already written. The window deliberately does not key on the slot set because the realistic suppressed cases carry the same slots. The exception is a *partial first bundle* (e.g. the cold plugin call returned poster only, no `clearLogo`) or a *differing `languages` set* (a different `mv:` key, so a fuller bundle): a second dispatch inside the window that would fill a newly resolved slot is suppressed, and that slot stays null on `canonical_metadata` until the window expires. The client therefore keeps firing `/artwork.get` for that slot for up to `WRITE_BACK_DEDUP_MS`. This is an accepted, bounded deferral, not a correctness bug — the slot is filled on the first dispatch after the window lapses, consistent with the best-effort, eventually-complete write-back contract — and it is preferred over per-slot window keying, which would re-introduce the write amplification the window exists to bound.

## Backfill

None. Real traffic warms catalog. Existing nightly `metadata-refresh` (30d stale) continues — unchanged. Hot rows fill within first user request.

## Observability

- `catalog.patch_artwork.ok`/`fail` counters.
- `home.row.artwork_inline_rate` = items shipped with all required slots filled / total items. Trend → 1.0 over time as catalog warms.
- Existing `mv:` dispatch hit-rate metrics + `consola.error("[artwork] dispatch crashed", …)` retained.

## Tests

| File                                          | Cases                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `catalog/canonical-metadata.test.ts`          | metadata-only raw → poster + backdrop filled, clearLogo null, no thumbUrl field; missing backdrop_path → null                                                                   |
| `catalog/service.test.ts`                     | `patchArtwork`: row exists all-null → populated; partial fill → COALESCE preserves; row absent → no throw, no rows; concurrent → no clobber                                     |
| `artwork/service.test.ts`                     | dispatch always fires; patchArtwork called per key with top1; dispatch reject one key → error map populated, other keys unaffected; patchArtwork throw → 200 to client (logged) |
| `plugins/tmdb/mappers.test.ts`                | `backdrop_path` → `backdropUrl`; null → null                                                                                                                                    |
| `client/hooks/use-artwork.test.tsx`           | `useArtworkIfMissing` no fetch when complete; fires on null slot; respects `enabled`                                                                                            |
| `client/components/home/{card,hero}.test.tsx` | row-supplied poster → no fetch; hero missing clearLogo → fetches                                                                                                                |

## Rollout

1. PR1: TMDB mapper backdrop + canonical drops thumb + patch-artwork method + write-back in artwork service. Server-side only, RPC contract unchanged.
2. PR2: client `useArtworkIfMissing` + swap consumers.
3. Watch `home.row.artwork_inline_rate` trend post-deploy.

## Open questions

None blocking. Multi-source picker deferred until UI lands.
