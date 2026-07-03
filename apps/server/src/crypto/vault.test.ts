import { describe, expect, it } from "vitest";
import { decrypt, encrypt } from "./vault";

const makeHexKey = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");

describe("vault", () => {
  it("round-trips plaintext", async () => {
    const key = makeHexKey();
    const ct = await encrypt("hello world", key);
    expect(await decrypt(ct, key)).toBe("hello world");
  });

  it("round-trips large plaintext without RangeError (>65 536 bytes)", async () => {
    const key = makeHexKey();
    const plaintext = "x".repeat(1_000_000);
    const ct = await encrypt(plaintext, key);
    expect(await decrypt(ct, key)).toBe(plaintext);
  });
});
