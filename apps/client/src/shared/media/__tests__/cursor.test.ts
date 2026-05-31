import { describe, expect, it } from "vite-plus/test";
import { type Cursor, type CursorMode, decode, encode, encodeSeedCursor } from "../cursor";

describe("shared media cursor re-export", () => {
  it("round-trips an offset cursor through encode/decode", () => {
    const cursor: Cursor = { mode: "offset", n: 5 };
    expect(decode(encode(cursor))).toEqual(cursor);
  });

  it("builds a similarTo seed cursor the resolver accepts (strict keyset decode)", () => {
    // The home `similarTo` source is `cursorOnNull: "throw"` → the resolver
    // decodes its cursor STRICTLY against the keyset mode. A client-built seed
    // cursor must survive that decode unchanged (closes the consolidation §H
    // gap) and carry the seed payload the home-private `decodeSeedToken` parses.
    const raw = encodeSeedCursor({ seedId: "603", seedType: "movie" });
    const mode: CursorMode = "keyset";
    const decoded = decode(raw, mode);
    expect(decoded).not.toBeNull();
    expect(decoded?.mode).toBe("keyset");
    const payload = JSON.parse((decoded as { mode: "keyset"; k: string }).k) as unknown;
    expect(payload).toEqual({ seedId: "603", seedType: "movie", offset: 0 });
  });

  it("rejects a foreign-mode decode to null (V.CU1)", () => {
    const raw = encodeSeedCursor({ seedId: "1", seedType: "tv" });
    expect(decode(raw, "offset")).toBeNull();
  });
});
