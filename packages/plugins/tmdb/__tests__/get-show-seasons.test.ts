import { describe, it, expect } from "vite-plus/test";
import { MetadataV1 } from "@ent-mcp/plugin-sdk";
import { jsonRes, makeCtx } from "./helpers";
import tmdbPlugin from "../src/plugin";

const SHOW_ROOT = {
  id: 1396,
  name: "Breaking Bad",
  seasons: [
    {
      season_number: 0,
      name: "Specials",
      air_date: "2009-02-17",
      episode_count: 3,
    },
    {
      season_number: 1,
      name: "Season 1",
      air_date: "2008-01-20",
      episode_count: 7,
    },
    // Unaired season — no air_date, episode_count = 0.
    {
      season_number: 2,
      name: "Season 2",
      air_date: null,
      episode_count: 0,
    },
    // Skipped: season_number === null (TMDB occasionally returns aggregate
    // "extras" rows with no season number).
    {
      season_number: null,
      name: "Extras",
    },
  ],
};

describe("tmdb getShowSeasons", () => {
  it("hits /tv/{id} then chunked appends, mapping seasons + episodes", async () => {
    const ctx = makeCtx([
      jsonRes(SHOW_ROOT),
      jsonRes({
        ...SHOW_ROOT,
        "season/0": {
          episodes: [
            { episode_number: 1, name: "Negro y Azul", air_date: "2009-04-19", runtime: 4 },
          ],
        },
        "season/1": {
          episodes: [
            { episode_number: 1, name: "Pilot", air_date: "2008-01-20", runtime: 58 },
            { episode_number: 2, name: "Cat's in the Bag..." },
          ],
        },
        "season/2": { episodes: [] },
      }),
    ]);
    const out = (await tmdbPlugin.capabilities.metadata!.getShowSeasons!(ctx, {
      id: "1396",
    })) as { seasons: Array<{ seasonNumber: number; episodes: Array<{ title: string }> }> };

    expect(ctx.calls[0]?.url).toContain("/tv/1396");
    expect(ctx.calls[1]?.url).toContain("append_to_response=season%2F0%2Cseason%2F1%2Cseason%2F2");
    expect(MetadataV1.methods.getShowSeasons.output.safeParse(out).success).toBe(true);

    expect(out.seasons.map((s) => s.seasonNumber)).toEqual([0, 1, 2]);
    const s1 = out.seasons.find((s) => s.seasonNumber === 1)!;
    expect(s1.episodes[0]?.title).toBe("Pilot");
    expect(s1.episodes[1]?.title).toBe("Cat's in the Bag...");
  });

  it("filters out seasons with null season_number", async () => {
    const ctx = makeCtx([
      jsonRes(SHOW_ROOT),
      jsonRes({
        ...SHOW_ROOT,
        "season/0": { episodes: [] },
        "season/1": { episodes: [] },
        "season/2": { episodes: [] },
      }),
    ]);
    const out = (await tmdbPlugin.capabilities.metadata!.getShowSeasons!(ctx, {
      id: "1396",
    })) as { seasons: Array<{ seasonNumber: number }> };
    expect(out.seasons.find((s) => s.seasonNumber === undefined)).toBeUndefined();
  });

  it("returns empty seasons when show has none", async () => {
    const ctx = makeCtx([jsonRes({ id: 1, name: "Empty", seasons: [] })]);
    const out = (await tmdbPlugin.capabilities.metadata!.getShowSeasons!(ctx, {
      id: "1",
    })) as { seasons: unknown[] };
    expect(out.seasons).toEqual([]);
    // Did not issue the append round-trip.
    expect(ctx.calls.length).toBe(1);
  });

  it("omits airDate on unaired seasons", async () => {
    const ctx = makeCtx([
      jsonRes(SHOW_ROOT),
      jsonRes({
        ...SHOW_ROOT,
        "season/0": { episodes: [] },
        "season/1": { episodes: [] },
        "season/2": { episodes: [] },
      }),
    ]);
    const out = (await tmdbPlugin.capabilities.metadata!.getShowSeasons!(ctx, {
      id: "1396",
    })) as { seasons: Array<{ seasonNumber: number; airDate?: string }> };
    const unaired = out.seasons.find((s) => s.seasonNumber === 2)!;
    expect(unaired.airDate).toBeUndefined();
  });
});
