import type { MediaItem } from "@nama/shared/media";
import type {
  FeedbackAction,
  PreferenceProfile,
  ProfileMediaType,
  RebuildResult,
  UpdateResult,
} from "@nama/shared/preferences";
import { getCatalogService } from "../catalog";
import { anyRunning, find as findJobEntry } from "../jobs";
import { latestRun } from "../jobs/history";
import type { JobRunSummary } from "@nama/shared/jobs";
import type { TriggerSource } from "../jobs/types";
import { CatalogPreferenceProvider, type FeatureCacheMetrics } from "./internal/catalog-provider";
import { PreferenceEngine, type RankOptions } from "./internal/engine";
import { feedbackLog, type RecordFeedbackInput } from "./internal/feedback-log";
import { MediaServicePreferenceProvider } from "./internal/media-provider";
import {
  profileStorage,
  type StoredPreferenceProfile,
  type WriteProfileOptions,
} from "./internal/profile-storage";
import * as repo from "./repo";
import {
  listUsersNeedingDailyRebuild,
  listUsersNeedingRebuild,
  type RebuildRow,
} from "./internal/rebuild-row-source";
import { PREFERENCE_MANUAL_REBUILD_JOB_ID } from "./jobs/ids";
import { triggerIncremental } from "./jobs/incremental-handle";
import type { PreferenceDataProvider, RankedCandidate, UserItemFeedback } from "./types";
import { JobNotRegisteredError, JobNotTriggerableError } from "./errors";

/**
 * Public sync surface for `preferences/`. Other modules call methods on the
 * singleton via `getPreferencesService()`; the underlying `PreferenceEngine`
 * stays private behind the service so callers cannot reach into the rebuild
 * + scoring internals.
 *
 * `service.ts` delegates persistence to `repo/**` via thin facades in
 * `internal/{feedback-log,profile-storage,rebuild-row-source}.ts`. The
 * service itself never imports drizzle-orm.
 */
export class PreferencesService {
  private engineInstance: PreferenceEngine | undefined;

  /**
   * Lazily constructed engine singleton. Built on first use so the module
   * can be safely imported before `bootstrap()` runs (tests, jobs registering
   * at module-load time). The default provider reads from the catalog and
   * falls back to the live media dispatcher on miss (V45); cold-fill misses
   * persist back via a detached write-back.
   */
  private get engine(): PreferenceEngine {
    if (!this.engineInstance) {
      const fallback = new MediaServicePreferenceProvider();
      this.engineInstance = new PreferenceEngine({
        provider: new CatalogPreferenceProvider(getCatalogService(), fallback),
      });
    }
    return this.engineInstance;
  }

  // ─── Profile reads ───────────────────────────────────────────────────────

  getProfile(userId: string, mediaType: ProfileMediaType): Promise<PreferenceProfile | null> {
    return this.engine.getProfile(userId, mediaType);
  }

  /**
   * Like `getProfile` but returns the server-internal `StoredPreferenceProfile`
   * (carries the monotonic `version` column). Catalog uses the version to pin
   * rec lists against the exact profile state that drove the ranking.
   */
  getStoredProfile(
    userId: string,
    mediaType: ProfileMediaType,
  ): Promise<StoredPreferenceProfile | null> {
    return profileStorage.read(userId, mediaType);
  }

  // ─── Ranking + match reason ──────────────────────────────────────────────

  rankCandidates(
    userId: string,
    candidates: ReadonlyArray<MediaItem>,
    opts?: RankOptions,
  ): Promise<RankedCandidate[]> {
    return this.engine.rankCandidates(userId, candidates, opts);
  }

  explainRanked(userId: string, ranked: RankedCandidate): Promise<string | null> {
    return this.engine.explainRanked(userId, ranked);
  }

  renderMatchReason(ranked: RankedCandidate): string | null {
    return this.engine.renderMatchReason(ranked);
  }

  previewFeedbackEffect(
    userId: string,
    item: MediaItem,
    action: FeedbackAction,
    opts: { rating?: number; note?: string } = {},
  ): Promise<string | null> {
    return this.engine.previewFeedbackEffect(userId, item, action, opts);
  }

  // ─── Feedback log ────────────────────────────────────────────────────────

  recordFeedback(input: RecordFeedbackInput) {
    return feedbackLog.record(input);
  }

  getUserFeedbackFor(
    userId: string,
    tmdbId: string,
    mediaType: "movie" | "tv",
  ): Promise<UserItemFeedback | null> {
    return this.engine.getUserFeedbackFor(userId, tmdbId, mediaType);
  }

  // ─── Profile rebuild paths (engine wrappers) ─────────────────────────────

