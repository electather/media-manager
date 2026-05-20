import { Hono } from "hono";
import { and, desc, eq, gte, lte, sql, type SQL } from "drizzle-orm";
import {
  perfAggregateQuerySchema,
  perfListQuerySchema,
  type PerfKind,
} from "@ent-mcp/shared/diagnostics";
import { requireSession, requirePermission, PERMISSIONS } from "../../../auth";
import { getDb } from "../../../db/client";
import { errorRecords, perfRecords } from "../../../db/schema/infra/diagnostics";
import { zValidator } from "../../../diagnostics/validator";
import { notFound } from "../../../diagnostics/http-errors";
import { AGGREGATE_ROW_BUDGET, aggregatePerfRows, percentile } from "./perf-aggregate";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Admin endpoints mounted at `/admin/diagnostics/perf`. Permission gated by
 *  `admin:plugins`. */
// fallow-ignore-next-line complexity
export const adminPerfApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_PLUGINS))
  // fallow-ignore-next-line complexity
  .get("/list", zValidator("query", perfListQuerySchema), async (c) => {
    const q = c.req.valid("query");
    const db = getDb();
    const filters: SQL[] = [];
    if (q.kind) filters.push(eq(perfRecords.kind, q.kind));
    if (q.route) filters.push(eq(perfRecords.route, q.route));
    if (q.pluginId) filters.push(eq(perfRecords.pluginId, q.pluginId));
    if (q.requestId) filters.push(eq(perfRecords.requestId, q.requestId));
    if (q.since) filters.push(gte(perfRecords.createdAt, q.since));
    if (q.until) filters.push(lte(perfRecords.createdAt, q.until));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await db
      .select()
      .from(perfRecords)
      .where(where)
      .orderBy(desc(perfRecords.createdAt))
      .limit(q.limit)
      .offset(q.offset)
      .all();

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(perfRecords)
      .where(where)
      .get();

    return c.json({ records: rows, total: total?.count ?? 0 });
  })
  // fallow-ignore-next-line complexity
  .get("/aggregate", zValidator("query", perfAggregateQuerySchema), async (c) => {
    const q = c.req.valid("query");
    const db = getDb();
    const since = q.since ?? Date.now() - DAY_MS;
    const filters: SQL[] = [gte(perfRecords.createdAt, since)];
    if (q.kind) filters.push(eq(perfRecords.kind, q.kind));
    if (q.until) filters.push(lte(perfRecords.createdAt, q.until));
    if (q.requestId) filters.push(eq(perfRecords.requestId, q.requestId));

    const rows = await db
      .select({
        kind: perfRecords.kind,
        durationMs: perfRecords.durationMs,
        route: perfRecords.route,
        pluginId: perfRecords.pluginId,
        createdAt: perfRecords.createdAt,
      })
      .from(perfRecords)
      .where(and(...filters))
      .orderBy(desc(perfRecords.createdAt))
      .limit(AGGREGATE_ROW_BUDGET)
      .all();

    const truncated = rows.length === AGGREGATE_ROW_BUDGET;
    const groups = aggregatePerfRows(rows, q.groupBy);
    return c.json({
      groups,
      window: { since, until: q.until ?? Date.now() },
      truncated,
      sampleSize: rows.length,
    });
  })
  // fallow-ignore-next-line complexity
  .get("/summary", async (c) => {
    const db = getDb();
    const dayAgo = Date.now() - DAY_MS;
    const hourAgo = Date.now() - 60 * 60 * 1000;

    const [windowRows, lastHourCount] = await Promise.all([
      db
        .select({
          createdAt: perfRecords.createdAt,
          durationMs: perfRecords.durationMs,
        })
        .from(perfRecords)
        .where(and(eq(perfRecords.kind, "http"), gte(perfRecords.createdAt, dayAgo)))
        .all(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(perfRecords)
        .where(and(eq(perfRecords.kind, "http"), gte(perfRecords.createdAt, hourAgo)))
        .get(),
    ]);

    const buckets = Array.from({ length: 24 }, () => ({ count: 0, durations: [] as number[] }));
    const bucketMs = 60 * 60 * 1000;
    const now = Date.now();
    for (const row of windowRows) {
      const idx = 23 - Math.floor((now - row.createdAt) / bucketMs);
      if (idx >= 0 && idx < 24) {
        const bucket = buckets[idx]!;
        bucket.count += 1;
        bucket.durations.push(row.durationMs);
      }
    }

    const sortedAll = windowRows.map((r) => r.durationMs).sort((a, b) => a - b);
    const hourlySeries = buckets.map((b) => {
      const sorted = [...b.durations].sort((a, b) => a - b);
      return {
        count: b.count,
        p50: Math.round(percentile(sorted, 0.5)),
        p95: Math.round(percentile(sorted, 0.95)),
      };
    });

    return c.json({
      requestsPerMinute: Math.round((lastHourCount?.count ?? 0) / 60),
      p50: Math.round(percentile(sortedAll, 0.5)),
      p95: Math.round(percentile(sortedAll, 0.95)),
      p99: Math.round(percentile(sortedAll, 0.99)),
      hourlySeries,
    });
  })
  .get("/:id", async (c) => {
    const db = getDb();
    const row = await db
      .select()
      .from(perfRecords)
      .where(eq(perfRecords.id, c.req.param("id")))
      .get();
    if (!row) throw notFound("http.not_found", "perf record not found");
    const correlated = await db
      .select({
        id: errorRecords.id,
        severity: errorRecords.severity,
        code: errorRecords.code,
        devMessage: errorRecords.devMessage,
        createdAt: errorRecords.createdAt,
      })
      .from(errorRecords)
      .where(eq(errorRecords.requestId, row.requestId))
      .all();
    return c.json({ record: row, correlatedErrors: correlated });
  });

/** Re-exported for tests. */
export type { PerfKind };
