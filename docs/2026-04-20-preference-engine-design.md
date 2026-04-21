# Preference Engine

**Status:** Draft for review
**Date:** 2026-04-20 (revised 2026-04-21 post-pilot; see _Changes since initial implementation_)
**Author:** Omid Astaraki
**Depends on:** `2026-04-19-plugin-architecture-design.md`, `2026-04-19-media-service-design.md`, `2026-04-19-error-management-design.md`, `2026-04-19-frontend-connections-design.md`, `2026-04-20-job-service-design.md`, `mcp-server.md`

## Summary

A host-owned preference engine that consumes the user's feedback, ratings, and watch history to produce a compact structured profile, and uses that profile to re-rank candidate media items for personalized recommendations. Scoring is feature-based — a weighted sum of overlaps across genres, keywords, people, decades, runtimes, and languages — with no ML dependencies in v1. The profile is explainable by construction, so `match_reason` strings and `profile_update` strings fall out of the same bookkeeping that produces the scores.

Two profiles per user, one for movies and one for TV, plus a combined fallback for users with thin signal in one medium. Profiles rebuild nightly via the job service and update incrementally on feedback bursts. The engine is a pure consumer of `MediaService`; it has no plugin surface of its own. An `embedding` slot is reserved in the profile schema and one scorer slot is reserved in the scoring pipeline so a future `embedding@v1` capability can contribute one signal without a refactor.

The scope here is strictly the engine — its interface, data model, scoring math, lifecycle, and integration points. The `/profile` user-facing page is a separate follow-up spec; this document specifies the oRPC procedures that page will need but not the page itself.

## Goals

- Re-rank candidate media items against a user's taste profile, producing stable and explainable orderings.
- Build and maintain per-user profiles from the data the system already has: `feedback_log`, `watchHistory@v1`, `ratings@v1`, and `metadata@v1`.
- Produce `match_reason` and `profile_update` strings as byproducts of scoring, not as separate subsystems.
- Host-owned. No plugin surface, no ML dependencies, no outbound calls.
- Keep the door open for a future `embedding@v1` capability plugin to contribute one scoring signal.
- Integrate cleanly with the existing job service, error-management, and MCP layers.

## Non-goals

- Embedding-based scoring. Reserved but not implemented in v1.
- Candidate generation. The engine re-ranks; it does not produce recommendations from nothing.
- Pluggable scoring algorithms. Per the plugin architecture doc, this is explicitly host-owned.
- Collaborative filtering. Upstream plugins (Trakt) already do this; the engine does not.
- A `/profile` user-facing page. Out of scope; this doc specifies only the backend procedures it will consume.
- Contextual / mood-based / multi-profile partitioning beyond movie + TV + combined-fallback.
- Recommendation logs or "things we showed this user" tracking. Product analytics is out of scope per the error-management doc.

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

The engine is a singleton constructed at host startup, exposed via dependency injection to MCP tool handlers, oRPC procedures, and job handlers. It has three concerns:

- **Scoring** — given a profile and a candidate list, produce a ranked list with per-candidate contributor data and confidence levels.
- **Profile maintenance** — given a user, read their history from `MediaService` and their feedback from `feedback_log`, aggregate into features, and write the resulting profile.
- **Explanation** — given a candidate and a profile (or a candidate and a pending feedback event), produce a short human-readable string describing the match or the profile shift.

The engine depends on `MediaService` and the database. It does not depend on the plugin runtime, the MCP layer, or any plugin. Callers depend on the engine, not the other way around.

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

Notes on the shape:

**`rankCandidates` returns `RankedCandidate[]`, not `MediaItem[]`.** Score, confidence, and top contributors ride along. Callers that want to render match reasons call `explainMatch` separately for whichever candidates they'll surface.

**`previewFeedbackEffect` does not mutate.** The synchronous `ent_feedback` response gets a string; the real profile update happens asynchronously in the coalesced job. Two paths, one truth (the job), one cheap preview. Minor disagreement between preview and eventual real update is acceptable — the preview is flavor copy, not an authoritative claim.

**`rebuildProfile` and `applyIncrementalUpdate` are separate methods.** Rebuild is expensive and authoritative. Incremental is cheap, approximate, and drift-prone by design. Both jobs call into one or the other; the split makes each algorithm simpler to reason about and test.

**Deliberately not on the interface:**

