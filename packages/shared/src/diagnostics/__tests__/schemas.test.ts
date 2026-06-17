import { describe, expect, it } from "vite-plus/test";
import { errorListQuerySchema, sourcemapUploadSchema } from "../schemas";

const valid = { buildId: "build-1", map: '{"version":3,"mappings":"AAAA"}' };

describe("diagnostics schemas — sourcemapUploadSchema fileName", () => {
  it("accepts a Vite content-hashed bundle basename", () => {
    expect(sourcemapUploadSchema.safeParse({ ...valid, fileName: "index-abc123.js" }).success).toBe(
      true,
    );
    expect(sourcemapUploadSchema.safeParse({ ...valid, fileName: "chunk.mjs" }).success).toBe(true);
  });

  it("rejects traversal- and wildcard-shaped names so the field stays a bundle filename", () => {
    // The field is semantically a JS bundle basename; reject anything that
    // looks like a path or a glob even though the store parameterises the query.
    // A literal space is rejected too — Vite-hashed basenames never contain one,
    // and allowing it widened the surface for free.
    for (const fileName of [
      "../../etc/passwd",
      "*",
      "   ",
      "index.js/../evil",
      "map.txt",
      "index abc.js",
    ]) {
      expect(sourcemapUploadSchema.safeParse({ ...valid, fileName }).success).toBe(false);
    }
  });
});

describe("diagnostics schemas — errorListQuerySchema search filter", () => {
  it("accepts a search string within the 200-char cap", () => {
    expect(errorListQuerySchema.safeParse({ search: "TypeError" }).success).toBe(true);
    expect(errorListQuerySchema.safeParse({ search: "x".repeat(200) }).success).toBe(true);
  });

  it("accepts an omitted search filter", () => {
    expect(errorListQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects a search string over the 200-char cap so a scripted caller cannot pass an unbounded string into the server-side query", () => {
    expect(errorListQuerySchema.safeParse({ search: "x".repeat(201) }).success).toBe(false);
  });
});
