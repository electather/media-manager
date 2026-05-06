import { describe, expect, it } from "vite-plus/test";
import type { Season } from "../lib/types";
import {
  createRequestPayload,
  describeDestination,
  getRequestableSeasonNumbers,
  getSeasonActionModel,
  inferSeasonStatus,
  normalizeRequestStatus,
  resolveRequestSelection,
} from "../lib/request-helpers";

const mkSeason = (
  partial: Partial<Season> & { number?: number; episodeCount: number },
): Season => ({
  number: partial.number ?? 1,
  episodeCount: partial.episodeCount,
  counts: partial.counts ?? {},
  episodes: partial.episodes ?? [],
});

describe("normalizeRequestStatus", () => {
  it("returns 'available' for nullish input", () => {
    expect(normalizeRequestStatus(null)).toBe("available");
    expect(normalizeRequestStatus(undefined)).toBe("available");
    expect(normalizeRequestStatus("")).toBe("available");
  });

  it("collapses wire aliases onto request-flow statuses", () => {
    expect(normalizeRequestStatus("requested")).toBe("in-progress");
    expect(normalizeRequestStatus("processing")).toBe("in-progress");
    expect(normalizeRequestStatus("unavailable")).toBe("missing");
  });

  it("passes through canonical request-flow statuses untouched", () => {
    for (const status of [
      "available",
      "in-progress",
      "pending",
      "missing",
      "partial",
      "upcoming",
    ] as const) {
      expect(normalizeRequestStatus(status)).toBe(status);
    }
  });

  it("falls back to 'available' for unknown values", () => {
    expect(normalizeRequestStatus("nonsense")).toBe("available");
  });
});

describe("inferSeasonStatus", () => {
  it("returns 'upcoming' when every episode is upcoming", () => {
    expect(inferSeasonStatus(mkSeason({ episodeCount: 4, counts: { upcoming: 4 } }))).toBe(
      "upcoming",
    );
  });
  it("returns 'available' when every episode is available", () => {
    expect(inferSeasonStatus(mkSeason({ episodeCount: 6, counts: { available: 6 } }))).toBe(
      "available",
    );
  });
  it("returns 'missing' when every episode is unavailable", () => {
    expect(inferSeasonStatus(mkSeason({ episodeCount: 5, counts: { unavailable: 5 } }))).toBe(
      "missing",
    );
  });
  it("returns 'in-progress' when every episode is requested", () => {
    expect(inferSeasonStatus(mkSeason({ episodeCount: 3, counts: { requested: 3 } }))).toBe(
      "in-progress",
    );
  });
  it("returns 'partial' when some episodes are available and the rest aren't all upcoming", () => {
    expect(
      inferSeasonStatus(
        mkSeason({ episodeCount: 6, counts: { available: 3, requested: 1, upcoming: 1 } }),
      ),
    ).toBe("partial");
  });
  it("returns 'in-progress' when some episodes are still requested but none are available", () => {
    expect(
      inferSeasonStatus(mkSeason({ episodeCount: 4, counts: { requested: 2, unavailable: 2 } })),
    ).toBe("in-progress");
  });
  it("falls back to 'missing' when nothing matches", () => {
    expect(inferSeasonStatus(mkSeason({ episodeCount: 4, counts: {} }))).toBe("missing");
  });
});

describe("getSeasonActionModel", () => {
  it("returns a status model when no plugin is configured", () => {
    expect(getSeasonActionModel("missing", false)).toEqual({ kind: "status", status: "missing" });
  });
  it("offers 'Request missing' for partial and missing seasons", () => {
    expect(getSeasonActionModel("partial", true)).toEqual({
      kind: "request",
      status: "partial",
      label: "Request missing",
    });
    expect(getSeasonActionModel("missing", true)).toEqual({
      kind: "request",
      status: "missing",
      label: "Request missing",
    });
  });
  it("offers 'Request season' for upcoming seasons", () => {
    expect(getSeasonActionModel("upcoming", true)).toEqual({
      kind: "request",
      status: "upcoming",
      label: "Request season",
    });
  });
  it("returns a status model for already-actioned seasons", () => {
    for (const status of ["available", "in-progress", "pending"] as const) {
      expect(getSeasonActionModel(status, true)).toEqual({ kind: "status", status });
    }
  });
});

describe("getRequestableSeasonNumbers", () => {
  it("only includes seasons whose action model is requestable", () => {
    const seasons = [
      { number: 1, status: "available" as const },
      { number: 2, status: "partial" as const },
      { number: 3, status: "missing" as const },
      { number: 4, status: "upcoming" as const },
      { number: 5, status: "in-progress" as const },
    ];
    expect(getRequestableSeasonNumbers(seasons, true)).toEqual([2, 3, 4]);
    expect(getRequestableSeasonNumbers(seasons, false)).toEqual([]);
  });
});

describe("resolveRequestSelection + describeDestination", () => {
  it("falls back to the default service and profile when ids are unknown", () => {
    const selection = resolveRequestSelection("movie", "unknown", "unknown");
    expect(selection.serviceId).toBeTruthy();
    expect(selection.profileId).toBeTruthy();
  });
  it("describes the chosen destination", () => {
    const destination = describeDestination("movie", "home-server", "best");
    expect(destination.serviceLabel).toMatch(/Radarr/);
    expect(destination.profileLabel).toBe("Best available");
  });
  it("filters services by the requested kind", () => {
    const movie = resolveRequestSelection("movie", undefined, undefined);
    expect(movie.services.every((s) => s.supports.includes("movie"))).toBe(true);
    const tv = resolveRequestSelection("tv", undefined, undefined);
    expect(tv.services.every((s) => s.supports.includes("tv"))).toBe(true);
  });
});

describe("createRequestPayload", () => {
  it("never includes seasons for movies", () => {
    expect(
      createRequestPayload({
        itemId: "movie:a",
        kind: "movie",
        serviceId: "home-server",
        profileId: "best",
        seasonNumbers: [1, 2],
      }).seasons,
    ).toEqual([]);
  });
  it("copies the season numbers for TV requests", () => {
    expect(
      createRequestPayload({
        itemId: "tv:a",
        kind: "tv",
        serviceId: "sonarr-main",
        profileId: null,
        seasonNumbers: [3, 4],
      }).seasons,
    ).toEqual([3, 4]);
  });
});
