import { describe, it, expect } from "vite-plus/test";
import { PlaybackSessionsV1, LibraryAvailabilityV1 } from "@ent-mcp/plugin-sdk";
import type { PluginContext } from "@ent-mcp/plugin-sdk";
import { isPluginError } from "@ent-mcp/plugin-sdk";
import jellyfinPlugin from "../src/plugin";
import { jfItem, jsonRes, makeCtx, statusRes, type FakeCall } from "./helpers";

// ─── Manifest ────────────────────────────────────────────────────────────────

describe("jellyfin manifest", () => {
  it("declares a form-auth, non-poolable, dynamic-host plugin", () => {
    const m = jellyfinPlugin.manifest;
    expect(m.auth.kind).toBe("form");
    expect(m.poolable).toBe(false);
    expect(m.allowedHosts).toEqual([]);
    expect(m.sdkVersion).toBe("^1.0.0");
  });

  it("exposes the expected capabilities, all user-scoped", () => {
    const caps = jellyfinPlugin.manifest.capabilities;
    const expected = [
      "libraryAvailability",
      "playback",
      "playbackSessions",
      "continueWatching",
      "watchHistory",
      "libraryAdmin",
      "idResolve",
    ].sort();
    expect(Object.keys(caps).sort()).toEqual(expected);
    for (const cap of Object.values(caps)) {
      expect(cap.scope).toBe("user");
    }
  });

  it("marks external/internal URLs with x-allowed-host, and internal + password with privacy flags", () => {
    const props = (
      jellyfinPlugin.manifest.userConfigSchema as {
        properties: Record<string, Record<string, unknown>>;
      }
    ).properties;
    expect(props.externalServerUrl?.["x-allowed-host"]).toBe(true);
    expect(props.internalServerUrl?.["x-allowed-host"]).toBe(true);
    expect(props.internalServerUrl?.["x-private"]).toBe(true);
    expect(props.password?.["x-secret"]).toBe(true);
    expect(props.password?.writeOnly).toBe(true);
  });

  it("promotes the password into credentialsSchema — it must never be persisted to userConfig", () => {
    const credProps = (
      jellyfinPlugin.manifest.credentialsSchema as {
        properties: Record<string, Record<string, unknown>>;
        required: string[];
      }
    ).properties;
    expect(credProps.accessToken?.type).toBe("string");
    expect(credProps.password?.type).toBe("string");
    expect(
      (
        jellyfinPlugin.manifest.userConfigSchema as {
          required: string[];
        }
      ).required,
    ).not.toContain("password");
  });

  it("does not declare sharedCredentialsSchema — pure user-scoped", () => {
    const manifest = jellyfinPlugin.manifest as unknown as Record<string, unknown>;
    expect(manifest.sharedCredentialsSchema).toBeUndefined();
  });
});

// ─── startAuth: cached userId + URL preference ────────────────────────────────

