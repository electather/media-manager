import type { PerfKind } from "@ent-mcp/shared/diagnostics";
import { groupBy } from "es-toolkit";

/** Bound on the number of rows we will pull into JS for in-memory percentile
 *  calculations. Beyond this, callers fall back to a per-group SQL slice. */
export const AGGREGATE_ROW_BUDGET = 50_000;

export interface RawPerfRow {
  kind: PerfKind;
  durationMs: number;
  route: string | null;
  pluginId: string | null;
  createdAt: number;
}

export interface AggregateRow {
  kind: PerfKind;
  route: string | null;
  pluginId: string | null;
  count: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  lastAt: number;
}

/** Computes a percentile from a sorted ascending array via linear-interpolated
 *  index. Returns `0` for empty input. Works correctly for `count=1` (returns
 *  the only sample regardless of percentile). */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = clamped * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const frac = idx - lo;
  return sorted[lo]! * (1 - frac) + sorted[hi]! * frac;
}

/** Groups the raw rows by `(kind, route)` or `(kind, pluginId)` and computes
 *  the count, p50/p95/p99, max, and lastAt per group. Sorted by p95 desc,
 *  capped at 100 rows. The cyclomatic count reflects field count, not
 *  branching logic. */
// fallow-ignore-next-line complexity
export function aggregatePerfRows(
  rows: RawPerfRow[],
  groupKey: "route" | "plugin",
): AggregateRow[] {
  if (rows.length === 0) return [];
  const grouped = groupBy(rows, (r) => {
    const part = groupKey === "route" ? (r.route ?? "(unknown)") : (r.pluginId ?? "(host)");
    return `${r.kind}:${part}`;
  });

  const out: AggregateRow[] = [];
  for (const list of Object.values(grouped)) {
    if (list.length === 0) continue;
    const first = list[0]!;
    const sorted = list.map((r) => r.durationMs).sort((a, b) => a - b);
    const max = sorted[sorted.length - 1]!;
    const lastAt = list.reduce((acc, r) => Math.max(acc, r.createdAt), 0);
    out.push({
      kind: first.kind,
      route: groupKey === "route" ? first.route : null,
      pluginId: groupKey === "plugin" ? first.pluginId : null,
      count: list.length,
      p50: Math.round(percentile(sorted, 0.5)),
      p95: Math.round(percentile(sorted, 0.95)),
      p99: Math.round(percentile(sorted, 0.99)),
      max,
      lastAt,
    });
  }
  out.sort((a, b) => b.p95 - a.p95);
  return out.slice(0, 100);
}
