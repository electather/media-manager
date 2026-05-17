import type { CanonicalMetadata, MetadataKey } from "@ent-mcp/shared/catalog";
import { MediaService } from "../../media";
import { registerScheduled } from "../../jobs/scheduled";
import type { JobRunContext } from "../../jobs/types";
import type { CatalogService } from "../../catalog";
import { toCanonicalRow, type RawCanonicalSource } from "../canonical";
import { SYSTEM_USER_ID } from "./constants";

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
  let failures = 0;

  for (let i = 0; i < stale.length; i += BATCH_SIZE) {
    ctx.abortSignal.throwIfAborted();
    const slice = stale.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(slice.map((key) => fetchOne(media, key)));
    const fresh = collectFresh(slice, results, ctx);
    if (fresh.length > 0) {
      await deps.catalog.writeMetadata(fresh);
      refreshed += fresh.length;
    }
    failures += results.length - fresh.length;
  }

  ctx.logger.info(
    `[catalog:metadata-refresh] processed ${stale.length} keys (${refreshed} refreshed, ${failures} failed)`,
  );
}

interface FetchResult {
  key: MetadataKey;
  data: RawCanonicalSource | null;
}

async function fetchOne(media: MediaService, key: MetadataKey): Promise<FetchResult> {
  const data = await media.getMetadata(key.tmdbId, key.type);
  return { key, data };
}

// fallow-ignore-next-line complexity
function collectFresh(
  slice: MetadataKey[],
  results: PromiseSettledResult<FetchResult>[],
  ctx: JobRunContext,
): CanonicalMetadata[] {
  const out: CanonicalMetadata[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const key = slice[i];
    if (!key) continue;
    if (!result || result.status === "rejected") {
      ctx.logger.debug(
        `[catalog:metadata-refresh] dispatch rejected for ${key.type}:${key.tmdbId}`,
      );
      continue;
    }
    const data = result.value.data;
    if (!data) continue;
    out.push(toCanonicalRow(key, data));
  }
  return out;
}
