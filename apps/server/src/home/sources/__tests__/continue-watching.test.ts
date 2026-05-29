import { consola } from "consola";
import { describe, expect, it, vi } from "vite-plus/test";

// `continueWatchingActiveSource` pulls the media barrel (`media → db → env`) for
// `isActiveContinueWatchingEntry`, so the env must be stubbed.
vi.mock("../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

const { continueWatchingActiveSource, continueWatchingNextSource } =
  await import("../continue-watching");
const { CONTINUE_WATCHING_FEED } = await import("../../__tests__/fixtures/home-layout-scenario");

type SourceContext = Parameters<typeof continueWatchingActiveSource.fetchRawSet>[0];
type CwRow = Awaited<ReturnType<typeof continueWatchingActiveSource.fetchRawSet>>["rows"][number];

/** Build a minimal `SourceContext` whose mediaService resolves the CW feed. */
function makeCtx(getContinueWatchingFeed: ReturnType<typeof vi.fn>): SourceContext {
  return {
    userId: "u1",
    mediaService: { getContinueWatchingFeed } as unknown as SourceContext["mediaService"],
    catalog: {} as SourceContext["catalog"],
    statusBatch: {} as SourceContext["statusBatch"],
    logger: consola.withTag("cw-source-test"),
  };
}

const tmdbIdsOf = (rows: CwRow[]): Array<string | undefined> => rows.map((r) => r.item.ids?.tmdb);

// RISK-103 / design §T: the source must reproduce the US-019 captured selection
// + order. The WHY (Rule 9): a filter / sort change snuck into `fetchRawSet`
// would fail here, not ship.
describe("home continue-watching sources", () => {
  it("carry no filter/cursor stage logic — identity sort, offset mode (V.MC1)", () => {
    expect(continueWatchingActiveSource.stages).toEqual({ sort: "none", cursorMode: "offset" });
    expect(continueWatchingNextSource.stages).toEqual({ sort: "none", cursorMode: "offset" });
    expect(continueWatchingActiveSource.stages.classify).toBeUndefined();
    expect(continueWatchingActiveSource.stages.filter).toBeUndefined();
  });

  it("active: keeps in-progress entries (ratio < 0.85), sorted by lastPlayedAt desc", async () => {
    const getFeed = vi.fn().mockResolvedValue({ items: CONTINUE_WATCHING_FEED, partial: false });
    const { rows, partial, nextRaw } = await continueWatchingActiveSource.fetchRawSet(
      makeCtx(getFeed),
      undefined,
      null,
    );
    // cwa1 (ratio 0.1) + cwa2 (0.5) survive; cwn1 (0.95) is excluded; ordered by
    // lastPlayedAt desc (cwa1 newer than cwa2).
    expect(tmdbIdsOf(rows)).toEqual(["cwa1", "cwa2"]);
    expect(partial).toBe(false);
    // An offset source mints no hop token — the pipeline owns the slice/cursor.
    expect(nextRaw).toBeUndefined();
  });

  it("next: keeps nextUp episodes and no-progress shelf entries in feed order", async () => {
    const getFeed = vi.fn().mockResolvedValue({ items: CONTINUE_WATCHING_FEED, partial: false });
    const { rows } = await continueWatchingNextSource.fetchRawSet(
      makeCtx(getFeed),
      undefined,
      null,
    );
    expect(tmdbIdsOf(rows)).toEqual(["cwn1", "cwn2"]);
  });

  it("propagates a plugin soft-failure as partial", async () => {
    const getFeed = vi.fn().mockResolvedValue({ items: [], partial: true });
    const { rows, partial } = await continueWatchingNextSource.fetchRawSet(
      makeCtx(getFeed),
      undefined,
      null,
    );
    expect(rows).toEqual([]);
    expect(partial).toBe(true);
  });
});
