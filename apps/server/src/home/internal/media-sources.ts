import { voidParamsSchema, type MediaSourceId } from "@nama/shared/media";
import type { AnyMediaSourceRegistration } from "../../media";
import { ROW_PROVIDERS } from "../rows";
import type { RowProvider } from "./types";

/**
 * Surfaces home rows as `MediaSourceRegistration` so the `/api/media` resolver (design §A4)
 * composes one registry from home + watchlist barrels without importing concrete sources
 * (invariant V.RG1) and without moving row wiring out of `home/rows` + `home/internal` (V.A1).
 * Constant across home: `rateLimit=undefined` (§A7), `paramSchema=voidParamsSchema` (§A3),
 * `cursorOnNull="400"` (rejects bad/foreign cursor, invariant V.CU1).
 */
function toRegistration(provider: RowProvider): AnyMediaSourceRegistration {
  return {
    sourceId: provider.rowId as MediaSourceId,
    rateLimit: undefined,
    paramSchema: voidParamsSchema,
    cursorMode: provider.cursorMode,
    cursorOnNull: "400",
    ...(provider.requiresInitialCursor ? { requiresInitialCursor: true } : {}),
    eligibility: (ctx) => provider.eligibility(ctx),
    build: (ctx, _params, cursor) => provider.buildPipeline(ctx, cursor),
  };
}

/** Registration map keyed by `rowId` (a `MediaSourceId`), one per home row. */
export const homeMediaSources: Record<string, AnyMediaSourceRegistration> = Object.fromEntries(
  Object.values(ROW_PROVIDERS).map((provider) => [provider.rowId, toRegistration(provider)]),
);
