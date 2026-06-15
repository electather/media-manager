import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

let db: Db;

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { oauthClient, oauthConsent, user } from "../../db/schema/auth";
import { deleteStaleDynamicClients } from "../repo";

const OWNER = "u_owner";
const NOW = Date.UTC(2026, 0, 1);
const OLD = NOW - 48 * 60 * 60 * 1000;
const RECENT = NOW - 60 * 1000;
const CUTOFF = NOW - 24 * 60 * 60 * 1000;

async function insertClient(args: {
  id: string;
  userId: string | null;
  createdAt: number;
}): Promise<void> {
  await db.insert(oauthClient).values({
    id: args.id,
    clientId: args.id,
    userId: args.userId,
    createdAt: new Date(args.createdAt),
    redirectUris: ["http://localhost/callback"],
  });
}

beforeEach(async () => {
  db = await createInMemoryDb();
  await db.insert(user).values({ id: OWNER, name: "Owner", email: "owner@example.com" });
});

afterAll(() => cleanupInMemoryDbs());

describe("deleteStaleDynamicClients", () => {
  // WHY: this is the table-growth bound for the unauthenticated RFC 7591
  // registration endpoint. A never-authorized dynamic client (no owner, no
  // consent) older than the cutoff is abandoned spam and must be reclaimed.
  it("deletes ownerless, unconsented clients older than the cutoff", async () => {
    await insertClient({ id: "c_stale", userId: null, createdAt: OLD });

    const removed = await deleteStaleDynamicClients(CUTOFF);

    expect(removed).toBe(1);
    const remaining = await db.select({ id: oauthClient.id }).from(oauthClient).all();
    expect(remaining).toHaveLength(0);
  });

  // WHY: a client mid-handshake (registered minutes ago, user about to
  // authorize) must survive — deleting it would break honest MCP first-connect.
  it("keeps recently registered clients within the TTL window", async () => {
    await insertClient({ id: "c_recent", userId: null, createdAt: RECENT });

    const removed = await deleteStaleDynamicClients(CUTOFF);

    expect(removed).toBe(0);
    const remaining = await db.select({ id: oauthClient.id }).from(oauthClient).all();
    expect(remaining.map((r) => r.id)).toEqual(["c_recent"]);
  });

  // WHY: once a user has authorized a client an `oauth_consent` row exists; the
  // sweep must never touch a connected app even if its `userId` is null.
  it("keeps old clients that have a consent row", async () => {
    await insertClient({ id: "c_consented", userId: null, createdAt: OLD });
    await db.insert(oauthConsent).values({
      id: "consent_1",
      clientId: "c_consented",
      userId: OWNER,
      scopes: ["openid"],
      createdAt: new Date(OLD),
      updatedAt: new Date(OLD),
    });

    const removed = await deleteStaleDynamicClients(CUTOFF);

    expect(removed).toBe(0);
    const remaining = await db.select({ id: oauthClient.id }).from(oauthClient).all();
    expect(remaining.map((r) => r.id)).toEqual(["c_consented"]);
  });

  // WHY: an owned client is a deliberately provisioned app, not dynamic-
  // registration spam; it must never be swept regardless of age.
  it("keeps old clients that have an owner", async () => {
    await insertClient({ id: "c_owned", userId: OWNER, createdAt: OLD });

    const removed = await deleteStaleDynamicClients(CUTOFF);

    expect(removed).toBe(0);
    const remaining = await db.select({ id: oauthClient.id }).from(oauthClient).all();
    expect(remaining.map((r) => r.id)).toEqual(["c_owned"]);
  });
});
