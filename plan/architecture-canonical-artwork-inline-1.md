---
goal: Canonical artwork inline + write-back. Drop `/artwork.get` fan-out from home/discover by serving artwork URLs inline on `CompactMediaItem` and back-filling `canonical_metadata` from `/artwork.get` plugin path.
version: 1.0
date_created: 2026-04-28
status: "Planned"
tags: [catalog, performance, artwork, plugin]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

Implements design at `docs/2026-04-28-canonical-artwork-readthrough-design.md`. Today: `canonical_metadata.poster_url` filled from TMDB metadata; `backdrop_url` / `clear_logo_url` / `thumb_url` mostly NULL → frontend cards POST `/artwork.get` per item → fan-out hits API on every cold render. Plan: TMDB mapper lifts `backdrop_path` (free win, no extra dispatch); drop `thumb_url` col (no consumer); `/artwork.get` always dispatches via existing `mv:` cache layer + writes back to canonical via new idempotent `patchArtwork`; client `useArtworkIfMissing` fires only when row lacks required slot. Net: warmed catalog = zero `/artwork.get` calls per row.

2 phases = 2 PRs. PR1 server-side (RPC contract unchanged). PR2 client-side (hook swap + consumer rewire).

## 1. Requirements & Constraints

- **REQ-001**: TMDB `mapMovie` + `mapShow` lift `backdrop_path` to `backdropUrl` via new `buildBackdropUrl(ctx, path)` helper. Falls through `RawArtwork.backdropUrl` → `toCanonicalRow` → `canonical_metadata.backdrop_url` filled on cold-fill.
- **REQ-002**: Drop `canonical_metadata.thumb_url` column. Drop `thumbUrl` field from `CanonicalMetadata` type + `toCanonicalRow` output. No wire field. No consumer today.
- **REQ-003**: New `CatalogService.patchArtwork(key, urls)` w/ COALESCE-only UPDATE — never overwrites filled URL. Row absent → 0 rows affected, no throw. Bumps `last_refreshed_at`.
- **REQ-004**: `ArtworkService.getArtwork` rewritten — always dispatches via `dispatchAggregatePerKind` (existing `mv:` cache absorbs repeats at TTL). No canonical lookup. After fan settled, fire-forget `Promise.allSettled` of `patchArtwork` per resolved key.
- **REQ-005**: `/artwork.get` RPC contract unchanged. Same request schema, same response shape (`ArtworkGetResponse { results, errors?, generatedAt }`).
- **REQ-006**: Client `useArtworkIfMissing(item, requiredSlots, opts)` hook — new export from `apps/client/src/hooks/use-artwork.ts`. Returns row's existing slot URLs when all `requiredSlots` non-null; else fires `useArtwork` query. Re-uses existing query key + stale time.
- **REQ-007**: Card / hero / sidebar / row consumers swap from unconditional `useArtwork(item)` → `useArtworkIfMissing(item, [...slots])`. Hero `["backdrop", "clearLogo"]`. Card `["poster"]`. Sidebar `["poster"]`. Each call site explicit about its slot needs.
- **REQ-008**: Existing `useArtwork` hook stays exported (future detail-page picker may use it); current consumers all migrate.
- **CON-001**: SQLite-only v1 (matches catalog scope). Postgres `ALTER TABLE … DROP COLUMN` deferred along w/ rest of catalog.
- **CON-002**: Plugin SDK + `artwork@v1` capability untouched. Bundle shape unchanged.
- **CON-003**: `CompactMediaItem` wire shape unchanged. No `thumb` field added.
- **CON-004**: Code uses normal English. Caveman applies to design doc + commit messages only.
- **CON-005**: V44 / V46 / V47 / V48 in SPEC.md = invariants. Implementation must satisfy each.
- **GUD-001**: `vp check` + `vp test` before every commit (memory guardrail #9).
- **GUD-002**: Each PR ships changeset (1–2 sentences, end-user voice, past tense).
- **GUD-003**: Every reported bug gets regression test (memory guardrail #12).
- **PAT-001**: TMDB image helper next to existing `buildPosterUrl` in `packages/plugins/tmdb/src/images.ts`. Same TMDB `image.tmdb.org` base; size `w1280` for backdrop (industry standard for hero/card).
- **PAT-002**: COALESCE-style partial update is the established catalog write idiom; reuse, don't invent a SET-IF-NULL helper.

## 2. Implementation Steps

### Phase 1 — Server: mapper + schema + patch + service rewrite

- GOAL-001: Cold-fill rows carry poster + backdrop + overview from one TMDB metadata dispatch. `/artwork.get` always plugin-dispatched + writes back. RPC contract unchanged. No client changes yet.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | `packages/plugins/tmdb/src/images.ts`: add `buildBackdropUrl(ctx, path: string \| null): string \| null` mirroring `buildPosterUrl` shape; size segment `w1280`. Export. | | |
| TASK-002 | `packages/plugins/tmdb/src/mappers.ts`: in `mapMovie` add `backdropUrl: buildBackdropUrl(ctx, m.backdrop_path ?? null)`. Same for `mapShow` w/ `s.backdrop_path`. Import the new helper. | | |
| TASK-003 | `packages/plugins/tmdb/src/types.ts` (or wherever `MovieRaw`/`TvRaw` live): confirm `backdrop_path?: string \| null` already typed. Add if missing. | | |
| TASK-004 | `packages/plugins/tmdb/__tests__/mappers.test.ts` (or existing mapper test file): add cases for `mapMovie` + `mapShow` — `backdrop_path` present → `backdropUrl` populated; null/absent → null. | | |
| TASK-005 | `apps/server/src/db/schema/catalog.ts`: drop `thumbUrl: text("thumb_url")` line from `canonicalMetadata` table. Regenerate `insertCanonicalMetadataSchema` + `selectCanonicalMetadataSchema` (drizzle-zod auto). | | |
| TASK-006 | Generate Drizzle migration via project's existing migration pipeline. Migration emits `ALTER TABLE canonical_metadata DROP COLUMN thumb_url`. SQLite supports `DROP COLUMN` since 3.35; project uses bun:sqlite (≥3.40). Verify against `apps/server/src/db/migrate.ts`. | | |
| TASK-007 | `apps/server/src/catalog/types.ts`: drop `thumbUrl: string \| null` from `CanonicalMetadata` interface. | | |
| TASK-008 | `apps/server/src/catalog/canonical.ts`: drop `thumbUrl` from `RawArtwork` union + `toCanonicalRow` return shape. Remove the `pickArtwork(raw.thumbUrl, raw.thumb)` line. | | |
| TASK-009 | `apps/server/src/catalog/__tests__/canonical-metadata.test.ts`: drop assertions on `thumbUrl`. Add case: `mapMovie`-shape raw w/ `backdropUrl` filled → row `backdrop_url` populated. Add case: raw w/ no backdrop → row `backdrop_url` null. | | |
| TASK-010 | `apps/server/src/catalog/service.ts`: implement `patchArtwork(key: MetadataKey, urls: { posterUrl?: string \| null; backdropUrl?: string \| null; clearLogoUrl?: string \| null }): Promise<void>`. SQL: ```UPDATE canonical_metadata SET poster_url = COALESCE(poster_url, ?), backdrop_url = COALESCE(backdrop_url, ?), clear_logo_url = COALESCE(clear_logo_url, ?), last_refreshed_at = ? WHERE tmdb_id = ? AND media_type = ?```. Return void. Throws only on DB-layer fault. | | |
| TASK-011 | Export `patchArtwork` from `apps/server/src/catalog/index.ts`. | | |
| TASK-012 | `apps/server/src/catalog/__tests__/service.test.ts` (or new test file): cases for `patchArtwork` — (a) row exists, all artwork cols null → all populated; (b) row exists, poster filled → poster preserved (COALESCE), backdrop+clearLogo patched; (c) row absent → no rows affected, no throw, returns; (d) bumps `last_refreshed_at`; (e) two sequential patches w/ different inputs → first wins per col, second no-op on filled. | | |
| TASK-013 | `apps/server/src/artwork/service.ts`: rewrite `getArtwork` body. Remove existing structure that returns synthesized bundle from canonical (if any was added pre-pivot — re-confirm against current `service.ts` first; today the file does not read canonical so this is a clarifying note, not a delete). Keep `dedupeByCanonicalKey`. After `Promise.allSettled` over `dispatchAggregatePerKind` calls, for each fulfilled outcome → for each `clientKey` in entry → no change to `results` assembly; ADD `void Promise.allSettled(canonicalKeysFor(entry).map(k => deps.catalogService.patchArtwork(k, top1(outcome.value))))` where `top1(bundle) = { posterUrl: bundle.poster[0]?.url ?? null, backdropUrl: bundle.backdrop[0]?.url ?? null, clearLogoUrl: bundle.clearLogo[0]?.url ?? null }`. `canonicalKeysFor(entry)` derives `MetadataKey[]` from `entry.ids.tmdb` + `entry.type` (one key when tmdb id present; skip patch when absent). Errors logged via existing `consola.error("[artwork] patch failed", e)` pattern; never propagate. | | |
| TASK-014 | `ArtworkService` constructor: accept `catalogService: CatalogService` as second param (alongside `userId`). Update RPC wiring at `apps/server/src/api/procedures/artwork.ts` to inject. | | |
| TASK-015 | `apps/server/src/artwork/__tests__/service.test.ts`: cases — (a) dispatch fulfilled → `patchArtwork` called once per resolved key w/ top1 URLs; (b) dispatch rejected for one key → `patchArtwork` not called for that key, called for others; (c) `patchArtwork` throws → response still 200, error logged; (d) request item with no tmdb id → no `patchArtwork` call (key not derivable); (e) duplicate canonical entry (two client keys → one tmdb) → patch called once per canonical key, not per client key. | | |
| TASK-016 | `apps/server/src/api/procedures/__tests__/artwork.test.ts`: confirm RPC contract unchanged — same input schema, same response shape. Update test fixture wiring if `ArtworkService` ctor changed. | | |
| TASK-017 | Add changeset `.changeset/artwork-inline-server.md`: 1–2 sentence note like `Improved home feed performance by serving artwork URLs inline and only fetching from external services when needed.` | | |
| TASK-018 | Run `vp check` + `vp test`. Commit. | | |

### Phase 2 — Client: useArtworkIfMissing + consumer migration

- GOAL-002: Cards / hero / sidebar render row-supplied artwork directly. Only fire `/artwork.get` when row missing required slot. Existing detail/picker consumers (if any) untouched.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-019 | `apps/client/src/hooks/use-artwork.ts`: add `useArtworkIfMissing(item: ArtworkRequestItem & { poster?: string; backdrop?: string; clearLogo?: string }, requiredSlots: Array<"poster" \| "backdrop" \| "clearLogo">, opts?: UseArtworkOptions): UseQueryResult<ArtworkBundle> \| { data: ArtworkBundle; isLoading: false; isError: false }`. Body: compute `haveAll = requiredSlots.every(s => item[s])`. If `haveAll` → return synthesized result `{ data: synthFromItem(item), ... }` w/ `isLoading: false`, no fetch. Else call `useArtwork(item, opts)`. `synthFromItem(item)` → `{ poster: item.poster ? [{ url: item.poster, language: "en" }] : [], backdrop: ..., clearLogo: ..., thumb: [] }`. | | |
| TASK-020 | `apps/client/src/hooks/__tests__/use-artwork.test.tsx`: add cases — (a) item has all required slots → no query fired (mock `useQuery` not called); (b) item missing one slot → query fires; (c) `enabled: false` → no fetch regardless; (d) synthesized bundle structurally matches plugin shape (same array indices, same field names). | | |
| TASK-021 | `apps/client/src/components/home/card.tsx`: swap `useArtwork(item)` → `useArtworkIfMissing(item, ["poster"])`. | | |
| TASK-022 | `apps/client/src/components/home/hero.tsx`: swap to `useArtworkIfMissing(item, ["backdrop", "clearLogo"])`. | | |
| TASK-023 | `apps/client/src/components/home/sidebar-item.tsx` + `sidebar-column.tsx`: swap to `useArtworkIfMissing(item, ["poster"])`. | | |
| TASK-024 | `apps/client/src/components/home/row.tsx` + `row-carousel.tsx`: audit any direct `useArtwork` calls; swap as appropriate per slot needs. | | |
| TASK-025 | `apps/client/src/components/home/__tests__/card.test.tsx` + `hero` test + `sidebar-item.test.tsx`: assert no artwork fetch fires when row carries required slots; fetch fires when slot missing. | | |
| TASK-026 | `apps/client/src/components/home/__tests__/row-carousel.test.tsx`: regression — full row of items w/ inline artwork → zero `/artwork.get` requests recorded. | | |
| TASK-027 | Add changeset `.changeset/artwork-inline-client.md`: 1–2 sentence note like `Reduced artwork network requests on the home feed by reading inline values supplied with each item.` | | |
| TASK-028 | Run `vp check` + `vp test`. Commit. | | |

### Phase 3 — Observability + verification

- GOAL-003: Track convergence of inline-rate post-deploy. Confirm hot home feed never calls `/artwork.get` after warm catalog reached.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-029 | `apps/server/src/home/...`: add metric `home.row.artwork_inline_rate` = items shipped with all required slots filled / total items per `home.getRowContent` response. Emit via existing metrics layer (check `apps/server/src/metrics/` or equivalent). | | |
| TASK-030 | `apps/server/src/catalog/service.ts`: add `catalog.patch_artwork.ok` + `catalog.patch_artwork.fail` counters around `patchArtwork`. | | |
| TASK-031 | Manual verification: open home feed in dev (`vp dev`); seed cold catalog; first scroll → observe `/artwork.get` fires per cold item; second scroll same items → zero `/artwork.get` calls (rows now carry slots inline). Document in PR description. | | |
| TASK-032 | Run `vp check` + `vp test`. Final commit on Phase 2 PR. | | |

## 3. Alternatives

- **ALT-001**: Read-through cache where `/artwork.get` first reads `canonical_metadata` and synthesizes bundle from row before dispatching. Rejected — user explicitly wanted `/artwork.get` to always hit endpoint w/ caching at the existing `mv:` layer; canonical lookup duplicates cache role and complicates contract.
- **ALT-002**: Sync parallel `metadata@v1` + `artwork@v1` dispatch on cold-fill (write artwork into row at metadata-write time). Rejected — adds dispatch latency to every cold metadata write; lazy fill via `/artwork.get` write-back achieves same end state with frontend-prioritized work (above-fold first).
- **ALT-003**: Add `mode: "canonical" \| "full"` param to `/artwork.get` (canonical mode reads row, full mode dispatches plugin). Rejected — single endpoint w/ caching layer is cleaner; multi-source picker (which would need full mode) is a separate future RPC.
- **ALT-004**: Add `thumb` field to wire + keep `thumb_url` col. Rejected — no consumer today; YAGNI; readd schema + wire field when first consumer lands.
- **ALT-005**: Backfill job to populate `clear_logo_url` for all existing rows immediately. Rejected — natural drift via existing 30d nightly metadata-refresh + lazy `/artwork.get` patch suffices; no admin button needed.

## 4. Dependencies

- **DEP-001**: `CatalogService` (T25–T31, complete) — `patchArtwork` is a new method on the existing service.
- **DEP-002**: `artwork@v1` plugin capability + `dispatchAggregatePerKind` strategy — unchanged, depended on for plugin path.
- **DEP-003**: `mv:` dispatch cache (`apps/server/src/media/dispatch-cache.ts`) — unchanged, absorbs repeat `/artwork.get` hits at TTL.
- **DEP-004**: TMDB plugin (`packages/plugins/tmdb`) — modified for backdrop lift.
- **DEP-005**: `@tanstack/react-query` — unchanged; `useArtworkIfMissing` reuses existing `useQuery` infra.
- **DEP-006**: `bun:sqlite` ≥ 3.35 for `DROP COLUMN` — confirmed satisfied.

## 5. Files

- **FILE-001**: `packages/plugins/tmdb/src/images.ts` — new `buildBackdropUrl` export.
- **FILE-002**: `packages/plugins/tmdb/src/mappers.ts` — `mapMovie` + `mapShow` set `backdropUrl`.
- **FILE-003**: `packages/plugins/tmdb/__tests__/mappers.test.ts` — new backdrop cases.
- **FILE-004**: `apps/server/src/db/schema/catalog.ts` — drop `thumbUrl` col.
- **FILE-005**: Drizzle migration file (auto-generated path) — `ALTER TABLE … DROP COLUMN thumb_url`.
- **FILE-006**: `apps/server/src/catalog/types.ts` — drop `thumbUrl` from interface.
- **FILE-007**: `apps/server/src/catalog/canonical.ts` — drop `thumbUrl` handling in `toCanonicalRow` + `RawArtwork`.
- **FILE-008**: `apps/server/src/catalog/service.ts` — new `patchArtwork`.
- **FILE-009**: `apps/server/src/catalog/index.ts` — export `patchArtwork`.
- **FILE-010**: `apps/server/src/catalog/__tests__/{canonical-metadata,service}.test.ts` — updated + new cases.
- **FILE-011**: `apps/server/src/artwork/service.ts` — rewrite to dispatch + write-back.
- **FILE-012**: `apps/server/src/artwork/__tests__/service.test.ts` — write-back cases.
- **FILE-013**: `apps/server/src/api/procedures/artwork.ts` — inject `catalogService` into `ArtworkService`.
- **FILE-014**: `apps/server/src/api/procedures/__tests__/artwork.test.ts` — wiring update.
- **FILE-015**: `apps/client/src/hooks/use-artwork.ts` — new `useArtworkIfMissing`.
- **FILE-016**: `apps/client/src/hooks/__tests__/use-artwork.test.tsx` — new cases.
- **FILE-017**: `apps/client/src/components/home/{card,hero,sidebar-item,sidebar-column,row,row-carousel}.tsx` — swap consumer hook.
- **FILE-018**: `apps/client/src/components/home/__tests__/{card,hero,sidebar-item,row-carousel}.test.tsx` — assert no fetch on inline-complete row.
- **FILE-019**: `.changeset/artwork-inline-server.md` + `.changeset/artwork-inline-client.md`.

## 6. Testing

- **TEST-001**: `mappers.test.ts` — TMDB `backdrop_path` → `backdropUrl`; null → null.
- **TEST-002**: `canonical-metadata.test.ts` — `toCanonicalRow` w/ backdrop → `backdrop_url` filled; no `thumbUrl` field.
- **TEST-003**: `service.test.ts` (catalog) — `patchArtwork` populates null cols, preserves filled cols (COALESCE), no-op on absent row, bumps `last_refreshed_at`.
- **TEST-004**: `service.test.ts` (artwork) — dispatch always fires; `patchArtwork` called per resolved key; reject one key → others unaffected; `patchArtwork` throw → 200 response.
- **TEST-005**: `use-artwork.test.tsx` — `useArtworkIfMissing` no fetch when complete; fires on null slot; respects `enabled`.
- **TEST-006**: `card.test.tsx` / `hero.test.tsx` / `sidebar-item.test.tsx` — row-supplied artwork → no fetch fires.
- **TEST-007**: `row-carousel.test.tsx` — full warm row → zero `/artwork.get` requests.
- **TEST-008**: Manual dev-server check — cold→warm transition observed in network tab.

## 7. Risks & Assumptions

- **RISK-001**: SQLite `DROP COLUMN` on `canonical_metadata` requires SQLite ≥ 3.35; older bun versions on dev machines could fail. Mitigation: pin minimum bun version in `package.json` engines if not already set; CI uses fixed version.
- **RISK-002**: `top1(bundle)` rule (`bundle.poster[0]?.url`) trusts `aggregate_per_kind`'s ranking. If a future plugin returns variants in suboptimal order, canonical row stores wrong URL. Mitigation: V47 documents the rule; if a future bug arises, backprop a bug entry + tighten ranking in `aggregate-per-kind.ts`.
- **RISK-003**: Two simultaneous `/artwork.get` for same cold key both call `patchArtwork`; SQLite serializes writers. Both writes succeed; second is COALESCE no-op. No lock needed but worth a regression test.
- **RISK-004**: `useArtworkIfMissing` synthesized result shape must match `useArtwork` return type so consumers needn't branch. Mitigation: TEST-005(d) asserts structural match.
- **ASSUMPTION-001**: TMDB metadata response includes `backdrop_path` for the vast majority of titles. Empty `backdrop_path` → null col → falls back to lazy `/artwork.get` fill.
- **ASSUMPTION-002**: `mv:` dispatch cache TTL for `artwork@v1` is appropriate (24h or similar). Not modified by this plan.
- **ASSUMPTION-003**: Detail-page artwork picker (multi-source, alt-language) is a future feature; today no consumer exists. If/when it lands, it can call `useArtwork` directly or a new dedicated RPC.

## 8. Related

- **DESIGN-001**: `docs/2026-04-28-canonical-artwork-readthrough-design.md` — design source.
- **SPEC-001**: `SPEC.md` §V44 / §V46 / §V47 / §V48 / §T32.
- **PRIOR-001**: `plan/architecture-catalog-service-1.md` — phase 2 (T26) added `canonical_metadata` columns + initial `toCanonicalRow`.
- **PRIOR-002**: `apps/server/src/artwork/service.ts` — current dispatch-only implementation; this plan adds write-back.
