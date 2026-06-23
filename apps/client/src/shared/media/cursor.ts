/**
 * Re-export of shared cursor codec (design §B1, V.WIRE1). Deliberate exception to CLAUDE.md
 * direct-import rule — design §B1 specifies this as the single cursor surface to keep layer
 * coherent (client/server mint/inspect with exact bytes). `encodeSeedCursor` closes similarTo
 * gap (§H): detail page "More like this" uses same helper as server `similar-paged` source.
 */
export { type Cursor, type CursorMode, decode, encode, encodeSeedCursor } from "@nama/shared/media";
