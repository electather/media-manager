import { describe, it, expect } from "vite-plus/test";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import { isPluginError } from "@ent-mcp/plugin-sdk";
import {
  LibraryAvailabilityV1,
  ContinueWatchingV1,
  PlaybackSessionsV1,
  LibraryAdminV1,
  PlaybackV1,
  WatchHistoryV1,
  IdResolveV1,
} from "@ent-mcp/plugin-sdk";
import plexPlugin from "../plugin";

// Minimal fake ctx that feeds a queue of responses to `ctx.fetch` and records
// every outbound call for assertion. Mirrors the shape used by the trakt
// behaviour tests in ../__tests__/capability-behavior.test.ts so both suites
// stay consistent.
interface FakeCall {
  url: string;
  init?: RequestInit;
}

function makeCtx(
  responses: Array<Response | Error>,
  overrides: Partial<PluginContext> = {},
): PluginContext & { calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  const ctx = {
    calls,
    async fetch(url: string, init?: RequestInit) {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error(`unexpected fetch: ${url}`);
      if (next instanceof Error) throw next;
      return next;
    },
    log: { debug() {}, info() {}, warn() {}, error() {} },
    credentials: { authToken: "token-123" },
    sharedCredentials: null,
    config: {
      global: null,
      user: {
        machineIdentifier: "abc123",
        externalServerUrl: "https://plex.example.com",
        internalServerUrl: "http://plex:32400",
        plexAccountId: "42",
      },
    },
    store: {
      async get() {
        return undefined;
      },
      async set() {},
      async delete() {},
    },
    pool: { markExhausted() {} },
    appBaseUrl: "https://app.example.com",
    ...overrides,
  } as unknown as PluginContext & { calls: FakeCall[] };
  return ctx;
}

function jsonRes(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function statusRes(status: number, body: string = ""): Response {
  const nullBody = status === 204 || status === 205 || status === 304;
  return new Response(nullBody ? null : body, { status });
}

// Builds a minimal Plex metadata row that satisfies the toLibraryItem /
// toItemShape mappers. Extending it is cheaper than keeping per-test literals
// in sync with PlexMetadata.
function metaFixture(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ratingKey: "1000",
    key: "/library/metadata/1000",
    type: "movie",
    title: "Example",
    Media: [{ videoResolution: "1080", videoCodec: "h264", bitrate: 8000 }],
    Guid: [{ id: "tmdb://550" }, { id: "imdb://tt0137523" }],
    duration: 9000000,
    addedAt: 1700000000,
    ...overrides,
  };
}

describe("plex manifest", () => {
  it("declares oauth_device auth, non-poolable, plex.tv allow-floor", () => {
    expect(plexPlugin.manifest.auth.kind).toBe("oauth_device");
    expect(plexPlugin.manifest.poolable).toBe(false);
    expect(plexPlugin.manifest.allowedHosts).toEqual(["plex.tv"]);
  });

  it("declares every expected user-scoped capability", () => {
    expect(Object.keys(plexPlugin.manifest.capabilities).sort()).toEqual(
      [
        "libraryAvailability",
        "playback",
        "playbackSessions",
        "continueWatching",
        "watchHistory",
        "libraryAdmin",
        "idResolve",
      ].sort(),
    );
    for (const cap of Object.values(plexPlugin.manifest.capabilities)) {
      expect(cap.scope).toBe("user");
    }
  });

  it("marks internalServerUrl as x-allowed-host AND x-private", () => {
    const props = (plexPlugin.manifest.userConfigSchema as { properties: Record<string, unknown> })
      .properties;
    const internal = props["internalServerUrl"] as Record<string, unknown>;
    const external = props["externalServerUrl"] as Record<string, unknown>;
    expect(external["x-allowed-host"]).toBe(true);
    expect(internal["x-allowed-host"]).toBe(true);
    expect(internal["x-private"]).toBe(true);
  });

  it("marks authToken as x-secret", () => {
    const props = (plexPlugin.manifest.credentialsSchema as { properties: Record<string, unknown> })
      .properties;
    const token = props["authToken"] as Record<string, unknown>;
    expect(token["x-secret"]).toBe(true);
  });
});

