import { consola } from "consola";
import type { HomeLayoutResponse, RowContentResponse, RowKind } from "@ent-mcp/shared/home";
import { MediaService } from "../media/service";
import { getPreferenceEngine } from "../preferences";
import { badRequest, notFound, internal } from "../errors/http-errors";
import { RequestScopedLoader } from "./dataloader";
import { captureSignals } from "./signals";
import { applyDynamicSubtitles, runFetch, runLayoutPipeline, toHomeRow } from "./layout";
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
   * Builds the inline layout — signal snapshot, candidate row order, every
   * row's first page, hero pick, hero exclusion, drop-empty. Wraps any
   * thrown error in `home.internal` and lets oRPC surface it to the user.
   */
  async getLayout(userId: string): Promise<HomeLayoutResponse> {
    try {
      const ctx = buildContext(userId);
      const signals = await captureSignals({
        userId,
        mediaService: ctx.mediaService,
        loader: ctx.dataloader,
      });
      const result = await runLayoutPipeline(signals, ctx);
      const annotated = applyDynamicSubtitles(result.rows, signals);
      return {
        hero: result.hero,
        rows: annotated.map(toHomeRow),
        generatedAt: Date.now(),
      };
    } catch (err) {
      consola.error("[home] getLayout failed:", err);
      throw internal("home.internal", "home feed unavailable");
    }
  }

  /**
   * Paginated scroll for a single row. Re-uses the same `RowFetcher.fetch`
   * the layout handler called, including its 3s timeout. Eligibility runs
   * before the fetch so plugin removals between sessions surface as
   * `home.row_unavailable` rather than an empty payload that the dashboard
   * cannot distinguish from "no more content".
   */
  async getRowContent(
    userId: string,
    args: { rowId: RowKind; cursor: string },
  ): Promise<RowContentResponse> {
    const fetcher = ROW_FETCHERS[args.rowId];
    if (!fetcher) {
      throw badRequest("home.bad_input", `unknown row id ${args.rowId}`);
    }
    const ctx = buildContext(userId);
    const eligible = await fetcher.isEligible(userId, ctx.dataloader);
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
      if (fetched.partial) out.partial = true;
      return out;
    } catch (err) {
      consola.error("[home] getRowContent failed:", err);
      throw internal("home.internal", "home feed unavailable");
    }
  }
}

function buildContext(userId: string) {
  const mediaService = new MediaService(userId);
  const dataloader = new RequestScopedLoader(mediaService, userId);
  return {
    userId,
    mediaService,
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
}
