import { makePipelineRow } from "../internal/pipeline";
import { similarPagedSource } from "../sources/similar-paged";
import { loadCanonicalItems } from "./_shared";

/**
 * "Similar to X" — title-specific row for the media detail page. The seed
 * `{ seedId, seedType }` rides on the keyset cursor (`similarPagedSource`),
 * constructed by the client from the detail item, so every detail page gets a
 * distinct query keyed to its own seed rather than a generic
 * recommended-for-you feed.
 *
 * `requiresInitialCursor: true` makes the orchestrator reject cursor-less
 * calls; `initialCursor` returns null because the client supplies the seed
 * rather than the server deriving it from history.
 */
const provider = makePipelineRow({
  rowId: "similarTo",
  kind: "similarTo",
  titleKey: "media_detail_section_related",
  cursorMode: similarPagedSource.stages.cursorMode,
  requiresInitialCursor: true,
  source: similarPagedSource,
  params: undefined,
  eligibility: (ctx) => ctx.mediaService.hasCapabilityProvider("metadata", "v1", "user"),
  initialCursor: async () => null,
  project: (ctx, rows) => loadCanonicalItems(ctx, rows),
});

export default provider;
