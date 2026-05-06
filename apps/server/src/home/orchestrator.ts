import { consola, type ConsolaInstance } from "consola";
import type {
  HomeLayoutResponse,
  HomeRowStub,
  MediaDetailsExtra,
  MediaDetailsResponse,
  RowContentResponse,
} from "@ent-mcp/shared/home";
import { getCatalogService } from "../catalog";
import { toCanonicalRow, type RawCanonicalSource } from "../catalog/canonical";
import { MediaService } from "../media/service";
import { HttpError } from "../errors/http-errors";
import { classifyError } from "./errors";
import { pickHero } from "./hero";
import * as layoutCache from "./layout-cache";
import { ROW_ORDER, ROW_PROVIDERS } from "./rows";
import { StatusBatchMemo } from "./status-batch";
import { enrichItems } from "./enrich";
import { fromCanonicalMetadata } from "./adapters";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import type { RowContext } from "./types";

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
    const cached = await layoutCache.read(ctx.userId);
    if (cached && layoutCache.isFresh(cached)) {
      return cached.layout;
    }
  }
  const blob = await composeLayoutLive(ctx);
  if (!opts.skipWriteback) {
    void layoutCache
      .write(ctx.userId, blob)
      .catch((err) => ctx.logger.warn("[home:layout-cache] write failed", err));
  }
  return blob;
}

async function composeLayoutLive(ctx: RowContext): Promise<HomeLayoutResponse> {
  const eligibilityChecks = ROW_ORDER.map(async (rowId) => {
    const provider = ROW_PROVIDERS[rowId]!;
    try {
      return { rowId, eligible: await provider.eligibility(ctx) };
    } catch (err) {
      ctx.logger.warn(`[home:eligibility] ${rowId} threw`, err);
      return { rowId, eligible: false };
    }
  });
  const [eligibilities, hero] = await Promise.all([
    Promise.all(eligibilityChecks),
    pickHero(ctx).catch((err) => {
      ctx.logger.warn("[home:hero] pickHero threw", err);
      return null;
    }),
  ]);
  const eligibleSet = new Set(eligibilities.filter((e) => e.eligible).map((e) => e.rowId));
  const rows: HomeRowStub[] = [];
  for (const rowId of ROW_ORDER) {
    if (!eligibleSet.has(rowId)) continue;
    const provider = ROW_PROVIDERS[rowId]!;
    const initialCursor = await provider.initialCursor(ctx).catch(() => null);
    const stub: HomeRowStub = {
      rowId,
      kind: provider.kind,
      titleKey: provider.titleKey,
      initialCursor,
    };
    if (provider.subtitleKey) stub.subtitleKey = provider.subtitleKey;
    rows.push(stub);
  }
  return { hero, rows, generatedAt: Date.now() };
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
  const page = await provider.fetchPage(ctx, cursor);
  const items = await enrichItems(page.items, ctx, { rowId });
  const out: RowContentResponse = { items, cursor: page.cursor };
  if (page.partial) out.partial = true;
  return out;
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
  mediaType: "movie" | "tv",
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
  const [detailsSettled, [summaryItem]] = await Promise.all([
    ctx.mediaService.getDetails(tmdbId, mediaType).then(
      (data) => ({ ok: true as const, data }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    enrichItems([summaryInternal], ctx, { rowId: "details" }) as Promise<CompactMediaItem[]>,
  ]);
  if (!summaryItem) throw new HttpError(500, "home.internal", "summary enrichment failed");
  if (!detailsSettled.ok) {
    return {
      summary: summaryItem,
      details: null,
      error: { code: classifyError(detailsSettled.err) },
    };
  }
  return { summary: summaryItem, details: toMediaDetailsExtra(detailsSettled.data) };
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
