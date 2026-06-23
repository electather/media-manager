import { makePipelineRow } from "../internal/pipeline";
import { similarPagedSource } from "../sources/similar-paged";
import { loadCanonicalItems } from "./_shared";

/**
 * "Similar to X" row for detail pages. Client supplies `{ seedId, seedType }` via keyset cursor,
 * so each page queries its own seed, not a generic feed. `requiresInitialCursor: true` rejects
 * cursor-less calls; `initialCursor` is null (client-supplied seed, not server-derived).
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
