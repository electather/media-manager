import { voidParamsSchema, type MediaSourceId } from "@nama/shared/media";
import type { AnyMediaSourceRegistration } from "../../media";
import { ROW_PROVIDERS } from "../rows";
import type { RowProvider } from "./types";

// Surfaces home rows as MediaSourceRegistration so /api/media resolver (design §A4) composes registry from home + watchlist barrels.
// Preserves invariants V.RG1 (media never imports concrete source) and V.A1 (row wiring stays in home/rows + home/internal).
// Constant fields across home: rateLimit=undefined (no per-user limiter, §A7), paramSchema=voidParamsSchema (no query params, cursor decoded by resolver §A3), cursorOnNull="400" (rejects bad cursor, invariant V.CU1).
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
