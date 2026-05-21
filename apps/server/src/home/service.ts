import { consola, type ConsolaInstance } from "consola";
import type {
  HomeLayoutResponse,
  HomeRowStub,
  LayoutHero,
  MediaDetailsExtra,
  MediaDetailsResponse,
  RowContentResponse,
} from "@ent-mcp/shared/home";
import type { MediaType } from "@ent-mcp/shared/media";
import { getCatalogService, toCanonicalRow, type RawCanonicalSource } from "../catalog";
import { MediaService, AllPluginsFailedError, PluginCallError } from "../media";
import { HttpError } from "../diagnostics/http-errors";
import { classifyError } from "./internal/classify-error";
import { pickHero } from "./internal/hero";
import * as repo from "./repo";
import { ROW_ORDER, ROW_PROVIDERS } from "./rows";
import { StatusBatchMemo } from "./internal/status-batch";
import { enrichItems } from "./internal/enrich";
import { fromCanonicalMetadata } from "./internal/adapters";
import type { RowContext, RowPage } from "./internal/types";

export { composeSeasonAvailability } from "./internal/season-availability";

const DEFAULT_DEADLINE_MS = 8000;

export interface ComposeOptions {
  /** Skips the cache read; the warm job uses this to force a recompute. */
  forceFresh?: boolean;
  /**
   * Skips the detached cache writeback so the caller can run a synchronous
   * write itself — e.g. the `host.home.layout_warm` job awaits the write so
   * a transient SQLite error surfaces to the per-row handler.
   */
  skipWriteback?: boolean;
}

/**
 * Builds the per-request context shared by every row provider, the hero
 * cascade, and the orchestrator passes themselves. Each call constructs
 * fresh `MediaService` / `StatusBatchMemo` instances so plugin caches and
 * status memos stay request-scoped.
 */
export function buildContext(userId: string, logger: ConsolaInstance = consola): RowContext {
  const mediaService = new MediaService(userId);
  const catalog = getCatalogService();
  const statusBatch = new StatusBatchMemo(mediaService);
  return {
    userId,
    mediaService,
    catalog,
    statusBatch,
    logger,
    deadlineMs: Date.now() + DEFAULT_DEADLINE_MS,
  };
}

/**
 * Returns the cached layout when fresh, otherwise composes live from the
 * row registry + hero cascade. Cold-fill writeback is detached so a slow
 * SQLite write never blocks the response. The warm job calls with
 * `forceFresh: true` to keep the blob current for active users.
 */
// fallow-ignore-next-line complexity
export async function composeLayout(
  ctx: RowContext,
  opts: ComposeOptions = {},
): Promise<HomeLayoutResponse> {
  if (!opts.forceFresh) {
    const cached = await repo.read(ctx.userId);
    if (cached && repo.isFresh(cached)) {
      return cached.layout;
    }
  }
  const blob = await composeLayoutLive(ctx);
  if (!opts.skipWriteback) {
    void repo
      .write(ctx.userId, blob)
      .catch((err) => ctx.logger.warn("[home:layout-cache] write failed", err));
  }
  return blob;
}

async function composeLayoutLive(ctx: RowContext): Promise<HomeLayoutResponse> {
  const [eligibleSet, hero] = await Promise.all([resolveEligibility(ctx), resolveHero(ctx)]);
  const previews = await Promise.all(
    ROW_ORDER.filter((rowId) => eligibleSet.has(rowId)).map((rowId) => previewRow(ctx, rowId)),
  );
  const previewByRow = new Map(previews.map((p) => [p.rowId, p] as const));
  const rows = ROW_ORDER.flatMap((rowId) => {
    const preview = previewByRow.get(rowId);
    return preview?.include ? [buildRowStub(rowId, preview)] : [];
  });
  return { hero, rows, generatedAt: Date.now() };
}

async function resolveEligibility(ctx: RowContext): Promise<Set<string>> {
  const results = await Promise.all(
    ROW_ORDER.map(async (rowId) => {
      const provider = ROW_PROVIDERS[rowId]!;
      try {
        return { rowId, eligible: await provider.eligibility(ctx) };
      } catch (err) {
        ctx.logger.warn(`[home:eligibility] ${rowId} threw`, err);
        return { rowId, eligible: false };
      }
    }),
  );
  return new Set(results.filter((e) => e.eligible).map((e) => e.rowId));
}

function resolveHero(ctx: RowContext): Promise<LayoutHero | null> {
  return pickHero(ctx).catch((err) => {
    ctx.logger.warn("[home:hero] pickHero threw", err);
    return null;
  });
}