- No `scoreOne(userId, candidate)`. Scoring normalizes over the candidate set; a single-item score would be meaningless.
- No `addFeedback`. Feedback ingestion is owned by `ent_feedback`'s handler, which writes `feedback_log` and triggers the coalesced job. The engine operates over data it doesn't own.
- No `recommend(userId, n)`. Candidate generation is `MediaService.getRecommendations` aggregating across plugins. The engine ranks; it does not pick from scratch.

## Profiles

### Partitioning

Two profiles per user plus a combined fallback:

- `movie` — built from the user's movie-typed feedback and history.
- `tv` — built from TV.
- `combined` — built from everything, used when one of the above is too thin to be reliable.

The combined profile is always rebuilt when either movie or TV rebuilds, because the fallback decision happens at scoring time based on signal thickness and the combined profile needs to be current whenever either typed profile is thin.

Partitioning by `media_type` is automatic from existing data — every item carries `media_type`, no user action required. More granular partitioning (contextual profiles, mood-based profiles) is deferred; naming profiles would require user curation and feedback attribution neither of which is trivial.

### Feature categories

Six categories, each a dictionary of `value → weight`:

| Category  | Source                                             | Notes                                          |
| --------- | -------------------------------------------------- | ---------------------------------------------- |
| Genres    | TMDB genres                                        | Strong, dense, always populated                |
| Keywords  | TMDB keywords (filtered, see below)                | Best signal for specificity and reasons        |
| People    | Director + top-billed cast + writers (TV creators) | Prefixed: `"Director:..."`, `"Actor:..."`      |
| Decades   | Release year bucketed                              | `"1990s"`, `"2010s"`, etc.                     |
| Runtime   | Movie runtime or TV episode runtime, bucketed      | `"short"`, `"medium"`, `"long"`, `"very_long"` |
| Languages | Original language ISO code                         | Strong signal for international-taste users    |

Deliberately out of v1:

- **Production company / network.** Low per-item value; users rarely track this consciously.
- **Mood, tone, pacing.** Not available from structured metadata. Embedding territory.
- **Seasonality / time-of-day.** Attribution is ambiguous and UX is a separate project.

### Keyword filtering

TMDB's keyword corpus mixes content descriptors ("unreliable narrator", "neo-noir", "heist") with structural metadata ("sequel", "aftercreditsstinger") and mood descriptors ("whimsical", "intense"). Only content descriptors are useful for the profile. Two hand-curated filter lists run in `keywords.ts` before aggregation:

- **Structural tags.** TMDB keywords describing franchise or meta-attributes rather than content: `aftercreditsstinger`, `duringcreditsstinger`, `beforecreditsstinger`, `sequel`, `reboot`, `spin off`, `live action remake`, and universe tags (`marvel cinematic universe (mcu)`, `dc extended universe (dceu)`). These correlate with what the user watched, not what they prefer. Without filtering, observed output included `aftercreditsstinger` ranking 4th in the normalized keyword profile (~1.6%) — and `match_reason` strings like "You tend to like films with aftercreditsstinger."

- **Tone / mood descriptors.** TMDB keywords describing emotional register: `excited`, `intense`, `sentimental`, `whimsical`, `wistful`, `complex`, `dramatic`, `suspicious`, `blunt`, and similar. Per the non-goals, mood-based scoring is deferred. Leaving these in the keyword pool dilutes content signal — in observed data a single TV show contributed 37 tone keywords at equal weight, consuming ~24% of the 200-keyword budget. If mood scoring is added later it belongs in a dedicated `moods` category with its own category weight, not silently mixed into keywords.

Both lists are constants in `keywords.ts`. TMDB's corpus evolves, so these are reviewed periodically — the maintenance cost is accepted; the alternative (unfiltered) produces visibly bad output.

### Weight derivation

Each feedback source contributes to feature weights with a configurable per-source strength. Rough hierarchy strongest to weakest:

| Signal                                           | Per-item weight |
| ------------------------------------------------ | --------------- |
| `rate` with rating 8–10                          | +1.0            |
| `ent_feedback` action `like`                     | +0.8            |
| Completed watch with high progress               | +0.5            |
| `ent_feedback` action `note`, positive sentiment | +0.6            |
| Watchlist add (not yet watched)                  | +0.3            |
| `ent_feedback` action `note`, neutral            | 0               |
| `ent_feedback` action `note`, negative sentiment | −0.6            |
| `rate` with rating 1–3                           | −0.8            |
| `ent_feedback` action `dislike`                  | −1.0            |

