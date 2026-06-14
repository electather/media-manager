import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import type { HomeLayoutResponse } from "@nama/shared/home";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { homeLayoutCache } from "../../db/schema/home";

vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const { CURRENT_SCHEMA_VERSION, isEmptyLayout, isFresh, read, write } =
  await import("../internal/layout-cache");

let db: Db;

beforeAll(async () => {
  db = await createInMemoryDb();
  await db.insert(user).values({
    id: "u1",
    name: "u1",
    email: "u1@test",
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(() => cleanupInMemoryDbs());

function layout(generatedAt = Date.now()): HomeLayoutResponse {
  return { hero: null, rows: [], generatedAt };
}

describe("layout-cache", () => {
  it("read returns null on cold miss", async () => {
    expect(await read("missing", db)).toBeNull();
  });

  it("write upserts and read echoes the blob back", async () => {
    const blob: HomeLayoutResponse = {
      hero: { slides: [] },
      rows: [],
      generatedAt: 1_700_000_000_000,
    };
    await write("u1", blob, db);
    const got = await read("u1", db);
    expect(got).not.toBeNull();
    expect(got!.layout).toEqual(blob);
    expect(got!.generatedAt).toBe(1_700_000_000_000);
  });

  it("isFresh boundary: <60min fresh, >=60min stale", () => {
    const now = 2_000_000_000_000;
    expect(isFresh({ layout: layout(), generatedAt: now - 59 * 60_000 }, now)).toBe(true);
    expect(isFresh({ layout: layout(), generatedAt: now - 61 * 60_000 }, now)).toBe(false);
  });

  it("read returns null on schema_version mismatch", async () => {
    await db
      .insert(homeLayoutCache)
      .values({
        userId: "u1",
        schemaVersion: CURRENT_SCHEMA_VERSION + 99,
        blob: JSON.stringify(layout()),
        generatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: homeLayoutCache.userId,
        set: {
          schemaVersion: CURRENT_SCHEMA_VERSION + 99,
          blob: JSON.stringify(layout()),
          generatedAt: Date.now(),
        },
      });
    expect(await read("u1", db)).toBeNull();
  });

  it("isEmptyLayout is true for a hero-less, row-less layout and false otherwise", () => {
    expect(isEmptyLayout({ hero: null, rows: [], generatedAt: Date.now() })).toBe(true);
    expect(isEmptyLayout({ hero: { slides: [] }, rows: [], generatedAt: Date.now() })).toBe(false);
    expect(
      isEmptyLayout({
        hero: null,
        rows: [{ id: "r1" } as unknown as HomeLayoutResponse["rows"][number]],
        generatedAt: Date.now(),
      }),
    ).toBe(false);
  });

  // An empty cached layout is the cold-catalog state, not a stable result; it
  // must never be served back so the feed self-heals once content exists.
  it("read returns null when the stored blob is a fully-empty layout", async () => {
    await write("u1", layout(1_700_000_000_001), db);
    expect(await read("u1", db)).toBeNull();
  });

  it("read returns null on unparsable blob", async () => {
    await db
      .insert(homeLayoutCache)
      .values({
        userId: "u1",
        schemaVersion: CURRENT_SCHEMA_VERSION,
        blob: "not-json{",
        generatedAt: Date.now(),
      })
      .onConflictDoUpdate({
        target: homeLayoutCache.userId,
        set: {
          schemaVersion: CURRENT_SCHEMA_VERSION,
          blob: "not-json{",
          generatedAt: Date.now(),
        },
      });
    expect(await read("u1", db)).toBeNull();
  });
});
