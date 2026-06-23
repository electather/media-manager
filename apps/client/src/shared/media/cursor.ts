/**
 * Re-export of shared cursor codec (design §B1, V.WIRE1). Exception to direct-import rule:
 * design §B1 specifies this as single cursor surface for layer coherence (client/server
 * mint/inspect with exact bytes). encodeSeedCursor closes similarTo gap (§H).
 */
export { type Cursor, type CursorMode, decode, encode, encodeSeedCursor } from "@nama/shared/media";
