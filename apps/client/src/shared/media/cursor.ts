// fallow-ignore-file unused-file
// Reason: this layer lands before its consumer — the cursor re-export is wired into the home shell (similarTo) in US-009.
/**
 * Client re-export of the one shared cursor codec (design §B1, invariant
 * V.WIRE1). Importing through this module keeps the layer's surface coherent —
 * the client mints and inspects cursors with the exact bytes the server
 * resolver decodes.
 *
 * `encodeSeedCursor` closes the `similarTo` seed-cursor gap (consolidation §H):
 * the home detail page builds the seeded row's initial cursor with the same
 * helper the server `similar-paged` source uses, so the client-built cursor is
 * accepted by the resolver's `decode` unchanged.
 */
export {
  type Cursor,
  type CursorMode,
  decode,
  encode,
  encodeSeedCursor,
} from "@ent-mcp/shared/media";