describe("plex startAuth / pollAuth", () => {
  it("startAuth creates a PIN and returns the display_code envelope", async () => {
    const ctx = makeCtx([jsonRes({ id: 999, code: "ABCD", expiresIn: 600 })]);
    const r = await plexPlugin.startAuth!(ctx, null);
    expect(r.status).toBe("display_code");
    if (r.status !== "display_code") throw new Error("unreachable");
    expect(r.code).toBe("ABCD");
    expect(r.verifyUrl).toBe("https://plex.tv/link");
    expect(r.pollState).toMatchObject({ pinId: 999, pinCode: "ABCD" });
    // Uses the POST /pins endpoint on plex.tv.
    expect(ctx.calls[0]?.url).toBe("https://plex.tv/api/v2/pins");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
    // Plex client headers are populated.
    const headers = ctx.calls[0]?.init?.headers as Record<string, string>;
    expect(headers["X-Plex-Client-Identifier"]).toBeDefined();
  });

  it("pollAuth returns pending while the PIN is unclaimed", async () => {
    const ctx = makeCtx([jsonRes({ id: 999, authToken: null })]);
    const r = await plexPlugin.pollAuth!(ctx, { pinId: 999, pinCode: "ABCD" });
    expect(r.status).toBe("pending");
  });

  it("pollAuth completes and carries machineIdentifier + plexAccountId on userConfigPatch", async () => {
    const ctx = makeCtx([
      jsonRes({ id: 999, authToken: "tok_abc" }),
      jsonRes({ id: 42, username: "omid" }),
      jsonRes([
        { clientIdentifier: "server-mid-1", provides: "server", owned: true, name: "home" },
        { clientIdentifier: "other", provides: "client" },
      ]),
    ]);
    const r = await plexPlugin.pollAuth!(ctx, { pinId: 999, pinCode: "ABCD" });
    expect(r.status).toBe("completed");
    if (r.status !== "completed") throw new Error("unreachable");
    expect(r.credentials).toEqual({ authToken: "tok_abc" });
    expect(r.userConfigPatch?.["plexAccountId"]).toBe("42");
    expect(r.userConfigPatch?.["machineIdentifier"]).toBe("server-mid-1");
  });

  it("pollAuth auto-fills externalServerUrl from the public connection, preferring non-local", async () => {
    // First-run UX: after the PIN flow the user should not also have to
    // hand-copy their server URL. When the `resources` response carries a
    // public connection URL, pollAuth stashes it on userConfigPatch.
    const ctx = makeCtx([
      jsonRes({ id: 999, authToken: "tok_abc" }),
      jsonRes({ id: 42, username: "omid" }),
      jsonRes([
        {
          clientIdentifier: "server-mid-1",
          provides: "server",
          owned: true,
          name: "home",
          connections: [
            { uri: "http://192.168.1.10:32400", local: true },
            { uri: "https://plex.example.com", local: false },
          ],
        },
      ]),
    ]);
    const r = await plexPlugin.pollAuth!(ctx, { pinId: 999, pinCode: "ABCD" });
    if (r.status !== "completed") throw new Error("unreachable");
    expect(r.userConfigPatch?.["externalServerUrl"]).toBe("https://plex.example.com");
  });

  it("pollAuth surfaces token_expired when Plex returns 404 for the PIN", async () => {
    const ctx = makeCtx([statusRes(404)]);
    const r = await plexPlugin.pollAuth!(ctx, { pinId: 999, pinCode: "ABCD" });
    expect(r.status).toBe("error");
    if (r.status !== "error") throw new Error("unreachable");
    expect(r.code).toBe("plugin.token_expired");
  });
});

