import { traktJson } from "../client";
import { mapMovie, mapShow } from "../mappers";
import type { Ctx, TraktMovie, TraktShow } from "../types";

export const calendar = {
  async getUpcoming(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { days = 7 } = input as { days?: number };
    const start = new Date().toISOString().slice(0, 10);
    const data = await traktJson<
      Array<{
        first_aired: string;
        episode: { season: number; number: number; title: string };
        show: TraktShow;
      }>
    >(c, `/calendars/my/shows/${start}/${days}`);
    return data.map((row) => ({
      item: mapShow(row.show),
      season: row.episode.season,
      episode: row.episode.number,
      episodeTitle: row.episode.title,
      airsAt: row.first_aired,
    }));
  },

  async getUpcomingMovies(ctx: unknown, input: unknown) {
    const c = ctx as Ctx;
    const { days = 30 } = input as { days?: number };
    const start = new Date().toISOString().slice(0, 10);
    const data = await traktJson<Array<{ released: string; movie: TraktMovie }>>(
      c,
      `/calendars/my/movies/${start}/${days}`,
    );
    return data.map((row) => ({ item: mapMovie(row.movie), airsAt: row.released }));
  },
};
