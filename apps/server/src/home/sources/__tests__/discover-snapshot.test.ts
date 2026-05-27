import { consola } from "consola";
import { describe, expect, it, vi } from "vite-plus/test";
import type { DiscoverFeedKind } from "@ent-mcp/shared/catalog";
import type { SourceContext } from "../../../media";
import fixture from "../../__tests__/fixtures/home-layout-parity.json";
import {
  NEW_RELEASES_SNAPSHOT,
  TRENDING_SNAPSHOT,
} from "../../__tests__/fixtures/home-layout-scenario";
import { discoverSnapshotSource, newReleasesSource, trendingNowSource } from "../discover-snapshot";

/** Build a minimal `SourceContext` whose catalog resolves the scenario feeds. */
function makeCtx(): SourceContext {
  const catalog = {
    getDiscoverFeed: vi.fn(async (kind: DiscoverFeedKind) => {
      if (kind === "trending") return TRENDING_SNAPSHOT;
      if (kind === "newReleases") return NEW_RELEASES_SNAPSHOT;
      return null;
    }),
  } as unknown as SourceContext["catalog"];
  return {
    userId: "u1",
    catalog,
    mediaService: {} as SourceContext["mediaService"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("discover-source-test"),
  };
}

const idsOf = (rows: Array<{ tmdbId: string; type: string }>): string[] =>
  rows.map((r) => `${r.type}:${r.tmdbId}`);
const fixtureIds = (rowId: string): string[] | undefined =>
  fixture.rows.find((r) => r.rowId === rowId)?.ids;

// RISK-103 / design §T: the source must reproduce the US-019 captured ids/order
// so the migration is provably behavior-neutral. The WHY (Rule 9): a slice /
// sort / cursor change snuck into `fetchRawSet` would fail here, not ship.
describe("home discovery snapshot source", () => {
  it("carries no sort/filter/cursor logic — identity sort, offset mode (V.MC1)", () => {
    expect(trendingNowSource.stages).toEqual({ sort: "none", cursorMode: "offset" });
    expect(trendingNowSource.stages.classify).toBeUndefined();
    expect(trendingNowSource.stages.filter).toBeUndefined();
    expect(newReleasesSource.stages).toEqual({ sort: "none", cursorMode: "offset" });
  });

  it("returns the FULL trending snapshot as raw keys in feed order (US-019 parity)", async () => {
    const { rows, partial, nextRaw } = await trendingNowSource.fetchRawSet(
      makeCtx(),
      undefined,
      null,
    );
    expect(idsOf(rows)).toEqual(fixtureIds("trendingNow"));
    expect(partial).toBe(false);
    // An offset source mints no hop token — the pipeline owns the slice/cursor.
    expect(nextRaw).toBeUndefined();
  });

  it("returns the FULL new-releases snapshot as raw keys (US-019 parity)", async () => {
    const { rows } = await newReleasesSource.fetchRawSet(makeCtx(), undefined, null);
    expect(idsOf(rows)).toEqual(fixtureIds("newReleases"));
  });

  it("yields zero rows (never partials) when the day has no snapshot", async () => {
    const catalog = {
      getDiscoverFeed: vi.fn().mockResolvedValue(null),
    } as unknown as SourceContext["catalog"];
    const source = discoverSnapshotSource({
      sourceId: "x",
      feedKind: "trending",
      sort: "popularity_desc",
    });
    const { rows, partial } = await source.fetchRawSet({ ...makeCtx(), catalog }, undefined, null);
    expect(rows).toEqual([]);
    expect(partial).toBe(false);
  });
});
