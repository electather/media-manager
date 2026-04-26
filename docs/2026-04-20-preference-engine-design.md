# Preference Engine

**Status:** Draft for review
**Date:** 2026-04-20 (revised 2026-04-21 post-pilot; see §Changes)
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md`, `2026-04-19-error-management-design.md`, `2026-04-19-frontend-connections-design.md`, `2026-04-20-job-service-design.md`, `mcp-server.md`

## Summary

Host-owned. Consumes feedback, ratings, watch history → compact structured profile → re-rank candidate media items. Scoring: weighted sum of feature overlaps (genres, keywords, people, decades, runtimes, languages). No ML in v1. Profile explainable by construction → `match_reason` & `profile_update` strings fall out of same bookkeeping.

2 profiles per user (movie, TV) + combined fallback for thin signal. Profiles rebuild nightly via job service, update incrementally on feedback bursts. Pure `MediaService` consumer — no plugin surface. `embedding` slot reserved in schema & one scorer slot in pipeline for future `embedding@v1` without refactor.

Scope: engine only — interface, data model, scoring math, lifecycle, integration. `/profile` page separate spec; oRPC procedures this doc specifies but not page itself.

## Goals

- Re-rank candidates against user taste profile → stable, explainable orderings.
- Build per-user profiles from existing data: `feedback_log`, `watchHistory@v1`, `ratings@v1`, `metadata@v1`.
- `match_reason` & `profile_update` strings: byproduct of scoring, not separate subsystems.
- Host-owned. No plugin surface, no ML deps, no outbound calls.
- Future `embedding@v1` capability plugin → one scoring signal slot open.
- Integrate with job service, error-management, MCP layers.

## Non-goals

- Embedding-based scoring. Reserved, ⊥ v1.
- Candidate generation. Engine re-ranks; ⊥ produce recommendations from nothing.
- Pluggable scoring algorithms. Explicitly host-owned per plugin architecture doc.
- Collaborative filtering. Upstream plugins (Trakt) handle; engine ⊥.
- `/profile` page. Spec covers backend procedures only.
- Contextual / mood / multi-profile beyond movie + TV + combined-fallback.
- Recommendation logs. Product analytics ⊥ per error-management doc.

## Architecture

```
                   ┌──────────────────────────────────────┐
                   │ Callers                              │
                   │   ent_discover (recommend mode)      │
                   │   ent_feedback (preview)             │
                   │   ent_details (per-item feedback)    │
                   │   /profile oRPC procedures           │
                   │   preference-rebuild jobs            │
                   └──────────────────┬───────────────────┘
                                      │
                                      ▼
                   ┌──────────────────────────────────────┐
                   │ PreferenceEngine                     │
                   │  • rankCandidates                    │
                   │  • explainMatch                      │
                   │  • previewFeedbackEffect             │
                   │  • rebuildProfile                    │
                   │  • applyIncrementalUpdate            │
                   │  • getProfile                        │
                   │  • getUserFeedbackFor                │
                   └───────┬──────────────────────┬───────┘
                           │                      │
                           ▼                      ▼
               ┌──────────────────────┐ ┌───────────────────┐
               │ Feature extractors   │ │ Storage           │
               │   genres             │ │  preference_      │
               │   keywords           │ │  profiles         │
               │   people             │ │  feedback_log     │
               │   decades            │ │                   │
               │   runtime            │ │                   │
               │   languages          │ │                   │
               │   (embedding: slot)  │ │                   │
               └───────┬──────────────┘ └───────────────────┘
                       │
                       ▼
               ┌──────────────────────┐
               │ MediaService          │
               │  getMetadata          │
               │  getHistory           │
               │  getAllRatings        │
               └──────────────────────┘
```

Engine: singleton at host startup, DI into MCP tool handlers, oRPC procedures, job handlers. 3 concerns:

- **Scoring** — given profile & candidates → ranked list with per-candidate contributors & confidence.
- **Profile maintenance** — given user, read history from `MediaService` & feedback from `feedback_log`, aggregate into features, write profile.
- **Explanation** — given candidate & profile (or candidate & pending feedback event) → short human-readable match/shift string.

Depends on `MediaService` & DB. ⊥ plugin runtime, MCP layer, any plugin. Callers depend on engine, ⊥ other way around.

## Public interface

```ts
class PreferenceEngine {
  // Hot path. Used by ent_discover (recommend mode), also reusable by any
  // future feature that wants personalized ordering.
  rankCandidates(
    userId: string,
    candidates: MediaItem[],
    opts?: { alpha?: number; mediaType?: "movie" | "tv" | "any" },
  ): Promise<RankedCandidate[]>;

  // Produces the match_reason string for a single candidate. Separate from
  // rankCandidates because not every caller wants reasons — skipping
  // rendering on candidates that won't be shown saves work.
  explainMatch(userId: string, candidate: MediaItem): Promise<string | null>;

