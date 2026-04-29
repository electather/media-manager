import { describe, it, expect } from "vite-plus/test";
import {
  identifyItem,
  splitCombinedId,
  parseItemDate,
  parseHistoryBase,
  type RawPluginItem,
} from "../parse-item";

describe("splitCombinedId", () => {
  it("parses movie combined id", () => {
    expect(splitCombinedId("movie:550")).toEqual({ type: "movie", id: "550" });
  });

  it("parses tv combined id", () => {
    expect(splitCombinedId("tv:1399")).toEqual({ type: "tv", id: "1399" });
  });

  it("returns null for undefined", () => {
    expect(splitCombinedId(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(splitCombinedId("")).toBeNull();
  });

  it("returns null for invalid type", () => {
    expect(splitCombinedId("series:123")).toBeNull();
  });

  it("returns null for missing id after colon", () => {
    expect(splitCombinedId("movie:")).toBeNull();
  });

  it("returns null for missing colon", () => {
    expect(splitCombinedId("movie550")).toBeNull();
  });

  it("splits only on first colon, rest is part of id", () => {
    expect(splitCombinedId("movie:123:extra")).toEqual({ type: "movie", id: "123" });
  });
});

describe("parseItemDate", () => {
  it("parses ISO date string to timestamp", () => {
    const iso = "2024-01-15T12:30:45Z";
    const result = parseItemDate(iso);
    expect(result).toBe(Date.parse(iso));
  });

  it("returns null for undefined", () => {
    expect(parseItemDate(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseItemDate("")).toBeNull();
  });

  it("returns null for invalid date string", () => {
    expect(parseItemDate("not-a-date")).toBeNull();
  });

  it("returns null for invalid ISO format", () => {
    expect(parseItemDate("2024-13-45")).toBeNull();
  });

  it("handles date without time component", () => {
    const iso = "2024-01-15";
    const result = parseItemDate(iso);
    expect(result).toBe(Date.parse(iso));
    expect(result).not.toBeNull();
  });
});

describe("identifyItem", () => {
  it("returns null for undefined item", () => {
    expect(identifyItem(undefined)).toBeNull();
  });

  it("extracts tmdbId from ids.tmdb_id", () => {
    const item: RawPluginItem = {
      ids: { tmdb_id: "550" },
      type: "movie",
    };
    expect(identifyItem(item)).toEqual({ tmdbId: "550", type: "movie" });
  });

  it("extracts type from item.type", () => {
    const item: RawPluginItem = {
      ids: { tmdb_id: "1399" },
      type: "tv",
    };
    expect(identifyItem(item)).toEqual({ tmdbId: "1399", type: "tv" });
  });

  it("falls back to splitCombinedId for tmdbId when ids.tmdb_id missing", () => {
    const item: RawPluginItem = {
      id: "movie:550",
    };
    expect(identifyItem(item)).toEqual({ tmdbId: "550", type: "movie" });
  });

  it("falls back to splitCombinedId for type when item.type missing", () => {
    const item: RawPluginItem = {
      ids: { tmdb_id: "1399" },
      id: "tv:1399",
    };
    expect(identifyItem(item)).toEqual({ tmdbId: "1399", type: "tv" });
  });

  it("returns null when tmdbId is missing entirely", () => {
    const item: RawPluginItem = {
      type: "movie",
    };
    expect(identifyItem(item)).toBeNull();
  });

  it("returns null when type is neither movie nor tv", () => {
    const item: RawPluginItem = {
      ids: { tmdb_id: "550" },
      type: "series" as any,
    };
    expect(identifyItem(item)).toBeNull();
  });

  it("returns null when type is undefined and cannot be split from id", () => {
    const item: RawPluginItem = {
      ids: { tmdb_id: "550" },
    };
    expect(identifyItem(item)).toBeNull();
  });

  it("prefers ids.tmdb_id over splitCombinedId", () => {
    const item: RawPluginItem = {
      ids: { tmdb_id: "550" },
      id: "movie:999",
      type: "movie",
    };
    expect(identifyItem(item)).toEqual({ tmdbId: "550", type: "movie" });
  });

  it("prefers item.type over splitCombinedId", () => {
    const item: RawPluginItem = {
      ids: { tmdb_id: "550" },
      id: "tv:550",
      type: "movie",
    };
    expect(identifyItem(item)).toEqual({ tmdbId: "550", type: "movie" });
  });

  it("handles empty ids object", () => {
    const item: RawPluginItem = {
      ids: {},
      id: "movie:550",
    };
    expect(identifyItem(item)).toEqual({ tmdbId: "550", type: "movie" });
  });
});

describe("parseHistoryBase", () => {
  it("parses valid entry with all fields", () => {
    const entry = {
      item: {
        ids: { tmdb_id: "550" },
        type: "movie" as const,
      },
      watchedAt: "2024-01-15T12:30:45Z",
    };
    const result = parseHistoryBase(entry);
    expect(result).toEqual({
      tmdbId: "550",
      mediaType: "movie",
      watchedAt: Date.parse("2024-01-15T12:30:45Z"),
    });
  });

  it("parses tv show entry", () => {
    const entry = {
      item: {
        ids: { tmdb_id: "1399" },
        type: "tv" as const,
      },
      watchedAt: "2024-02-20T08:15:00Z",
    };
    const result = parseHistoryBase(entry);
    expect(result).toEqual({
      tmdbId: "1399",
      mediaType: "tv",
      watchedAt: Date.parse("2024-02-20T08:15:00Z"),
    });
  });

  it("returns null when item is undefined", () => {
    const entry = {
      watchedAt: "2024-01-15T12:30:45Z",
    };
    expect(parseHistoryBase(entry)).toBeNull();
  });

  it("returns null when item cannot be identified", () => {
    const entry = {
      item: { id: "invalid" },
      watchedAt: "2024-01-15T12:30:45Z",
    };
    expect(parseHistoryBase(entry)).toBeNull();
  });

  it("returns null when watchedAt is undefined", () => {
    const entry = {
      item: {
        ids: { tmdb_id: "550" },
        type: "movie" as const,
      },
    };
    expect(parseHistoryBase(entry)).toBeNull();
  });

  it("returns null when watchedAt is empty string", () => {
    const entry = {
      item: {
        ids: { tmdb_id: "550" },
        type: "movie" as const,
      },
      watchedAt: "",
    };
    expect(parseHistoryBase(entry)).toBeNull();
  });

  it("returns null when watchedAt is invalid date", () => {
    const entry = {
      item: {
        ids: { tmdb_id: "550" },
        type: "movie" as const,
      },
      watchedAt: "not-a-date",
    };
    expect(parseHistoryBase(entry)).toBeNull();
  });

  it("extracts item identity from combined id fallback", () => {
    const entry = {
      item: {
        id: "movie:550",
      },
      watchedAt: "2024-01-15T12:30:45Z",
    };
    const result = parseHistoryBase(entry);
    expect(result).toEqual({
      tmdbId: "550",
      mediaType: "movie",
      watchedAt: Date.parse("2024-01-15T12:30:45Z"),
    });
  });

  it("returns null when item type is invalid even with valid tmdbId", () => {
    const entry = {
      item: {
        ids: { tmdb_id: "550" },
        type: "series" as any,
      },
      watchedAt: "2024-01-15T12:30:45Z",
    };
    expect(parseHistoryBase(entry)).toBeNull();
  });

  it("returns null when entry is empty object", () => {
    expect(parseHistoryBase({})).toBeNull();
  });

  it("short-circuits on first invalid field", () => {
    const entry = {
      item: {
        ids: { tmdb_id: "550" },
        type: "movie" as const,
      },
      watchedAt: "invalid-date",
    };
    const result = parseHistoryBase(entry);
    expect(result).toBeNull();
  });
});