describe("jellyfin startAuth", () => {
  it("authenticates, caches userId, and moves the password into the encrypted credentials blob", async () => {
    // The issue explicitly requires this: after auth, userId is cached on
    // userConfigPatch so no round-trip to /Users/Me is needed on every call.
    // The password is promoted into the credentials blob and stripped from
    // the persisted userConfig via `password: null`, so it is only ever
    // stored encrypted at rest.
    const ctx = makeCtx([jsonRes({ AccessToken: "new-token", User: { Id: "jf-user-42" } })]);
    const result = (await jellyfinPlugin.startAuth!(ctx, {
      externalServerUrl: "https://jellyfin.example.com",
      internalServerUrl: "http://jellyfin:8096",
      username: "alice",
      password: "s3cret",
    })) as { status: string; userConfigPatch?: Record<string, unknown>; credentials: unknown };
    expect(result.status).toBe("completed");
    expect(result.userConfigPatch).toEqual({ userId: "jf-user-42", password: null });
    expect(result.credentials).toEqual({ accessToken: "new-token", password: "s3cret" });
    expect(ctx.calls[0]?.url).toBe("http://jellyfin:8096/Users/AuthenticateByName");
  });

  it("rehydrates the password from ctx.credentials on re-auth (form edit that omits password)", async () => {
    // On an updateUserConfig re-auth, the form does not resubmit the
    // password (it lives in the encrypted credentials blob, not userConfig).
    // The host passes the prior decrypted credentials through to startAuth
    // via ctx.credentials — startAuth reads the password from there rather
    // than refusing.
    const ctx = makeCtx([jsonRes({ AccessToken: "rotated-token", User: { Id: "jf-user-42" } })], {
      credentials: { accessToken: "stale", password: "prior-pw" },
    });
    const result = (await jellyfinPlugin.startAuth!(ctx, {
      externalServerUrl: "https://jellyfin.example.com",
      internalServerUrl: "http://jellyfin:8096",
      username: "alice",
    })) as { status: string; credentials: { accessToken: string; password: string } };
    expect(result.status).toBe("completed");
    expect(result.credentials.accessToken).toBe("rotated-token");
    expect(result.credentials.password).toBe("prior-pw");
    expect(JSON.parse(ctx.calls[0]?.init?.body as string)).toEqual({
      Username: "alice",
      Pw: "prior-pw",
    });
  });

  it("falls back to /Users/Me when AuthenticateByName does not return User.Id", async () => {
    const ctx = makeCtx([jsonRes({ AccessToken: "new-token" }), jsonRes({ Id: "jf-user-99" })]);
    const result = (await jellyfinPlugin.startAuth!(ctx, {
      externalServerUrl: "https://jellyfin.example.com",
      username: "alice",
      password: "pw",
    })) as { status: string; userConfigPatch?: Record<string, unknown> };
    expect(result.status).toBe("completed");
    expect(result.userConfigPatch).toEqual({ userId: "jf-user-99", password: null });
  });

  it("returns plugin.upstream_error when the /Users/Me fallback fails", async () => {
    const ctx = makeCtx([jsonRes({ AccessToken: "new-token" }), statusRes(500, "nope")]);
    const result = (await jellyfinPlugin.startAuth!(ctx, {
      externalServerUrl: "https://jellyfin.example.com",
      username: "alice",
      password: "pw",
    })) as { status: string; code: string };
    expect(result.status).toBe("error");
    expect(result.code).toBe("plugin.upstream_error");
  });

  it("authenticates against internalServerUrl when set, not external", async () => {
    const ctx = makeCtx([jsonRes({ AccessToken: "t", User: { Id: "u" } })]);
    await jellyfinPlugin.startAuth!(ctx, {
      externalServerUrl: "https://public.example.com",
      internalServerUrl: "http://internal:8096",
      username: "alice",
      password: "pw",
    });
    expect(ctx.calls[0]?.url).toContain("http://internal:8096/Users/AuthenticateByName");
  });

  it("returns plugin.bad_credentials on 401 from AuthenticateByName", async () => {
    const ctx = makeCtx([statusRes(401, "nope")]);
    const result = (await jellyfinPlugin.startAuth!(ctx, {
      externalServerUrl: "https://jellyfin.example.com",
      username: "alice",
      password: "wrong",
    })) as { status: string; code: string };
    expect(result.status).toBe("error");
    expect(result.code).toBe("plugin.bad_credentials");
  });

  it("rejects missing credentials before any fetch (no ctx.credentials fallback)", async () => {
    const ctx = makeCtx([], { credentials: null });
    const result = (await jellyfinPlugin.startAuth!(ctx, {
      externalServerUrl: "https://jellyfin.example.com",
      username: "",
      password: "",
    })) as { status: string; code: string };
    expect(result.status).toBe("error");
    expect(result.code).toBe("plugin.input_invalid");
  });
});

