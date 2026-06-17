import { describe, expect, it } from "vite-plus/test";
import {
  errorListQuerySchema,
  perfAggregateQuerySchema,
  perfListQuerySchema,
  sourcemapUploadSchema,
} from "../schemas";

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

describe("diagnostics schemas — admin viewer requestId filter", () => {
  // requestId flows straight into `eq(records.requestId, q.requestId)` server-side,
  // so the schema is the real fence against a scripted caller pushing an unbounded
  // or malformed string. It must match the server's canonical request-id shape.
  const querySchemas = {
    errorListQuerySchema,
    perfListQuerySchema,
    perfAggregateQuerySchema,
  } as const;

  for (const [name, schema] of Object.entries(querySchemas)) {
    it(`${name} accepts a canonical request id`, () => {
      expect(schema.safeParse({ requestId: "req-AbC_123" }).success).toBe(true);
    });

    it(`${name} accepts an omitted request id`, () => {
      expect(schema.safeParse({}).success).toBe(true);
    });

    it(`${name} rejects a request id over the 64-char cap`, () => {
      expect(schema.safeParse({ requestId: "x".repeat(65) }).success).toBe(false);
    });

    it(`${name} rejects request ids with characters outside the canonical shape`, () => {
      for (const requestId of ["has space", "semi;colon", "../traversal", "wild*card"]) {
        expect(schema.safeParse({ requestId }).success).toBe(false);
      }
    });
  }
});