For each item with a per-item weight, the item's extracted features each receive that weight added to their dictionary slot. After aggregating across all items, weights are normalized per category so no single category dominates the sum during scoring.

**Recency decay.** A feedback signal from N months ago gets multiplied by `0.5 ^ (months / 24)` — a half-life of two years. Applied to genres and keywords; not applied to people (a user who loved early Fincher still loves early Fincher) or languages (language preference is stable). Applied at rebuild time only; incremental updates cannot retroactively re-decay old signals, which is one source of the drift the daily rebuild corrects.

**Top-K pruning per category.** At rebuild completion, retain the top-K entries by absolute weight per category: 50 genres (effectively all of them), 200 keywords, 100 people, 10 decades, 4 runtimes, 20 languages. Sorting by `|weight|` preserves strong negative signals (things the user dislikes) alongside strong positives; a strong negative is more informative for ranking than a weak positive. Bounds profile size and keeps scoring fast.

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

Confidence mapping: `< 15` items → low, `15–49` → medium, `≥ 50` → high. Stored rather than computed because the scoring read path reads it every call; denormalizing saves recomputation.

### Free-text notes

`ent_feedback` with `action: "note"` writes a free-text note. Sentiment and keyword extraction happen at write time in `feedback_log.record`, not at rebuild time, because re-extracting on every rebuild would be wasteful.

**Sentiment classifier:** a small embedded-friendly model (e.g. DistilBERT-based ONNX or a simpler lexicon-based approach for v1). Produces `positive | negative | neutral`. If the classifier fails, `note_sentiment` is stored as `NULL` and the rebuild treats NULL-sentiment notes as neutral.

**Keyword extraction:** extract notable nouns and adjectives from the note that appear in the item's TMDB keyword list. Stored as a JSON array in `note_keywords`. At rebuild time, these keywords get reinforced with the note's sentiment weight on top of any base signal the item already produces.

This is deliberately crude. The place to plug in a richer text-feature extractor (or an LLM) later is well-defined: `server/preference-engine/sentiment.ts`, replaceable behind a stable interface.

## Scoring

### Per-category score

For a candidate item and a profile, the per-category score is the sum of the profile weights for the feature values the candidate has:

```
categoryScore(c, candidate, profile)
  = Σ over v in candidate.features[c]:  profile.features[c][v] or 0
```

Example: a candidate is a Thriller/Crime movie. Profile has `genres: { Thriller: 0.34, Crime: 0.18, Comedy: 0.05 }`. Genre score = `0.34 + 0.18 = 0.52`.

### Overall score

```
profileScore(candidate, profile)
  = Σ categoryWeight[c] × categoryScore(c, candidate, profile)

finalScore
  = α × normalizedProfileScore + (1 − α) × (1 − normalizedOriginalRank)
```

**Category weights** — hand-tuned for v1:

| Category  | Weight |
| --------- | ------ |
| Genres    | 0.30   |
| Keywords  | 0.30   |
| People    | 0.15   |
| Decades   | 0.10   |
| Runtime   | 0.05   |
| Languages | 0.10   |

Tuning is a hand-iteration job once real user feedback accrues; learned weights require a feedback loop that doesn't exist yet.

**α-blending.** The engine re-ranks an upstream-produced candidate list. The upstream order carries real information (popularity, collaborative-filtering signal from Trakt, etc.) that the profile alone cannot produce. `α = 0.7` by default means the profile dominates but upstream ranking is not ignored.

**Normalization is over the candidate set, not global.** `normalizedProfileScore` is `profileScore` divided by the max profileScore across the current candidate list; `normalizedOriginalRank` is `originalIndex / (N − 1)`. Per-set normalization keeps α-blending stable across queries with wildly different absolute score magnitudes.

### Confidence handling

When the relevant profile has `sampleSize < 15`, it is considered thin:

1. α drops from 0.7 toward 0.3 proportional to thinness: `α_effective = 0.3 + (sampleSize / 15) × 0.4`, clamped to `[0.3, 0.7]`.
2. If the media-type profile is thin but the combined profile is not, score against combined instead of the typed profile. This is the fallback decision mentioned under Partitioning.
3. If both are thin, `α_effective` stays at 0.3 and the returned confidence is `"low"`. Callers can choose to hide `match_reason` when confidence is low (the MCP tool does not, but future callers may).