describe("plex libraryAvailability.checkAvailability", () => {
  const cap = plexPlugin.capabilities.libraryAvailability!;

  it("routes tmdb lookups through /library/all?guid=tmdb://...", async () => {
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [metaFixture()] } })]);
    const r = (await cap.checkAvailability!(ctx, {
      id: "550",
      idType: "tmdb",
      type: "movie",
    })) as { items: unknown[] };
    expect(r.items).toHaveLength(1);
    expect(ctx.calls[0]?.url).toContain("/library/all?guid=");
    // Uses the internal URL for outbound fetches when set.
    expect(ctx.calls[0]?.url.startsWith("http://plex:32400")).toBe(true);
    // Output validates against the capability schema.
    const parsed = LibraryAvailabilityV1.methods.checkAvailability.output.safeParse(r);
    expect(parsed.success).toBe(true);
  });

  it("returns empty items for jellyfin idType without reaching Plex", async () => {
    const ctx = makeCtx([]);
    const r = (await cap.checkAvailability!(ctx, {
      id: "f00",
      idType: "jellyfin",
      type: "movie",
    })) as { items: unknown[] };
    expect(r.items).toEqual([]);
    expect(ctx.calls).toHaveLength(0);
  });

  it("treats 404 on a plex:ratingKey as no match (not error)", async () => {
    const ctx = makeCtx([statusRes(404, "not found")]);
    const r = (await cap.checkAvailability!(ctx, {
      id: "99999",
      idType: "plex",
      type: "movie",
    })) as { items: unknown[] };
    expect(r.items).toEqual([]);
  });

  it("falls back to externalServerUrl when internalServerUrl is unset", async () => {
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [metaFixture()] } })], {
      config: {
        global: null,
        user: {
          machineIdentifier: "abc123",
          externalServerUrl: "https://plex.example.com",
          plexAccountId: "42",
        },
      },
    } as Partial<PluginContext>);
    await cap.checkAvailability!(ctx, { id: "550", idType: "tmdb", type: "movie" });
    expect(ctx.calls[0]?.url.startsWith("https://plex.example.com")).toBe(true);
  });

  it("builds playerLink and webLink off the EXTERNAL URL even when internal is set", async () => {
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [metaFixture()] } })]);
    const r = (await cap.checkAvailability!(ctx, {
      id: "550",
      idType: "tmdb",
      type: "movie",
    })) as { items: Array<{ playerLink: string; webLink?: string }> };
    expect(r.items[0]?.playerLink).toContain("plex://");
    expect(r.items[0]?.playerLink).toContain(encodeURIComponent("https://plex.example.com"));
    expect(r.items[0]?.webLink?.startsWith("https://plex.example.com")).toBe(true);
    // Never the internal URL.
    expect(r.items[0]?.playerLink).not.toContain("plex%3A32400");
  });

  it("throws plugin.token_expired on 401", async () => {
    const ctx = makeCtx([statusRes(401, "no")]);
    let caught: unknown;
    try {
      await cap.checkAvailability!(ctx, { id: "550", idType: "tmdb", type: "movie" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("throws plugin.rate_limited on 429 and signals the pool", async () => {
    let exhausted = 0;
    const ctx = makeCtx([statusRes(429, "slow down")], {
      pool: {
        markExhausted() {
          exhausted += 1;
        },
      },
    });
    let caught: unknown;
    try {
      await cap.checkAvailability!(ctx, { id: "550", idType: "tmdb", type: "movie" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
    expect(exhausted).toBe(1);
  });
});

describe("plex libraryAvailability.listRecentlyAdded", () => {
  const cap = plexPlugin.capabilities.libraryAvailability!;

  it("returns a nextCursor when more rows exist past the window", async () => {
    const ctx = makeCtx([
      jsonRes({ MediaContainer: { Metadata: [metaFixture()], totalSize: 50, size: 20 } }),
    ]);
    const r = (await cap.listRecentlyAdded!(ctx, { limit: 20 })) as {
      items: unknown[];
      nextCursor?: string;
    };
    expect(r.items).toHaveLength(1);
    expect(r.nextCursor).toBe("20");
  });

  it("omits nextCursor when there is no next page", async () => {
    const ctx = makeCtx([
      jsonRes({ MediaContainer: { Metadata: [metaFixture()], totalSize: 1, size: 1 } }),
    ]);
    const r = (await cap.listRecentlyAdded!(ctx, { limit: 20 })) as {
      items: unknown[];
      nextCursor?: string;
    };
    expect(r.nextCursor).toBeUndefined();
  });

  it("rejects a non-numeric cursor with plugin.input_invalid", async () => {
    const ctx = makeCtx([]);
    let caught: unknown;
    try {
      await cap.listRecentlyAdded!(ctx, { cursor: "not-a-number" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.input_invalid");
  });
});

describe("plex libraryAvailability.searchLibrary", () => {
  const cap = plexPlugin.capabilities.libraryAvailability!;

  it("maps results through toLibraryItem", async () => {
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [metaFixture()] } })]);
    const r = (await cap.searchLibrary!(ctx, { query: "fight", type: "movie" })) as Array<{
      id: string;
      title: string;
    }>;
    expect(r).toHaveLength(1);
    expect(r[0]?.id).toBe("1000");
    expect(ctx.calls[0]?.url).toContain("/search?");
    expect(ctx.calls[0]?.url).toContain("query=fight");
    expect(ctx.calls[0]?.url).toContain("type=1");
  });

  it("propagates the caller's limit via X-Plex-Container-Size (defaulting to 50)", async () => {
    // Without this, Plex returns its server-default page of 100–500 rows and
    // silently ignores the caller's cap — broke the capability contract.
    const ctxWithLimit = makeCtx([jsonRes({ MediaContainer: { Metadata: [] } })]);
    await cap.searchLibrary!(ctxWithLimit, { query: "x", limit: 25 });
    expect(ctxWithLimit.calls[0]?.url).toContain("X-Plex-Container-Size=25");
    const ctxDefault = makeCtx([jsonRes({ MediaContainer: { Metadata: [] } })]);
    await cap.searchLibrary!(ctxDefault, { query: "x" });
    expect(ctxDefault.calls[0]?.url).toContain("X-Plex-Container-Size=50");
  });
});

describe("plex playback.getPositions", () => {
  const cap = plexPlugin.capabilities.playback!;

  it("computes progress and playbackId from viewOffset + ratingKey", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Metadata: [
            metaFixture({
              ratingKey: "1000",
              type: "movie",
              duration: 10000,
              viewOffset: 2500,
              lastViewedAt: 1700000000,
            }),
          ],
        },
      }),
    ]);
    const r = (await cap.getPositions!(ctx, {})) as Array<{
      progress: number;
      playbackId: string;
    }>;
    expect(r[0]?.progress).toBe(25);
    expect(r[0]?.playbackId).toBe("1000");
  });

  it("filters to movies when type=movie is passed", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Metadata: [metaFixture({ type: "movie" }), metaFixture({ type: "episode" })],
        },
      }),
    ]);
    const r = (await cap.getPositions!(ctx, { type: "movie" })) as unknown[];
    expect(r).toHaveLength(1);
  });

  it("output passes the capability schema", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Metadata: [metaFixture({ duration: 10000, viewOffset: 5000, lastViewedAt: 1700000000 })],
        },
      }),
    ]);
    const r = await cap.getPositions!(ctx, {});
    const parsed = PlaybackV1.methods.getPositions.output.safeParse(r);
    expect(parsed.success).toBe(true);
  });
});

