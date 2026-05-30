import { consola } from "consola";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { encode } from "@ent-mcp/shared/media";
import { itemsQuerySchema, MOOD_IDS } from "@ent-mcp/shared/watchlist";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { HttpError } from "../../../diagnostics/http-errors";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

vi.mock("../../../auth", () => ({
  requireSession: async (
    c: { set: (k: string, v: unknown) => void },
    next: () => Promise<void>,
  ) => {
    c.set("session", { user: { id: "u1" } });
    await next();
  },
  sessionUserId: () => "u1",
}));

// Spy `listRows` while keeping every other media export real, so the source +
// cfg both the old endpoints and the resolver feed the pipeline are built by the
// real wiring — we capture the call args and assert they are identical (RISK-202
// read parity), without running the read pipeline / db.
const SPY_PAGE = { items: [], cursor: null, partial: false };
vi.mock("../../../media", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../media")>();
  return { ...actual, listRows: vi.fn(async () => SPY_PAGE) };
});

const media = await import("../../../media");
const { listItems, listMoodItems, getRecentlyAdded } = await import("../../../watchlist");
const { homeMediaSources } = await import("../../../home");
const { ROW_PROVIDERS } = await import("../../../home/rows");
const { watchlistReadLimiter } = await import("../media");
const { mediaApp } = await import("../media");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/media", mediaApp)
    .notFound(() => {
      throw new HttpError(404, "http.not_found", "route not found");
    })
    .onError(errorHandler);
}

/** Loose per-request context for the old watchlist service fns (listRows is spied,
 *  so no service handle is actually dereferenced). */
const oldCtx = {
  userId: "u1",
  mediaService: {} as never,
  catalog: {} as never,
  statusBatch: {} as never,
  logger: consola.withTag("parity"),
  log: consola.withTag("parity"),
};

/** Run one read and return the single `listRows` call it produced. */
async function capture(run: () => Promise<unknown>): Promise<unknown[]> {
  vi.mocked(media.listRows).mockClear();
  await run();
  const calls = vi.mocked(media.listRows).mock.calls;
  expect(calls).toHaveLength(1);
  return calls[0]!;
}

/** The parity-relevant slice of a `listRows` call: the source's stage declaration
 *  (cursor mode / sort / filter / classify) and the decoded-cursor config. Equal
 *  here ⇒ identical pipeline run ⇒ identical item ids / order / cursor. */
function summarize(call: unknown[]) {
  const [source, cfg] = call as [{ stages: unknown }, unknown];
  return { stages: source.stages, cfg };
}

async function resolverCall(url: string): Promise<unknown[]> {
  return capture(async () => {
    const res = await buildApp().request(url);
    expect(res.status).toBe(200);
  });
}

beforeEach(() => {
  watchlistReadLimiter.reset?.();
});

describe("media resolver read parity vs the old endpoints (US-003, RISK-202)", () => {
  it("watchlist-items recent (keyset) matches /watchlist/items first page", async () => {
    const oldArgs = await capture(() => listItems(oldCtx, itemsQuerySchema.parse({})));
    const newArgs = await resolverCall("/media/sources/watchlist-items");
    expect(summarize(newArgs)).toEqual(summarize(oldArgs));
  });

  it("watchlist-items recent (keyset) matches on a page-2 keyset cursor", async () => {
    const cursor = encode({ mode: "keyset", k: "42:id-a" });
    const oldArgs = await capture(() => listItems(oldCtx, itemsQuerySchema.parse({ cursor })));
    const newArgs = await resolverCall(`/media/sources/watchlist-items?cursor=${cursor}`);
    expect(summarize(newArgs)).toEqual(summarize(oldArgs));
    // The keyset cursor decoded identically on both paths (not reset to page 1).
    expect((summarize(newArgs).cfg as { cursor: unknown }).cursor).toEqual({
      mode: "keyset",
      k: "42:id-a",
    });
  });

  it("watchlist-items alpha (offset) matches — incl. a page-2 OFFSET cursor (dynamic mode)", async () => {
    const cursor = encode({ mode: "offset", n: 60 });
    const oldArgs = await capture(() =>
      listItems(oldCtx, itemsQuerySchema.parse({ sort: "alpha", cursor })),
    );
    const newArgs = await resolverCall(
      `/media/sources/watchlist-items?sort=alpha&cursor=${cursor}`,
    );
    expect(summarize(newArgs)).toEqual(summarize(oldArgs));
    // The offset cursor survived the resolver's lenient decode (a static keyset
    // expected-mode would have reset it to page 1 — the US-002 design-gap fix).
    expect((summarize(newArgs).cfg as { cursor: unknown }).cursor).toEqual({
      mode: "offset",
      n: 60,
    });
  });

  it("watchlist-items ready bucket (offset + bucket filter) matches", async () => {
    const oldArgs = await capture(() =>
      listItems(oldCtx, itemsQuerySchema.parse({ bucket: "ready" })),
    );
    const newArgs = await resolverCall("/media/sources/watchlist-items?bucket=ready");
    expect(summarize(newArgs)).toEqual(summarize(oldArgs));
  });

  it("watchlist-mood-items matches /watchlist/moods/:moodId/items", async () => {
    const moodId = MOOD_IDS[0]!;
    const oldArgs = await capture(() => listMoodItems(oldCtx, moodId, { limit: 60 }));
    const newArgs = await resolverCall(
      `/media/sources/watchlist-mood-items?moodId=${moodId}&limit=60`,
    );
    expect(summarize(newArgs)).toEqual(summarize(oldArgs));
  });

  it("watchlist-recently matches /watchlist/sections/recently", async () => {
    const oldArgs = await capture(() => getRecentlyAdded(oldCtx, 10));
    const newArgs = await resolverCall("/media/sources/watchlist-recently?limit=10");
    expect(summarize(newArgs)).toEqual(summarize(oldArgs));
  });

  it("watchlist-recently / -tonight return the one Page shape with cursor:null (bounded)", async () => {
    const recently = await buildApp().request("/media/sources/watchlist-recently");
    expect(recently.status).toBe(200);
    expect(await recently.json()).toEqual(SPY_PAGE);
    const tonight = await buildApp().request("/media/sources/watchlist-tonight");
    expect(tonight.status).toBe(200);
  });

  // Home read parity rides on the shared `buildRowPipeline` (US-002): each home
  // registration's `build` and the row provider's `load` (what the old
  // `composeRow` runs) feed `listRows` the same source + cfg, and the resolver
  // decodes a home cursor with the same expected mode the old `decodeRowCursor`
  // used. We assert that equivalence directly (the resolver's home eligibility
  // gate needs live plugins, so we don't drive it over HTTP here).
  it("home registration build matches the row provider's pipeline wiring", () => {
    for (const rowId of Object.keys(homeMediaSources)) {
      const provider = ROW_PROVIDERS[rowId]!;
      const fromProvider = provider.buildPipeline(oldCtx, null);
      const fromRegistry = homeMediaSources[rowId]!.build(oldCtx, {}, null);
      expect(fromRegistry.source).toBe(fromProvider.source);
      expect(fromRegistry.cfg).toEqual(fromProvider.cfg);
      // The resolver decodes against `reg.cursorMode`; the old `decodeRowCursor`
      // decoded against `provider.cursorMode` — they are the same mode.
      expect(homeMediaSources[rowId]!.cursorMode).toBe(provider.cursorMode);
    }
  });
});
