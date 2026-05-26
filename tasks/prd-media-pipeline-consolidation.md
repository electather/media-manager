# PRD: Media Pipeline Consolidation

> **Source of truth:** [`docs/2026-05-26-media-pipeline-consolidation-design.md`](../docs/2026-05-26-media-pipeline-consolidation-design.md) (rev 1).
> This PRD repackages that design into implementable, independently-verifiable user stories for the Ralph autonomous loop. The design document governs all contract details; where this PRD and the design disagree, the design wins.
>
> **Epic:** [#491](https://github.com/electather/media-manager/issues/491). Folds in #496 (split watchlist service) and #502 (`isInfoOnly` → `unavailable`). #500/#501 already shipped.

## Introduction

The backend has two divergent read paths that do the same job — list media. `home` composes feeds through a thin, pluggable `RowProvider` registry; `watchlist` composes through an 864-LOC monolith `service.ts` of bespoke endpoint functions. Both re-assemble the same pipeline by hand (batch-load → enrich → classify → filter → sort → paginate), in two different output shapes (`CompactMediaItem` vs `WatchlistItem`), behind three forked cursor codecs, with the same domain logic duplicated 3–4× across consumers.

The `media/` module already owns the storage and domain *primitives* (enrich, classify, progress, availability-cache) from the earlier closed work (#492–#500). What it does not own is the *pipeline*. This project makes `media` the single owner of one read pipeline (`listRows`), one wire shape (an extended `CompactMediaItem`), one cursor codec (two modes), and the `watchlist_items` writes. `home` and `watchlist` become thin product shells that supply a *source* plus *config* and wrap results in their own envelope.

This is a backend-only refactor. With one exception (the #502 bucket fix), there is **no user-visible behavior change** — parity is the success bar.

## Goals

- Establish a single media read pipeline owned by `media`, consumed by `home` and `watchlist` as thin shells.
- Collapse the two output shapes into one wire type by extending the existing `CompactMediaItem` (not the recommendation-engine `MediaItem`); delete `WatchlistItem`.
- Replace the three cursor codecs with one opaque base64url codec carrying two modes (`keyset` | `offset`).
- Move `watchlist_items` writes (`addItem`/`removeItem`/`seedFromPlugins`/`syncFromPlugins`) to the table owner, `media`.
- Remove the duplicated domain logic (`extractTmdbId`, `FINISHING_THRESHOLD`/`isFinishing`, `batchLoad` fan-out, the classify-count loop, `compositeId`) down to exactly one definition each, and drop the corresponding `fallow-ignore code-duplication` markers.
- Remove the per-row sort/slice/cursor boilerplate that every `RowProvider.fetchPage` re-implements.
- Fix #502: `isInfoOnly` items classify as `unavailable`, not `upcoming`.
- Split `watchlist/service.ts` (#496) into `sources/` + a thin envelope `service.ts` + `internal/`.

## User Stories

Each story is one phase from design §M and maps to **one PR** that must end with `vp check` and `vp test` green. Phases are ordered and dependent — implement in sequence. "Parity" criteria assert no behavior change; capture fixtures from the pre-refactor code where noted.

### US-001: Pipeline core in `media`
**Description:** As a backend developer, I want `media` to own the read pipeline and contract so that consumers can list media through a single path instead of re-assembling it by hand.

**Acceptance Criteria:**
- [ ] `media/source.ts` defines the `MediaSource<P = void>` interface exactly per design §B: `sourceId`, `fetchRawSet(ctx, params, cursor) → { rows, partial, nextRaw? }`, and a `stages` declaration (`classify?`, `filter?`, `sort`, `cursorMode`). The source carries no enrich/sort/slice/cursor logic (invariant V.MC1).
- [ ] `media/cursor.ts` defines one base64url-JSON, zod-validated codec with `Cursor = { mode: "keyset"; k } | { mode: "offset"; n }`; `decode` returns `Cursor | null` and **never throws** on bad/foreign input or mode-mismatch (invariant V.CU1).
- [ ] `media/pipeline/` contains `batchLoad` (the single status+metadata+progress fan-out with warn-and-fallback) and the `listRows` stage sequence with a `paginate` that supports both `keyset` (raw-query hop) and `offset` (in-memory slice) modes.
- [ ] `listRows`, writes, and count-mode helpers land as **new files** under `media/service/` (`service/list-rows.ts`, `service/writes.ts`, `service/count.ts`) — nothing is appended to the already-1073-LOC `service/index.ts`.
- [ ] `extractTmdbId` and `FINISHING_THRESHOLD`/`isFinishing` exist as a single definition each in `media` (`progress.ts`). Duplicate copies are NOT yet deleted from consumers if they still compile against them, but the canonical `media` copy exists and is exported via the barrel (full dedup completes in later phases).
- [ ] The **existing** `CompactMediaItem` in `@ent-mcp/shared` is extended with `addedAt?: number | null` (epoch ms) and `addedSource?: WatchlistSource | null` (design §D). The recommendation-engine `MediaItem` at `packages/shared/src/media/types.ts` is untouched.
- [ ] `MediaSource`, `listRows`, `batchLoad`, the cursor codec, and `countBuckets` are exported from the `media/index.ts` barrel; `repo/` and `pipeline/` internals stay behind it.
- [ ] No consumer (`home`/`watchlist`) code is changed in this phase; `media` is unit-tested in isolation.
- [ ] Pipeline-stage unit tests exist for `batchLoad` (warn+fallback on partial), `classify`, `filter`, `sort`, and `paginate` (keyset hop + offset slice), each asserting WHY (e.g. sparse-page invariant, empty-streak `cursor:null`) per Rule 9.
- [ ] Cursor codec tests assert `decode → null` on bad/foreign input for **both** modes and on mode-mismatch.
- [ ] A `minor` changeset for `@ent-mcp/shared` and `@ent-mcp/server` is included (new public surface + `CompactMediaItem` fields).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-002: Move writes into `media`
**Description:** As a backend developer, I want the `watchlist_items` writes owned by the table owner so that mutation logic lives with the data it mutates.

**Acceptance Criteria:**
- [ ] `addItem`, `removeItem`, `seedFromPlugins`, and `syncFromPlugins` are implemented in `media/service` (`service/writes.ts`) and exported via the `media` barrel.
- [ ] `watchlist` calls these through the `media` barrel; the original implementations are deleted from `watchlist`.
- [ ] Seed / sync / event **semantics are unchanged** — this is a move, not a rewrite.
- [ ] The watchlist mutation job (`sync-plugin-watchlist`) calls `media.syncFromPlugins` (not the old `service.syncFromPlugins`).
- [ ] Existing watchlist mutation tests are repointed at the new location and stay green.
- [ ] `media` does not import `home`/`watchlist`; the `circular-deps: error` boundary holds (invariant — no `home→media→home` cycle).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-003: Fix #502 and add count-mode aggregates
**Description:** As a user, I want info-only titles shown as unavailable rather than upcoming so that the watchlist buckets are correct; and as a developer, I want bucket tallies computed by one shared count-mode helper.

**Acceptance Criteria:**
- [ ] `classify.ts` `classifyBucket` routes `isInfoOnly` items (released + no server + not on a request path, info-only metadata) to `"unavailable"`, NOT `"upcoming"`. `upcoming` is reserved for unreleased titles (design §K).
- [ ] `countBuckets(rows)` exists in `media` and tallies the 5 buckets + total by reusing `batchLoad` + `classify` in count-mode (no enrich/sort/paginate).
- [ ] `watchlist` `getCounts` becomes a thin wrapper over `media.countBuckets`; the duplicated classify-count loop in `getCounts` is deleted.
- [ ] `moodSummary` stays in `watchlist/moods` but calls `media.batchLoad` (and media metadata) instead of its own fan-out; mood-derivation logic stays watchlist-owned.
- [ ] The 3× classify-count loop and 4× `Promise.all([...])` fan-out duplications are removed, along with their `fallow-ignore code-duplication` markers.
- [ ] A regression test asserts `isInfoOnly → "unavailable"` (#502).
- [ ] A counts parity test asserts the 5 buckets + total match pre-refactor fixtures.
- [ ] Wire shapes `WatchlistCounts` (5 buckets + total) and `WatchlistMoodSummary` (`{ clusters: { moodId, count }[] }`) are unchanged.
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-004: Reimplement watchlist read path as sources (#496)
**Description:** As a backend developer, I want the watchlist sections expressed as `MediaSource`s over the shared pipeline so that the monolith `service.ts` is split into focused, testable units.

**Acceptance Criteria:**
- [ ] `items`, `mood-items`, `tonight`, and `recently` are implemented as `MediaSource`s in `watchlist/sources/`, each providing only `fetchRawSet` + `stages` (no sort/slice/cursor in the source).
- [ ] `watchlist/service.ts` is reduced to a thin section envelope (wrap `listRows` results) plus aggregates (counts, mood-summary), with the rest moved into `sources/` and `internal/`. `service.ts` byte size drops by **≥ 40%** versus pre-refactor.
- [ ] The watchlist sections read via `media.listRows` and decode cursors via the single shared codec; `null` decode maps to **first-page** (watchlist's existing behavior, invariant V.CU1).
- [ ] The `tonight` source returns the ranked list from inside `fetchRawSet` (score+pick stays watchlist product). The hero-vs-alternates split (`items[0]` hero, ≤4 alternates) happens in the **section envelope**, not the pipeline; `Page.items` stays flat (invariant V.TN1).
- [ ] Section items use the extended `CompactMediaItem`; watchlist no longer constructs `WatchlistItem`.
- [ ] Section parity tests assert `items`, `mood-items`, `tonight`, and `recently` produce the same item ids/order as pre-refactor fixtures (capture fixtures before refactoring — RISK-103).
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-005: Reimplement home rows as sources
**Description:** As a backend developer, I want the 12 home discovery rows expressed as `MediaSource`s so that each row stops re-implementing pagination.

**Acceptance Criteria:**
- [ ] The 12 home rows are reimplemented as `MediaSource`s in `home/sources/`, each providing only `fetchRawSet` (raw row set); the per-row sort/slice/cursor code is deleted and handled by the pipeline.
- [ ] `home/_shared.ts` helpers (`fetchSimilarPage`, `loadCanonicalItems`, `probeMediaEntry`) stay home-side (catalog-feed plumbing).
- [ ] `composeLayoutLive` is unchanged except that it runs consumer-side `eligibility(ctx)` then calls `media.listRows(source, cfg)` and builds the row stub (include iff `items.length > 0 || partial`).
- [ ] Home's `your-watchlist` row stops stripping `addedAt`/`addedSource` (the strip step is deleted; design §D).
- [ ] Home `compositeId` is deleted in favor of shared `keyToId`.
- [ ] Home feed cursor decode maps `null → HttpError 400` (home's existing contract, invariant V.CU1).
- [ ] Hero cascade, match-reason, layout ordering + eligibility, layout-cache, and detail/season composition are **unchanged**.
- [ ] A home layout parity test asserts the same item ids/order as pre-refactor fixtures.
- [ ] `vp check` passes.
- [ ] `vp test` passes.

### US-006: Cleanup and dedup verification
**Description:** As a backend developer, I want all dead consolidation residue removed so that the codebase has exactly one definition of each shared concept.

**Acceptance Criteria:**
- [ ] The old `RowProvider` type, the old `ROW_PROVIDERS` registry naming, and the three old cursor codecs are deleted.
- [ ] The `WatchlistItem` superset type is deleted; no code references it.
- [ ] Exactly one definition remains of each: `extractTmdbId`, `FINISHING_THRESHOLD`/`isFinishing`, `batchLoad`, the bucket classify loop, and the cursor codec (invariant V.SH1). The remaining duplicate copies in `home`/`watchlist` are deleted and callers import from the `media` barrel.
- [ ] The four `0.85` finishing-threshold literals (`home/internal/hero.ts`, `home/internal/match-reason.ts`, `home/rows/continue-watching-active.ts`, plus the `media` canonical) collapse to the single `media` constant imported by callers.
- [ ] The `.fallow/dead-code-baseline.json` baseline does **not** grow (Rule 14); any intentional exception carries an inline `// fallow-ignore-*` with a one-line reason.
- [ ] `vp check` passes.
- [ ] `vp test` passes.

## Functional Requirements

- **FR-1:** `media` MUST own a single read pipeline, `listRows(source, cfg)`, executing the stages: `fetchRawSet` → `batchLoad` → `enrich` → optional `classify` → optional `filter` → `sort` → `paginate`, returning `Page = { items: CompactMediaItem[]; cursor: string | null; partial: boolean }`.
- **FR-2:** `MediaSource<P>` MUST expose only `sourceId`, `fetchRawSet(ctx, params, cursor)`, and a `stages` declaration. It MUST NOT contain enrich/sort/slice/cursor logic. Eligibility MUST remain a consumer-side concern, not on the source.
- **FR-3:** `fetchRawSet` MUST return `{ rows: ActiveRow[]; partial: boolean; nextRaw?: RawPageToken }`. When a plugin soft-fails, the source MUST set `partial: true` and propagate (degrade gracefully) rather than throw.
- **FR-4:** The system MUST use one cursor codec with two modes (`keyset`, `offset`). `decode` MUST return `Cursor | null` and MUST NOT throw on bad, foreign, or mode-mismatched input.
- **FR-5:** On a `null` decode, the consumer MUST decide the response: home feed maps `null → HTTP 400`; watchlist maps `null → first-page`. The codec MUST NOT make this decision.
- **FR-6:** The single wire item shape MUST be the extended `CompactMediaItem` with new `addedAt?: number | null` (epoch ms) and `addedSource?: WatchlistSource | null`. Discovery sources leave them null; persistent-table sources fill them.
- **FR-7:** `CompactMediaItem` internal private fields (`__*`, e.g. `__topContributors`, `__addedAtMs`) MUST NOT be serialized to the wire.
- **FR-8:** `watchlist_items` writes (`addItem`, `removeItem`, `seedFromPlugins`, `syncFromPlugins`) MUST live in `media/service` and be exported via the `media` barrel; `watchlist` MUST call them through that barrel.
- **FR-9:** `classifyBucket` MUST route `isInfoOnly` items to `"unavailable"`; `"upcoming"` MUST be reserved for unreleased titles.
- **FR-10:** `/counts` and `/moods` summaries MUST be computed in count-mode (`batchLoad` + `classify`/derive + tally), reusing the pipeline without enrich/sort/paginate. `countBuckets` MUST live in `media`; `moodSummary` MUST stay in `watchlist/moods` but call `media.batchLoad`.
- **FR-11:** `keyset`-mode pagination MUST preserve #500 (empty-streak → `cursor:null`), #501 (single-pass sparse bucket+sort), and the RISK-005 offset ceiling (`OFFSET_FULL_LOAD_WARN_ROWS`).
- **FR-12:** Each of `extractTmdbId`, `FINISHING_THRESHOLD`/`isFinishing`, `batchLoad`, the bucket classify loop, and the cursor codec MUST have exactly one definition; all `fallow-ignore code-duplication` markers on the retired sites MUST be removed.
- **FR-13:** Consumers MUST import `media` via its barrel only; `media` MUST NOT import `home`/`watchlist`. Concrete sources MUST be owned and registered by the consumer that uses them.
- **FR-14:** Tonight hero-vs-alternates shaping MUST be an envelope concern; `Page.items` MUST stay flat.

## Non-Goals (Out of Scope)

- Any frontend work (#504–#519, Paraglide variants #511–#512, route loaders #513, virtualization #519) — deferred to a future client doc.
- Any user-visible behavior change beyond the #502 bucket fix.
- Collapsing `home`/`watchlist` into `media` (god-module — rejected; product logic ≠ domain logic).
- Legacy `?filter=` support, an `unknown` bucket, or any compatibility shims (pre-stable).
- Collapsing list endpoints into a generic `:sourceId` resolver — deferred to a future client doc.
- Changing seed/sync lifecycle internals, events, or plugin-dispatch strategies — unchanged.

## Technical Considerations

- **Toolchain:** Use Vite+ (`vp`) only — `vp check`, `vp test`, `vp install`. Never invoke pnpm/npm/yarn or Vitest/Oxlint directly.
- **Module size budgets:** `media` grows (pipeline + source). Stay within budgets via subdir promotion (`service/`, `repo/`, new `pipeline/`); never append to the 1073-LOC `service/index.ts`. Do not fold product logic into `media`.
- **Shared package:** `CompactMediaItem` and the new enums/types that cross the client/server boundary live in `@ent-mcp/shared`; extend the existing type rather than adding a parallel one.
- **Boundaries / fallow:** No new module means no new fallow zone pair. The `circular-deps: error` and zone boundaries must hold. The fallow dead-code baseline must not grow.
- **Changesets:** Phase 1 needs a `minor` changeset for `@ent-mcp/shared` and `@ent-mcp/server` (new public surface + `CompactMediaItem` fields). Internal-only phases use an empty-frontmatter changeset.
- **Parity fixtures (RISK-103):** Capture home-layout and watchlist-section output fixtures from the pre-refactor code **before** Phases 4 and 5, then assert against them after.
- **Cursor invalidation (RISK-104):** Existing cursors are invalidated on deploy. Acceptable pre-stable (no live users); note it in the changeset.
- **Compact between phases:** Each phase is its own focused session/PR; compact context at phase boundaries.

## Success Metrics

- Exactly one definition of each shared concept in FR-12 (verified: zero remaining `fallow-ignore code-duplication` markers on those sites).
- `watchlist/service.ts` byte size reduced by ≥ 40%.
- Home layout and every watchlist section produce identical item ids/order to pre-refactor fixtures (parity holds; only #502 changes behavior).
- `WatchlistItem` and `RowProvider` no longer exist in the codebase.
- All six phases land with `vp check` and `vp test` green.
- The fallow dead-code baseline count is unchanged or lower at the end of Phase 6.

## Open Questions

- Whether the per-section list endpoint URLs stay as-is or collapse to a generic `:sourceId` resolver is explicitly **deferred** (design §I / future client doc) — Phase 4 keeps existing surface URLs.
- Confirm whether any non-test caller outside `home`/`watchlist` references `WatchlistItem` before deleting it in Phase 6 (grep gate during cleanup).
