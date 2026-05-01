import { describe, it, expect } from "vite-plus/test";
import {
  MEDIA_ID_REGEX,
  mediaGetInputSchema,
  mediaGetManyInputSchema,
} from "@ent-mcp/shared/media";
import { peekSchema } from "../lib/peek-schema";

/**
 * Regex single-source guard (V90). Every consumer of the composite-id regex
 * must read it through `@ent-mcp/shared/media` so a future format change
 * touches one constant.
 */
describe("MEDIA_ID_REGEX single source", () => {
  it("peekSchema accepts movie:550", () => {
    expect(peekSchema.parse({ peek: "movie:550" }).peek).toBe("movie:550");
  });

  it("peekSchema rejects malformed ids", () => {
    expect(() => peekSchema.parse({ peek: "movie:abc" })).toThrow();
  });

  it("media.get + getMany input schemas accept the same shape as peek", () => {
    expect(mediaGetInputSchema.parse({ id: "tv:1396" }).id).toBe("tv:1396");
    expect(mediaGetManyInputSchema.parse({ ids: ["movie:1"] }).ids).toEqual(["movie:1"]);
  });

  it("MEDIA_ID_REGEX matches both movie and tv composite ids", () => {
    expect(MEDIA_ID_REGEX.test("movie:550")).toBe(true);
    expect(MEDIA_ID_REGEX.test("tv:1396")).toBe(true);
    expect(MEDIA_ID_REGEX.test("series:1")).toBe(false);
  });
});
