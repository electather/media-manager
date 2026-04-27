import { consola } from "consola";
import type { HomeRowStub, LayoutHero, RowKind } from "@ent-mcp/shared/home";
import { AllPluginsFailedError } from "../media/errors";
import { encodeCursor } from "./cursor";
import type { LayoutSignals } from "./signals";
import {
  HERO_REASONS,
  ROW_TITLES,
  TITLE_OVERRIDE_MAP,
  makeHero,
  resolveHeroCandidates,
  resolveLayoutOrder,
  type FetchOutcome,
  type FetchedRow,
} from "./rules";
import {
  ROW_FETCHERS,
  type RowFetchContext,
  type RowFetchResult,
  type RowFetcher,
} from "./rows/index";

/**
 * Per-row wall-clock budget for the layout pipeline. Bumped from 3s after
 * #135: a single ~1.2s upstream call followed by `invokeOne`'s rate-limit
 * retry (2s sleep + 1.2s retry) overran the original 3s and dropped the
 * row from the layout entirely. Paired with `deadlineMs` on `InvokeRequest`
 * so `invokeOne` skips a retry when the remaining budget cannot fit it,
 * surfacing the original error as `partial: true` instead of a hard timeout.
 */
const PER_ROW_TIMEOUT_MS = 5_000;

export interface LayoutPipelineResult {
  hero: LayoutHero | null;
  stubs: HomeRowStub[];
}

/**
 * Builds a stub for each row in `order` without fetching any items. The
 * `initialCursor` is null for most rows; `becauseYouWatched` gets a
 * seed-pinned cursor so subsequent `getRowContent` calls stay bound to the
 * same seed item across the scroll session.
 */
export function buildRowStubs(order: RowKind[], signals: LayoutSignals): HomeRowStub[] {
  return order.map((rowId) => {
    const stub: HomeRowStub = {
      rowId,
      title: ROW_TITLES[rowId],
      initialCursor:
        rowId === "becauseYouWatched" && signals.recentSeed
          ? encodeCursor("becauseYouWatched", {
              v: 1,
              r: "becauseYouWatched",
              p: 1,
              s: signals.recentSeed.id,
            })
          : null,
    };
    if (rowId === "becauseYouWatched" && signals.recentSeed) {
      stub.subtitle = `Because you watched ${signals.recentSeed.title}`;
    }
    return stub;
  });
}

/**
 * Tries each candidate row in priority order, fetching a single item. Stops
 * at the first row that returns a non-empty result and builds the hero from
 * it. Returns `heroCursor` — the cursor after that one item — which the
 * caller stamps onto the source row stub so clients skip the hero item when
 * they paginate.
 */
export async function fetchHero(
  candidates: RowKind[],
  ctx: RowFetchContext,
): Promise<{ hero: LayoutHero | null; heroSource: RowKind | null; heroCursor: string | null }> {
  for (const rowId of candidates) {
    const result = await runFetch(rowId, ctx, { cursor: null, limit: 1 });
    if (result.items.length === 0) continue;
    const item = result.items[0]!;
    const reason = HERO_REASONS[rowId];
    if (!reason) continue;
    const hero = makeHero(item, rowId, reason);
    return { hero, heroSource: rowId, heroCursor: result.cursor };
  }
  return { hero: null, heroSource: null, heroCursor: null };
}

/**
 * Runs the layout pipeline:
 *   1. Compute candidate row order (pure).
 *   2. Build row stubs without fetching items (pure).
 *   3. Fetch one item from the hero-candidate row only.
 *   4. Stamp `titleOverride` and `initialCursor` onto the hero source stub.
 *   5. Drop the hero source stub when `heroCursor` is null (hero consumed the
 *      only item in that row — equivalent to the old `applyHeroExclusion` +
 *      `dropEmpty` behavior).
 */
export async function runLayoutPipeline(
  signals: LayoutSignals,
  ctx: RowFetchContext,
): Promise<LayoutPipelineResult> {
  const order = resolveLayoutOrder(signals);
  const stubs = buildRowStubs(order, signals);
  const candidates = resolveHeroCandidates(signals, order);
  const { hero, heroSource, heroCursor } = await fetchHero(candidates, ctx);

  const finalStubs = stubs
    .map((stub) => {
      if (stub.rowId !== heroSource) return stub;
      if (heroCursor === null) return null; // hero took the only item
      return {
        ...stub,
        initialCursor: heroCursor,
        titleOverride: TITLE_OVERRIDE_MAP[stub.rowId],
      };
    })
    .filter((s): s is HomeRowStub => s !== null);

  return { hero, stubs: finalStubs };
}

const TIMEOUT_SENTINEL: unique symbol = Symbol("home-row-timeout");

/**
 * Single dispatch wrapper for a fetcher. `FetchOutcome` is computed here so
 * row implementations cannot misreport their own status.
 */
export async function runFetch(
  rowId: RowKind,
  ctx: RowFetchContext,
  opts: { cursor: string | null; limit: number },
): Promise<LayoutFetchedRow> {
  const fetcher = ROW_FETCHERS[rowId];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), PER_ROW_TIMEOUT_MS);
  });
  const deadlineCtx: RowFetchContext = {
    ...ctx,
    deadlineMs: ctx.deadlineMs ?? Date.now() + PER_ROW_TIMEOUT_MS,
  };
  try {
    const raced = await Promise.race<RowFetchResult | typeof TIMEOUT_SENTINEL>([
      fetcher.fetch(deadlineCtx, opts),
      timeoutPromise,
    ]);
    if (raced === TIMEOUT_SENTINEL) return emptyRow(fetcher, "timeout");
    return classify(fetcher, raced);
  } catch (err) {
    if (err instanceof AllPluginsFailedError) return emptyRow(fetcher, "all_failed");
    consola.warn(`[home/layout] ${rowId} fetch threw — falling back to all_failed:`, err);
    return emptyRow(fetcher, "all_failed");
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export type LayoutFetchedRow = FetchedRow;

function classify(fetcher: RowFetcher, result: RowFetchResult): LayoutFetchedRow {
  const outcome: FetchOutcome = result.partial
    ? "partial"
    : result.items.length === 0
      ? "ok_empty"
      : "ok_items";
  return {
    rowId: fetcher.rowId,
    title: ROW_TITLES[fetcher.rowId],
    items: result.items,
    cursor: result.cursor,
    outcome,
    ...(result.partial ? { partial: true as const } : {}),
  };
}

function emptyRow(fetcher: RowFetcher, outcome: FetchOutcome): LayoutFetchedRow {
  return {
    rowId: fetcher.rowId,
    title: ROW_TITLES[fetcher.rowId],
    items: [],
    cursor: null,
    outcome,
  };
}

export type { FetchOutcome } from "./rules";
export type { CompactMediaItem } from "@ent-mcp/shared/home";