  rebuildProfile(
    userId: string,
    mediaType: ProfileMediaType,
    abortSignal?: AbortSignal,
  ): Promise<RebuildResult> {
    return this.engine.rebuildProfile(userId, mediaType, abortSignal);
  }

  applyIncrementalUpdate(userId: string): Promise<UpdateResult> {
    return this.engine.applyIncrementalUpdate(userId);
  }

  // ─── Row sources used by external schedulers (catalog rec build) ────────

  listUsersNeedingRebuild(now?: number): Promise<RebuildRow[]> {
    return listUsersNeedingRebuild(now);
  }

  listUsersNeedingDailyRebuild(now?: number): Promise<RebuildRow[]> {
    return listUsersNeedingDailyRebuild(now);
  }

  /**
   * Distinct ids of users with any feedback event at or after `cutoff`. Lets
   * the home warm job count "recently active" users without reaching into the
   * preferences-owned `feedback` table directly.
   */
  listUserIdsWithFeedbackSince(cutoff: number): Promise<string[]> {
    return repo.listUserIdsWithFeedbackSince(cutoff);
  }

  // ─── Job-status helpers ──────────────────────────────────────────────────

  /**
   * `true` when the manual-rebuild job is currently running. Catalog prune
   * composes this with its own `anyRunning` check to short-circuit pruning
   * while a rebuild is in flight — eviction would race rec-list writes.
   */
  isManualRebuildRunning(): boolean {
    return anyRunning([PREFERENCE_MANUAL_REBUILD_JOB_ID]);
  }

  getManualRebuildStatus(userId: string): Promise<JobRunSummary | null> {
    return latestRun(PREFERENCE_MANUAL_REBUILD_JOB_ID, userId);
  }

  // ─── Job triggers ────────────────────────────────────────────────────────

  /**
   * Fires the manual rebuild job for `userId`. Used by the admin/user-facing
   * `/api/preferences/rebuild` endpoint. Throws if the job is not yet
   * registered (cold worker before `registerJobs()` settles).
   */
  async triggerManualRebuild(
    input: { userId: string },
    meta: TriggerSource,
  ): Promise<{ runId: string; result: unknown }> {
    const entry = findJobEntry(PREFERENCE_MANUAL_REBUILD_JOB_ID);
    if (!entry) {
      throw new JobNotRegisteredError(PREFERENCE_MANUAL_REBUILD_JOB_ID);
    }
    if (entry.kind !== "triggerable" || !entry.triggerFromApi) {
      throw new JobNotTriggerableError(PREFERENCE_MANUAL_REBUILD_JOB_ID);
    }
    return entry.triggerFromApi(input, meta);
  }

  /**
   * Best-effort trigger for the coalesced incremental-update job. Silently
   * no-ops when the job is not registered — the caller (`ent_feedback`) has
   * already persisted the feedback row, and the daily rebuild safety net
   * picks it up if the live trigger never lands. Routes through the
   * `incremental-handle` leaf module rather than the registry because only
   * the `CoalescedJobHandle` exposes `trigger()`.
   */
  triggerIncrementalUpdate(userId: string): void {
    triggerIncremental(userId);
  }

  // ─── Internal hooks (in-module callers only) ─────────────────────────────

  /**
   * Reads + clears the canonical-feature cache counters from the live
   * `CatalogPreferenceProvider` when present. Returns `null` when a custom
   * provider was injected for tests (so the metric-collection path doesn't
   * crash a test using `setEngineForTest`).
   */
  consumeFeatureCacheMetrics(): FeatureCacheMetrics | null {
    const provider = this.engine.provider;
    return provider instanceof CatalogPreferenceProvider
      ? provider.consumeFeatureCacheMetrics()
      : null;
  }

  // ─── Test helpers ────────────────────────────────────────────────────────

  /** Test seam: replace the engine with one backed by `provider`. */
  setEngineForTest(provider: PreferenceDataProvider): PreferenceEngine {
    this.engineInstance = new PreferenceEngine({ provider });
    return this.engineInstance;
  }

  /** Test seam: drop the engine singleton so the next call rebuilds. */
  resetEngineForTest(): void {
    this.engineInstance = undefined;
  }
}

let instance: PreferencesService | null = null;

export function getPreferencesService(): PreferencesService {
  if (!instance) instance = new PreferencesService();
  return instance;
}

/** Test helper: drop the singleton so the next `get` rebuilds from scratch. */
export function resetPreferencesServiceForTest(): void {
  instance = null;
}

export type { FeatureCacheMetrics } from "./internal/catalog-provider";
export type { RebuildRow } from "./internal/rebuild-row-source";
export type { RecordFeedbackInput, StoredPreferenceProfile, WriteProfileOptions, RankOptions };
