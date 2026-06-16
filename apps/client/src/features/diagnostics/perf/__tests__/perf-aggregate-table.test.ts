import { describe, expect, it } from "vite-plus/test";
import { groupKey, sortAndFilter } from "../perf-aggregate-table";
import type { PerfAggregateGroup, PerfFilters } from "../../shared/types";

function group(over: Partial<PerfAggregateGroup>): PerfAggregateGroup {
  return {
    kind: "http",
    route: "/a",
    pluginId: null,
    count: 1,
    p50: 1,
    p95: 1,
    p99: 1,
    max: 1,
    lastAt: 0,
    ...over,
  };
}

const baseFilters: PerfFilters = {
  kind: "all",
  sort: "p95",
  range: "24h",
  requestId: "",
  search: "",
};

describe("groupKey", () => {
  it("keys route groups by kind and route", () => {
    expect(groupKey(group({ kind: "http", route: "/users" }))).toBe("http:/users");
  });

  it("folds plugin groups with no route onto the pluginId", () => {
    expect(groupKey(group({ kind: "plugin", route: null, pluginId: "trakt" }))).toBe(
      "plugin:trakt",
    );
  });

  it("falls back to an unknown marker when both route and pluginId are null", () => {
    expect(groupKey(group({ kind: "plugin", route: null, pluginId: null }))).toBe(
      "plugin:(unknown)",
    );
  });
});

describe("sortAndFilter", () => {
  const groups = [
    group({ route: "/slow", p95: 300, p99: 100 }),
    group({ route: "/fast", p95: 50, p99: 400 }),
  ];

  it("sorts by the chosen percentile descending", () => {
    // Why this matters: the table sorts client-side off the cached data, so a
    // sort change must reorder the same rows by the picked metric.
    const byP95 = sortAndFilter(groups, { ...baseFilters, sort: "p95" });
    expect(byP95.map((g) => g.route)).toEqual(["/slow", "/fast"]);

    const byP99 = sortAndFilter(groups, { ...baseFilters, sort: "p99" });
    expect(byP99.map((g) => g.route)).toEqual(["/fast", "/slow"]);
  });

  it("filters by a case-insensitive route/plugin substring", () => {
    const filtered = sortAndFilter(groups, { ...baseFilters, search: "SLO" });
    expect(filtered.map((g) => g.route)).toEqual(["/slow"]);
  });

  it("does not mutate the input array", () => {
    const original = [...groups];
    sortAndFilter(groups, { ...baseFilters, sort: "p99" });
    expect(groups).toEqual(original);
  });
});