describe("jellyfin testConnection", () => {
  it("returns { ok: true } when /Users/Me accepts the cached token", async () => {
    const ctx = makeCtx([jsonRes({ Id: "user-1" })]);
    const out = (await jellyfinPlugin.testConnection!(ctx)) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(ctx.calls[0]?.url).toContain("/Users/Me");
  });

  it("returns { ok: false } when /Users/Me rejects the token with 401", async () => {
    const ctx = makeCtx([statusRes(401, "unauthorized")]);
    const out = (await jellyfinPlugin.testConnection!(ctx)) as { ok: boolean; message?: string };
    expect(out.ok).toBe(false);
  });

  it("returns { ok: false } when the network call throws", async () => {
    const ctx = makeCtx([new Error("econnrefused")]);
    const out = (await jellyfinPlugin.testConnection!(ctx)) as { ok: boolean };
    expect(out.ok).toBe(false);
  });
});

// ─── fetch base URL preference ───────────────────────────────────────────────

describe("jellyfin ctx.fetch prefers internalServerUrl", () => {
  it("uses internal URL for capability calls when set", async () => {
    const ctx = makeCtx([jsonRes({ Items: [] })]);
    await jellyfinPlugin.capabilities.libraryAvailability!.searchLibrary!(ctx, {
      query: "foo",
    });
    expect(ctx.calls[0]?.url).toContain("http://jellyfin:8096/Users/user-1/Items");
  });

  it("falls back to externalServerUrl when internalServerUrl is absent", async () => {
    const ctx = makeCtx([jsonRes({ Items: [] })], {
      config: {
        global: null,
        user: {
          externalServerUrl: "https://jellyfin.example.com",
          username: "alice",
          userId: "user-1",
        },
      } as PluginContext["config"],
    });
    await jellyfinPlugin.capabilities.libraryAvailability!.searchLibrary!(ctx, {
      query: "foo",
    });
    expect(ctx.calls[0]?.url).toContain("https://jellyfin.example.com/Users/user-1/Items");
  });
});

// ─── libraryAvailability ─────────────────────────────────────────────────────

