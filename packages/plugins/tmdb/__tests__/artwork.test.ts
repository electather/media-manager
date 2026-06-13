import { describe, it, expect } from "vite-plus/test";
import { ArtworkV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx } from "./helpers";
import tmdbPlugin from "../src/plugin";

describe("artwork capability contract", () => {
  it("hits /{type}/{id}/images and maps to bundle", async () => {
    const ctx = makeCtx([
      jsonRes({
        posters: [
          { file_path: "/p-en.jpg", iso_639_1: "en", vote_average: 8, width: 780, height: 1170 },
          { file_path: "/p-textless.jpg", iso_639_1: null, vote_average: 9 },
          { file_path: "/p-fr.jpg", iso_639_1: "fr", vote_average: 7 },
        ],
        backdrops: [
          { file_path: "/b.jpg", iso_639_1: null, vote_average: 6, width: 1280, height: 720 },
        ],
        logos: [{ file_path: "/l.png", iso_639_1: "en", vote_average: 5 }],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    expect(ctx.calls[0]?.url).toContain("/movie/550/images");
    expect(ArtworkV1.methods.getArtwork.output.safeParse(out).success).toBe(true);
    const bundle = out as {
      poster: Array<{ url: string; language: string; likes: number }>;
      backdrop: Array<{ url: string; language: string }>;
      clearLogo: Array<{ url: string }>;
      thumb: unknown[];
    };
    // English variant ranks above textless, both rank above French.
    expect(bundle.poster[0]?.language).toBe("en");
    expect(bundle.poster[0]?.url).toContain("/w780/p-en.jpg");
    expect(bundle.poster[1]?.language).toBe("00");
    expect(bundle.poster[2]?.language).toBe("fr");
    expect(bundle.backdrop[0]?.url).toContain("/w1280/b.jpg");
    expect(bundle.clearLogo[0]?.url).toContain("/w500/l.png");
    expect(bundle.thumb).toEqual([]);
  });

  it("ranks textless backdrops above language-tagged variants", async () => {
    // Backdrops are the background layer behind UI text — text baked into
    // the image clashes with localised overlays. Posters/logos still prefer
    // the caller's language order since their text is the point.
    const ctx = makeCtx([
      jsonRes({
        posters: [
          { file_path: "/p-en.jpg", iso_639_1: "en", vote_average: 9 },
          { file_path: "/p-textless.jpg", iso_639_1: null, vote_average: 1 },
        ],
        backdrops: [
          { file_path: "/b-en.jpg", iso_639_1: "en", vote_average: 9 },
          { file_path: "/b-textless.jpg", iso_639_1: null, vote_average: 1 },
        ],
        logos: [],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    const bundle = out as {
      poster: Array<{ url: string; language: string }>;
      backdrop: Array<{ url: string; language: string }>;
    };
    // Posters keep English-first preference even with a higher-voted textless.
    expect(bundle.poster[0]?.language).toBe("en");
    // Backdrops invert: textless wins regardless of votes.
    expect(bundle.backdrop[0]?.language).toBe("00");
    expect(bundle.backdrop[0]?.url).toContain("/b-textless.jpg");
    expect(bundle.backdrop[1]?.language).toBe("en");
  });

  it("throws plugin.input_invalid without tmdb id (defensive guard)", async () => {
    const ctx = makeCtx([]);
    await expect(
      tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
        ids: { imdb: "tt0137523" },
        type: "movie",
        languages: ["en", "00"],
      }),
    ).rejects.toThrow();
  });

  it("hits /tv/{id}/images for tv items", async () => {
    const ctx = makeCtx([
      jsonRes({
        posters: [{ file_path: "/tv-p.jpg", iso_639_1: "en", vote_average: 9 }],
        backdrops: [{ file_path: "/tv-b.jpg", iso_639_1: null, vote_average: 7 }],
        logos: [{ file_path: "/tv-l.png", iso_639_1: "en", vote_average: 5 }],
      }),
    ]);
    const out = await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "1399" },
      type: "tv",
      languages: ["en", "00"],
    });
    expect(ctx.calls[0]?.url).toContain("/tv/1399/images");
    expect(ArtworkV1.methods.getArtwork.output.safeParse(out).success).toBe(true);
    const bundle = out as { poster: Array<{ url: string }>; backdrop: Array<{ url: string }> };
    expect(bundle.poster[0]?.url).toContain("/w780/tv-p.jpg");
    expect(bundle.backdrop[0]?.url).toContain("/w1280/tv-b.jpg");
  });

  it("include_image_language honors the caller's languages preference", async () => {
    // Regression test for a bug where the param was hard-coded to "null,en"
    // regardless of the `languages` arg, silently dropping non-English variants.
    const ctx = makeCtx([jsonRes({ posters: [], backdrops: [], logos: [] })]);
    await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["fr", "en", "00"],
    });
    const url = ctx.calls[0]!.url;
    expect(url).toContain("include_image_language=fr%2Cen%2Cnull");
  });

  it("include_image_language always includes 'null' even when caller omits textless", async () => {
    // Textless art is a meaningful fallback when the caller's preferred
    // languages have no localised variants, so the plugin always appends
    // "null". Without this, a caller passing ["en"] would never see textless
    // art even when no English art exists for the item.
    const ctx = makeCtx([jsonRes({ posters: [], backdrops: [], logos: [] })]);
    await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en"],
    });
    expect(ctx.calls[0]?.url).toContain("include_image_language=en%2Cnull");
  });

  it("respects custom artworkSizes config", async () => {
    const ctx = makeCtx(
      [
        jsonRes({
          posters: [{ file_path: "/p.jpg", iso_639_1: "en", vote_average: 1 }],
          backdrops: [],
          // Config keys mirror the bundle field names; `clearLogo` (not
          // `logo`) overrides the size used for logos.
          logos: [{ file_path: "/l.png", iso_639_1: "en", vote_average: 1 }],
        }),
      ],
      {
        config: {
          global: { artworkSizes: { poster: "original", clearLogo: "w300" } },
          user: undefined,
        },
      },
    );
    const out = await tmdbPlugin.capabilities.artwork!.getArtwork!(ctx, {
      ids: { tmdb: "550" },
      type: "movie",
      languages: ["en", "00"],
    });
    const bundle = out as {
      poster: Array<{ url: string }>;
      clearLogo: Array<{ url: string }>;
    };
    expect(bundle.poster[0]?.url).toContain("/original/p.jpg");
    expect(bundle.clearLogo[0]?.url).toContain("/w300/l.png");
  });
});
