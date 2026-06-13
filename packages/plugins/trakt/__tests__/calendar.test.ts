import { describe, it, expect } from "vite-plus/test";
import { CalendarV1 } from "@nama/plugin-sdk";
import { jsonRes, makeCtx, MOVIE, SHOW } from "./helpers";
import traktPlugin from "../src/plugin";

const cap = traktPlugin.capabilities.calendar!;

describe("calendar", () => {
  it("getUpcoming: hits /calendars/my/shows/{start}/{days}", async () => {
    const ctx = makeCtx([
      jsonRes([
        {
          first_aired: "2026-04-02",
          episode: { season: 1, number: 1, title: "Pilot" },
          show: SHOW,
        },
      ]),
    ]);
    const out = await cap.getUpcoming!(ctx, { days: 7 });
    expect(ctx.calls[0]?.url).toMatch(/\/calendars\/my\/shows\/\d{4}-\d{2}-\d{2}\/7/);
    expect(CalendarV1.methods.getUpcoming.output.safeParse(out).success).toBe(true);
  });

  it("getUpcomingMovies: hits /calendars/my/movies/{start}/{days}", async () => {
    const ctx = makeCtx([jsonRes([{ released: "2026-04-05", movie: MOVIE }])]);
    const out = await cap.getUpcomingMovies!(ctx, { days: 30 });
    expect(ctx.calls[0]?.url).toMatch(/\/calendars\/my\/movies\/\d{4}-\d{2}-\d{2}\/30/);
    expect(CalendarV1.methods.getUpcomingMovies.output.safeParse(out).success).toBe(true);
  });
});
