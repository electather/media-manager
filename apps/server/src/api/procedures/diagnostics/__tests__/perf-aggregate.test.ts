import { describe, it, expect } from "vite-plus/test";
import { aggregatePerfRows, percentile, type RawPerfRow } from "../perf-aggregate";

function makeRow(overrides: Partial<RawPerfRow> = {}): RawPerfRow {
  return {
    kind: "http",
    durationMs: 100,
    route: "/api/test",
    pluginId: null,
    createdAt: 1,
    ...overrides,
  };
}

describe("percentile", () => {
  it("returns 0 for an empty array", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("returns the only sample for count=1 regardless of percentile", () => {
    expect(percentile([42], 0.5)).toBe(42);
    expect(percentile([42], 0.99)).toBe(42);
  });

  it("interpolates between adjacent samples for count=2", () => {
    expect(percentile([10, 20], 0.5)).toBe(15);
    expect(percentile([10, 20], 0)).toBe(10);
    expect(percentile([10, 20], 1)).toBe(20);
  });

  it("matches a sorted slice for a 100-element array at p50/p95/p99", () => {
    const arr = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(arr, 0.5)).toBe(50.5);
    expect(percentile(arr, 0.95)).toBeCloseTo(95.05, 2);
    expect(percentile(arr, 0.99)).toBeCloseTo(99.01, 2);
  });
});

describe("aggregatePerfRows", () => {
  it("groups by route and computes p50/p95/p99/max + count", () => {
    const rows: RawPerfRow[] = [];
    for (let i = 1; i <= 100; i++) {
      rows.push(makeRow({ durationMs: i, createdAt: i }));
    }
    const out = aggregatePerfRows(rows, "route");
    expect(out).toHaveLength(1);
    const group = out[0]!;
    expect(group.kind).toBe("http");
    expect(group.route).toBe("/api/test");
    expect(group.count).toBe(100);
    expect(group.p50).toBe(51); // rounded from 50.5
    expect(group.p95).toBe(95);
    expect(group.p99).toBe(99);
    expect(group.max).toBe(100);
    expect(group.lastAt).toBe(100);
  });

  it("groups by plugin id when groupBy='plugin'", () => {
    const rows: RawPerfRow[] = [
      makeRow({ kind: "plugin", route: null, pluginId: "trakt", durationMs: 10 }),
      makeRow({ kind: "plugin", route: null, pluginId: "trakt", durationMs: 30 }),
      makeRow({ kind: "plugin", route: null, pluginId: "tmdb", durationMs: 5 }),
    ];
    const out = aggregatePerfRows(rows, "plugin");
    expect(out).toHaveLength(2);
    expect(out.map((g) => g.pluginId).sort((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual([
      "tmdb",
      "trakt",
    ]);
  });

  it("sorts groups by p95 desc and caps at 100 rows", () => {
    const rows: RawPerfRow[] = [];
    for (let r = 0; r < 200; r++) {
      for (let i = 1; i <= 10; i++) {
        rows.push(makeRow({ route: `/r${r}`, durationMs: r + i }));
      }
    }
    const out = aggregatePerfRows(rows, "route");
    expect(out).toHaveLength(100);
    for (let i = 0; i < out.length - 1; i++) {
      expect(out[i]!.p95).toBeGreaterThanOrEqual(out[i + 1]!.p95);
    }
  });

  it("returns an empty array when given no rows", () => {
    expect(aggregatePerfRows([], "route")).toEqual([]);
  });
});
