import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { consola, type ConsolaInstance } from "consola";
import { and, eq } from "drizzle-orm";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { user } from "../../db/schema/auth";
import { libraryItems } from "../../db/schema/library";

// The membership sync resolves its database handle through `getDb()`. Point it
// at the real migrated in-memory database so `upsertOwned`'s
// `onConflictDoNothing` and `tombstoneMissing`'s predicate are exercised
// against actual SQLite — the no-resurrect invariant can only be proven against
// the real conflict path, never a mocked repo.
vi.mock("../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../db/client", async () => {
  const actual = await vi.importActual<typeof import("../../db/client")>("../../db/client");
  return {
    ...actual,
    getDb: () => testDb,
  };
});

// Import the code under test AFTER the mocks are registered so it binds to the
// stubbed `getDb`. The repo is imported real (NOT mocked): mocking it would
// defeat the very invariant the no-resurrect test exists to guard.
const { syncMembership } = await import("../service");
const { allKnownKeys, upsertOwned, __resetLibraryForTests } = await import("../repo");
const { asLibraryContext } = await import("../internal/context");

let testDb: Db;

const log: ConsolaInstance = consola.withTag("test");

const USER_ID = "u1";

/** Shape the `collection@v1` aggregate surfaces, as `syncMembership` consumes it. */
type CollectionFeed = { items: unknown[]; partial: boolean };

/**
 * Builds one feed entry in the `collection@v1` `{ item, addedAt }` shape that
 * `toOwnedRow` parses. `addedAt` is an ISO string so `parseItemDate` resolves a
 * real `ownedAt`.
 */
function entry(tmdbId: string, type: "movie" | "tv" = "movie", addedAt?: string) {
  return { item: { ids: { tmdb_id: tmdbId }, type }, addedAt: addedAt ?? "2024-01-01T00:00:00Z" };
}

/**
 * A media-service stub whose only sync-relevant method is `getCollectionFeed`.
 * The default resolves an empty, complete feed; callers override per test to
 * drive the membership diff. Phase-1 membership sync touches nothing else on
 * the service, so the rest is deliberately absent.
 */
function makeMediaService(feed: CollectionFeed = { items: [], partial: false }) {
  return { getCollectionFeed: vi.fn().mockResolvedValue(feed) };
}

/**
 * Builds the loose `MaybeLibraryContext` the public surface accepts. The
 * `catalog` handle is unused by phase-1 membership sync (it is carried for the
 * phase-2 hydrate path), so an empty stub is sufficient and is cast through the
 * resolver's expected type. Each call gets a fresh media-service stub.
 */
function makeCtx(feed?: CollectionFeed) {
  const mediaService = makeMediaService(feed);
  const ctx = {
    userId: USER_ID,
    mediaService: mediaService as unknown as Parameters<typeof asLibraryContext>[0]["mediaService"],
    catalog: {} as unknown as Parameters<typeof asLibraryContext>[0]["catalog"],
    log,
  };
  return { ctx, mediaService };
}

/** Reads a single library row by its composite id, or undefined when absent. */
async function rowById(id: string) {
  const rows = await testDb
    .select()
    .from(libraryItems)
    .where(and(eq(libraryItems.userId, USER_ID), eq(libraryItems.id, id)));
  return rows[0];
}

