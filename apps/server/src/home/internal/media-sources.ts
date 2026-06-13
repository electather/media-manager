import { voidParamsSchema, type MediaSourceId } from "@nama/shared/media";
import type { AnyMediaSourceRegistration } from "../../media";
import { ROW_PROVIDERS } from "../rows";
import type { RowProvider } from "./types";

/**
 * Surface every home row as a `MediaSourceRegistration` so the `/api/media`
 * resolver (design §A4) can compose one registry from the home + watchlist
 * barrels — WITHOUT `media` importing a concrete source (invariant V.RG1) and
 * WITHOUT any home composition logic moving (invariant V.A1: the row wiring
 * stays in `home/rows` + `home/internal`; this only re-packages it through the
 * barrel).
 *
 * Thin lift: each `RowProvider` already carries `eligibility` / `cursorMode` /
 * `requiresInitialCursor` and assembles its pipeline pieces via `buildPipeline`.
 * Three policy fields are constant across home:
 *  - `rateLimit: undefined` — the home feed has no per-user limiter today (§A7).
 *  - `paramSchema: voidParamsSchema` — home rows take no query params; the only
 *    input is the opaque cursor (the seed for `becauseYouWatched` / `similarTo`
 *    rides inside it), which the resolver decodes separately (§A3).
 *  - `cursorOnNull: "400"` — the home feed rejects a bad/foreign cursor with 400
 *    (invariant V.CU1), mirroring today's `composeRowPage`.
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
