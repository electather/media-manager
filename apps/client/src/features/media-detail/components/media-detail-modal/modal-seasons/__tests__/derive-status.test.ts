import { describe, expect, it } from "vite-plus/test";
import type { SeasonAvailabilityServer, SeasonInfo } from "@ent-mcp/shared/home";
import { deriveSeasonStatus, joinSeasonAvailability } from "../derive-status";

const NOW = Date.parse("2026-05-06T00:00:00Z");

function season(overrides: Partial<SeasonInfo> = {}): SeasonInfo {
  return {
    seasonNumber: 1,
    name: "Season 1",
    totalEpisodes: 3,
    episodes: [
      { episodeNumber: 1, title: "Ep1", airDate: "2024-01-01", runtime: 50 },
      { episodeNumber: 2, title: "Ep2", airDate: "2024-01-08", runtime: 50 },
      { episodeNumber: 3, title: "Ep3", airDate: "2024-01-15", runtime: 50 },
    ],
    ...overrides,
  };
}

function server(label: string, present: Array<[number, number]>): SeasonAvailabilityServer {
  return {
    serverId: label,
    serverLabel: label,
    episodesPresent: present.map(([s, e]) => ({ season: s, episode: e })),
  };
}

describe("deriveSeasonStatus", () => {
  it("available when at least one server has every episode", () => {
    const status = deriveSeasonStatus(
      season(),
      [
        server("plex", [
          [1, 1],
          [1, 2],
          [1, 3],
        ]),
      ],
      NOW,
    );
    expect(status).toBe("available");
  });

  it("partial when one server has some episodes, none has all", () => {
    const status = deriveSeasonStatus(
      season(),
      [
        server("plex", [
          [1, 1],
          [1, 2],
        ]),
        server("jellyfin", [[1, 3]]),
      ],
      NOW,
    );
    expect(status).toBe("partial");
  });

  it("unavailable when every server has zero episodes", () => {
    const status = deriveSeasonStatus(season(), [server("plex", []), server("jellyfin", [])], NOW);
    expect(status).toBe("unavailable");
  });

  it("upcoming when all episode airDates are in the future and no presence", () => {
    const future = season({
      episodes: [
        { episodeNumber: 1, title: "Ep1", airDate: "2027-01-01", runtime: 50 },
        { episodeNumber: 2, title: "Ep2", airDate: "2027-01-08", runtime: 50 },
      ],
      totalEpisodes: 2,
    });
    expect(deriveSeasonStatus(future, [server("plex", [])], NOW)).toBe("upcoming");
  });

  it("unavailable on no servers", () => {
    expect(deriveSeasonStatus(season(), [], NOW)).toBe("unavailable");
  });
});

describe("joinSeasonAvailability", () => {
  it("emits seasons matching the RequestableSeasons shape", () => {
    const result = joinSeasonAvailability(
      [season()],
      [
        server("plex", [
          [1, 1],
          [1, 2],
        ]),
      ],
      NOW,
    );
    expect(result).toHaveLength(1);
    const s = result[0]!;
    expect(s.number).toBe(1);
    expect(s.episodeCount).toBe(3);
    expect(s.counts.available).toBe(2);
    expect(s.counts.unavailable).toBe(1);
    expect(s.episodes.find((e) => e.episode === 1)?.status).toBe("available");
    expect(s.episodes.find((e) => e.episode === 3)?.status).toBe("unavailable");
  });

  it("filters specials (season 0) when no server has any episode", () => {
    const result = joinSeasonAvailability(
      [season({ seasonNumber: 0, name: "Specials" }), season()],
      [
        server("plex", [
          [1, 1],
          [1, 2],
          [1, 3],
        ]),
      ],
      NOW,
    );
    expect(result.map((s) => s.number)).toEqual([1]);
  });

  it("keeps specials when at least one server has any of their episodes", () => {
    const result = joinSeasonAvailability(
      [season({ seasonNumber: 0, name: "Specials" })],
      [server("plex", [[0, 1]])],
      NOW,
    );
    expect(result.map((s) => s.number)).toEqual([0]);
    expect(result[0]?.counts.available).toBe(1);
  });

  it("marks future episodes as upcoming when not present on any server", () => {
    const future = season({
      episodes: [
        { episodeNumber: 1, title: "Past", airDate: "2024-01-01", runtime: 50 },
        { episodeNumber: 2, title: "Future", airDate: "2027-01-01", runtime: 50 },
      ],
      totalEpisodes: 2,
    });
    const result = joinSeasonAvailability([future], [server("plex", [[1, 1]])], NOW);
    expect(result[0]?.episodes.find((e) => e.episode === 2)?.status).toBe("upcoming");
  });
});
