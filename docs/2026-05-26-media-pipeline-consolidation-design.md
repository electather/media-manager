# Media Pipeline Consolidation — Shared Source Pipeline + Thin Product Shells

**Status:** design (rev 1)
**Date:** 2026-05-26
**Author:** Omid Astaraki
**Epic:** [#491](https://github.com/electather/media-manager/issues/491). Folds in #496 (split watchlist service), #502 (isInfoOnly→unavailable). #500/#501 already shipped.
**Supersedes (partial):**
- [2026-05-05-home-page-backend-design.md](./2026-05-05-home-page-backend-design.md) — §RowProvider contract + per-row pagination. Hero / match-reason / layout-cache / detail composition unchanged.
- [2026-05-23-watchlist-sections-design.md](./2026-05-23-watchlist-sections-design.md) — §S read path (items / mood-items / tonight / recently). Counts / moods-summary semantics, seed, sync, events, all client (§C) unchanged.
- [media-service.md](./media-service.md) — stale plugin-dispatch-only scope; this doc records media as the row-pipeline owner.
**Deps:** the three docs above, [2026-05-19-watchlist-backend-design.md](./2026-05-19-watchlist-backend-design.md), [2026-05-17-backend-feature-architecture-design.md](./2026-05-17-backend-feature-architecture-design.md), `backend-feature-architecture` skill.
**Scope:** backend only. Wire-contract changes recorded here; client migration → future doc (epic frontend issues #504–#519 untouched).

Caveman ultra. Pseudo = shape only, ⊥ = not/none/false, ∪ = union, → = maps-to/becomes, ∀ = for-all, ≥ = at-least.

## Revision history

- **rev 1 (2026-05-26)** — Initial consolidation design.

## Problem

Epic #491 already moved storage, enrich, classify, progress, availability-cache into `media/` (#492–#500, closed). `media/` IS the shared service. Residue remains:

1. **Divergent read paths.** `home` composes via a `RowProvider` registry (thin, pluggable). `watchlist` composes via a 864-LOC monolith `service.ts` of bespoke endpoint functions (#496, "too big"). Two patterns, one job (list media).
2. **Two output shapes.** `CompactMediaItem` (home — already carries `progress`/`availability`) vs `WatchlistItem` (= `CompactMediaItem` + `addedAt`/`addedSource`). Home's `your-watchlist` row strips the extra fields. Superset masquerading as two types.
3. **Three cursor codecs.** keyset (`addedAt:id`), offset-into-feed (home, JSON, zod, decode→400), offset-snapshot (watchlist alpha/runtime/status, decode→null). Same encode/decode mechanics, forked.
4. **Domain logic leaked into consumers, duplicated:**
   - classify→preview→count loop **3×** — `watchlist/service.ts` `getCounts` (~:200), `tonight/section.ts` (~:69), `media/enrich.ts` filter pass (~:158). All carry `fallow-ignore code-duplication`.
   - `extractTmdbId` **3×** — `home/internal/adapters.ts:70`, `watchlist/service.ts:480`, `media/progress.ts:86`.
   - `0.85` finishing threshold declared **4×** — `media/progress.ts:14` (`FINISHING_THRESHOLD`), `home/internal/hero.ts:9`, `home/internal/match-reason.ts:5` (`FINISHING_SOON_THRESHOLD`), `home/rows/continue-watching-active.ts:9`.
   - `Promise.all([getStatusBatch, getMetadataBatch, loadProgressMap])` warn-and-fallback fan-out **4×** — `getCounts`, `listItemsOffset` (~:705), `tonight/section` (~:53), `filterByMood` (~:675).
   - `home/internal/adapters.ts` `compositeId` duplicates shared `keyToId`.
5. **`RowProvider` re-implements sort+slice+cursor inside every `fetchPage`** — home's own boilerplate; each new row re-writes pagination.
6. **#502 bug** — `classify` routes `isInfoOnly` items to `upcoming`; should be `unavailable`.

Root cause: media owns *primitives* but not the *pipeline*. Each consumer re-assembles the same pipeline (batch→enrich→classify→filter→sort→paginate) by hand, in two different shapes.

## Goals / non-goals

**Goals**
- One media-domain pipeline owned by `media`. home + watchlist = thin product shells that supply a *source* + *config* and wrap results in their own envelope.
- One wire shape (extend existing `CompactMediaItem`; §D). One cursor codec (2 modes). Writes owned by table owner (`media`).
- Kill residue #4. Remove `RowProvider` per-row pagination boilerplate (#5). Fix #502.
- Split `watchlist/service.ts` (#496).

**Non-goals**
- ⊥ frontend (#504–#519, Paraglide, route loaders) — future doc.
- ⊥ user-visible behavior change beyond bucket fix #502. Epic constraint.
- ⊥ collapse home/watchlist into media (god-module, rejected — product logic ≠ domain).
- ⊥ legacy `?filter=`. ⊥ `unknown` bucket. ⊥ compat shims (pre-stable).

## §A — Architecture (target module structure)

```
media/                                  FAT domain + pipeline + storage + writes
  service/         listRows(source,cfg)→Page; writes; count-mode helpers; (existing MediaService dispatch)
  pipeline/        batchLoad → enrich → classify → filter → sort → paginate
  source.ts        MediaSource<P> interface (the contract; §B)
  classify.ts      classifyBucket, previewForClassify, isActiveProgress, matchesBucket  (+ #502 fix)
  enrich.ts        enrich(rows,batch) → CompactMediaItem[]   (single shape; §D)
  progress.ts      loadProgressMap; extractTmdbId (the ONE copy; §F); FINISHING_THRESHOLD (the ONE copy)
  availability-cache.ts  getMatchingServersCached
  status-batch.ts  StatusBatchMemo
  cursor.ts        ONE opaque codec, modes keyset|offset  (§E)
  repo/            watchlist_items reads+writes+seed (owns table)
  types.ts         CompactMediaItem extension (§D); MediaSource; PipelineConfig; Page; Cursor

(media/service/index.ts already 1073 LOC — over the 500 hard cap. New work lands as NEW files in
 service/ — service/list-rows.ts, service/writes.ts, service/count.ts — NOT appended to index.ts.)

home/                                   THIN product shell
  sources/         12 discovery MediaSources (catalog/plugin feeds)
  internal/        hero cascade, match-reason, layout ordering+eligibility, layout-cache, detail/season
  service.ts       composeLayout / composeRow / composeDetails → wrap media Page in layout envelope

watchlist/                              THIN product shell
  sources/         persistent-table MediaSources: items, mood-items, tonight, recently
  moods/           derive, registry, cluster-summary (aggregate, §G)
  tonight/         score, pick (ranking heuristic; §H tonight shaping)
  service.ts       section envelope + aggregates (counts, mood-summary) → reads via listRows, writes via media barrel
  jobs/            on-watchlist-mutation (cache invalidation), sync-plugin-watchlist
```

Boundary rule (unchanged, enforced): consumers import `media` **barrel only**. `media` ⊥ import home/watchlist (no cycle; §J).

## §B — MediaSource contract (generalized RowProvider)

Replaces `home/internal/types.ts` `RowProvider`. Lives `media/source.ts`, exported via barrel.

```
interface MediaSource<P = void> {
  sourceId: string                 // stable slug, unique across a consumer's registry
  // fetch RAW set only. NO enrich/classify/sort/slice here — pipeline owns those.
  fetchRawSet(ctx: SourceContext, params: P, cursor: Cursor | null):
    Promise<{ rows: ActiveRow[]; partial: boolean; nextRaw?: RawPageToken }>
  stages: {
    classify?: boolean             // run bucket classification
    filter?: FilterKind            // "bucket" | "mood" | ⊥   (driven by params)
    sort: RowSort                  // default sort; params may override if allowed
    cursorMode: "keyset" | "offset"
  }
}
```

- `P` = per-source request params (bucket, sort, moodId, limit). Closes the `/items` filter-param gap (home's `fetchPage(ctx,cursor)` had no param slot).
- `fetchRawSet` does the **only** thing that differs between sources: produce the raw row set (persistent-table query OR ephemeral plugin feed). `partial=true` ⇒ a plugin soft-failed; propagates (home degrade-gracefully). `cursor` threads the page position; source decodes via the shared codec (§E).
- `SourceContext` = unify `RowContext` ∪ `WatchlistContext`. Research: `WatchlistContext` already documented "structurally compatible with home row context"; `asWatchlistContext` already bridges `log`/`logger`. Pin: `{ userId, mediaService, catalog, deadlineMs?, statusBatch, logger }`. Drop the `log` alias (pre-stable break).
- Eligibility: keep `eligibility(ctx)` **as a consumer-side concern**, NOT on the source — it's product-gating (home: has-capability / has-history), invoked by the consumer envelope before calling `listRows`. Source contract stays minimal (V.MC1).

**Type glossary** (✚ = new in Phase 1; ◆ = existing, reused):
- `ActiveRow` ◆ — `@ent-mcp/shared/media`, the persisted/raw row.
- `RowSort` ◆ / `FilterKind` ✚ — sort enum (exists as `RowSort`) / filter selector (`"bucket"|"mood"|⊥`, new).
- `Cursor` ✚ — the discriminated union in §E. `RawPageToken` ✚ — opaque keyset hop token a table source threads back (e.g. last `addedAt:id`); ⊥ for offset sources.
- `SourceContext` ✚ — `RowContext ∪ WatchlistContext` (§B), media-owned.
- `PipelineConfig` ✚ — `{ params; sort?; filter?; cursor; limit }` passed to `listRows`.
- `Page` ✚ — `{ items: CompactMediaItem[]; cursor: string | null; partial: boolean }` (was home `RowPage`).

## §C — listRows pipeline

`media.listRows(source, cfg)` — the single read path. Stages opt-in via `source.stages` + `cfg`.

```
listRows(source, cfg):
  raw   = await source.fetchRawSet(ctx, cfg.params, cfg.cursor)     // {rows, partial, nextRaw}
  batch = await batchLoad(rows)            // ONE place: status+meta+progress, warn+fallback (kills #4 fan-out 4×)
  items = enrich(rows, batch)              // → CompactMediaItem[]  (single shape)
  if source.stages.classify: items = items.map(withBucket)          // classify (#502 fix inside)
  if source.stages.filter:   items = filter(items, cfg.params)      // bucket|mood predicate
  items = sort(items, cfg.sort ?? source.stages.sort)
  page  = paginate(items, source.stages.cursorMode, cfg.cursor, raw.nextRaw, cfg.limit)
  return { items: page.items, cursor: page.next, partial: raw.partial }
```

- `batchLoad` = the shared fan-out (status batch + metadata batch + progress map), warn-and-fallback. Single definition in `media/pipeline`. All 4 watchlist sites + enrich's internal call route here.
- `classify` count loop (the 3× dup) is now this single stage; count-mode (§G) reuses it without enrich/paginate.
- `paginate`: keyset mode hops the raw query (overshoot helper, preserves #500 empty-streak `cursor:null` + #501 single-pass sparse bucket+sort + RISK-005 offset ceiling — §E). offset mode slices the in-memory sorted set.
- Soft-failure: a source that catches `AllPluginsFailedError`/`PluginCallError` returns `partial:true` rather than throw; consumer envelope decides include/drop (home preview rule: include iff `items.length>0 || partial`). Hard throw bubbles as typed media error.

## §D — Unified item shape (extend `CompactMediaItem`, ⊥ new name)

**Name caution:** `MediaItem` is already taken — `packages/shared/src/media/types.ts` defines a *recommendation-engine* `MediaItem` (different shape; consumed by `preferences/*` + `mcp` adapter). Do **not** reuse it. Unify into the **existing** home wire type `CompactMediaItem` (`@ent-mcp/shared`), which already carries `progress`/`availability`. Only `addedAt`/`addedSource` are genuinely new.

```
CompactMediaItem (extend existing; @ent-mcp/shared)
  ... existing fields (incl. progress?, availability? — already present today)
  + addedAt?: number | null            // epoch ms (matches today's WatchlistItem.addedAt: number); ⊥ on discovery rows
  + addedSource?: WatchlistSource | null
```

- `addedAt` stays **epoch ms (`number`)** to match today's `WatchlistItem.addedAt` — no string reformat. The internal sort field `__addedAtMs` is unchanged; the public `addedAt` is its nullable wire mirror.
- Discovery sources leave `addedAt`/`addedSource` `⊥`. Persistent-table sources fill them. home stops stripping (`your-watchlist` deletes its strip step).
- **`WatchlistItem` is deleted** — callers use `CompactMediaItem`. Internal-only private fields (`__topContributors`, `__addedAtMs`) stay stripped-before-serialize on `InternalCompactMediaItem`, ⊥ on wire (V.MI1).
- Pre-stable wire break: home row items gain two nullable fields. Acceptable. Client follows in future doc.

## §E — Cursor (one codec, two modes)

`media/cursor.ts`. base64url JSON, zod-validated. Replaces all 3 codecs.

```
Cursor = { mode: "keyset"; k: string }      // e.g. "addedAt:id" or feed seed (becauseYouWatched style)
       | { mode: "offset"; n: number }
encode(c) → string
decode(s) → Cursor | null                    // NEVER throws; bad/foreign input → null
```

- **Codec never throws** — `decode` returns `null` on bad/foreign input. The **400-vs-empty decision is the consumer's**, preserving today's split: home feed wraps `null → HttpError 400` (its existing contract); watchlist treats `null → first-page` (its existing keyset + offset-snapshot behavior — both return null today, **no behavior change**). This avoids the trap of "keyset→400 / offset→null," which is wrong: home *offset* throws 400 while watchlist *keyset* returns null, so decode-fail behavior is per-consumer, not per-mode.
- `decode` asserts the decoded `mode` matches `source.stages.cursorMode`; mismatch → `null` (V.CU1), consumer maps as above.
- Source-specific seed (moodId, feed seedId/seedType, sort) rides inside `k` for keyset sources, exactly as `becauseYouWatched` carries its seed today. No separate per-source codec.
- RISK-005 `OFFSET_FULL_LOAD_WARN_ROWS` advisory ceiling moves onto the offset-mode paginate path.

## §F — Shared domain utils (kill #4)

Single definitions in `media`, exported via barrel where a consumer still needs them:
- `extractTmdbId(payload)` → `media/progress.ts` (the one). Delete home + watchlist copies.
- `FINISHING_THRESHOLD = 0.85` + `isFinishing(progress)` → `media` (the one). Delete the 4 literals; callers import.
- `compositeId` (home) → delete, use shared `keyToId`.
- `batchLoad` fan-out → `media/pipeline` (the one). §C.

## §G — Aggregates (count-mode, NOT sources)

`/counts` + `/moods` summary return tallies, ⊥ item lists → ⊥ a `MediaSource`. They reuse the pipeline's `batchLoad+classify` in **count-mode** (skip enrich/sort/paginate):

```
countBuckets(rows) = batchLoad → classify → tally 5 buckets + total        // → media helper
moodSummary(rows)  = batchLoad(meta) → derive → tally clusters ≥ MIN_CLUSTER_SIZE   // watchlist owns derive/registry
```

- `countBuckets` lives in `media` (pure domain tally; consumed by watchlist `getCounts`). Kills the getCounts copy of the classify loop.
- `moodSummary` stays in `watchlist/moods/cluster.ts` (mood derivation = watchlist product), but calls `media.batchLoad` + media metadata, ⊥ its own fan-out.
- Wire shapes unchanged: `WatchlistCounts` (5 buckets + total), `WatchlistMoodSummary` ({clusters:{moodId,count}[]}).

## §H — Consumer composition (envelopes)

Sources are media-domain; **envelopes are product, stay in consumers.**

- **home** — `composeLayoutLive`: per `ROW_ORDER`, run `eligibility(ctx)` (consumer-side, §B), then `listRows(source, cfg)`, build stub (include iff `items>0 || partial`). hero / match-reason / layout-cache / detail / season composition unchanged. home's 12 rows reimplemented as `MediaSource` (`fetchRawSet` only — sort/slice/cursor deleted from each, → pipeline). `_shared.ts` helpers (`fetchSimilarPage`, `loadCanonicalItems`, `probeMediaEntry`) stay home-side (catalog feed plumbing).
- **watchlist** — section envelope: each section = `listRows(source, params)` + wrap. items / mood-items / tonight / recently → `MediaSource`. counts / mood-summary → §G aggregates. writes → media barrel.
- **tonight shaping** — `tonight` source returns the ranked list (score+pick stays watchlist product, run inside `fetchRawSet` over the active set, returns rows already ranked + `partial`). Pipeline enriches/returns flat `items`. Hero-vs-alternates (`items[0]` special, ≤4 alternates) = **envelope concern**: watchlist section wrapper splits `items` into hero + alternates. `Page.items` stays flat (V.TN1). No cursor (bounded page).

## §I — Wire contract delta

- Item shape: extended `CompactMediaItem` everywhere; `WatchlistItem` deleted (home rows gain nullable `addedAt`/`addedSource`). Pre-stable break.
- Cursor: single opaque base64url JSON (mode-tagged). Existing cursors invalidated on deploy (pre-stable, no migration).
- Endpoints: list reads (home rows, watchlist items/mood-items/tonight/recently) route through the source pipeline; surface URLs may stay per the sections doc OR collapse to a generic `:sourceId` resolver — **deferred to §M Phase 4 / future client doc**. counts / mood-summary / writes keep distinct endpoints.

## §J — Fallow / boundaries

- No new module → no new fallow zone pair. media / home / watchlist zones unchanged.
- `MediaSource` interface + `listRows` + `batchLoad` + `countBuckets` + cursor codec → `media/index.ts` barrel (public). `repo/`, `pipeline/` internals stay behind barrel.
- home/watchlist import `media` barrel only. media ⊥ import home/watchlist (no `home→media→home` cycle; `circular-deps: error` holds). Concrete sources owned by the consumer that registers them (V.RG1).
- Size: media grows (pipeline + source.ts). Use subdir promotion per backend budgets — `service/` (>500 LOC), `repo/` (>300), new `pipeline/` dir. Cohesive, ⊥ god-module.
- `events.ts` contract: ⊥ change → no semver bump beyond the internal-only changeset. Writes moving into media service = internal reorg, but deleting `WatchlistItem` + extending `CompactMediaItem` is a public type change on `@ent-mcp/shared` + `@ent-mcp/server` → **minor** changeset.

## §K — #502 fix

`classify.ts` `classifyBucket`: `isInfoOnly` (released + ⊥ server + ⊥ request path, info-only metadata) → `"unavailable"`, NOT `"upcoming"`. `upcoming` reserved for unreleased. Update sections doc §S.5 reference. Regression test (§T).

## §L — Invariants

- **V.MC1** — `MediaSource` carries no enrich/sort/slice/cursor logic. Only `fetchRawSet` + `stages` declaration. Eligibility is consumer-side. (Anti-boilerplate.)
- **V.MI1** — `CompactMediaItem` internal private fields (`__*`) never serialize. Wire = public fields only.
- **V.CU1** — `decode` never throws; bad/foreign input or mode-mismatch → `null`. Consumer maps `null` (home feed → 400; watchlist → first-page), preserving today's per-consumer behavior.
- **V.PG1** — pipeline preserves #500 (empty-streak → `cursor:null`) + #501 (single-pass sparse bucket+sort) + RISK-005 ceiling.
- **V.RG1** — concrete sources owned + registered by the consumer module; media never imports a concrete source.
- **V.TN1** — `Page.items` flat; tonight hero/alternate split is envelope-side, not pipeline-side.
- **V.SH1** — exactly one definition each of `extractTmdbId`, `FINISHING_THRESHOLD`/`isFinishing`, `batchLoad`, bucket classify loop, cursor codec. fallow `code-duplication` ignores on the old sites removed.

## §M — Phases

Each phase: own PR, `vp check` + `vp test` green, regression tests where noted. Compact between phases.

1. **Pipeline core in media.** Add `media/source.ts` (`MediaSource`), `media/cursor.ts` (unified), `media/pipeline/` (`batchLoad`, `listRows`, paginate w/ both modes); `listRows`/writes/count land as **new files in `service/`**, ⊥ appended to the 1073-LOC `service/index.ts`. Move `extractTmdbId`/`FINISHING_THRESHOLD` to single defs. Extend `CompactMediaItem` in shared (the **existing** type — NOT the recommendation-engine `MediaItem`, §D). No consumer change yet; media unit-tested in isolation. Changeset: minor (`@ent-mcp/shared`, `@ent-mcp/server` — new public surface + `CompactMediaItem` fields).
2. **Writes → media.** `addItem`/`removeItem`/`seedFromPlugins`/`syncFromPlugins` move to `media/service`, exported via barrel. watchlist calls media barrel. Delete from watchlist. Regression: existing watchlist mutation tests repoint, stay green.
3. **#502 + count-mode.** classify fix; `countBuckets` in media; `getCounts` + `moodSummary` route through it. Kill the 3× classify loop + 4× fan-out dup; remove `fallow-ignore code-duplication`. Regression: #502 routing test; counts parity test.
4. **watchlist sources (#496).** Reimplement items / mood-items / tonight / recently as `MediaSource` in `watchlist/sources/`. Split `service.ts` → `sources/` + thin `service.ts` (envelope + aggregates) + `internal/`. ≥40% byte drop on `service.ts`. tonight envelope hero/alternate split. Regression: section parity tests (items, mood-items, tonight, recently produce same items as pre-refactor).
5. **home sources.** Reimplement 12 rows as `MediaSource` (delete per-row sort/slice/cursor). `_shared.ts` stays. `composeLayoutLive` unchanged except calling `listRows`. Drop `compositeId` → `keyToId`. Regression: home layout parity test.
6. **Cleanup.** Delete dead: old `RowProvider` type, old cursor codecs, `WatchlistItem` superset type, duplicate utils. fallow baseline ⊥ grow (Rule 14). Final `vp check` + `vp test`.

## §T — Testing

- Pipeline stage units: `batchLoad` (warn+fallback on partial), `classify` (bucket rules incl. #502), `filter` (bucket/mood predicate), `sort`, `paginate` (keyset hop + offset slice). Rule 9: assert WHY (sparse-page invariant, empty-streak cursor:null).
- `MediaSource` contract test: `partial` propagation, deadline honored, no sort/cursor logic in source (V.MC1).
- Cursor codec: `decode→null` on bad/foreign input for **both** modes + mode-mismatch→null (codec never throws). Separately assert consumer mapping: home consumer null→400, watchlist consumer null→first-page (V.CU1).
- Regression: #500 phantom cursor, #501 sparse page, #502 isInfoOnly→unavailable.
- Parity (epic: no behavior change): home layout + each watchlist section produce same item ids/order as pre-refactor fixtures.
- counts parity (5 buckets + total) post count-mode.

## §N — Risks

- **RISK-101** — `MediaSource` interface over-general → awkward for ephemeral-feed (home) AND persistent-table (watchlist). Mitigate: keep contract tiny (`fetchRawSet` + `stages`); variation in `params`/closure, ⊥ in interface. V.MC1 guards.
- **RISK-102** — media module size. Mitigate: subdir promotion (`service/`, `repo/`, `pipeline/`); ⊥ fold product logic in (§A).
- **RISK-103** — parity drift during reimplementation (subtle sort/classify behavior change). Mitigate: §T parity fixtures captured BEFORE Phase 4/5, asserted after.
- **RISK-104** — cursor invalidation on deploy. Accept (pre-stable, no live users); note in changeset.
- **RISK-105** — tonight ranking semantics lost when flattening to `Page.items`. Mitigate: V.TN1 envelope split; ranking stays in `fetchRawSet`, order preserved.

## §O — Out of scope

Frontend (#504–#519), Paraglide variants (#511–#512), route loaders (#513), virtualization (#519), generic `:sourceId` endpoint collapse (§I) — all future client doc. Seed/sync lifecycle internals, events, plugin dispatch strategies — unchanged.
