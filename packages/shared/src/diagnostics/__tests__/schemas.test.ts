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

    it(`${name} accepts a request id at exactly the 64-char cap`, () => {
      expect(schema.safeParse({ requestId: "x".repeat(64) }).success).toBe(true);
    });

    it(`${name} rejects a request id over the 64-char cap`, () => {
      expect(schema.safeParse({ requestId: "x".repeat(65) }).success).toBe(false);
    });

    it(`${name} rejects an empty request id`, () => {
      // The `{1,64}` quantifier rejects "" today; this documents that intent so a
      // future `*` typo would fail the test instead of silently widening the field.
      expect(schema.safeParse({ requestId: "" }).success).toBe(false);
    });

    it(`${name} rejects request ids with characters outside the canonical shape`, () => {
      for (const requestId of ["has space", "semi;colon", "../traversal", "wild*card"]) {
        expect(schema.safeParse({ requestId }).success).toBe(false);
      }
    });
  }
});

describe("diagnostics schemas — admin viewer pluginId filter", () => {
  // pluginId flows straight into `eq(records.pluginId, q.pluginId)` server-side
  // (errors.ts, perf.ts), so the schema is the real fence against a scripted
  // caller pushing an unbounded or malformed string past the boundary (#840).
  const querySchemas = { errorListQuerySchema, perfListQuerySchema } as const;

  for (const [name, schema] of Object.entries(querySchemas)) {
    it(`${name} accepts a canonical plugin id`, () => {
      expect(schema.safeParse({ pluginId: "trakt" }).success).toBe(true);
      expect(schema.safeParse({ pluginId: "tmdb-1" }).success).toBe(true);
    });

    it(`${name} accepts an omitted plugin id`, () => {
      expect(schema.safeParse({}).success).toBe(true);
    });

    it(`${name} accepts a plugin id at exactly the 64-char cap`, () => {
      expect(schema.safeParse({ pluginId: "a".repeat(64) }).success).toBe(true);
    });

    it(`${name} rejects a plugin id over the 64-char cap`, () => {
      expect(schema.safeParse({ pluginId: "a".repeat(65) }).success).toBe(false);
    });

    it(`${name} rejects an empty plugin id`, () => {
      // The `{1,64}` quantifier rejects "" today; this documents that intent so a
      // future `*` typo would fail the test instead of silently widening the field.
      expect(schema.safeParse({ pluginId: "" }).success).toBe(false);
    });

    it(`${name} rejects plugin ids with characters outside the lowercase slug shape`, () => {
      for (const pluginId of ["Trakt", "has space", "semi;colon", "../traversal", "wild*card"]) {
        expect(schema.safeParse({ pluginId }).success).toBe(false);
      }
    });
  }
});

describe("diagnostics schemas — perfListQuerySchema route filter", () => {
  // route flows straight into `eq(perfRecords.route, q.route)` server-side (perf.ts).
  // A length cap alone bounds the input; routes carry path/query punctuation so no
  // charset regex is applied (#840). 500 chars matches errorReportSchema.route.
  it("accepts a route within the 500-char cap", () => {
    expect(perfListQuerySchema.safeParse({ route: "/api/diagnostics/perf" }).success).toBe(true);
    expect(perfListQuerySchema.safeParse({ route: "x".repeat(500) }).success).toBe(true);
  });

  it("accepts an omitted route filter", () => {
    expect(perfListQuerySchema.safeParse({}).success).toBe(true);
  });

  it("rejects a route over the 500-char cap so a scripted caller cannot pass an unbounded string into the server-side query", () => {
    expect(perfListQuerySchema.safeParse({ route: "x".repeat(501) }).success).toBe(false);
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
