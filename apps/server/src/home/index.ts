import { consola } from "consola";
import type { HomeLayoutResponse, RowContentResponse, RowKind } from "@ent-mcp/shared/home";
import { CatalogService } from "../catalog";
import { getDb } from "../db/client";
import { MediaService } from "../media/service";
import { getPreferenceEngine } from "../preferences";
import { badRequest, notFound, internal } from "../errors/http-errors";
import { RequestScopedLoader } from "./dataloader";
import { captureSignals } from "./signals";
import { runFetch, runLayoutPipeline } from "./layout";
import { ROW_FETCHERS } from "./rows/index";

/**
 * Public entry point for the home feed. Two procedures map onto two methods:
 *   - `getLayout(userId)`           ↔ `home.getLayout`
 *   - `getRowContent(userId, args)` ↔ `home.getRowContent`
 *
 * The service constructs all per-request dependencies (MediaService,
 * RequestScopedLoader) — callers only supply the authenticated userId and
 * cursor input.
 */
export class HomeFeedService {
  /**
   * Returns the skeleton layout: row stubs (no items) and a resolved hero.
   * Item fetching is delegated to `getRowContent`, which the client calls
   * per row after receiving the skeleton.
   */
  async getLayout(userId: string): Promise<HomeLayoutResponse> {
    try {
      const ctx = buildContext(userId);
      const signals = await captureSignals({
        userId,
        mediaService: ctx.mediaService,
        loader: ctx.dataloader,
      });
      const { hero, stubs } = await runLayoutPipeline(signals, ctx);
      return {
        hero,
        rows: stubs,
        generatedAt: Date.now(),
      };
    } catch (err) {
      consola.error("[home] getLayout failed:", err);
      throw internal("home.internal", "home feed unavailable");
    }
  }

  /**
   * Paginated scroll for a single row. A null cursor means first page.
   * Re-uses the same `RowFetcher.fetch` the layout handler calls, including
   * its 5s timeout. Eligibility runs before the fetch so plugin removals
   * between sessions surface as `home.row_unavailable` rather than an empty
   * payload.
   */
  async getRowContent(
    userId: string,
    args: { rowId: RowKind; cursor: string | null },
  ): Promise<RowContentResponse> {
    const fetcher = ROW_FETCHERS[args.rowId];
    if (!fetcher) {
      throw badRequest("home.bad_input", `unknown row id ${args.rowId}`);
    }
    const ctx = buildContext(userId);
    const eligible = await fetcher.isEligible(userId, ctx.dataloader, args.cursor);
    if (!eligible) {
      throw notFound(
        "home.row_unavailable",
        `row ${args.rowId} is no longer available for this user`,
      );
    }

    try {
      const fetched = await runFetch(args.rowId, ctx, {
        cursor: args.cursor,
        limit: 20,
      });
      const out: RowContentResponse = { items: fetched.items, cursor: fetched.cursor };
      // Promote degraded outcomes to `partial` on the wire. Without this, a
      // calendar timeout for `upcomingForYou` returns `{ items: [] }` indistinguishable
      // from a genuine "you're caught up" empty fetch — the client renders the
      // empty-state copy during a plugin outage. See docs §5 dropEmpty rule.
      if (fetched.partial || fetched.outcome === "timeout" || fetched.outcome === "all_failed") {
        out.partial = true;
      }
      return out;
    } catch (err) {
      consola.error("[home] getRowContent failed:", err);
      throw internal("home.internal", "home feed unavailable");
    }
  }
}

let catalogServiceInstance: CatalogService | undefined;

function getCatalogService(): CatalogService {
  if (!catalogServiceInstance) catalogServiceInstance = new CatalogService(getDb());
  return catalogServiceInstance;
}

function buildContext(userId: string) {
  const mediaService = new MediaService(userId);
  const dataloader = new RequestScopedLoader(mediaService, userId);
  return {
    userId,
    mediaService,
    catalogService: getCatalogService(),
    dataloader,
    preferenceEngine: getPreferenceEngine(),
    logger: consola,
  };
}

let instance: HomeFeedService | undefined;

/** Singleton handle. Lazily constructed so module load is cheap. */
export function getHomeFeedService(): HomeFeedService {
  if (!instance) instance = new HomeFeedService();
  return instance;
}

/** Test helper: drop the singleton so the next `get` rebuilds from scratch. */
export function resetHomeFeedServiceForTest(): void {
  instance = undefined;
  catalogServiceInstance = undefined;
}