function buildRowStub(rowId: string, preview: RowPreview): HomeRowStub {
  const provider = ROW_PROVIDERS[rowId]!;
  const stub: HomeRowStub = {
    rowId,
    kind: provider.kind,
    titleKey: provider.titleKey,
    initialCursor: preview.initialCursor,
  };
  if (provider.eyebrowKey) stub.eyebrowKey = provider.eyebrowKey;
  return stub;
}

interface RowPreview {
  rowId: string;
  initialCursor: string | null;
  /** False when the row produced zero items on a fully successful fetch — gets dropped from the layout. */
  include: boolean;
}

/**
 * Runs the row's first-page fetch so the orchestrator can drop rows that
 * passed eligibility but have nothing to show (e.g. a watchlist plugin with
 * an empty list). Soft plugin failures (`partial: true` or thrown
 * `AllPluginsFailedError`/`AbortError`) keep the stub so transient outages
 * don't quietly remove a configured surface — the row endpoint will surface
 * the partial/empty state to the client. The dispatch cache absorbs the
 * follow-up `/home/row` fetch the client makes for the surviving rows.
 */
// fallow-ignore-next-line complexity
async function previewRow(ctx: RowContext, rowId: string): Promise<RowPreview> {
  const provider = ROW_PROVIDERS[rowId]!;
  let initialCursor: string | null;
  try {
    initialCursor = await provider.initialCursor(ctx);
  } catch (err) {
    ctx.logger.warn(`[home:preview] ${rowId} initialCursor threw, keeping stub`, err);
    return { rowId, initialCursor: null, include: true };
  }
  try {
    const page = await provider.fetchPage(ctx, initialCursor);
    return { rowId, initialCursor, include: page.items.length > 0 || page.partial };
  } catch (err) {
    if (isRowSoftFailure(err)) {
      const detail =
        err instanceof AllPluginsFailedError
          ? `errors=${JSON.stringify(err.errors)}`
          : err instanceof PluginCallError
            ? `code=${err.code} plugin=${err.pluginId}`
            : err instanceof Error
              ? err.name
              : "?";
      ctx.logger.warn(
        `[home:preview] ${rowId} fetchPage soft-failed, keeping stub (${detail})`,
        err,
      );
      return { rowId, initialCursor, include: true };
    }
    ctx.logger.warn(`[home:preview] ${rowId} fetchPage threw, dropping row`, err);
    return { rowId, initialCursor, include: false };
  }
}

/**
 * Loads a single row page. Validates the row id against the registry and
 * enforces `requiresInitialCursor` so seeded rows like `becauseYouWatched`
 * fail loud when the client forgets to thread the cursor through.
 */
// fallow-ignore-next-line complexity
export async function composeRow(
  ctx: RowContext,
  rowId: string,
  cursor: string | null,
): Promise<RowContentResponse> {
  const provider = ROW_PROVIDERS[rowId];
  if (!provider) {
    throw new HttpError(404, "home.row_unavailable", `unknown rowId: ${rowId}`);
  }
  // Direct row access bypasses layout assembly, so re-run the row's
  // eligibility gate. Without this, a client requesting a row whose
  // capability/data is absent gets a 200 with `items: []`, masking
  // misconfiguration. Eligibility is cheap (capability lookup or PK read).
  const eligible = await provider.eligibility(ctx).catch(() => false);
  if (!eligible) {
    throw new HttpError(404, "home.row_unavailable", `row ineligible: ${rowId}`);
  }
  if (provider.requiresInitialCursor && cursor === null) {
    throw new HttpError(400, "home.bad_input", "cursor_required");
  }
  // Per spec §Error handling: per-row plugin failures (`AllPluginsFailedError`,
  // single-strategy `PluginCallError`, AbortError on deadline) collapse to
  // `partial: true` with an empty item list rather than crashing the request.
  // Other HttpError (or any unexpected throw) still propagates to
  // `errorHandler`. The soft-failure check runs first because
  // `AllPluginsFailedError` is itself an `HttpError` subclass.
  let page: RowPage;
  try {
    page = await provider.fetchPage(ctx, cursor);
  } catch (err) {
    if (isRowSoftFailure(err)) {
      ctx.logger.warn(`[home:row] ${rowId} fetchPage soft-failed`, err);
      page = { items: [], cursor: null, partial: true };
    } else {
      throw err;
    }
  }
  const items = await enrichItems(page.items, ctx, { rowId });
  const out: RowContentResponse = { items, cursor: page.cursor };
  if (page.partial) out.partial = true;
  return out;
}

