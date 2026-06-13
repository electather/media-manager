import { describe, it, expect, vi } from "vite-plus/test";
import { ArtworkV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx, MOVIE_RICH, TV_RICH } from "./helpers";
import fanartPlugin from "../src/plugin";

const invokeArtwork = (
  ctx: Parameters<NonNullable<typeof fanartPlugin.capabilities.artwork.getArtwork>>[0],
  input: Parameters<NonNullable<typeof fanartPlugin.capabilities.artwork.getArtwork>>[1],
) => fanartPlugin.capabilities.artwork.getArtwork!(ctx, input);

describe("fanart artwork capability contract", () => {
  it("hits /v3/movies/{tmdb} and shapes a full bundle", async () => {
    const ctx = makeCtx([jsonRes(MOVIE_RICH)]);
    const out = await invokeArtwork(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });

    expect(ctx.calls[0]?.url).toBe("https://webservice.fanart.tv/v3/movies/550");
    // Auth header — fanart's standard header-based auth, not query param.
    const headers = (ctx.calls[0]?.init?.headers ?? {}) as Record<string, string>;
    expect(headers["api-key"]).toBe("fanart-key");
    expect(ArtworkV1.methods.getArtwork.output.safeParse(out).success).toBe(true);

    const bundle = out as {
      poster: Array<{ url: string; language: string; likes?: number }>;
      backdrop: Array<{ url: string; language: string }>;
      clearLogo: Array<{ url: string; language: string }>;
      thumb: Array<{ url: string; language: string }>;
    };
    // English variant ranks above textless (higher in caller's preference)
    // even though textless has more likes; textless ranks above French.
    expect(bundle.poster[0]?.language).toBe("en");
    expect(bundle.poster[1]?.language).toBe("00");
    expect(bundle.poster[2]?.language).toBe("fr");
    expect(bundle.backdrop[0]?.url).toContain("/moviebackground/bg.jpg");
    expect(bundle.clearLogo[0]?.url).toContain("/hdmovielogo/en-logo.png");
    expect(bundle.thumb[0]?.url).toContain("/moviethumb/thumb.jpg");
  });

  it("falls back to imdb id for movies when tmdb is absent", async () => {
    const ctx = makeCtx([jsonRes(MOVIE_RICH)]);
    await invokeArtwork(ctx, {
      ids: { imdb: "tt0137523" },
      type: "movie",
      languages: ["en", "00"],
    });
    expect(ctx.calls[0]?.url).toBe("https://webservice.fanart.tv/v3/movies/tt0137523");
  });

  it("hits /v3/tv/{tvdb} for tv items", async () => {
    const ctx = makeCtx([jsonRes(TV_RICH)]);
    const out = await invokeArtwork(ctx, {
      ids: { tvdb: "12345" },
      type: "tv",
      languages: ["en", "00"],
    });
    expect(ctx.calls[0]?.url).toBe("https://webservice.fanart.tv/v3/tv/12345");
    const bundle = out as { poster: Array<{ url: string }>; backdrop: Array<{ url: string }> };
    expect(bundle.poster[0]?.url).toContain("/tvposter/en.jpg");
    expect(bundle.backdrop[0]?.url).toContain("/showbackground/bg.jpg");
  });

  it("returns an empty bundle on 404 (item absent from fanart's catalog)", async () => {
    const ctx = makeCtx([new Response("", { status: 404 })]);
    const out = await invokeArtwork(ctx, {
      ids: { tmdb: "999999" },
      type: "movie",
      languages: ["en", "00"],
    });
    expect(out).toEqual({ poster: [], backdrop: [], clearLogo: [], thumb: [] });
  });

  it("signals pool exhaustion and throws retryable on 429", async () => {
    const markExhausted = vi.fn();
    const ctx = makeCtx(
      [new Response("rate limited", { status: 429, headers: { "Retry-After": "120" } })],
      { pool: { markExhausted } },
    );
    await expect(
      invokeArtwork(ctx, { ids: { tmdb: "550" }, type: "movie", languages: ["en", "00"] }),
    ).rejects.toMatchObject({ name: "PluginError", code: "plugin.rate_limited", retryable: true });
    expect(markExhausted).toHaveBeenCalledWith({ retryAfterSec: 120 });
  });

  it("signals pool exhaustion on 503 with a default retry-after when header is missing", async () => {
    const markExhausted = vi.fn();
    const ctx = makeCtx([new Response("unavailable", { status: 503 })], {
      pool: { markExhausted },
    });
    await expect(
      invokeArtwork(ctx, { ids: { tmdb: "550" }, type: "movie", languages: ["en", "00"] }),
    ).rejects.toMatchObject({ code: "plugin.rate_limited" });
    expect(markExhausted).toHaveBeenCalledWith({ retryAfterSec: 60 });
  });

  it("maps 401 to plugin.bad_credentials so a revoked key surfaces in /connections", async () => {
    const ctx = makeCtx([new Response("unauthorized", { status: 401 })]);
    await expect(
      invokeArtwork(ctx, { ids: { tmdb: "550" }, type: "movie", languages: ["en", "00"] }),
    ).rejects.toMatchObject({ code: "plugin.bad_credentials" });
  });

  it("maps 403 to plugin.bad_credentials", async () => {
    const ctx = makeCtx([new Response("forbidden", { status: 403 })]);
    await expect(
      invokeArtwork(ctx, { ids: { tmdb: "550" }, type: "movie", languages: ["en", "00"] }),
    ).rejects.toMatchObject({ code: "plugin.bad_credentials" });
  });

  it("propagates 5xx as a non-retryable upstream error (handleHttpStatus path)", async () => {
    const ctx = makeCtx([new Response("server error", { status: 500 })]);
    const promise = invokeArtwork(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    await expect(promise).rejects.toMatchObject({ code: "plugin.upstream_error" });
    // Confirm `retryable` is not set on the thrown error — the dispatcher
    // uses the absence of an explicit `retryable: true` as the non-retryable
    // signal, so a regression to `retryable: true` would silently turn
    // transient outages into infinite retries.
    await expect(promise).rejects.not.toMatchObject({ retryable: true });
  });

  it("rejects unexpected non-2xx (e.g. 400) instead of shaping an empty bundle", async () => {
    // Regression test: a 400 with a JSON body used to slip past `handleHttpStatus`
    // and get JSON-parsed into an empty bundle, masking the upstream failure
    // as "no artwork" and poisoning the negative cache.
    const ctx = makeCtx([
      new Response(JSON.stringify({ error: "bad id" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    ]);
    await expect(
      invokeArtwork(ctx, { ids: { tmdb: "550" }, type: "movie", languages: ["en", "00"] }),
    ).rejects.toMatchObject({ code: "plugin.upstream_error" });
  });

  it("throws plugin.input_invalid without a usable id (defensive guard)", async () => {
    const ctx = makeCtx([]);
    // Movie request with only tvdb — neither tmdb nor imdb is set, so the
    // plugin's `pickId` returns undefined and the defensive guard fires.
    await expect(
      invokeArtwork(ctx, { ids: { tvdb: "1" }, type: "movie", languages: ["en", "00"] }),
    ).rejects.toMatchObject({ code: "plugin.input_invalid" });
    // No fetch should have been issued.
    expect(ctx.calls).toHaveLength(0);
  });

  it("throws plugin.bad_credentials when no shared api key is configured", async () => {
    const ctx = makeCtx([], { sharedCredentials: null });
    await expect(
      invokeArtwork(ctx, { ids: { tmdb: "550" }, type: "movie", languages: ["en", "00"] }),
    ).rejects.toMatchObject({ code: "plugin.bad_credentials" });
    expect(ctx.calls).toHaveLength(0);
  });

  it("rewrites the asset CDN origin when assetCdnPrefix is overridden", async () => {
    const ctx = makeCtx([jsonRes(MOVIE_RICH)], {
      config: {
        global: { assetCdnPrefix: "https://cdn.example.com/fanart" },
        user: undefined,
      },
    });
    const out = await invokeArtwork(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    const bundle = out as { poster: Array<{ url: string }> };
    // The origin segment is replaced; the path the mapper sees from fanart
    // is preserved 1:1 so the proxy can route the asset.
    expect(bundle.poster[0]?.url).toBe(
      "https://cdn.example.com/fanart/fanart/movies/550/movieposter/en.jpg",
    );
  });

  it("returns empty per-kind arrays when fanart only populates posters (niche title)", async () => {
    const ctx = makeCtx([
      jsonRes({
        movieposter: [
          {
            url: "https://assets.fanart.tv/fanart/movies/77/movieposter/en.jpg",
            lang: "en",
            likes: "1",
          },
        ],
      }),
    ]);
    const out = await invokeArtwork(ctx, {
      ids: { tmdb: "77" },
      type: "movie",
      languages: ["en", "00"],
    });
    const bundle = out as {
      poster: unknown[];
      backdrop: unknown[];
      clearLogo: unknown[];
      thumb: unknown[];
    };
    expect(bundle.poster).toHaveLength(1);
    // Per the spec, "asked, none found" is distinct from "didn't ask" — every
    // kind is present as an array even when fanart omits the field entirely.
    expect(bundle.backdrop).toEqual([]);
    expect(bundle.clearLogo).toEqual([]);
    expect(bundle.thumb).toEqual([]);
  });

  it("caps each kind at MAX_VARIANTS_PER_KIND variants", async () => {
    // Six entries — one over the cap; mapper must drop the sixth after sort.
    const posters = Array.from({ length: 6 }, (_, i) => ({
      url: `https://assets.fanart.tv/fanart/movies/550/movieposter/en-${i}.jpg`,
      lang: "en",
      likes: String(i + 1),
    }));
    const ctx = makeCtx([jsonRes({ movieposter: posters })]);
    const out = await invokeArtwork(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    const bundle = out as { poster: Array<{ likes?: number }> };
    expect(bundle.poster).toHaveLength(5);
    // After sort, highest-likes English variants survive.
    expect(bundle.poster[0]?.likes).toBe(6);
    expect(bundle.poster[4]?.likes).toBe(2);
  });

  it("wraps malformed JSON as plugin.upstream_error without leaking the body", async () => {
    const ctx = makeCtx([
      new Response("<html>oops</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ]);
    await expect(
      invokeArtwork(ctx, { ids: { tmdb: "550" }, type: "movie", languages: ["en", "00"] }),
    ).rejects.toMatchObject({ code: "plugin.upstream_error" });
  });

  it("treats missing/blank lang as textless ('00')", async () => {
    const ctx = makeCtx([
      jsonRes({
        movieposter: [
          {
            url: "https://assets.fanart.tv/fanart/movies/550/movieposter/anon.jpg",
            likes: "1",
            // no `lang` field at all
          },
        ],
      }),
    ]);
    const out = await invokeArtwork(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    const bundle = out as { poster: Array<{ language: string }> };
    expect(bundle.poster[0]?.language).toBe("00");
  });
});
