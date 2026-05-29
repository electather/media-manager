import { describe, expect, it } from "vite-plus/test";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import { MEDIA_ROW_BUCKETS, type MediaRowBucket } from "@ent-mcp/shared/media";
import { classifyBucket } from "../classify";

const VALID = new Set<MediaRowBucket>(MEDIA_ROW_BUCKETS);

type ClassifyInput = Pick<CompactMediaItem, "status" | "availability" | "facets" | "progress">;

function row(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    status: "unknown",
    availability: { hasAnyServerCopy: false, requestEligible: true, servers: [] },
    ...overrides,
  };
}

describe("classifyBucket - rev 6 total-coverage (V.WL2)", () => {
  it("classifies an active progress row as in-progress", () => {
    expect(classifyBucket(row({ progress: { watched: 100, total: 1000 } }))).toBe("in-progress");
  });

  it("classifies a server-backed row as ready", () => {
    expect(
      classifyBucket(
        row({
          status: "available",
          availability: {
            hasAnyServerCopy: true,
            requestEligible: false,
            servers: [{ id: "jf", label: "Jellyfin" }],
          },
        }),
      ),
    ).toBe("ready");
  });

  it.each([
    ["requested" as const, "awaiting"],
    ["processing" as const, "awaiting"],
    ["unavailable" as const, "awaiting"],
  ])("routes status %s to %s (STATUS_MAP collision sanity)", (status, expected) => {
    expect(classifyBucket(row({ status }))).toBe(expected);
  });

  it("classifies a future-release row as upcoming", () => {
    expect(classifyBucket(row({ facets: { releaseDate: "2099" } }))).toBe("upcoming");
  });

  it("falls through to unavailable for rows with no server, no status route, no release", () => {
    expect(classifyBucket(row())).toBe("unavailable");
  });

  it("routes an info-only row to unavailable, not upcoming (#502)", () => {
    // Released, no server copy, not request-eligible, no future releaseDate:
    // this must read as unavailable. "upcoming" is reserved for unreleased
    // titles, so an info-only row mis-classified as upcoming is the #502 bug.
    const infoOnly = row({
      status: "unknown",
      availability: { hasAnyServerCopy: false, requestEligible: false, servers: [] },
    });
    expect(classifyBucket(infoOnly)).toBe("unavailable");
    expect(classifyBucket(infoOnly)).not.toBe("upcoming");
  });

  it("never emits a legacy 'unknown' bucket value", () => {
    const fixtures: ClassifyInput[] = [
      row(),
      row({ progress: { watched: 50, total: 100 } }),
      row({
        status: "available",
        availability: { hasAnyServerCopy: true, servers: [], requestEligible: false },
      }),
      row({ status: "requested" }),
      row({ status: "processing" }),
      row({ status: "unavailable" }),
      row({ facets: { releaseDate: "2099" } }),
      row({ availability: { hasAnyServerCopy: false, requestEligible: false, servers: [] } }),
    ];
    for (const f of fixtures) {
      const bucket = classifyBucket(f);
      expect(VALID.has(bucket)).toBe(true);
      expect(bucket).not.toBe("unknown");
    }
  });
});