function isRowSoftFailure(err: unknown): boolean {
  return (
    err instanceof AllPluginsFailedError ||
    err instanceof PluginCallError ||
    (err instanceof Error && err.name === "AbortError")
  );
}

/**
 * Detail composition: catalog summary + live `metadata@v1.getDetails` +
 * status. Cold-fill path triggers when the catalog has no row yet — calls
 * the metadata plugin, writes the canonical row, refetches it as a
 * `CanonicalMetadata` (so we don't reshape the wire from a raw payload).
 *
 * Plugin-side detail failures resolve to `details: null + error.code` so the
 * client can render the summary while surfacing the retry hint.
 */
// fallow-ignore-next-line complexity
export async function composeDetails(
  ctx: RowContext,
  tmdbId: string,
  mediaType: MediaType,
): Promise<MediaDetailsResponse> {
  let summary = await ctx.catalog.getMetadata(tmdbId, mediaType);
  if (!summary) {
    const raw = (await ctx.mediaService.getMetadata(
      tmdbId,
      mediaType,
    )) as RawCanonicalSource | null;
    if (!raw) throw new HttpError(404, "http.not_found", `media not found: ${mediaType}:${tmdbId}`);
    await ctx.catalog.writeMetadata([toCanonicalRow({ tmdbId, type: mediaType }, raw)]);
    summary = await ctx.catalog.getMetadata(tmdbId, mediaType);
    if (!summary) throw new HttpError(500, "home.internal", "catalog write failed");
  }
  const summaryInternal = fromCanonicalMetadata(summary);
  const [detailsSettled, [summaryItem], seasonsResult] = await Promise.all([
    ctx.mediaService.getDetails(tmdbId, mediaType).then(
      (data) => ({ ok: true as const, data }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    enrichItems([summaryInternal], ctx, { rowId: "details" }),
    // Best-effort: season payload only fetched for shows. `getShowSeasons`
    // already swallows plugin errors and returns null, so a failure here
    // never propagates and the field is simply omitted from the response.
    mediaType === "tv" ? ctx.mediaService.getShowSeasons(tmdbId) : Promise.resolve(null),
  ]);
  if (!summaryItem) throw new HttpError(500, "home.internal", "summary enrichment failed");
  if (!detailsSettled.ok) {
    return {
      summary: summaryItem,
      details: null,
      error: { code: classifyError(detailsSettled.err) },
    };
  }
  const details = toMediaDetailsExtra(detailsSettled.data);
  if (seasonsResult && seasonsResult.length > 0) details.seasons = seasonsResult;
  return { summary: summaryItem, details };
}

/**
 * Permissive shape narrowing — `metadata@v1.getDetails` returns a
 * provider-shaped payload (TMDB/Trakt naming varies); pull the fields the
 * detail modal cares about and drop the rest. Each branch is null-tolerant
 * so a partial provider response doesn't block the row.
 */
// fallow-ignore-next-line complexity
function toMediaDetailsExtra(data: unknown): MediaDetailsExtra {
  const v = (data ?? {}) as Record<string, unknown>;
  const out: MediaDetailsExtra = {
    cast: Array.isArray(v.cast) ? (v.cast as unknown[]).map((c) => String(c)).slice(0, 12) : [],
  };
  const director = pickString(v.director);
  if (director) out.director = director;
  const ageRating = pickString(v.ageRating ?? v.contentRating ?? v.certification);
  if (ageRating) out.ageRating = ageRating;
  const audienceScore = pickNumber(v.audienceScore);
  if (audienceScore != null) out.audienceScore = audienceScore;
  const criticScore = pickNumber(v.criticScore);
  if (criticScore != null) out.criticScore = criticScore;
  const votes = pickNumber(v.votes);
  if (votes != null) out.votes = votes;
  const trailerUrl = pickString(v.trailerUrl);
  if (trailerUrl) out.trailerUrl = trailerUrl;
  const nextAirDate = pickString(v.nextAirDate);
  if (nextAirDate) out.nextAirDate = nextAirDate;
  const seriesStatus = pickString(v.seriesStatus);
  if (seriesStatus === "ongoing" || seriesStatus === "finished") out.seriesStatus = seriesStatus;
  const runtime = pickString(v.runtime);
  if (runtime) out.runtime = runtime;
  return out;
}

function pickString(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function pickNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