beforeAll(async () => {
  testDb = await createInMemoryDb();
  await testDb.insert(user).values({
    id: USER_ID,
    name: USER_ID,
    email: `${USER_ID}@test`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
});

afterAll(() => cleanupInMemoryDbs());

beforeEach(async () => {
  await __resetLibraryForTests(testDb);
});

describe("library membership sync (design §Sync + hydrate, phase 1)", () => {
  // IDEMPOTENT DIFF — a re-run with the identical feed must be a no-op. If the
  // diff ever stopped pre-filtering against `allKnownKeys` (e.g. blindly
  // re-inserting), the second run's `added` would be non-zero; if it tombstoned
  // on equality, `removed` would be non-zero. Both counts MUST be zero and the
  // owned rows must be byte-for-byte unchanged (same `ownedAt`, still owned).
  it("re-running with the identical feed inserts and tombstones nothing", async () => {
    const feed: CollectionFeed = {
      items: [entry("550"), entry("1400", "tv")],
      partial: false,
    };

    const first = await syncMembership(makeCtx(feed).ctx);
    expect(first).toEqual({ added: 2, partial: false, removed: 0 });
    expect(await allKnownKeys(USER_ID)).toEqual(new Set(["movie:550", "tv:1400"]));

    const before = await rowById("movie:550");
    expect(before?.owned).toBe(true);

    const second = await syncMembership(makeCtx(feed).ctx);
    expect(second).toEqual({ added: 0, partial: false, removed: 0 });

    // The pre-existing rows are untouched: same membership, same ownedAt,
    // still owned, never tombstoned.
    expect(await allKnownKeys(USER_ID)).toEqual(new Set(["movie:550", "tv:1400"]));
    const after = await rowById("movie:550");
    expect(after?.owned).toBe(true);
    expect(after?.ownedAt).toBe(before?.ownedAt);
    expect(after?.unownedAt).toBeNull();
  });

  // NO-RESURRECT — the load-bearing invariant. A key that was owned, then
  // dropped from the feed (tombstoned), MUST stay tombstoned when the feed
  // re-includes it. The tombstone survives ONLY because `upsertOwned` uses
  // `onConflictDoNothing` on the primary key. This test runs against the real
  // SQLite conflict path (repo is NOT mocked).
  //
  // It exercises the conflict TWO ways:
  //   1. End-to-end through `syncMembership`, mirroring the real lifecycle
  //      (present -> dropped -> re-included).
  //   2. A direct `upsertOwned([tombstonedKey])` call. This is the assertion
  //      that actually FAILS if `onConflictDoNothing` is ever replaced with an
  //      upsert: the service pre-filters re-included keys against
  //      `allKnownKeys`, so the full-sync path alone would never reach the
  //      conflict and could not catch a regression. Inserting the existing pk
  //      directly forces the conflict and proves it is a no-op.
  it("does not resurrect a tombstoned key when the feed re-includes it", async () => {
    // Run 1: key K1 + anchor A2 present -> both owned. The anchor keeps every
    // later feed non-empty so the tombstone sweep fires (an empty feed is a
    // no-op by design and would not tombstone anything).
    await syncMembership(
      makeCtx({
        items: [
          entry("K1", "movie", "2024-06-01T00:00:00Z"),
          entry("A2", "movie", "2024-06-01T00:00:00Z"),
        ],
        partial: false,
      }).ctx,
    );
    const owned = await rowById("movie:K1");
    expect(owned?.owned).toBe(true);
    expect(owned?.unownedAt).toBeNull();
    const originalOwnedAt = owned?.ownedAt;

    // Run 2: feed drops K1 but keeps anchor A2 -> the complete, non-empty feed
    // tombstones K1 (owned=false, unownedAt set).
    await syncMembership(
      makeCtx({ items: [entry("A2", "movie", "2024-06-01T00:00:00Z")], partial: false }).ctx,
    );
    const tombstoned = await rowById("movie:K1");
    expect(tombstoned?.owned).toBe(false);
    expect(tombstoned?.unownedAt).not.toBeNull();
    const tombstonedAt = tombstoned?.unownedAt;

    // Direct conflict: attempt to re-insert the tombstoned key as owned. With
    // `onConflictDoNothing` this returns 0 and leaves the row untouched. An
    // upsert would return 1 and flip `owned` back to true / clear `unownedAt`
    // — exactly the resurrection this invariant forbids. This call is the
    // mutation-sensitive heart of the test.
    const reinserted = await upsertOwned(
      [{ id: "movie:K1", userId: USER_ID, tmdbId: "K1", mediaType: "movie", ownedAt: Date.now() }],
      testDb,
    );
    expect(reinserted).toBe(0);
    const afterDirect = await rowById("movie:K1");
    expect(afterDirect?.owned).toBe(false);
    expect(afterDirect?.unownedAt).toBe(tombstonedAt);
    expect(afterDirect?.ownedAt).toBe(originalOwnedAt);

    // Run 3: a full feed re-including K1 (alongside the still-present anchor
    // A2) stays consistent end-to-end. The row remains owned=false and the run
    // is a no-op (both keys pre-filtered as known, already-tombstoned row not
    // re-swept).
    const third = await syncMembership(
      makeCtx({
        items: [
          entry("K1", "movie", "2024-06-01T00:00:00Z"),
          entry("A2", "movie", "2024-06-01T00:00:00Z"),
        ],
        partial: false,
      }).ctx,
    );
    const final = await rowById("movie:K1");
    expect(final?.owned).toBe(false);
    expect(final?.unownedAt).toBe(tombstonedAt);
    expect(third.added).toBe(0);
    expect(third.removed).toBe(0);
  });

  // TOMBSTONE ON REMOVAL — the direct half of the lifecycle: a key present in
  // one feed then absent from the next flips owned=false with `unownedAt`
  // populated. `removed` must count exactly that one transition. A bug that
  // hard-deleted instead of tombstoning would lose the row entirely (and so
  // lose the no-resurrect guard); this asserts the row survives, flipped.
  it("tombstones a key that leaves the feed and stamps unownedAt", async () => {
    const present = await syncMembership(
      makeCtx({ items: [entry("700"), entry("701")], partial: false }).ctx,
    );
    expect(present.added).toBe(2);

    const removed = await syncMembership(makeCtx({ items: [entry("700")], partial: false }).ctx);
    expect(removed.removed).toBe(1);

    // 700 stays owned; 701 is tombstoned, not deleted, with a timestamp.
    const kept = await rowById("movie:700");
    expect(kept?.owned).toBe(true);
    expect(kept?.unownedAt).toBeNull();

    const gone = await rowById("movie:701");
    expect(gone).toBeDefined();
    expect(gone?.owned).toBe(false);
    expect(gone?.unownedAt).not.toBeNull();
  });

  // EMPTY / ABSENT FEED — no `collection@v1` provider (or a provider that
  // disconnected) yields an empty, complete feed: the sync must be a no-op with
  // zero counts, must not throw, and CRUCIALLY must not tombstone any existing
  // owned row. An empty `feedKeys` would otherwise match every owned row in the
  // sweep and wipe the whole library on a provider outage; the sweep guard
  // forbids it. Verifies the design §Errors "no provider -> eager-seed no-op".
  it("treats an empty feed as a no-op and never tombstones existing owned rows", async () => {
    // Pre-seed owned rows from a complete feed.
    await syncMembership(makeCtx({ items: [entry("900"), entry("901")], partial: false }).ctx);

    // A later empty feed (provider gone) must leave them fully intact.
    const result = await syncMembership(makeCtx({ items: [], partial: false }).ctx);
    expect(result).toEqual({ added: 0, partial: false, removed: 0 });
    expect((await rowById("movie:900"))?.owned).toBe(true);
    expect((await rowById("movie:901"))?.owned).toBe(true);
  });

  // PARTIAL FEED — a degraded fan-out (a provider errored) surfaces
  // `partial: true` but MUST still apply the rows that did arrive and MUST NOT
  // throw. It must ALSO NOT tombstone keys merely absent from the incomplete
  // feed: absence under partial is untrusted (the missing provider may own
  // them). The degradation is reported, not swallowed; a later complete sync
  // reconciles any real removals.
  it("on a partial feed applies delivered rows but tombstones nothing absent", async () => {
    // Pre-seed two owned rows from a complete feed.
    await syncMembership(makeCtx({ items: [entry("800"), entry("801")], partial: false }).ctx);

    // Next feed is partial and omits 801 — 801 must NOT be tombstoned.
    const result = await syncMembership(makeCtx({ items: [entry("800")], partial: true }).ctx);
    expect(result.partial).toBe(true);
    expect(result.removed).toBe(0);
    expect((await rowById("movie:800"))?.owned).toBe(true);
    expect((await rowById("movie:801"))?.owned).toBe(true);
  });

  // FEED THROW — a terminal all-providers failure inside `getCollectionFeed`
  // must be swallowed at the sync boundary: the run reports `partial: true`,
  // does NOT throw to the caller, and MUST NOT tombstone the owned library.
  // The swallowed error returns `feedKeys: []` with `partial: true`; the sweep
  // guard skips the tombstone pass so a transient outage cannot wipe owned
  // rows. (Before the guard, the empty `keepKeys` matched every owned row and
  // a single outage erased the whole library — this is the regression guard.)
  it("does not tombstone the owned library when the feed errors terminally", async () => {
    // Pre-seed an owned row from a healthy feed.
    await syncMembership(makeCtx({ items: [entry("802")], partial: false }).ctx);

    // The next sync's feed call throws (all providers down).
    const { ctx, mediaService } = makeCtx();
    mediaService.getCollectionFeed.mockRejectedValueOnce(new Error("all providers failed"));

    const result = await syncMembership(ctx);
    expect(result.partial).toBe(true);
    expect(result.added).toBe(0);
    expect(result.removed).toBe(0);
    // The owned library survives the outage untouched.
    expect((await rowById("movie:802"))?.owned).toBe(true);
  });
});
