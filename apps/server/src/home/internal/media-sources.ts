import { voidParamsSchema, type MediaSourceId } from "@nama/shared/media";
import type { AnyMediaSourceRegistration } from "../../media";
import { ROW_PROVIDERS } from "../rows";
import type { RowProvider } from "./types";

// Surfaces home rows as MediaSourceRegistration so /api/media (design §A4)
// composes one registry without importing concrete sources (V.RG1) or moving
// row wiring (V.A1). Constants: rateLimit=undefined (§A7), paramSchema=void
// (§A3), cursorOnNull="400" rejects bad cursor (V.CU1).
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
