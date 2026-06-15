import type { CanonicalMetadata, MetadataKey } from "@nama/shared/catalog";
import { SYSTEM_USER_ID } from "@nama/shared/jobs";
import { MediaService } from "../../media";
import { registerScheduled } from "../../jobs/scheduled";
import type { JobRunContext } from "../../jobs/types";
import type { CatalogService } from "../../catalog";
import { toCanonicalRow, type RawCanonicalSource } from "../canonical";

const DAY_MS = 24 * 60 * 60 * 1000;

export const CATALOG_METADATA_REFRESH_JOB_ID = "host.catalog.metadata_refresh";

const STALE_AFTER_MS = 30 * DAY_MS;
const BATCH_LIMIT = 500;
const BATCH_SIZE = 25;

export interface CatalogMetadataRefreshDeps {
  catalog: CatalogService;
}

/**
 * Registers the nightly catalog metadata refresh. Reads up to `BATCH_LIMIT`
 * stale rows from `canonical_metadata`, fans them out in chunks of
 * `BATCH_SIZE` against the global-scope `metadata@v1` provider, and writes
 * the freshened rows back through `CatalogService.writeMetadata`.
 */
export function registerCatalogMetadataRefreshJob(deps: CatalogMetadataRefreshDeps): void {
  registerScheduled({
    id: CATALOG_METADATA_REFRESH_JOB_ID,
    name: "Catalog metadata refresh",
    description: "Refreshes stale rows on canonical_metadata against the upstream metadata plugin.",
    schedule: "0 4 * * *",
    timeoutSec: 60 * 60,
    adminTriggerable: true,
    handler: (ctx) => runCatalogMetadataRefresh(deps, ctx),
  });
}

export async function runCatalogMetadataRefresh(
  deps: CatalogMetadataRefreshDeps,
  ctx: JobRunContext,
): Promise<void> {
  const stale = await deps.catalog.listStaleMetadata(STALE_AFTER_MS, BATCH_LIMIT);
  if (stale.length === 0) {
    ctx.logger.info("[catalog:metadata-refresh] no stale rows; skipping");
    return;
  }
  const media = new MediaService(SYSTEM_USER_ID);
  let refreshed = 0;
  let notFound = 0;
  let failures = 0;

  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    ctx.abortSignal.throwIfAborted();
    const slice = stale.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(slice.map((key) => fetchOne(media, key)));
    const counts = collectFresh(slice, results, ctx);
    if (counts.fresh.length > 0) {
      await deps.catalog.writeMetadata(counts.fresh);
      refreshed += counts.fresh.length;
    }
    notFound += counts.notFound;
    failures += counts.failures;
  }

  ctx.logger.info(
    `[catalog:metadata-refresh] processed ${stale.length} keys (${refreshed} refreshed, ${notFound} not-found, ${failures} failed)`,
  );
}

interface FetchResult {
  key: MetadataKey;
  data: RawCanonicalSource | null;
  /**
   * True only when a provider was actually queried and reported the title is
   * gone: at least one provider was contacted (`attempted > 0`), none errored
   * (`errors` empty), yet no data came back. This is the genuine upstream
   * removal. Every other no-data shape — every provider errored (outage or
   * rate-limit storm) or no provider was contacted at all (`attempted === 0`,
   * e.g. the metadata capability has no configured provider) — is treated as a
   * failure, because the title was never confirmed absent and so must not be
   * logged as a removal.
   */
  notFound: boolean;
}

async function fetchOne(media: MediaService, key: MetadataKey): Promise<FetchResult> {
  const result = await media.getMetadataResult(key.tmdbId, key.type);
  const data = result.data ?? null;
  const notFound = data === null && result.attempted > 0 && result.errors.length === 0;
  return { key, data, notFound };
}

interface CollectResult {
  fresh: CanonicalMetadata[];
  notFound: number;
  failures: number;
}

// fallow-ignore-next-line complexity
function collectFresh(
  slice: MetadataKey[],
  results: PromiseSettledResult<FetchResult>[],
  ctx: JobRunContext,
): CollectResult {
  const fresh: CanonicalMetadata[] = [];
  let notFound = 0;
  let failures = 0;
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const key = slice[i];
    if (!key) continue;
    if (!result || result.status === "rejected") {
      ctx.logger.debug(
        `[catalog:metadata-refresh] dispatch rejected for ${key.type}:${key.tmdbId}`,
      );
      failures += 1;
      continue;
    }
    const { data } = result.value;
    if (!data) {
      if (result.value.notFound) {
        // A provider answered and the title is genuinely gone upstream. This
        // is a normal expected outcome and must not be conflated with a
        // dispatch failure so operators can track genuine plugin errors.
        notFound += 1;
        continue;
      }
      // No data, but the title was never confirmed absent: either every
      // provider errored (outage / rate-limit storm) or no provider was
      // contacted at all. Count it as a failure so these never masquerade as
      // upstream removals in the summary log.
      ctx.logger.debug(
        `[catalog:metadata-refresh] no data and not confirmed absent for ${key.type}:${key.tmdbId}`,
      );
      failures += 1;
      continue;
    }
    fresh.push(toCanonicalRow(key, data));
  }
  return { fresh, notFound, failures };
}