### `match_reason` generation

Derived from top contributors to the profile score:

1. For each category, compute per-feature contribution `categoryWeight[c] × profile.features[c][v]` for each `v` the candidate has.
2. Flatten across categories and sort descending.
3. Take the top 1–2 contributors that each contribute at least ~10% of the final profile score.
4. Render with a small per-category template table:

| Category  | Template                                          |
| --------- | ------------------------------------------------- |
| Genres    | "Matches your interest in {genre}"                |
| Keywords  | "You tend to like films with {keyword}"           |
| People    | "From {person} whose work you've enjoyed"         |
| Decades   | "From the {decade} which you favor"               |
| Runtime   | "A {runtime-bucket} runtime fits your preference" |
| Languages | "Matches your taste for {language} cinema"        |

Joining two contributors: "Matches your interest in thrillers and you tend to like films with unreliable-narrator themes." Truncated to ~100 chars.

Deliberately plain. A future LLM-rendered version can receive the same top-contributor data as structured input; the v1 output is deterministic, cheap, and snapshot-testable.

Returns `null` when confidence is low and no contributor clears the 10% threshold, or when the profile does not exist yet.

### `profile_update` generation

Synchronous preview for `ent_feedback`. Runs as `previewFeedbackEffect`, which is a pure function over the candidate item, the action, and the current profile. Does not read the newly-written `feedback_log` row.

Algorithm:

1. Identify what the feedback _would_ reinforce or diminish based on the action and the item's features.
2. For positive signals, pick the top category feature (by category weight × item feature presence) and render "Reinforces your preference for {feature}."
3. For negative signals, render "Decreased preference for {feature}."
4. For notes, fall back to "Noted your feedback on {title}." when sentiment is neutral or classification failed.