describe("jellyfin libraryAvailability", () => {
  const cap = jellyfinPlugin.capabilities.libraryAvailability!;

  it("checkAvailability (tmdb) queries AnyProviderIdEquals and maps matches", async () => {
    const ctx = makeCtx([
      jsonRes({
        Items: [
          jfItem({
            Id: "jf-99",
            Name: "Example Movie",
            Type: "Movie",
            ProviderIds: { Tmdb: "550" },
            MediaSources: [
              {
                Size: 1234,
                Bitrate: 8_000_000,
                MediaStreams: [
                  { Type: "Video", Width: 3840, Height: 2160, VideoRangeType: "HDR10" },
                ],
              },
            ],
          }),
        ],
      }),
    ]);
    const out = (await cap.checkAvailability!(ctx, {
      id: "550",
      idType: "tmdb",
      type: "movie",
    })) as { items: Array<{ id: string; quality: { resolution?: string; hdr?: string } }> };
    expect(ctx.calls[0]?.url).toContain("AnyProviderIdEquals=Tmdb.550");
    expect(out.items[0]?.id).toBe("jf-99");
    expect(out.items[0]?.quality.resolution).toBe("4k");
    expect(out.items[0]?.quality.hdr).toBe("hdr10");
    // Output should parse through the capability schema.
    const parsed = LibraryAvailabilityV1.methods.checkAvailability.output.safeParse(out);
    expect(parsed.success).toBe(true);
  });

  it("checkAvailability filters out items whose ProviderIds.Tmdb does not match (server ignored AnyProviderIdEquals)", async () => {
    // Recent Jellyfin builds (10.10+) silently drop the
    // `AnyProviderIdEquals` filter and return the full type-filtered
    // library. The plugin must re-filter on the client so the home feed's
    // `availability.hasAnyServerCopy` does not turn into a uniform `true`.
    const ctx = makeCtx([
      jsonRes({
        Items: [
          jfItem({ Id: "jf-1", ProviderIds: { Tmdb: "111" } }),
          jfItem({ Id: "jf-2", ProviderIds: { Tmdb: "550" } }),
          jfItem({ Id: "jf-3", ProviderIds: { Tmdb: "999" } }),
          jfItem({ Id: "jf-4" }),
        ],
      }),
    ]);
    const out = (await cap.checkAvailability!(ctx, {
      id: "550",
      idType: "tmdb",
      type: "movie",
    })) as { items: Array<{ id: string }> };
    expect(out.items.map((i) => i.id)).toEqual(["jf-2"]);
  });

  it("checkAvailability with idType=jellyfin hits /Items/{id} directly", async () => {
    const ctx = makeCtx([jsonRes(jfItem({ Id: "local-42", Name: "Local" }))]);
    const out = (await cap.checkAvailability!(ctx, {
      id: "local-42",
      idType: "jellyfin",
      type: "movie",
    })) as { items: Array<{ id: string }> };
    expect(ctx.calls[0]?.url).toContain("/Items/local-42");
    expect(out.items[0]?.id).toBe("local-42");
  });

  it("checkAvailability idType=jellyfin returns empty list on 404 (item removed upstream)", async () => {
    // The cached server-local id may have been deleted since the caller
    // captured it — treat as "not available", not as an error.
    const ctx = makeCtx([statusRes(404)]);
    const out = (await cap.checkAvailability!(ctx, {
      id: "gone",
      idType: "jellyfin",
      type: "movie",
    })) as { items: unknown[] };
    expect(out.items).toEqual([]);
  });

  it("checkAvailability returns empty for idType=plex (cross-server handles aren't resolvable)", async () => {
    const ctx = makeCtx([]);
    const out = (await cap.checkAvailability!(ctx, {
      id: "12345",
      idType: "plex",
      type: "movie",
    })) as { items: unknown[] };
    expect(out.items).toEqual([]);
    expect(ctx.calls).toHaveLength(0);
  });

  it("listRecentlyAdded returns an empty list cleanly when server is empty", async () => {
    const ctx = makeCtx([jsonRes([])]);
    const out = (await cap.listRecentlyAdded!(ctx, { limit: 10 })) as {
      items: unknown[];
      nextCursor?: string;
    };
    expect(out.items).toEqual([]);
    expect(out.nextCursor).toBeUndefined();
  });

  it("listRecentlyAdded emits a nextCursor when the page is saturated", async () => {
    // Asking for 2 items when the server returns 3 — the page one slice has 2
    // items and there's one left, so a nextCursor is issued.
    const ctx = makeCtx([jsonRes([jfItem({ Id: "a" }), jfItem({ Id: "b" }), jfItem({ Id: "c" })])]);
    const out = (await cap.listRecentlyAdded!(ctx, { limit: 2 })) as {
      items: Array<{ id: string }>;
      nextCursor?: string;
    };
    expect(out.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(out.nextCursor).toBe("2");
  });

  it("listRecentlyAdded returns the second page when given cursor='2'", async () => {
    // Follow-up to the paging test above: with cursor='2' the slice starts at
    // offset 2 and returns the remaining items. Exercises the read path for
    // non-first pages.
    const ctx = makeCtx([jsonRes([jfItem({ Id: "a" }), jfItem({ Id: "b" }), jfItem({ Id: "c" })])]);
    const out = (await cap.listRecentlyAdded!(ctx, { limit: 2, cursor: "2" })) as {
      items: Array<{ id: string }>;
      nextCursor?: string;
    };
    expect(out.items.map((i) => i.id)).toEqual(["c"]);
    expect(out.nextCursor).toBeUndefined();
  });

  it("searchLibrary hits /Items with SearchTerm", async () => {
    const ctx = makeCtx([jsonRes({ Items: [jfItem({ Id: "1" }), jfItem({ Id: "2" })] })]);
    const out = (await cap.searchLibrary!(ctx, {
      query: "foo",
      type: "movie",
      limit: 5,
    })) as Array<{
      id: string;
    }>;
    expect(ctx.calls[0]?.url).toContain("SearchTerm=foo");
    expect(ctx.calls[0]?.url).toContain("IncludeItemTypes=Movie");
    expect(out.map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("listAvailable returns the TMDB ids of every library item with one round-trip", async () => {
    const ctx = makeCtx([
      jsonRes({
        Items: [
          jfItem({ Id: "1", ProviderIds: { Tmdb: "550" } }),
          jfItem({ Id: "2", ProviderIds: { Tmdb: "1198994" } }),
          jfItem({ Id: "3", ProviderIds: { Imdb: "tt123" } }),
        ],
      }),
    ]);
    const out = (await cap.listAvailable!(ctx, { type: "movie" })) as { tmdbIds: string[] };
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.url).toContain("IncludeItemTypes=Movie");
    expect(ctx.calls[0]?.url).toContain("Recursive=true");
    expect(out.tmdbIds).toEqual(["550", "1198994"]);
    const parsed = LibraryAvailabilityV1.methods.listAvailable.output.safeParse(out);
    expect(parsed.success).toBe(true);
  });
});

// ─── playback ────────────────────────────────────────────────────────────────

describe("jellyfin playback", () => {
  const cap = jellyfinPlugin.capabilities.playback!;

  it("getPositions maps resumable items to MediaItemShape entries with playbackId", async () => {
    const ctx = makeCtx([
      jsonRes({
        Items: [
          jfItem({
            Id: "r1",
            Name: "A",
            Type: "Movie",
            UserData: {
              PlaybackPositionTicks: 60 * 10_000_000,
              PlayedPercentage: 42.7,
              LastPlayedDate: "2026-04-01T00:00:00.000Z",
            },
          }),
        ],
      }),
    ]);
    const out = (await cap.getPositions!(ctx, {})) as Array<{
      progress: number;
      playbackId: string;
    }>;
    expect(out).toHaveLength(1);
    expect(out[0]?.progress).toBe(43);
    expect(out[0]?.playbackId).toBe("jellyfin:r1");
  });

  it("removePosition strips the jellyfin: prefix before DELETE", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = (await cap.removePosition!(ctx, { playbackId: "jellyfin:local-42" })) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
    expect(ctx.calls[0]?.init?.method).toBe("DELETE");
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items/local-42");
  });

  it("removePosition treats 404 as idempotent success", async () => {
    const ctx = makeCtx([statusRes(404)]);
    const out = (await cap.removePosition!(ctx, { playbackId: "jellyfin:gone" })) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
  });

  it("removePosition throws plugin.token_expired on 401", async () => {
    const ctx = makeCtx([statusRes(401)]);
    let caught: unknown;
    try {
      await cap.removePosition!(ctx, { playbackId: "jellyfin:foo" });
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });
});

// ─── playbackSessions: privacy filter + remote-control semantics ─────────────

describe("jellyfin playbackSessions", () => {
  const cap = jellyfinPlugin.capabilities.playbackSessions!;

  it("getSessions filters out sessions belonging to other users — privacy guarantee", async () => {
    // Jellyfin /Sessions returns server-wide sessions for admin tokens. The
    // plugin MUST drop entries whose UserId does not match the cached
    // userConfig.userId even if the server ignores the `controllableByUserId`
    // filter hint below.
    const ctx = makeCtx([
      jsonRes([
        {
          Id: "session-mine",
          UserId: "user-1",
          UserName: "alice",
          DeviceName: "iPhone",
          Client: "Jellyfin iOS",
          StartTimeUtc: "2026-04-01T00:00:00.000Z",
          NowPlayingItem: jfItem({ Id: "nowp-1", RunTimeTicks: 60 * 10_000_000 }),
          PlayState: { PositionTicks: 30 * 10_000_000, IsPaused: false, PlayMethod: "DirectPlay" },
        },
        {
          Id: "session-other",
          UserId: "user-BAD",
          UserName: "eve",
          DeviceName: "Someone else's TV",
          NowPlayingItem: jfItem({ Id: "secret", Name: "Private" }),
          PlayState: { PositionTicks: 0, IsPaused: false },
        },
      ]),
    ]);
    const out = (await cap.getSessions!(ctx, {})) as Array<{
      sessionId: string;
      user: { id: string };
    }>;
    expect(out).toHaveLength(1);
    expect(out[0]?.sessionId).toBe("session-mine");
    expect(out[0]?.user.id).toBe("user-1");
    // Server-side payload-size filter — the request must narrow to the
    // cached user so a large server doesn't return every session over the
    // wire.
    expect(ctx.calls[0]?.url).toContain("controllableByUserId=user-1");
    // Validate against the capability schema.
    const parsed = PlaybackSessionsV1.methods.getSessions.output.safeParse(out);
    expect(parsed.success).toBe(true);
  });

  it("getSessions fills in transcoding decisions when TranscodingInfo is present", async () => {
    // Exercises the video/audio direct-play-vs-copy-vs-transcode logic in
    // getSessions (untested before). IsVideoDirect=true with a Transcode
    // play method maps video to 'copy', audio falls to 'transcode' via the
    // PlayMethod path, and the TranscodingInfo bitrate/reasons are forwarded.
    const ctx = makeCtx([
      jsonRes([
        {
          Id: "sess-tx",
          UserId: "user-1",
          UserName: "alice",
          DeviceName: "Roku",
          StartTimeUtc: "2026-04-01T00:00:00.000Z",
          NowPlayingItem: jfItem({ Id: "t1", RunTimeTicks: 60 * 10_000_000 }),
          PlayState: { PositionTicks: 0, IsPaused: false, PlayMethod: "Transcode" },
          TranscodingInfo: {
            IsVideoDirect: true,
            IsAudioDirect: false,
            Bitrate: 4_000_000,
            TranscodeReasons: ["AudioCodecNotSupported", "ContainerNotSupported"],
          },
        },
      ]),
    ]);
    const out = (await cap.getSessions!(ctx, {})) as Array<{
      transcoding?: {
        videoDecision: string;
        audioDecision: string;
        targetBitrate?: number;
        reason?: string;
      };
    }>;
    expect(out[0]?.transcoding).toEqual({
      videoDecision: "copy",
      audioDecision: "transcode",
      targetBitrate: 4000,
      reason: "AudioCodecNotSupported, ContainerNotSupported",
    });
  });

  it("getSessions drops sessions without a NowPlayingItem", async () => {
    const ctx = makeCtx([jsonRes([{ Id: "idle", UserId: "user-1", DeviceName: "TV" }])]);
    const out = (await cap.getSessions!(ctx, {})) as unknown[];
    expect(out).toEqual([]);
  });

  it("stopSession returns semantics 'requested' (remote-control, not forced)", async () => {
    // Jellyfin /Sessions/{id}/Playing/Stop is a best-effort remote-control
    // command — an offline client may ignore it. This is distinct from Plex's
    // hard terminate.
    const ctx = makeCtx([statusRes(204)]);
    const out = (await cap.stopSession!(ctx, { sessionId: "sess-1" })) as {
      ok: boolean;
      semantics: string;
    };
    expect(out.ok).toBe(true);
    expect(out.semantics).toBe("requested");
    expect(ctx.calls[0]?.url).toContain("/Sessions/sess-1/Playing/Stop");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
  });
});

// ─── continueWatching ────────────────────────────────────────────────────────

describe("jellyfin continueWatching", () => {
  const cap = jellyfinPlugin.capabilities.continueWatching!;

  it("returns an empty list when both Resume and NextUp are empty", async () => {
    const ctx = makeCtx([jsonRes({ Items: [] }), jsonRes({ Items: [] })]);
    const out = (await cap.getContinueWatching!(ctx, {})) as unknown[];
    expect(out).toEqual([]);
  });

  it("merges Resume with NextUp and carries progressMs through", async () => {
    const ctx = makeCtx([
      jsonRes({
        Items: [
          jfItem({
            Id: "resume-1",
            Type: "Episode",
            ParentIndexNumber: 1,
            IndexNumber: 2,
            RunTimeTicks: 1800 * 10_000_000,
            UserData: {
              PlaybackPositionTicks: 300 * 10_000_000,
              LastPlayedDate: "2026-04-01T00:00:00.000Z",
            },
          }),
        ],
      }),
      jsonRes({
        Items: [jfItem({ Id: "next-up-1", Type: "Episode" })],
      }),
    ]);
    const out = (await cap.getContinueWatching!(ctx, {})) as Array<{
      item: { id: string };
      progressMs?: number;
    }>;
    expect(out.map((e) => e.item.id).sort()).toEqual(["next-up-1", "resume-1"]);
    const resume = out.find((e) => e.item.id === "resume-1");
    expect(resume?.progressMs).toBe(300_000);
    // NextUp entries have no progress attached.
    expect(out.find((e) => e.item.id === "next-up-1")?.progressMs).toBeUndefined();
  });

  it("type=movie skips the NextUp request", async () => {
    const ctx = makeCtx([jsonRes({ Items: [] })]);
    await cap.getContinueWatching!(ctx, { type: "movie" });
    expect(ctx.calls).toHaveLength(1);
    expect(ctx.calls[0]?.url).toContain("/Users/user-1/Items/Resume");
  });
});

// ─── watchHistory ────────────────────────────────────────────────────────────

describe("jellyfin watchHistory", () => {
  const cap = jellyfinPlugin.capabilities.watchHistory!;

  it("addToHistory requires `jellyfin:itemId`", async () => {
    const ctx = makeCtx([]);
    let caught: unknown;
    try {
      await cap.addToHistory!(ctx, [{ type: "movie", ids: {} }]);
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.input_invalid");
  });

  it("addToHistory POSTs /Users/{userId}/PlayedItems/{itemId} per item", async () => {
    const ctx = makeCtx([statusRes(204), statusRes(204)]);
    const out = (await cap.addToHistory!(ctx, [
      { type: "movie", ids: { "jellyfin:itemId": "jf-1" } },
      { type: "tv", ids: { "jellyfin:itemId": "jf-2" } },
    ])) as { added: number };
    expect(out.added).toBe(2);
    expect(ctx.calls.map((c) => c.url).some((u) => u.includes("/PlayedItems/jf-1"))).toBe(true);
    expect(ctx.calls.map((c) => c.url).some((u) => u.includes("/PlayedItems/jf-2"))).toBe(true);
    expect(ctx.calls[0]?.init?.method).toBe("POST");
  });

  it("addToHistory fires requests in parallel (all fetches started before any resolves)", async () => {
    // Enforces Promise.all semantics: the plugin must not wait for the first
    // POST to resolve before issuing the second. Uses deferreds so the test
    // is deterministic — if the plugin serialises, the second fetch will
    // never be issued while the first is pending.
    const deferreds = [0, 1].map(() => {
      let resolve!: (v: Response) => void;
      const promise = new Promise<Response>((r) => {
        resolve = r;
      });
      return { promise, resolve };
    });
    const calls: FakeCall[] = [];
    const ctx = {
      calls,
      async fetch(url: string, init?: RequestInit) {
        calls.push({ url, init });
        return deferreds[calls.length - 1]!.promise;
      },
      log: { debug() {}, info() {}, warn() {}, error() {} },
      credentials: { accessToken: "tok", password: "pw" },
      sharedCredentials: null,
      config: {
        global: null,
        user: {
          externalServerUrl: "https://jellyfin.example.com",
          username: "alice",
          userId: "user-1",
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
    } as unknown as PluginContext;
    const p = cap.addToHistory!(ctx, [
      { type: "movie", ids: { "jellyfin:itemId": "jf-1" } },
      { type: "movie", ids: { "jellyfin:itemId": "jf-2" } },
    ]);
    // Yield so startAuth-style microtasks can schedule both fetches.
    await Promise.resolve();
    expect(calls).toHaveLength(2);
    deferreds.forEach((d) => d.resolve(statusRes(204)));
    await p;
  });

  it("removeFromHistory treats 404 as idempotent removal", async () => {
    const ctx = makeCtx([statusRes(404)]);
    const out = (await cap.removeFromHistory!(ctx, [
      { type: "movie", ids: { "jellyfin:itemId": "gone" } },
    ])) as { removed: number };
    expect(out.removed).toBe(1);
  });

  it("getHistory maps played items to cross-service MediaItemShape", async () => {
    const ctx = makeCtx([
      jsonRes({
        Items: [
          jfItem({
            Id: "played-1",
            Name: "Watched",
            Type: "Movie",
            ProviderIds: { Tmdb: "123" },
            UserData: { Played: true, LastPlayedDate: "2026-04-20T00:00:00.000Z" },
          }),
        ],
      }),
    ]);
    const out = (await cap.getHistory!(ctx, {})) as Array<{
      item: { id: string; ids: Record<string, string | undefined> };
      watchedAt: string;
    }>;
    expect(out).toHaveLength(1);
    expect(out[0]?.item.id).toBe("jellyfin:played-1");
    expect(out[0]?.item.ids.tmdb_id).toBe("123");
    expect(out[0]?.watchedAt).toBe("2026-04-20T00:00:00.000Z");
  });
});

// ─── libraryAdmin ────────────────────────────────────────────────────────────

describe("jellyfin libraryAdmin", () => {
  const cap = jellyfinPlugin.capabilities.libraryAdmin!;

  it("refreshLibrary POSTs /Library/Refresh and returns { ok: true }", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = (await cap.refreshLibrary!(ctx, {})) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(ctx.calls[0]?.url).toContain("/Library/Refresh");
    expect(ctx.calls[0]?.init?.method).toBe("POST");
  });

  it("refreshItem POSTs /Items/{id}/Refresh", async () => {
    const ctx = makeCtx([statusRes(204)]);
    const out = (await cap.refreshItem!(ctx, { serverItemId: "jf-77" })) as { ok: boolean };
    expect(out.ok).toBe(true);
    expect(ctx.calls[0]?.url).toContain("/Items/jf-77/Refresh");
  });

  it("refreshLibrary surfaces 401 as plugin.token_expired", async () => {
    const ctx = makeCtx([statusRes(401)]);
    let caught: unknown;
    try {
      await cap.refreshLibrary!(ctx, {});
    } catch (err) {
      caught = err;
    }
    expect(isPluginError(caught)).toBe(true);
    expect((caught as { code: string }).code).toBe("plugin.token_expired");
  });
});

// ─── idResolve ───────────────────────────────────────────────────────────────

describe("jellyfin idResolve", () => {
  const cap = jellyfinPlugin.capabilities.idResolve!;

  it("resolves a jellyfin:itemId to cross-service handles via ProviderIds", async () => {
    const ctx = makeCtx([
      jsonRes(jfItem({ Id: "jf-1", ProviderIds: { Tmdb: "550", Imdb: "tt001" } })),
    ]);
    const out = (await cap.resolve!(ctx, {
      from: "jellyfin:itemId",
      id: "jf-1",
      type: "movie",
    })) as Record<string, string | undefined>;
    expect(out.tmdb).toBe("550");
    expect(out.imdb).toBe("tt001");
    expect(out["jellyfin:itemId"]).toBe("jf-1");
  });

  it("resolves from tmdb via AnyProviderIdEquals and returns the first match", async () => {
    const ctx = makeCtx([
      jsonRes({
        Items: [jfItem({ Id: "local-1", ProviderIds: { Tmdb: "550", Imdb: "tt001" } })],
      }),
    ]);
    const out = (await cap.resolve!(ctx, {
      from: "tmdb",
      id: "550",
      type: "movie",
    })) as Record<string, string>;
    expect(out["jellyfin:itemId"]).toBe("local-1");
    expect(out.imdb).toBe("tt001");
    expect(ctx.calls[0]?.url).toContain("AnyProviderIdEquals=Tmdb.550");
  });

  it("returns {} for from=plex:ratingKey (cross-server handles aren't resolvable)", async () => {
    const ctx = makeCtx([]);
    const out = (await cap.resolve!(ctx, {
      from: "plex:ratingKey",
      id: "12345",
      type: "movie",
    })) as Record<string, string>;
    expect(out).toEqual({});
    expect(ctx.calls).toHaveLength(0);
  });
});