  // Called synchronously from ent_feedback. Returns the preview string.
  // Does NOT mutate the profile — that's the job's responsibility.
  previewFeedbackEffect(
    userId: string,
    item: MediaItem,
    action: "like" | "dislike" | "rate" | "note",
    opts?: { rating?: number; note?: string },
  ): Promise<string | null>;

  // Job-facing. Full rebuild.
  rebuildProfile(userId: string, mediaType: "movie" | "tv" | "combined"): Promise<RebuildResult>;

  // Job-facing. Incremental update from buffered feedback since last rebuild.
  applyIncrementalUpdate(userId: string): Promise<UpdateResult>;

  // Read accessor for admin tooling and the eventual /profile page.
  getProfile(
    userId: string,
    mediaType: "movie" | "tv" | "combined",
  ): Promise<PreferenceProfile | null>;

  // Read accessor for ent_details — per-item feedback for one user.
  getUserFeedbackFor(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<UserItemFeedback | null>;
}

interface RankedCandidate {
  item: MediaItem;
  score: number; // final combined score, normalized [0, 1]
  profileScore: number; // profile contribution only, for debugging
  confidence: "low" | "medium" | "high";
  topContributors: Array<{ category: string; feature: string; weight: number }>;
}

interface UserItemFeedback {
  rated?: number;
  liked?: boolean;
  noted?: boolean;
  latestAt?: number;
}
```

Notes:

**`rankCandidates` returns `RankedCandidate[]`, ⊥ `MediaItem[]`.** Score, confidence, top contributors ride along. Callers wanting reasons call `explainMatch` separately for surfaced candidates.

**`previewFeedbackEffect` ⊥ mutate.** Sync `ent_feedback` response gets string; real profile update async in coalesced job. Minor preview/update disagreement acceptable — preview flavor copy, ⊥ authoritative.

**`rebuildProfile` & `applyIncrementalUpdate` separate.** Rebuild expensive & authoritative. Incremental cheap, approximate, drift-prone by design. Split keeps each algorithm simple to reason about & test.

**Deliberately ⊥ on interface:**

- ⊥ `scoreOne(userId, candidate)`. Scoring normalizes over candidate set; single-item score meaningless.
- ⊥ `addFeedback`. Feedback ingestion owned by `ent_feedback` handler → writes `feedback_log` → triggers coalesced job. Engine operates over data it ⊥ own.
- ⊥ `recommend(userId, n)`. Candidate generation = `MediaService.getRecommendations` aggregating across plugins. Engine ranks; ⊥ pick from scratch.

## Profiles

### Partitioning

2 profiles per user + combined fallback:

- `movie` — from movie-typed feedback & history.
- `tv` — from TV.
- `combined` — from everything; used when one typed profile too thin.

Combined always rebuilds when either movie/TV rebuilds (fallback decision at scoring time based on signal thickness). Partitioning auto from existing data; `media_type` on every item, ⊥ user action required. Granular partitioning (contextual, mood) deferred — naming profiles requires user curation & feedback attribution.

### Feature categories

6 categories, each `value → weight` dict:

| Category  | Source                                             | Notes                                          |
| --------- | -------------------------------------------------- | ---------------------------------------------- |
| Genres    | TMDB genres                                        | Strong, dense, always populated                |
| Keywords  | TMDB keywords (filtered, see below)                | Best signal for specificity and reasons        |
| People    | Director + top-billed cast + writers (TV creators) | Prefixed: `"Director:..."`, `"Actor:..."`      |
| Decades   | Release year bucketed                              | `"1990s"`, `"2010s"`, etc.                     |
| Runtime   | Movie runtime or TV episode runtime, bucketed      | `"short"`, `"medium"`, `"long"`, `"very_long"` |
| Languages | Original language ISO code                         | Strong signal for international-taste users    |

⊥ v1: production company/network (low per-item value; users ⊥ track consciously), mood/tone/pacing (⊥ available from structured metadata — embedding territory), seasonality/time-of-day (attribution ambiguous; UX separate project).

### Keyword filtering

TMDB keyword corpus mixes content descriptors ("unreliable narrator", "neo-noir", "heist") with structural metadata ("sequel", "aftercreditsstinger") & mood descriptors ("whimsical", "intense"). Only content descriptors useful. 2 hand-curated filter lists in `keywords.ts` before aggregation:

- **Structural tags.** Franchise/meta-attributes ⊥ content: `aftercreditsstinger`, `duringcreditsstinger`, `beforecreditsstinger`, `sequel`, `reboot`, `spin off`, `live action remake`, universe tags (`marvel cinematic universe (mcu)`, `dc extended universe (dceu)`). Correlate with what user watched, ⊥ what they prefer. Without filtering: `aftercreditsstinger` ranked 4th in normalized keyword profile (~1.6%) → `match_reason` "You tend to like films with aftercreditsstinger."

- **Tone/mood descriptors.** Emotional register keywords: `excited`, `intense`, `sentimental`, `whimsical`, `wistful`, `complex`, `dramatic`, `suspicious`, `blunt`, similar. Mood scoring deferred per non-goals; in keyword pool dilutes content signal — observed: single TV show contributed 37 tone keywords at equal weight, consuming ~24% of 200-keyword budget. If mood scoring added later → dedicated `moods` category with own weight, ⊥ silently mixed into keywords.

Both lists constants in `keywords.ts`. TMDB corpus evolves → periodic review. Maintenance cost accepted; alternative (unfiltered) produces visibly bad output.

### Weight derivation

Per-source strength configurable. Hierarchy strongest → weakest:

| Signal                                           | Per-item weight |
| ------------------------------------------------ | --------------- |
| `rate` with rating 8–10                          | +1.0            |
| `ent_feedback` action `like`                     | +0.8            |
| `ent_feedback` action `note`, positive sentiment | +0.6            |
| Completed watch with high progress               | +0.5            |
| Watchlist add (not yet watched)                  | +0.3            |
| `ent_feedback` action `note`, neutral            | 0               |
| `ent_feedback` action `note`, negative sentiment | −0.6            |
| `rate` with rating 1–3                           | −0.8            |
| `ent_feedback` action `dislike`                  | −1.0            |

∀ item with per-item weight: extracted features each receive that weight added to dict slot. After aggregating across all items, weights normalized per category (⊥ single category dominates sum during scoring).

**Recency decay.** Signal N months ago × `0.5 ^ (months / 24)` (half-life 2yr). Applied to genres & keywords; ⊥ people (user who loved early Fincher still loves early Fincher) or languages (stable). Rebuild-time only; incremental ⊥ retroactively re-decay old signals → one drift source daily rebuild corrects.

**Top-K pruning per category.** At rebuild: retain top-K by `|weight|` per category — 50 genres, 200 keywords, 100 people, 10 decades, 4 runtimes, 20 languages. Sort by `|weight|` preserves strong negatives alongside strong positives; strong negative more informative than weak positive.

### Profile shape

```ts
interface PreferenceProfile {
  userId: string;
  mediaType: "movie" | "tv" | "combined";
  features: {
    genres: Record<string, number>;
    keywords: Record<string, number>;
    people: Record<string, number>;
    decades: Record<string, number>;
    runtimes: Record<string, number>;
    languages: Record<string, number>;
  };
  sampleSize: number;
  confidence: "low" | "medium" | "high";
  lastRebuiltAt: number;
  lastUpdatedAt: number;
  embedding?: number[]; // reserved; null in v1
}
```

Confidence: `< 15` items → low, `15–49` → medium, `≥ 50` → high. Stored ⊥ computed — scoring read path reads every call; denormalizing saves recomputation.

### Free-text notes

`ent_feedback` `action: "note"` → free-text note. Sentiment & keyword extraction at write time in `feedback_log.record`, ⊥ rebuild time (re-extracting on every rebuild wasteful).

**Sentiment classifier:** small embedded-friendly model (e.g. DistilBERT ONNX or lexicon-based v1). Produces `positive | negative | neutral`. Classifier fails → `note_sentiment` = `NULL`; rebuild treats NULL-sentiment as neutral.

**Keyword extraction:** extract notable nouns/adjectives from note ∈ item's TMDB keyword list. Stored as JSON array in `note_keywords`. Rebuild → keywords reinforced with note's sentiment weight on top of base signal.

Deliberately crude. Plug in richer extractor (or LLM) later at `server/preference-engine/sentiment.ts` behind stable interface.

## Scoring

### Per-category score

```
categoryScore(c, candidate, profile)
  = Σ over v in candidate.features[c]:  profile.features[c][v] or 0
```

Example: Thriller/Crime candidate. Profile `genres: { Thriller: 0.34, Crime: 0.18, Comedy: 0.05 }`. Genre score = `0.34 + 0.18 = 0.52`.

### Overall score

```
profileScore(candidate, profile)
  = Σ categoryWeight[c] × categoryScore(c, candidate, profile)

finalScore
  = α × normalizedProfileScore + (1 − α) × (1 − normalizedOriginalRank)
```

**Category weights** — hand-tuned v1:

| Category  | Weight |
| --------- | ------ |
| Genres    | 0.30   |
| Keywords  | 0.30   |
| People    | 0.15   |
| Decades   | 0.10   |
| Runtime   | 0.05   |
| Languages | 0.10   |

Tuning via hand-iteration once real feedback accrues; learned weights require feedback loop ⊥ yet.

**α-blending.** Engine re-ranks upstream candidate list. Upstream order carries real info (popularity, collaborative-filtering signal from Trakt) profile alone ⊥ produce. `α = 0.7` default → profile dominates but upstream ⊥ ignored.

**Normalization over candidate set, ⊥ global.** `normalizedProfileScore` = `profileScore` / max(`profileScore`) across candidate list; `normalizedOriginalRank` = `originalIndex / (N − 1)`. Per-set normalization keeps α-blending stable across queries with wildly different absolute score magnitudes.

### Confidence handling

`sampleSize < 15` → thin profile:

1. α drops 0.7 → 0.3 proportional: `α_effective = 0.3 + (sampleSize / 15) × 0.4`, clamped to `[0.3, 0.7]`.
2. Movie profile thin but combined ⊥ → score against combined instead of typed profile. Fallback per §Partitioning.
3. Both thin → `α_effective` stays 0.3, returned confidence = `"low"`. Callers may hide `match_reason` when low (MCP tool ⊥, future callers may).

### `match_reason` generation

From top contributors to profile score:

1. ∀ category: per-feature contribution `categoryWeight[c] × profile.features[c][v]` for each `v` candidate has.
2. Flatten across categories, sort descending.
3. Top 1–2 contributors each ≥ ~10% of final profile score.
4. Render via per-category template:

| Category  | Template                                          |
| --------- | ------------------------------------------------- |
| Genres    | "Matches your interest in {genre}"                |
| Keywords  | "You tend to like films with {keyword}"           |
| People    | "From {person} whose work you've enjoyed"         |
| Decades   | "From the {decade} which you favor"               |
| Runtime   | "A {runtime-bucket} runtime fits your preference" |
| Languages | "Matches your taste for {language} cinema"        |

2 contributors joined: "Matches your interest in thrillers and you tend to like films with unreliable-narrator themes." Truncated ~100 chars.

Deterministic, cheap, snapshot-testable. Future LLM-rendered version receives same top-contributor data as structured input.

Returns `null` when confidence low & ⊥ contributor clears 10% threshold, or profile ⊥ exist.

### `profile_update` generation

Sync preview for `ent_feedback`. Runs as `previewFeedbackEffect` — pure function over candidate item, action, current profile. ⊥ read newly-written `feedback_log` row.

Algorithm:

1. Identify what feedback _would_ reinforce/diminish based on action & item features.
2. Positive signals → top category feature (by `categoryWeight × item feature presence`) → "Reinforces your preference for {feature}."
3. Negative signals → "Decreased preference for {feature}."
4. Notes → fallback "Noted your feedback on {title}." when sentiment neutral or classification failed.

Returns `null` when candidate has ⊥ registering features (shouldn't happen for real TMDB items, but keeps interface honest).

## Data model

### `preference_profiles`

```
preference_profiles
├── user_id              text FK → user.id, NOT NULL
├── media_type           text NOT NULL           ("movie" | "tv" | "combined")
├── features             text NOT NULL           (JSON; see Profile shape)
├── sample_size          integer NOT NULL
├── confidence           text NOT NULL           ("low" | "medium" | "high")
├── last_rebuilt_at      integer NOT NULL
├── last_updated_at      integer NOT NULL        (bumps on incremental too)
├── embedding            blob                    (reserved; NULL in v1)
├── embedding_model      text                    (reserved; NULL in v1)
├── PRIMARY KEY (user_id, media_type)
```

**Why JSON ⊥ normalized `preference_feature_weights`.** Profiles write atomically (rebuild replaces whole thing; incremental also writes new whole). Read atomically (every scoring call needs all 6 categories). ⊥ query pattern benefits from cross-user feature analytics. Normalized schema → indexes that buy nothing.

**Sizes.** Top-K caps bound blob ~20–40KB/profile; practice smaller. 3 profiles/user worst case. ⊥ scale concern.

**`embedding` / `embedding_model` reserved.** NULL v1. `BLOB` stores serialized float32 vector; `embedding_model` records which model produced it (for re-embedding on model change). ⊥ migration pain when activated.

### `feedback_log`

```
feedback_log
├── id                   text PK                 (cuid2)
├── user_id              text FK → user.id, NOT NULL
├── tmdb_id              text NOT NULL
├── media_type           text NOT NULL           ("movie" | "tv")
├── action               text NOT NULL           ("like" | "dislike" | "rate" | "note")
├── rating               integer                 (nullable; 1–10, action="rate" only)
├── note                 text                    (nullable; action="note" only)
├── note_sentiment       text                    (nullable; "positive" | "negative" | "neutral")
├── note_keywords        text                    (nullable; JSON array; extracted at write)
├── created_at           integer NOT NULL
├── INDEX(user_id, created_at DESC)
├── INDEX(user_id, tmdb_id, media_type)
```

**Event-sourced, ⊥ upserts.** User rates movie 7 then 9 → both rows exist. Rebuild & incremental both use most-recent-wins when reducing to per-(user, item) signal. Matches MCP doc's "most-recent wins per MediaService doc" stance.

**Sentiment & keywords extracted at write time.** Stored in row. Rebuild reads structured fields ⊥ re-running classification on every rebuild.

**`tmdb_id` + `media_type`, ⊥ `connection_id`.** Feedback about item, ⊥ where rating written. `ent_feedback` rating fan-out to `ratings@v1` plugins separate concern, outside this table.

### Indexes

- `feedback_log (user_id, created_at DESC)` — incremental reads "feedback since `last_rebuilt_at`" per user.
- `feedback_log (user_id, tmdb_id, media_type)` — rebuild dedup to most-recent-wins per item; `ent_details` checks "has this user rated this item."
- `preference_profiles` ⊥ secondary index; always accessed by `(user_id, media_type)`.

### Deletion

User deletion cascades both tables. If app exposes "delete my data," these tables matter most for promise.

### What ⊥ stored

- **Candidate lists passed to `rankCandidates`.** Ephemeral. Engine scores what it's handed, ⊥ remember. Keeps scoring reproducible from (profile, candidate list).
- **Recommendation logs.** ⊥ "things we showed this user" table. Explicitly ⊥ scope per error-management doc.

## Lifecycle

Both background jobs register through job service (per job-service doc). Engine ⊥ touch `croner` directly.

### Daily rebuild

`scheduled_per_row` job:

```ts
registerScheduledPerRow({
  id: "host.preference.daily_rebuild",
  schedule: "0 2 * * *",
  rowSource: async () => db.query.usersNeedingRebuild(),
  handler: async (ctx, user) => {
    await preferenceEngine.rebuildProfile(user.userId, "movie");
    await preferenceEngine.rebuildProfile(user.userId, "tv");
    await preferenceEngine.rebuildProfile(user.userId, "combined");
  },
  perRowTimeoutSec: 120,
  runTimeoutSec: 60 * 60,
  continueOnRowError: true,
});
```

**Row source.** User ∈ row set if any of:

- ⊥ profile yet but ∃ activity (feedback, watch history, or ratings).
- `now - last_rebuilt_at > 7 days` — staleness cap; rebuilds weekly even without new feedback (upstream metadata shifts).
- `≥ 20` new `feedback_log` rows since `last_rebuilt_at` — counts events ⊥ distinct items. `feedback_log` event-sourced; user iterating ratings on 7 films hits threshold. Intent: proxy for "user active," regardless of spread.

Users with ⊥ activity skipped.

**3 profiles per user per run.** Daily handler calls `rebuildProfile` 3× (movie, tv, combined) — 3 independent `collectContributions` passes. Shared-load optimization deferred (triple-read ⊥ load-bearing at current volumes; refactor belongs in rebuild layer ⊥ job handler when worth doing). Sequential per user, ⊥ per (user, media_type).

### Incremental update

`coalesced` job triggered by `ent_feedback`:

```ts
registerCoalesced({
  id: "host.preference.incremental_update",
  debounceMs: 30_000,
  maxWaitMs: 5 * 60_000,
  scopeKey: (input) => input.userId,
  handler: async (ctx, triggerCount) => {
    await preferenceEngine.applyIncrementalUpdate(ctx.input.userId);
  },
  timeoutSec: 60,
});
```

**Why coalesced.** Agent conversation → feedback burst. Incremental 5× in 30s wasteful & thrashes profile if user immediately asks recommendations. 30s debounce catches bursts; 5min ceiling prevents starvation under steady trickle. `scopeKey: userId` prevents cross-user coalescing.

### Incremental update algorithm

1. Read stored profile.
2. Read `feedback_log` rows for user with `created_at > profile.lastUpdatedAt`.
3. Fetch metadata for each item via `MediaService.getMetadata` (cached).
4. ∀ new feedback row: compute per-item weight (per hierarchy above) & add contributions to in-memory profile feature dicts.
5. Increment `sample_size`, update `last_updated_at`.
6. **⊥ re-normalize, re-decay, re-prune.** Intentionally approximate.
7. Write profile.

Skipped re-normalization = main drift source. Over time, incremental accumulates old high-magnitude signals without corrective recency decay or top-K pruning. Daily rebuild = correction pass: fully re-normalizes, re-applies decay, re-prunes. Incremental keeps profiles warm between rebuilds; daily keeps them honest.

### User-triggered rebuild

`triggerable` job for eventual `/profile` "Rebuild my profile" button:

```ts
registerTriggerable({
  id: "feature.preference.rebuild",
  handler: async (ctx, input: { userId: string }) => {
    await preferenceEngine.rebuildProfile(input.userId, "movie");
    await preferenceEngine.rebuildProfile(input.userId, "tv");
    await preferenceEngine.rebuildProfile(input.userId, "combined");
    return { rebuiltAt: Date.now() };
  },
  scopeKey: (input) => input.userId,
  requiredPermission: {
    kind: "feature",
    check: async (userId, input) => userId === input.userId,
  },
  timeoutSec: 120,
});
```

**`scopeKey: userId`** — one rebuild per user at a time. Second trigger while one running → `job.already_running` → `/profile` UI shows "already rebuilding."

**Permission strictly `userId === input.userId`.** User rebuilds own profile only. ⊥ admin bypass; admin rebuilding for another user → `/admin/jobs` with daily-rebuild job. Keeps feature endpoint narrow, ⊥ privilege-escalation surface.

**Same `rebuildProfile` method daily job uses.** One algorithm, multiple triggers. After manual rebuild, `last_rebuilt_at` fresh → daily job skips next run.

### First-run behavior

When user first connects tracking service:

1. Connection-create path ⊥ synchronously rebuild. Daily job picks up.
2. `ent_discover recommend` before first rebuild: `getProfile` → `null`. `rankCandidates` returns candidates in original order with `score: 0` & `confidence: "low"`; `explainMatch` returns `null`. Handler omits `match_reason`. Agent sees pre-engine response.
3. After daily job runs → re-ranked normally.

Sync first-run build addable as another trigger for `feature.preference.rebuild` from `connection.create` if needed. ⊥ v1.

### Failure modes

All through job service error-management integration:

- **`MediaService` call fails during rebuild** (e.g. TMDB transient). Affected feature extractor returns partial features for that item. Rebuild continues. Logged, ⊥ fatal.
- **Sentiment classifier fails on note.** Note recorded; `note_sentiment` = NULL. Rebuild treats NULL as neutral. ⊥ user-visible.
- **Incremental update, ⊥ existing profile.** Bail; daily rebuild creates baseline. ⊥ error.
- **2 coalesced updates same user overlap.** Job service scope-key handling prevents — same scopeKey while running extends debounce ⊥ starts second run.
- **Note keyword extraction silently returns empty.** Write-time extractor in `feedback_log.record` may return `[]` — benign (note has ⊥ TMDB-matching keywords) or silent bug. Rebuild ⊥ distinguish. To make detectable: `feedback_log.record` logs warning when note > 20 chars but `note_keywords` empty. Future admin view aggregates by comparing note count vs non-empty `note_keywords` count.

## Integration points

### `ent_discover` (recommend mode)

```ts
async function entDiscoverHandler(ctx, input) {
  if (input.mode === "recommend") {
    const candidates = await ctx.mediaService.getRecommendations(ctx.userId, {
      mediaType: input.media_type,
      limit: input.limit * 3,
    });

    const ranked = await ctx.preferenceEngine.rankCandidates(ctx.userId, candidates, {
      mediaType: input.media_type,
    });

    const top = ranked.slice(0, input.limit);
    const withReasons = await Promise.all(
      top.map(async (r) => ({
        ...r,
        match_reason: await ctx.preferenceEngine.explainMatch(ctx.userId, r.item),
      })),
    );

    return compressToMcpShape(withReasons);
  }
  // ... other modes
}
```

**Over-fetch then prune.** Ask upstream for `limit * 3`, re-rank, take top `limit`. Enough candidates to pull good matches from mid-pack; ⊥ slow upstream calls. 3× constant in handler.

**Reasons for top-N only.** `explainMatch` runs `limit` times ⊥ `limit * 3`. Scoring already computed top contributors; `explainMatch` just renders.

**Engine injected via `ToolCallContext`.** Same pattern as `MediaService`. MCP doc's context builder adds `preferenceEngine: PreferenceEngine`.

### `ent_feedback`

```ts
async function entFeedbackHandler(ctx, input) {
  const item = await ctx.mediaService.getMetadata(ctx.userId, parseMediaId(input.id));

  await ctx.feedbackLog.record(ctx.userId, item, input);

  const profileUpdate = await ctx.preferenceEngine.previewFeedbackEffect(
    ctx.userId, item, input.action,
    { rating: input.rating, note: input.note },
  );

  ctx.jobService.find("host.preference.incremental_update")
    .trigger({ userId: ctx.userId });

  const synced_to = input.action === "rate"
    ? await syncRatingToPlugins(...)
    : [];

  return { recorded: true, synced_to, profile_update: profileUpdate };
}
```

**`previewFeedbackEffect` after `feedback_log` write.** Preview ⊥ need new row, but ordering keeps mental model consistent if preview ever starts reading latest feedback.

**Coalesced trigger fire-and-forget.** Returns sync. Tool response ⊥ wait for update.

### `ent_details`

MCP doc has `ent_details` read per-item feedback. Engine exposes `getUserFeedbackFor(userId, tmdbId, mediaType)` — pass-through to `feedback_log` filtered by user + item. Lives on engine ⊥ exposing `feedback_log` to handlers directly; engine owns table.

### `MediaService` integration

Engine calls 5 methods on `MediaService`:

- `getHistory(userId, opts)` — aggregate across `watchHistory@v1` plugins.
- `getAllRatings(userId)` — aggregate across `ratings@v1` plugins.
- `getWatchlist(userId)` — items queued ⊥ watched, contributing at watchlist weight (+0.3).
- `getComments(userId)` — user-written comments from plugins (e.g. Trakt); distinct from `ent_feedback` notes in `feedback_log`. Sentiment-classified at scoring time via same classifier.
- `getMetadata(userId, id)` — per-item metadata, 24h TTL cache.

All ∃ or trivially derivable from media-service doc. ⊥ new capability, ⊥ new `MediaService` method. Engine pure consumer.

Implicit requirement: rebuild issues many `getMetadata` calls. 24h cache cheap for popular items; obscure → first-miss-then-cache. ⊥ bulk-fetch needed.

### `/profile` oRPC procedures

`/profile` page separate spec. Engine exposes 3 oRPC procedures:

```
preference.getMyProfile(mediaType: "movie" | "tv" | "combined")
  → PreferenceProfile | null
  permission: authenticated user, scoped to ctx.user.id

preference.rebuildMine()
  → { runId: string }
  permission: authenticated user
  implementation: jobService.find("feature.preference.rebuild").trigger({ userId: ctx.user.id })

preference.getRebuildStatus()
  → { status: "idle" | "running" | "succeeded" | "failed", lastRunAt?: number }
  permission: authenticated user
  implementation: jobService.getRunHistory("feature.preference.rebuild", {
    scopeKey: ctx.user.id, limit: 1,
  })
```

`getRebuildStatus` → poll-and-spinner UX for rebuild button. Streaming ⊥ scope per job-service doc; page polls.

## Scorer extension slot

Pipeline structured with one slot reserved for embedding-based scorer:

```ts
// server/preference-engine/features/index.ts
interface FeatureScorer {
  id: string;
  categoryWeight: number;
  extract?(item: MediaItem): Record<string, number>; // for feature-dict scorers
  scoreCandidate?(candidate: MediaItem, profile: PreferenceProfile): number; // for custom scorers
}

const SCORERS: FeatureScorer[] = [
  genresScorer,
  keywordsScorer,
  peopleScorer,
  decadesScorer,
  runtimeScorer,
  languagesScorer,
  // embeddingScorer — registered only if an embedding@v1 plugin is installed.
];
```

Feature-dict scorers (genres, keywords, etc.) all ∈ one pattern: extract features → aggregate into weights at rebuild → score by feature overlap. Embedding scorer different shape: computes user centroid at rebuild, scores by cosine similarity. Both conform to `FeatureScorer` via 2 optional methods.

**When embeddings added:**

1. Define `embedding@v1` capability (host-side) with one method: `embed(ctx, { texts }) → Promise<Array<number[]>>`.
2. Author embedding plugin (one per provider — OpenAI, Voyage, Cohere, Ollama, etc.) per plugin architecture.
3. Register `embeddingScorer` in `SCORERS`, using `MediaService` to call capability.
4. Populate `embedding` column on `preference_profiles` during rebuild.
5. Add `categoryWeight`, shift existing weights. Deployment-wide re-rebuild needed; admins trigger via daily job with modified row source.

⊥ refactor of scoring pipeline. ⊥ change to profile reads. ⊥ change to data model. Reserved column & scorer slot absorb addition.

## Layout

```
server/
├── preference-engine/
│   ├── index.ts                   # PreferenceEngine class, public surface only
│   ├── types.ts                   # PreferenceProfile, RankedCandidate, etc.
│   ├── storage.ts                 # preference_profiles reads/writes
│   ├── scoring.ts                 # rankCandidates internals, α-blending, normalization
│   ├── explain.ts                 # explainMatch + previewFeedbackEffect templates
│   ├── rebuild.ts                 # full rebuild algorithm
│   ├── incremental.ts             # incremental update algorithm
│   ├── feedback-log.ts            # feedback_log writes, sentiment + keyword extraction
│   ├── sentiment.ts               # small embedded sentiment classifier
│   └── features/
│       ├── index.ts               # FeatureScorer interface + SCORERS registry
│       ├── genres.ts
│       ├── keywords.ts
│       ├── people.ts
│       ├── decades.ts
│       ├── runtime.ts
│       └── languages.ts
├── routes/
│   └── preference.ts              # oRPC procedures for /profile page
└── jobs/                          # unchanged; registrations live with callers

migrations/
└── NNNN_preference_engine.sql     # preference_profiles + feedback_log + indexes
```

Job registrations live next to engine (registered at host startup) ⊥ `server/jobs/` — per job-service doc "registrants import registration functions."

## Testing

### Feature extractor unit tests

One test file per extractor. Given `MediaItem` fixture → expected features. Fixtures cover: normal, missing-field (no keywords, no cast), large-list (top-K pruning at aggregation ⊥ extraction — verify extractors emit everything).

### Scoring unit tests

Given profile fixture & candidate fixture, `rankCandidates` returns expected order with expected scores. Cases:

- α-blending at multiple confidence levels (high, medium, low).
- Normalization-per-candidate-set: re-ranking `[A, B, C]` produces same relative order as re-ranking `[A, B, C, D, E]`.
- Thin-profile fallback: thin movie profile against movie candidate → verify combined profile used.
- Empty profile: `rankCandidates` ⊥ profile → candidates in original order with `score: 0`.

### Explain / preview unit tests

Snapshot tests for `explainMatch` & `previewFeedbackEffect` across representative inputs. Deterministic output → snapshot testing correct.

### Rebuild integration tests

Fixture user with known `feedback_log` rows & mocked `MediaService`. Run `rebuildProfile` → verify `preference_profiles` row matches expected features. One test per media-type branch (movie, TV, combined-fallback-when-thin).

### Incremental update correctness

Rebuild profile → add N feedback rows → incremental update → verify profile reflects new rows. Separately: rebuild, incremental many times, rebuild again → verify post-rebuild matches fresh rebuild from all data. This = "incremental drifts, daily corrects" contract.

### End-to-end with `ent_discover`

Fixture user + fixture plugins exercising `recommendations@v1`. Call recommend handler → verify candidates re-ordered, top results have `match_reason`, low-confidence users see less aggressive re-ranking.

### Job integration

Job scheduling & lifecycle tested by job service's own suite (per job-service doc). Tests here cover handlers only — what engine does when called, ⊥ cron registration or scope-key semantics.

## Changes since initial implementation

Pilot ran against real user data before shipping. Issues found → revisions 2026-04-21:

- **Keyword filtering.** TMDB keyword pollution from structural tags (e.g. `aftercreditsstinger`) & tone descriptors (e.g. `whimsical`) corrupted scoring & `match_reason`. 2 hand-curated filter lists now in `keywords.ts`. See §Keyword filtering.
- **Top-K sort order.** Made explicit: pruning sorts by `|weight|` preserving strong negatives. Spec ambiguous; implementation already correct.
- **Daily rebuild pass count.** Original "one pass produces all 3 profiles" aspirational — implementation does 3 passes. Spec amended; shared-load optimization deferred.
- **Rebuild threshold semantics.** ≥20 threshold counts events ⊥ distinct items.
- **Note keyword silent failures.** Write-time log warning in `feedback_log.record` for empty-extraction-on-non-empty-note.
- **`MediaService` integration.** Added `getWatchlist` & `getComments` to consumed methods (previously omitted).

Section removed once subsequent revision lands & delta ⊥ freshest context.

## Open questions / deferred

- **`embedding@v1` capability.** Reserved in profile schema & scorer registry. Ship when demand.
- **Learned category weights.** V1 hand-tuned. Learning requires feedback loop on recommendation quality ⊥ yet. Revisit once enough `ent_feedback` signal ∃.
- **Top-K budget post-filter.** Structural-tag & tone-descriptor filtering removes meaningful fraction of raw keyword pool; 200-keyword cap may be over/under-sized. Revisit when filtered profiles accumulate — data-driven ⊥ inherited from pre-filter design.
- **Contextual / mood profiles.** Named contexts ("with the kids," "background while cooking") expressive but require user curation & feedback attribution. ⊥ v1.
- **Sync first-run rebuild.** If new-user `ent_discover recommend` too thin before daily job, trigger from `connection.create` small addition. Deferred.
- **Note extractor beyond sentiment + keyword matching.** V1 crude. LLM/embedding-based extractor slots in behind `sentiment.ts` interface if needed.
- **Streaming rebuild progress.** `/profile` spinner polls v1. Job-service doc explicitly defers streaming.
- **Rebuild-in-progress read semantics.** `rankCandidates` called while profile mid-rebuild → reads last complete rebuild. ⊥ locking. Correct for write-replace-whole pattern; notable.
- **Cross-user analytics.** "Users who like X also like Y" ∃ upstream via Trakt. Host-side collaborative filtering ⊥ scope per non-goals.
