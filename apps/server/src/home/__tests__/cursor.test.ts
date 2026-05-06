import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";
import { decodeCursor, encodeCursor } from "../cursor";
import { HttpError } from "../../errors/http-errors";

const schema = z.object({ offset: z.number().int().min(0) });

describe("cursor codec", () => {
  it("round-trips a payload", () => {
    const cursor = encodeCursor({ offset: 12 });
    expect(decodeCursor(cursor, schema)).toEqual({ offset: 12 });
  });

  it("produces base64-url-safe output (no '+', '/', '=' padding)", () => {
    const cursor = encodeCursor({ offset: 99999 });
    expect(cursor).not.toMatch(/[+/=]/u);
  });

  it("rejects malformed base64", () => {
    expect(() => decodeCursor("@@@", schema)).toThrow(HttpError);
  });

  it("rejects malformed JSON post-decode", () => {
    const cursor = Buffer.from("not-json", "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/u, "");
    expect(() => decodeCursor(cursor, schema)).toThrow(HttpError);
  });

  it("rejects payloads outside the row's zod schema", () => {
    const cursor = encodeCursor({ offset: -1 });
    expect(() => decodeCursor(cursor, schema)).toThrow(HttpError);
  });

  it("uses code 'cursor_invalid' on rejection", () => {
    try {
      decodeCursor("@@@", schema);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).code).toBe("cursor_invalid");
      expect((err as HttpError).status).toBe(400);
    }
  });
});