Returns `null` when the candidate item has no features that would register (shouldn't happen for real TMDB items, but the fallback keeps the interface honest).

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

**Why one JSON column instead of a normalized `preference_feature_weights` child table.** Profiles are written atomically (rebuild replaces the whole thing, incremental also writes a new whole thing). Read atomically (every scoring call needs all six categories). No query pattern benefits from cross-user feature analytics — the engine is per-user, not cross-user. A normalized schema would add indexes that buy nothing.

**Sizes.** Top-K caps bound the blob at roughly 20–40KB per profile; in practice much smaller. Three profiles per user worst case. Not a scale concern.

**`embedding` / `embedding_model` reserved.** NULL in v1. A `BLOB` column stores a serialized float32 vector; `embedding_model` records which model produced it, for re-embedding on model change. No migration pain when this lights up.

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

**Event-sourced, no upserts.** If a user rates a movie 7, then later rates it 9, both rows exist. Rebuild and incremental both use most-recent-wins when reducing to a per-(user, item) signal. This matches the MCP doc's "most-recent wins per the MediaService doc" stance for ratings.

**Sentiment and keywords extracted at write time.** Stored in the row. Rebuild reads structured fields rather than re-running classification on every rebuild.

**`tmdb_id` + `media_type`, not `connection_id`.** Feedback is about the item, not where the rating was written. `ent_feedback`'s rating fan-out to `ratings@v1` plugins is a separate concern, handled outside this table.

### Indexes

- `feedback_log (user_id, created_at DESC)` — incremental update reads "feedback since last_rebuilt_at" per user.
- `feedback_log (user_id, tmdb_id, media_type)` — rebuild dedup to most-recent-wins per item; `ent_details` asks "has this user rated this item."
- `preference_profiles` has no secondary index; always accessed by `(user_id, media_type)`.

### Deletion

User deletion cascades both tables. Standard. Called out because if the app ever exposes "delete my data," these are the tables that matter most for the promise.

### What isn't stored

- **Candidate lists passed to `rankCandidates`.** Ephemeral — the engine scores what it's handed and doesn't remember. Keeps scoring reproducible from (profile, candidate list).
- **Recommendation logs.** No "things we showed this user" table. Tempting for analytics but explicitly out of scope per the error-management doc.

## Lifecycle

Both background jobs register through the job service (per the job-service doc). The engine does not touch `croner` directly.

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

**Row source.** A user appears in the row set if any of:

- They have no profile yet, but have at least some activity (feedback, watch history, or ratings).
- `now - last_rebuilt_at > 7 days` — staleness cap; profiles rebuild weekly even without new feedback, since upstream metadata can shift.
- They have ≥ 20 new `feedback_log` rows since `last_rebuilt_at` — enough incremental signal accrued that a full rebuild is warranted. Counts events, not distinct items: because `feedback_log` is event-sourced, a user iterating ratings on 7 films can hit this threshold. Intentional — the threshold is a proxy for "this user has been active," regardless of whether activity is spread across many items or concentrated on fewer.

Users with no activity at all are skipped.

**Three profiles per user per run.** The daily handler calls `rebuildProfile` three times (movie, tv, combined). In v1 these are three independent `collectContributions` passes over the user's history. An optimization to share a single data load across all three profiles is deferred — at current user volumes the triple-read is not load-bearing, but the shared-load refactor belongs in the rebuild layer (not the job handler) when it becomes worth doing. Sequential per user, not per (user, media_type).

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

**Why coalesced.** An agent conversation can produce a burst of feedback events. Running incremental update five times in 30 seconds is wasteful and visibly thrashes the profile if the user immediately asks for recommendations. 30s debounce catches conversation bursts; 5min ceiling prevents starvation under steady trickle. `scopeKey: userId` prevents cross-user coalescing.

### Incremental update algorithm

Not obvious from the interface alone:

1. Read the stored profile.
2. Read `feedback_log` rows for this user with `created_at > profile.lastUpdatedAt`.
3. Fetch metadata for each referenced item via `MediaService.getMetadata` (cached).
4. For each new feedback row, compute per-item weight (per the hierarchy above) and add contributions to the in-memory profile's feature dictionaries.
5. Increment `sample_size`, update `last_updated_at`.
6. _Do not re-normalize, re-decay, or re-prune._ The incremental update is intentionally approximate.
7. Write the profile.

The skipped re-normalization is the main source of drift. Over time, incremental updates cause the profile to accumulate old high-magnitude signals without the corrective recency decay or top-K pruning. The daily rebuild is the correction pass that fully re-normalizes, re-applies decay, and re-prunes. The two work together: incremental keeps profiles warm between rebuilds; daily keeps them honest.

### User-triggered rebuild

`triggerable` job for the eventual `/profile` page's "Rebuild my profile" button:

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

**`scopeKey: userId`** — one rebuild per user at a time. A second trigger while one is running returns `job.already_running`, which the `/profile` UI surfaces as "already rebuilding."

**Permission is strictly `userId === input.userId`.** A user can only rebuild their own profile. No admin bypass; an admin who wants to rebuild for another user does it via `/admin/jobs` with the daily-rebuild job. This keeps the feature endpoint narrow and free of privilege-escalation surface.

**Calls the same `rebuildProfile` method the daily job uses.** One algorithm, multiple triggers. After a manual rebuild, the user's `last_rebuilt_at` is fresh and the daily job will skip them next run.

### First-run behavior

When a user first connects a tracking service:

1. The connection-create path does not synchronously rebuild. The daily job will pick them up.
2. `ent_discover recommend` before the first rebuild finds `getProfile` returning `null`. `rankCandidates` returns candidates in original order with `score: 0` and `confidence: "low"`; `explainMatch` returns `null`. The handler omits `match_reason` from the response. The agent sees a response that looks like what it would have gotten pre-engine.
3. Once the daily job runs, subsequent calls get re-ranked normally.

If a synchronous first-run build is wanted later, it can be added as another trigger for `feature.preference.rebuild` from `connection.create`. Not in v1.

### Failure modes

All captured through the job service's error-management integration:

- **`MediaService` call fails during rebuild** (e.g. TMDB transient error). The affected feature extractor returns partial features for that item. Rebuild continues. Logged but not fatal.
- **Sentiment classifier fails on a note.** Note is recorded; `note_sentiment` is NULL. Rebuild treats NULL sentiment as neutral. No user-visible impact.
- **Incremental update runs against a user with no existing profile.** Bail out; the daily rebuild will create the baseline. Not an error.
- **Two coalesced updates for the same user overlap.** Job service's scope-key handling prevents this — same scopeKey while running extends the debounce rather than starting a second run.
- **Note keyword extraction silently returns empty.** The write-time extractor in `feedback_log.record` may return an empty array either because the note contains no TMDB-matching keywords (benign) or because extraction failed (silent bug). Rebuild cannot distinguish the two at read time. To make the failure case detectable, `feedback_log.record` logs a warning when the note is non-trivial (> 20 chars) but `note_keywords` ends up empty. A future admin view can aggregate this by comparing note count against non-empty `note_keywords` count in `feedback_log`.

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

**Over-fetch then prune.** Ask upstream for `limit * 3`, re-rank, take top `limit`. Enough candidates to pull good matches up from mid-pack; not so many that upstream calls get slow. 3× is a constant in the handler.

**Reasons for top-N only.** `explainMatch` runs `limit` times, not `limit * 3`. Scoring already computed top contributors; `explainMatch` just renders them.

**Engine injected via `ToolCallContext`.** Same pattern as `MediaService`. The MCP doc's context builder adds `preferenceEngine: PreferenceEngine` as one additional field.

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

**`previewFeedbackEffect` after the `feedback_log` write.** The preview doesn't need the new row, but the ordering keeps the mental model consistent if the preview ever starts reading the latest feedback.

**Coalesced trigger is fire-and-forget.** Returns synchronously. The tool response does not wait for the update.

### `ent_details`

The MCP doc has `ent_details` read per-item feedback. The engine exposes `getUserFeedbackFor(userId, tmdbId, mediaType)` specifically for this — a pass-through to `feedback_log` filtered by user + item. Lives on the engine rather than exposing `feedback_log` to handlers directly, because the engine owns the table.

### `MediaService` integration

The engine calls five methods on `MediaService`:

- `getHistory(userId, opts)` — aggregate across `watchHistory@v1` plugins.
- `getAllRatings(userId)` — aggregate across `ratings@v1` plugins.
- `getWatchlist(userId)` — items the user has queued but not watched, contributing at the watchlist weight (+0.3).
- `getComments(userId)` — user-written comments surfaced by plugins that expose them (e.g. Trakt); distinct from `ent_feedback` notes, which live in `feedback_log`. Sentiment-classified at scoring time via the same classifier used for notes.
- `getMetadata(userId, id)` — per-item metadata, cached at 24h TTL.

All exist or are trivially derivable from methods already specified in the media-service doc. No new capability. No new `MediaService` method. The engine is a pure consumer.

One implicit requirement: rebuild issues many `getMetadata` calls for items in history. The 24h cache makes this cheap for popular items; for obscure items it's a first-miss-then-cache pattern. No bulk-fetch needed.

### `/profile` oRPC procedures

The `/profile` page itself is a separate spec. This engine exposes three oRPC procedures for it:

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

`getRebuildStatus` enables a poll-and-spinner UX for the rebuild button. Streaming run output is explicitly out of scope per the job-service doc; the page polls.

## Scorer extension slot

The scoring pipeline is structured so one slot is reserved for an embedding-based scorer:

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

Feature-dictionary scorers (genres, keywords, etc.) are all cases of one pattern: extract features from items, aggregate into weights at rebuild, score candidates by feature overlap. The embedding scorer is a different shape — it computes a user centroid at rebuild and scores candidates by cosine similarity to that centroid. Both conform to `FeatureScorer` via the two optional methods.

**When embeddings are added later:**

1. Define `embedding@v1` capability (host-side) with one method: `embed(ctx, { texts }) → Promise<Array<number[]>>`.
2. Author an embedding plugin (one per provider — OpenAI, Voyage, Cohere, Ollama, etc.) per the existing plugin architecture.
3. Register `embeddingScorer` in `SCORERS`, using `MediaService` to call the capability.
4. Populate the `embedding` column on `preference_profiles` during rebuild.
5. Add a `categoryWeight` and shift existing weights. Deployment-wide re-rebuild is needed at this point; admins trigger it via the daily job with a modified row source.

No refactor of the scoring pipeline. No change to the profile reads. No change to the data model. The reserved column and the reserved scorer slot absorb the addition.

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

Job registrations live next to the engine (registered at host startup) rather than in `server/jobs/` — per the job-service doc's pattern of "registrants import the registration functions."

## Testing

### Feature extractor unit tests

One test file per extractor. Given a `MediaItem` fixture, produces the expected features. Fixtures cover normal cases, missing-field cases (no keywords, no cast), and large-list cases (top-K pruning happens at aggregation, not extraction — verify extractors emit everything).

### Scoring unit tests

Given a profile fixture and a candidate fixture, `rankCandidates` returns candidates in expected order with expected scores. Specific cases:

- α-blending at multiple confidence levels (high, medium, low).
- Normalization-per-candidate-set: re-ranking `[A, B, C]` produces the same relative order for those three items as re-ranking `[A, B, C, D, E]`.
- Thin-profile fallback: score a thin movie profile against a movie candidate; verify combined profile is used.
- Empty profile case: `rankCandidates` with no profile returns candidates in original order with `score: 0`.

### Explain / preview unit tests

Snapshot tests for `explainMatch` and `previewFeedbackEffect` across representative inputs. Deterministic output makes snapshot testing correct.

### Rebuild integration tests

Fixture user with known `feedback_log` rows and mocked `MediaService`. Run `rebuildProfile`, verify the resulting `preference_profiles` row matches expected features. One test per media-type branch (movie, TV, combined-fallback-when-thin).

### Incremental update correctness

Rebuild a profile, add N feedback rows, run incremental update, verify the profile reflects the new rows. Separately: rebuild, incremental many times, rebuild again — verify the post-rebuild profile matches a fresh rebuild from all data. This is the "incremental drifts, daily corrects" contract.

### End-to-end with `ent_discover`

Fixture user + fixture plugins exercising `recommendations@v1`. Call the recommend handler; verify candidates from upstream get re-ordered, that top results have `match_reason` strings, and that low-confidence users see less aggressive re-ranking.

### Job integration

Job scheduling and lifecycle are tested by the job service's own suite (per the job-service doc). Tests in this spec cover only the handlers — what the engine does when called — not cron registration or scope-key semantics.

## Changes since initial implementation

An initial implementation of this spec ran against real user data before shipping. The pilot surfaced issues that produced the following revisions on 2026-04-21:

- **Keyword filtering.** TMDB keyword pollution from structural tags (e.g. `aftercreditsstinger`) and tone descriptors (e.g. `whimsical`) was severe enough to corrupt both scoring and `match_reason` output. Two hand-curated filter lists now run in `keywords.ts` before aggregation. See _Keyword filtering_ under Profiles.
- **Top-K sort order.** Made explicit that pruning sorts by `|weight|` to preserve strong negative signals. Spec was ambiguous; implementation was already correct.
- **Daily rebuild pass count.** The original claim that one pass over history produces all three profiles was aspirational — the implementation does three passes. Spec amended to match reality, shared-load optimization deferred.
- **Rebuild threshold semantics.** Clarified that the ≥20 threshold counts events, not distinct items.
- **Note keyword silent failures.** Added a write-time log warning in `feedback_log.record` to make empty-extraction-on-non-empty-note detectable.
- **MediaService integration.** Added `getWatchlist` and `getComments` to the list of consumed methods (previously omitted from the integration section).

This section will be removed once a subsequent revision lands and this delta is no longer the freshest context.

## Open questions / deferred

- **Embedding-based scoring via `embedding@v1` capability.** Reserved in the profile schema and scorer registry. Shipped when there's demand.
- **Learned category weights.** V1 uses hand-tuned weights. Learning them requires a feedback loop on recommendation quality that doesn't exist yet. Revisit once enough `ent_feedback` signal exists to train against.
- **Top-K budget tuning post-filter.** With structural-tag and tone-descriptor filtering now removing a meaningful fraction of the raw keyword pool, the existing 200-keyword cap may be over- or under-sized. Revisit once filtered profiles have accumulated — the choice should be data-driven, not inherited from the pre-filter design.
- **Contextual / mood profiles.** Named contexts ("with the kids," "background while cooking") are expressive but require user curation and feedback attribution. Out of v1.
- **Synchronous first-run rebuild.** If new-user experience in `ent_discover recommend` feels too thin before the daily job runs, a trigger from `connection.create` is a small addition. Deferred.
- **Note extractor beyond sentiment + keyword matching.** The v1 approach is crude. An LLM-based or embedding-based text-feature extractor slots in behind the existing `sentiment.ts` interface if needed.
- **Streaming rebuild progress.** `/profile`'s "Rebuild my profile" shows a spinner and polls in v1. Job-service doc explicitly defers streaming run output.
- **Rebuild-in-progress read semantics.** If `rankCandidates` is called while the user's profile is mid-rebuild, the call reads whatever is currently stored (last complete rebuild). No locking. This is correct for our write-replace-whole pattern but worth noting.
- **Cross-user analytics.** "Users who like X also like Y" exists upstream via Trakt. Host-side collaborative filtering is out of scope per non-goals.
