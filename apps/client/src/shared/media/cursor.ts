/**
 * Client re-export of the one shared cursor codec (design §B1, invariant
 * V.WIRE1). Importing through this module keeps the layer's surface coherent —
 * the client mints and inspects cursors with the exact bytes the server
 * resolver decodes.
 *
 * NOTE: CLAUDE.md prefers importing shared symbols directly over a local
 * re-export shim. Design §B1 specifies this module as the layer's single cursor
 * surface, so it is retained as a deliberate, documented exception — see the
 * acknowledgement in the design doc §B1.
 *
 * `encodeSeedCursor` closes the `similarTo` seed-cursor gap (consolidation §H):
 * the detail page's "More like this" row builds the seeded row's initial cursor
 * with the same helper the server `similar-paged` source uses (see
 * `features/media-detail/lib/related-items.ts`), so the client-built cursor is
 * accepted by the resolver's `decode` unchanged.
 */
export {
  type Cursor,
  type CursorMode,
  decode,
  encode,
  encodeSeedCursor,
} from "@ent-mcp/shared/media";
