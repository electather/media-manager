import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { sourcemaps } from "../../db/schema/infra/diagnostics";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

let db: Db;
vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

const { saveSourcemap, resolveStackTrace, resetSourcemapCache } = await import("../sourcemaps");

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  db = await createInMemoryDb();
  resetSourcemapCache();
});

/** Minimal but real sourcemap: the single segment `AASKA` maps generated
 *  line 1, column 0 onto `sources[0]` line 10, column 5 with `names[0]`.
 *  Any column on generated line 1 resolves to it via greatest-lower-bound. */
const HOME_PAGE_MAP = JSON.stringify({
  version: 3,
  file: "index-abc123.js",
  sources: ["src/features/home/home-page.tsx"],
  names: ["loadHomeRows"],
  mappings: "AASKA",
});

const MINIFIED_STACK = [
  "Error: boom",
  "    at t (https://app.example.com/assets/index-abc123.js:1:42)",
  "    at https://app.example.com/assets/vendor-zzz999.js:1:7",
].join("\n");

describe("resolveStackTrace", () => {
  it("translates a minified frame to the original file, line, column, and symbol name", async () => {
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    const resolved = await resolveStackTrace(MINIFIED_STACK, "build-1");

    expect(resolved).not.toBeNull();
    // Hashed bundle position becomes the original TSX position — this is the
    // whole point of storing hidden maps server-side.
    expect(resolved).toContain("src/features/home/home-page.tsx:10:6");
    expect(resolved).toContain("[loadHomeRows]");
    expect(resolved).not.toContain("index-abc123.js:1:42");
  });

  it("keeps frames verbatim when no map covers their bundle file", async () => {
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    const resolved = await resolveStackTrace(MINIFIED_STACK, "build-1");

    // The vendor chunk has no uploaded map, so its frame must survive
    // untouched rather than being dropped or mangled.
    expect(resolved).toContain("vendor-zzz999.js:1:7");
    expect(resolved).toContain("Error: boom");
  });

  it("returns null when not a single frame resolves, so callers store an honest null", async () => {
    const resolved = await resolveStackTrace(MINIFIED_STACK, "build-1");
    expect(resolved).toBeNull();
  });

  it("scopes the lookup to the reported buildId so stale builds never borrow newer maps", async () => {
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    const resolved = await resolveStackTrace(MINIFIED_STACK, "build-other");
    expect(resolved).toBeNull();
  });

  it("falls back to a filename-only lookup when the report carries no buildId", async () => {
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    // Vite content-hashes bundle names, so the basename alone identifies the
    // build; reports from clients that do not know their build id still resolve.
    const resolved = await resolveStackTrace(MINIFIED_STACK);
    expect(resolved).toContain("src/features/home/home-page.tsx:10:6");
  });

  it("resolves Firefox/Safari-style frames without the `at fn (...)` wrapper", async () => {
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    const resolved = await resolveStackTrace(
      "t@https://app.example.com/assets/index-abc123.js:1:42",
      "build-1",
    );
    expect(resolved).toContain("src/features/home/home-page.tsx:10:6");
  });

  it("ignores cache-busting query strings when matching the bundle file name", async () => {
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    const resolved = await resolveStackTrace(
      "    at t (https://app.example.com/assets/index-abc123.js?v=5:1:42)",
      "build-1",
    );
    expect(resolved).toContain("src/features/home/home-page.tsx:10:6");
  });

  it("keeps frames whose generated line has no mapping segment", async () => {
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    // The map only covers generated line 1; a line-2 frame must stay raw so
    // partial maps never fabricate positions.
    const stack = "    at t (https://app.example.com/assets/index-abc123.js:2:5)";
    const resolved = await resolveStackTrace(stack, "build-1");
    expect(resolved).toBeNull();
  });
});

describe("saveSourcemap", () => {
  it("rejects content that is not valid JSON", async () => {
    await expect(
      saveSourcemap({ buildId: "b", fileName: "a.js", content: "not json" }),
    ).rejects.toThrow(/not valid JSON/);
  });

  it("rejects JSON without a `mappings` field so corrupt uploads fail loudly", async () => {
    await expect(
      saveSourcemap({ buildId: "b", fileName: "a.js", content: '{"version":3}' }),
    ).rejects.toThrow(/mappings/);
  });

  it("replaces the stored map on re-upload for the same build and file", async () => {
    const oldMap = JSON.stringify({
      version: 3,
      sources: ["src/old.ts"],
      names: [],
      mappings: "AAAA",
    });
    await saveSourcemap({ buildId: "build-1", fileName: "index-abc123.js", content: oldMap });
    // Warm the parsed-map cache, then re-upload; resolution must reflect the
    // new map, proving both the upsert and the cache invalidation.
    await resolveStackTrace(MINIFIED_STACK, "build-1");
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    const rows = await db
      .select()
      .from(sourcemaps)
      .where(eq(sourcemaps.fileName, "index-abc123.js"))
      .all();
    expect(rows).toHaveLength(1);

    const resolved = await resolveStackTrace(MINIFIED_STACK, "build-1");
    expect(resolved).toContain("src/features/home/home-page.tsx:10:6");
    expect(resolved).not.toContain("src/old.ts");
  });

  it("only evicts the uploaded file's cache entry, leaving sibling maps warm", async () => {
    const otherMap = JSON.stringify({
      version: 3,
      file: "vendor-zzz999.js",
      sources: ["src/vendor.ts"],
      names: [],
      mappings: "AASKA",
    });
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });
    await saveSourcemap({ buildId: "build-1", fileName: "vendor-zzz999.js", content: otherMap });

    // Warm both bundles' parsed maps into the cache.
    await resolveStackTrace(MINIFIED_STACK, "build-1");

    // Delete the vendor row directly so a cache miss would surface as an
    // unresolved frame; then re-upload only `index-abc123.js`. Targeted
    // eviction must keep the still-warm vendor entry, so the vendor frame
    // resolves from cache even though its row is gone.
    await db.delete(sourcemaps).where(eq(sourcemaps.fileName, "vendor-zzz999.js")).run();
    await saveSourcemap({
      buildId: "build-1",
      fileName: "index-abc123.js",
      content: HOME_PAGE_MAP,
    });

    const resolved = await resolveStackTrace(MINIFIED_STACK, "build-1");
    // The vendor frame is still resolved from the warm cache entry that a full
    // `clear()` would have wiped.
    expect(resolved).toContain("src/vendor.ts");
  });
});