describe("plex playback.removePosition", () => {
  const cap = plexPlugin.capabilities.playback!;

  it("returns ok:true on 200", async () => {
    const ctx = makeCtx([statusRes(200)]);
    const r = (await cap.removePosition!(ctx, { playbackId: "1000" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(ctx.calls[0]?.url).toContain("/:/unscrobble");
  });

  it("returns ok:true on 404 (already cleared — idempotent)", async () => {
    const ctx = makeCtx([statusRes(404)]);
    const r = (await cap.removePosition!(ctx, { playbackId: "1000" })) as { ok: boolean };
    expect(r.ok).toBe(true);
  });

  it("throws plugin.token_expired on 401", async () => {
    const ctx = makeCtx([statusRes(401)]);
    let caught: unknown;
    try {
      await cap.removePosition!(ctx, { playbackId: "1000" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("surfaces 429 as plugin.rate_limited AND signals the pool on the direct-fetch path", async () => {
    let exhausted = 0;
    const ctx = makeCtx([statusRes(429)], {
      pool: {
        markExhausted() {
          exhausted += 1;
        },
      },
    });
    let caught: unknown;
    try {
      await cap.removePosition!(ctx, { playbackId: "1000" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
    expect(exhausted).toBe(1);
  });
});

describe("plex playbackSessions.getSessions privacy guarantee", () => {
  const cap = plexPlugin.capabilities.playbackSessions!;

  it("drops sessions whose User.id does not match the connection's plexAccountId", async () => {
    const mine = {
      ...metaFixture(),
      Session: { id: "sess-1" },
      Player: { title: "iPhone", product: "Plex for iOS", state: "playing" },
      User: { id: "42", title: "omid" },
    };
    const someoneElse = {
      ...metaFixture(),
      ratingKey: "2000",
      Session: { id: "sess-2" },
      Player: { title: "AppleTV", state: "playing" },
      User: { id: "999", title: "stranger" },
    };
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [mine, someoneElse] } })]);
    const r = (await cap.getSessions!(ctx, {})) as Array<{
      sessionId: string;
      user: { id: string };
    }>;
    expect(r).toHaveLength(1);
    expect(r[0]?.sessionId).toBe("sess-1");
    expect(r[0]?.user.id).toBe("42");
  });

  it("keeps every session when plexAccountId is not cached (cannot verify ownership)", async () => {
    const s = {
      ...metaFixture(),
      Session: { id: "sess-x" },
      Player: { title: "web", state: "playing" },
      User: { id: "77", title: "other" },
    };
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [s] } })], {
      config: {
        global: null,
        user: {
          machineIdentifier: "abc",
          externalServerUrl: "https://plex.example.com",
        },
      },
    } as Partial<PluginContext>);
    const r = (await cap.getSessions!(ctx, {})) as unknown[];
    expect(r).toHaveLength(1);
  });

  it("surfaces the transcode decision when the server is transcoding", async () => {
    const s = {
      ...metaFixture(),
      Session: { id: "sess-t" },
      Player: { title: "phone", state: "playing" },
      User: { id: "42", title: "omid" },
      TranscodeSession: {
        videoDecision: "transcode",
        audioDecision: "copy",
        targetBitrate: 4000,
        transcodeReason: "codec mismatch",
      },
    };
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [s] } })]);
    const r = (await cap.getSessions!(ctx, {})) as Array<{
      transcoding?: { videoDecision: string; targetBitrate?: number };
    }>;
    expect(r[0]?.transcoding?.videoDecision).toBe("transcode");
    expect(r[0]?.transcoding?.targetBitrate).toBe(4000);
    const parsed = PlaybackSessionsV1.methods.getSessions.output.safeParse(r);
    expect(parsed.success).toBe(true);
  });
});

