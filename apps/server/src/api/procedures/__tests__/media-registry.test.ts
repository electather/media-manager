import { describe, expect, it, vi } from "vite-plus/test";
import { MEDIA_SOURCE_IDS, type MediaSourceId } from "@ent-mcp/shared/media";
import { MOOD_IDS } from "@ent-mcp/shared/watchlist";

vi.mock("../../../env", () => ({
  env: { CACHE_PROVIDER: "memory", ENCRYPTION_KEY: "test-key" },
}));

const { homeMediaSources } = await import("../../../home");
const { watchlistMediaSources } = await import("../../../watchlist");

/**
 * The adapter composes one registry from the two consumer barrels exactly as
 * `api/procedures/media.ts` will (design §A4) — `media` never imports a concrete
 * source (invariant V.RG1); the registry lives adapter-side.
 */
const REGISTRY = { ...homeMediaSources, ...watchlistMediaSources };

const HOME_IDS = Object.keys(homeMediaSources);
const WATCHLIST_IDS = Object.keys(watchlistMediaSources);

// A stub context is safe: `build` is pure construction (it captures the context
// in the lazy enrich closure but never runs `fetchRawSet`), so no DB/plugin
// access is triggered.
const stubCtx = {} as Parameters<(typeof REGISTRY)[MediaSourceId]["build"]>[0];

/** Per-source sample query the registration's `paramSchema` accepts. */
const SAMPLE_INPUT: Record<string, unknown> = {
  "watchlist-mood-items": { moodId: MOOD_IDS[0] },
};

describe("media source registry (US-002)", () => {
  it("surfaces both consumer registration maps through their barrels", () => {
    expect(typeof homeMediaSources).toBe("object");
    expect(typeof watchlistMediaSources).toBe("object");
  });

  it("resolves every MEDIA_SOURCE_IDS entry to exactly one registration", () => {
    for (const id of MEDIA_SOURCE_IDS) {
      expect(REGISTRY[id], `missing registration for ${id}`).toBeDefined();
      expect(REGISTRY[id]!.sourceId).toBe(id);
    }
    // No stray ids: the registry covers the tuple and nothing more.
    expect(Object.keys(REGISTRY).sort()).toEqual([...MEDIA_SOURCE_IDS].sort());
  });

  it("partitions the tuple cleanly across the two consumer barrels", () => {
    expect(HOME_IDS).toHaveLength(10);
    expect(WATCHLIST_IDS).toEqual([
      "watchlist-items",
      "watchlist-mood-items",
      "watchlist-recently",
      "watchlist-tonight",
    ]);
    // Disjoint — no id is registered by both consumers.
    expect(HOME_IDS.filter((id) => WATCHLIST_IDS.includes(id))).toEqual([]);
  });

  it("builds a source whose stages line up with the registration for every id", () => {
    for (const id of MEDIA_SOURCE_IDS) {
      const reg = REGISTRY[id]!;
      const params = reg.paramSchema.parse(SAMPLE_INPUT[id] ?? {});
      const built = reg.build(stubCtx, params, null);

      expect(built.source, `${id} build returned no source`).toBeDefined();
      expect(typeof built.source.fetchRawSet).toBe("function");
      expect(built.source.stages.sort, `${id} missing sort stage`).toBeDefined();
      // Under default params the built source's mode matches the declared one
      // (watchlist-items defaults to recent → keyset; its offset path is
      // asserted separately below).
      expect(built.source.stages.cursorMode).toBe(reg.cursorMode);
      // The resolver decoded the cursor; build threads it onto the config.
      expect(built.cfg).toBeDefined();
      expect(built.cfg.cursor).toBeNull();
    }
  });

  it("wires home rows with a custom enrich override and watchlist with the default fan-out", () => {
    for (const id of HOME_IDS) {
      const reg = REGISTRY[id]!;
      const built = reg.build(stubCtx, reg.paramSchema.parse({}), null);
      // Home feed rows are not persisted ActiveRows, so home injects its own
      // enrich (the row-aware match-reason chip).
      expect(typeof built.enrichRows, `${id} should inject enrichRows`).toBe("function");
    }
    for (const id of WATCHLIST_IDS) {
      const reg = REGISTRY[id]!;
      const built = reg.build(stubCtx, reg.paramSchema.parse(SAMPLE_INPUT[id] ?? {}), null);
      // Watchlist sources emit persisted ActiveRows → the default listRows
      // fan-out runs, so no override is supplied.
      expect(built.enrichRows, `${id} should not override enrich`).toBeUndefined();
    }
  });

  it("preserves per-consumer cursor-null policy + rate limit (V.CU1 / §A7)", () => {
    for (const id of HOME_IDS) {
      const reg = REGISTRY[id]!;
      expect(reg.cursorOnNull, `${id} home → 400`).toBe("400");
      expect(reg.rateLimit, `${id} home has no limiter`).toBeUndefined();
      expect(typeof reg.eligibility, `${id} home carries eligibility`).toBe("function");
    }
    for (const id of WATCHLIST_IDS) {
      const reg = REGISTRY[id]!;
      expect(reg.cursorOnNull, `${id} watchlist → first page`).toBe("firstPage");
      expect(reg.rateLimit, `${id} watchlist read limiter`).toBe("read");
      expect(typeof reg.eligibility, `${id} watchlist always eligible`).toBe("undefined");
    }
  });

  it("carries requiresInitialCursor only on the seeded home rows", () => {
    expect(REGISTRY.becauseYouWatched!.requiresInitialCursor).toBe(true);
    expect(REGISTRY.similarTo!.requiresInitialCursor).toBe(true);
    expect(REGISTRY["continueWatching-active"]!.requiresInitialCursor).toBeUndefined();
    for (const id of WATCHLIST_IDS) {
      expect(REGISTRY[id]!.requiresInitialCursor, `${id} needs no seed cursor`).toBeUndefined();
    }
  });

  it("flips watchlist-items to offset mode for a non-recent / filtered read", () => {
    const reg = REGISTRY["watchlist-items"]!;

    const recent = reg.build(stubCtx, reg.paramSchema.parse({ sort: "recent" }), null);
    expect(recent.source.stages.cursorMode).toBe("keyset");

    const alpha = reg.build(stubCtx, reg.paramSchema.parse({ sort: "alpha" }), null);
    expect(alpha.source.stages.cursorMode).toBe("offset");

    const bucketed = reg.build(stubCtx, reg.paramSchema.parse({ bucket: "ready" }), null);
    expect(bucketed.source.stages.cursorMode).toBe("offset");
  });
});
