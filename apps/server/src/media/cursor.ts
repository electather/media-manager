/**
 * The opaque media page cursor now lives in `@nama/shared/media` (design
 * §A5) so client and server share exactly one codec (invariant V.WIRE1). This
 * file is a thin re-export so server-internal consumers that import
 * `encode` / `decode` / `Cursor` from the `media` barrel (which forwards this
 * file) keep their import unchanged (invariant V.RG1).
 */
export { encode, decode, encodeSeedCursor, type Cursor, type CursorMode } from "@nama/shared/media";