describe("plex playbackSessions.stopSession", () => {
  const cap = plexPlugin.capabilities.playbackSessions!;

  it("returns forced semantics and ok:true on 200", async () => {
    const ctx = makeCtx([statusRes(200)]);
    const r = (await cap.stopSession!(ctx, { sessionId: "s-1" })) as {
      ok: boolean;
      semantics: string;
    };
    expect(r.ok).toBe(true);
    expect(r.semantics).toBe("forced");
    expect(ctx.calls[0]?.url).toContain("/status/sessions/terminate");
    expect(ctx.calls[0]?.init?.method).toBe("DELETE");
  });

  it("treats 404 as idempotent success (session already ended)", async () => {
    const ctx = makeCtx([statusRes(404)]);
    const r = (await cap.stopSession!(ctx, { sessionId: "s-1" })) as { ok: boolean };
    expect(r.ok).toBe(true);
  });

  it("surfaces 429 as plugin.rate_limited AND signals the pool", async () => {
    let exhausted = 0;
    const ctx = makeCtx([statusRes(429)], {
      pool: {
        markExhausted() {
          exhausted += 1;
        },
      },
    });
    let caught: unknown;
    try {
      await cap.stopSession!(ctx, { sessionId: "s-1" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
    expect(exhausted).toBe(1);
  });
});

describe("plex continueWatching.getContinueWatching", () => {
  const cap = plexPlugin.capabilities.continueWatching!;

  it("falls back to /library/onDeck when /hubs/continueWatching 404s", async () => {
    const ctx = makeCtx([
      statusRes(404, "no hub"),
      jsonRes({ MediaContainer: { Metadata: [metaFixture({ viewOffset: 5000 })] } }),
    ]);
    const r = (await cap.getContinueWatching!(ctx, {})) as unknown[];
    expect(r).toHaveLength(1);
    expect(ctx.calls[0]?.url).toContain("/hubs/continueWatching");
    expect(ctx.calls[1]?.url).toContain("/library/onDeck");
  });

  it("output passes the capability schema", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Metadata: [metaFixture({ viewOffset: 2500, lastViewedAt: 1700000000 })],
        },
      }),
    ]);
    const r = await cap.getContinueWatching!(ctx, {});
    const parsed = ContinueWatchingV1.methods.getContinueWatching.output.safeParse(r);
    expect(parsed.success).toBe(true);
  });
});

