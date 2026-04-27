import { consola } from "consola";
import type { CompactMediaItem, HomeRow, RowKind } from "@ent-mcp/shared/home";
import { AllPluginsFailedError } from "../media/errors";
import { encodeCursor } from "./cursor";
import {
  ROW_TITLES,
  applyHeroExclusion,
  dropEmpty,
  resolveHero,
  resolveLayoutOrder,
  type FetchOutcome,
  type FetchedRow,
} from "./rules";
import type { LayoutSignals } from "./signals";
import {
  FIRST_PAGE_LIMIT,
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

/**
 * Result of running a single fetcher under the orchestrator's timeout +
 * outcome-classification wrapper. `outcome` discriminates the reason the row
 * may be empty so `dropEmpty` and the hero pipeline can treat each case
 * correctly. The wire-level `partial` mirrors `outcome === "partial"`.
 */
export type LayoutFetchedRow = FetchedRow;

export interface LayoutPipelineResult {
  hero: ReturnType<typeof resolveHero>;
  rows: LayoutFetchedRow[];
}

/**
 * Runs the full layout pipeline against a precomputed signal snapshot:
 *   1. Compute candidate row order (pure).
 *   2. Dispatch every row's fetch in parallel through `runFetch`.
 *   3. Resolve a hero from the populated rows.
 *   4. Apply hero exclusion (drops the picked item from its source row).
 *   5. Drop empty rows except for `upcomingForYou`'s `ok_empty` exemption.
 */
export async function runLayoutPipeline(
  signals: LayoutSignals,
  ctx: RowFetchContext,
): Promise<LayoutPipelineResult> {
  const order = resolveLayoutOrder(signals);
  const fetched = await Promise.all(
    order.map((rowId) => runFetch(rowId, ctx, buildLayoutOpts(rowId, signals))),
  );
  const indexed = new Map<RowKind, LayoutFetchedRow>(fetched.map((row) => [row.rowId, row]));
  const hero = resolveHero(signals, indexed);
  const heroApplied = applyHeroExclusion(fetched, hero);
  const rows = dropEmpty(heroApplied);
  return { hero, rows };
}

/**
 * Builds the per-row first-page options. Most rows pass `null` for cursor;
 * `becauseYouWatched` requires a layout-time synthesised initial cursor that
 * pins the seed for the entire scroll session (V11).
 */
function buildLayoutOpts(
  rowId: RowKind,
  signals: LayoutSignals,
): { cursor: string | null; limit: number } {
  if (rowId === "becauseYouWatched" && signals.recentSeed) {
    return {
      cursor: encodeCursor("becauseYouWatched", {
        v: 1,
        r: "becauseYouWatched",
        p: 1,
        s: signals.recentSeed.id,
      }),
      limit: FIRST_PAGE_LIMIT,
    };
  }
  return { cursor: null, limit: FIRST_PAGE_LIMIT };
}

const TIMEOUT_SENTINEL: unique symbol = Symbol("home-row-timeout");

/**
 * Single dispatch wrapper for a fetcher. This is the only place
 * `FetchOutcome` is computed — row implementations cannot lie about whether
 * they timed out. The classification rules:
 *   - `ok_items`  — fetch succeeded with at least one item.
 *   - `ok_empty`  — fetch succeeded with zero items, no plugin errors.
 *   - `partial`   — fetch succeeded but at least one peer plugin errored.
 *   - `timeout`   — exceeded the 3s per-row budget.
 *   - `all_failed` — every contributing provider errored
 *                    (`AllPluginsFailedError` from `MediaService`).
 *
 * Order matters: `partial` wins over `ok_empty` when items is empty but
 * peers errored — otherwise `upcomingForYou`'s drop-empty exemption would
 * render "you're caught up" copy during a calendar plugin outage.
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
  // Inherit any caller-supplied deadline (e.g. tests) but default to the
  // per-row budget so `invokeOne` can short-circuit retry backoffs that
  // would otherwise overrun the wall-clock timer above.
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

/**
 * Strips internal-only fields (`outcome`) when projecting a `FetchedRow`
 * onto the wire. Callers see only the fields documented in
 * `@ent-mcp/shared/home`.
 */
export function toHomeRow(row: LayoutFetchedRow): HomeRow {
  const out: HomeRow = {
    rowId: row.rowId,
    title: row.title,
    items: row.items,
    cursor: row.cursor,
  };
  if (row.subtitle) out.subtitle = row.subtitle;
  if (row.titleOverride) out.titleOverride = row.titleOverride;
  if (row.partial) out.partial = true;
  return out;
}

/** Subtitle support — `becauseYouWatched` is the only dynamic case today. */
export function applyDynamicSubtitles(
  rows: LayoutFetchedRow[],
  signals: LayoutSignals,
): LayoutFetchedRow[] {
  return rows.map((row) => {
    if (row.rowId === "becauseYouWatched" && signals.recentSeed) {
      return { ...row, subtitle: `Because you watched ${signals.recentSeed.title}` };
    }
    return row;
  });
}

/** Convenience for tests: re-export the outcome alphabet at the boundary. */
export type { FetchOutcome } from "./rules";
export type { CompactMediaItem };