describe("plex watchHistory", () => {
  const cap = plexPlugin.capabilities.watchHistory!;

  it("addToHistory only calls /:/scrobble for items with a resolvable ratingKey", async () => {
    const ctx = makeCtx([statusRes(200)]);
    const r = (await cap.addToHistory!(ctx, [
      { ids: { plex_ratingKey: "1234" }, type: "movie" },
      { type: "movie", ids: {} }, // no ratingKey — dropped
    ])) as { added: number };
    expect(r.added).toBe(1);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.url).toContain("/:/scrobble");
    expect(ctx.calls[0]?.url).toContain("key=1234");
  });

  it("removeFromHistory throws plugin.token_expired on 401", async () => {
    const ctx = makeCtx([statusRes(401)]);
    let caught: unknown;
    try {
      await cap.removeFromHistory!(ctx, [{ ids: { plex_ratingKey: "1234" }, type: "movie" }]);
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });

  it("getHistory filters by the connection's plexAccountId", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Metadata: [metaFixture({ ratingKey: "10", type: "movie", viewedAt: 1700000000 })],
        },
      }),
    ]);
    const r = await cap.getHistory!(ctx, {});
    const parsed = WatchHistoryV1.methods.getHistory.output.safeParse(r);
    expect(parsed.success).toBe(true);
    expect(ctx.calls[0]?.url).toContain("accountID=42");
  });

  it("getHistory emits a literal `viewedAt>=<unix>` filter when `since` is set", async () => {
    // Regression: URLSearchParams percent-encodes `>` to `%3E`, but Plex's
    // filter syntax needs the literal `>`. The plugin builds that segment
    // manually — this verifies the on-the-wire URL matches.
    const ctx = makeCtx([jsonRes({ MediaContainer: { Metadata: [] } })]);
    const since = "2026-04-01T00:00:00.000Z";
    await cap.getHistory!(ctx, { since });
    const url = ctx.calls[0]?.url ?? "";
    const expectedTs = Math.floor(new Date(since).getTime() / 1000);
    expect(url).toContain(`viewedAt>=${expectedTs}`);
    expect(url).not.toContain("viewedAt%3E");
  });

  it("addToHistory surfaces 429 as plugin.rate_limited AND signals the pool", async () => {
    // Regression: earlier the direct-fetch path threw without calling
    // markExhausted, so the host couldn't rotate credentials for scrobble.
    let exhausted = 0;
    const ctx = makeCtx([statusRes(429, "slow down")], {
      pool: {
        markExhausted() {
          exhausted += 1;
        },
      },
    });
    let caught: unknown;
    try {
      await cap.addToHistory!(ctx, [{ ids: { plex_ratingKey: "1234" }, type: "movie" }]);
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
    expect(exhausted).toBe(1);
  });

  it("removeFromHistory surfaces 429 as plugin.rate_limited AND signals the pool", async () => {
    let exhausted = 0;
    const ctx = makeCtx([statusRes(429)], {
      pool: {
        markExhausted() {
          exhausted += 1;
        },
      },
    });
    let caught: unknown;
    try {
      await cap.removeFromHistory!(ctx, [{ ids: { plex_ratingKey: "1234" }, type: "movie" }]);
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
    expect(exhausted).toBe(1);
  });
});

describe("plex libraryAdmin", () => {
  const cap = plexPlugin.capabilities.libraryAdmin!;

  it("refreshLibrary without librarySectionId iterates every section with force=1", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Directory: [
            { key: "1", title: "Movies", type: "movie" },
            { key: "2", title: "TV", type: "show" },
          ],
        },
      }),
      statusRes(200),
      statusRes(200),
    ]);
    const r = (await cap.refreshLibrary!(ctx, {})) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(ctx.calls[1]?.url).toContain("/library/sections/1/refresh?force=1");
    expect(ctx.calls[2]?.url).toContain("/library/sections/2/refresh?force=1");
    const parsed = LibraryAdminV1.methods.refreshLibrary.output.safeParse(r);
    expect(parsed.success).toBe(true);
  });

  it("refreshLibrary with a section id hits exactly that section without force=1", async () => {
    const ctx = makeCtx([statusRes(200)]);
    const r = (await cap.refreshLibrary!(ctx, { librarySectionId: "1" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.url).toContain("/library/sections/1/refresh");
    expect(ctx.calls[0]?.url).not.toContain("force=1");
  });

  it("refreshLibrary without a section id signals the pool when any section returns 429", async () => {
    // `Promise.allSettled` over `plexServerFetch` swallows 429 into a
    // `fulfilled` result (the fetch never throws), so the post-settle
    // scan must notice it and call `ctx.pool.markExhausted`. `ok` still
    // reflects the aggregate success/failure of the refresh.
    let exhausted = 0;
    const ctx = makeCtx(
      [
        jsonRes({
          MediaContainer: {
            Directory: [
              { key: "1", title: "Movies", type: "movie" },
              { key: "2", title: "TV", type: "show" },
            ],
          },
        }),
        statusRes(200),
        statusRes(429),
      ],
      {
        pool: {
          markExhausted() {
            exhausted += 1;
          },
        },
      },
    );
    const r = (await cap.refreshLibrary!(ctx, {})) as { ok: boolean };
    expect(r.ok).toBe(false);
    expect(exhausted).toBe(1);
  });

  it("refreshItem uses PUT /library/metadata/{id}/refresh", async () => {
    const ctx = makeCtx([statusRes(200)]);
    const r = (await cap.refreshItem!(ctx, { serverItemId: "555" })) as { ok: boolean };
    expect(r.ok).toBe(true);
    expect(ctx.calls[0]?.init?.method).toBe("PUT");
    expect(ctx.calls[0]?.url).toContain("/library/metadata/555/refresh");
  });

  it("refreshLibrary single-section 429 surfaces rate_limited AND signals the pool", async () => {
    let exhausted = 0;
    const ctx = makeCtx([statusRes(429)], {
      pool: {
        markExhausted() {
          exhausted += 1;
        },
      },
    });
    let caught: unknown;
    try {
      await cap.refreshLibrary!(ctx, { librarySectionId: "1" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
    expect(exhausted).toBe(1);
  });

  it("refreshItem 429 surfaces rate_limited AND signals the pool", async () => {
    let exhausted = 0;
    const ctx = makeCtx([statusRes(429)], {
      pool: {
        markExhausted() {
          exhausted += 1;
        },
      },
    });
    let caught: unknown;
    try {
      await cap.refreshItem!(ctx, { serverItemId: "555" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.rate_limited");
    expect(exhausted).toBe(1);
  });
});

describe("plex idResolve", () => {
  const cap = plexPlugin.capabilities.idResolve!;

  it("resolves a tmdb id to the plex ratingKey + adjacent guids", async () => {
    const ctx = makeCtx([
      jsonRes({
        MediaContainer: {
          Metadata: [
            {
              ...metaFixture({ ratingKey: "4242" }),
              Guid: [{ id: "tmdb://550" }, { id: "imdb://tt0137523" }, { id: "tvdb://12345" }],
            },
          ],
        },
      }),
    ]);
    const r = (await cap.resolve!(ctx, { from: "tmdb", id: "550", type: "movie" })) as Record<
      string,
      string
    >;
    expect(r["plex:ratingKey"]).toBe("4242");
    expect(r["tmdb"]).toBe("550");
    expect(r["imdb"]).toBe("tt0137523");
    expect(r["tvdb"]).toBe("12345");
    const parsed = IdResolveV1.methods.resolve.output.safeParse(r);
    expect(parsed.success).toBe(true);
  });

  it("returns {} for Trakt ids (Plex doesn't index them)", async () => {
    const ctx = makeCtx([]);
    const r = (await cap.resolve!(ctx, { from: "trakt", id: "1", type: "movie" })) as Record<
      string,
      string
    >;
    expect(r).toEqual({});
    expect(ctx.calls).toHaveLength(0);
  });

  it("returns {} for jellyfin:itemId (cross-server id has no Plex anchor)", async () => {
    const ctx = makeCtx([]);
    const r = (await cap.resolve!(ctx, {
      from: "jellyfin:itemId",
      id: "abc",
      type: "movie",
    })) as Record<string, string>;
    expect(r).toEqual({});
  });

  it("returns {} when the caller's plex:ratingKey is unknown (404)", async () => {
    const ctx = makeCtx([statusRes(404, "nope")]);
    const r = (await cap.resolve!(ctx, {
      from: "plex:ratingKey",
      id: "99999",
      type: "movie",
    })) as Record<string, string>;
    expect(r).toEqual({});
  });
});

describe("plex contract: every declared capability method reaches Plex through ctx.fetch", () => {
  // Walks through the manifest, invokes each method with a trivial happy-path
  // response, and asserts the outbound URL is the expected Plex endpoint. This
  // catches regressions where a method forgets to use plexServerFetch / picks
  // the wrong base URL.
  const cases: Array<{
    name: string;
    mock: Response[];
    call: (ctx: PluginContext) => Promise<unknown>;
    expectUrl: RegExp;
  }> = [
    {
      name: "libraryAvailability.checkAvailability",
      mock: [jsonRes({ MediaContainer: { Metadata: [] } })],
      call: (ctx) =>
        plexPlugin.capabilities.libraryAvailability!.checkAvailability!(ctx, {
          id: "550",
          idType: "tmdb",
          type: "movie",
        }),
      expectUrl: /\/library\/all\?guid=/,
    },
    {
      name: "libraryAvailability.listRecentlyAdded",
      mock: [jsonRes({ MediaContainer: { Metadata: [] } })],
      call: (ctx) =>
        plexPlugin.capabilities.libraryAvailability!.listRecentlyAdded!(ctx, { limit: 10 }),
      expectUrl: /\/library\/recentlyAdded\?/,
    },
    {
      name: "libraryAvailability.searchLibrary",
      mock: [jsonRes({ MediaContainer: { Metadata: [] } })],
      call: (ctx) =>
        plexPlugin.capabilities.libraryAvailability!.searchLibrary!(ctx, { query: "x" }),
      expectUrl: /\/search\?/,
    },
    {
      name: "playback.getPositions",
      mock: [jsonRes({ MediaContainer: { Metadata: [] } })],
      call: (ctx) => plexPlugin.capabilities.playback!.getPositions!(ctx, {}),
      expectUrl: /\/library\/onDeck/,
    },
    {
      name: "playbackSessions.getSessions",
      mock: [jsonRes({ MediaContainer: { Metadata: [] } })],
      call: (ctx) => plexPlugin.capabilities.playbackSessions!.getSessions!(ctx, {}),
      expectUrl: /\/status\/sessions/,
    },
    {
      name: "continueWatching.getContinueWatching",
      mock: [jsonRes({ MediaContainer: { Metadata: [] } })],
      call: (ctx) =>
        plexPlugin.capabilities.continueWatching!.getContinueWatching!(ctx, { limit: 10 }),
      expectUrl: /\/hubs\/continueWatching\?/,
    },
    {
      name: "watchHistory.getHistory",
      mock: [jsonRes({ MediaContainer: { Metadata: [] } })],
      call: (ctx) => plexPlugin.capabilities.watchHistory!.getHistory!(ctx, {}),
      expectUrl: /\/status\/sessions\/history\/all\?/,
    },
    {
      name: "libraryAdmin.refreshItem",
      mock: [statusRes(200)],
      call: (ctx) => plexPlugin.capabilities.libraryAdmin!.refreshItem!(ctx, { serverItemId: "1" }),
      expectUrl: /\/library\/metadata\/1\/refresh/,
    },
  ];

  for (const c of cases) {
    it(c.name, async () => {
      const ctx = makeCtx(c.mock);
      await c.call(ctx);
      expect(ctx.calls[0]?.url).toMatch(c.expectUrl);
    });
  }
});
