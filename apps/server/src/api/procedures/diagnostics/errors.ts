import { Hono } from "hono";
import { and, desc, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  errorListQuerySchema as listSchema,
  errorReportSchema as reportSchema,
  type ErrorSeverity,
  type ErrorSource,
} from "@ent-mcp/shared/diagnostics";
import { requireSession, requirePermission, PERMISSIONS } from "../../../auth";
import { getDb } from "../../../db/client";
import { errorRecords } from "../../../db/schema/diagnostics";
import { captureError } from "../../../diagnostics/capture";
import { zValidator } from "../../../diagnostics/validator";
import { notFound } from "../../../diagnostics/http-errors";

interface SessionCtx {
  user: { id: string };
}

/** Frontend-facing endpoint mounted at `/api/diagnostics/errors` (POST).
 *  Scrubbed and persisted with `source="frontend"`. Silently accepts even
 *  malformed bodies so we never surface "error capture failed" to the end user. */
// fallow-ignore-next-line complexity
export const errorsReportApp = new Hono()
  .use("*", requireSession)
  // fallow-ignore-next-line complexity
  .post("/", zValidator("json", reportSchema), async (c) => {
    const body = c.req.valid("json");
    const session = (
      c as unknown as {
        get: (key: "session") => SessionCtx | undefined;
      }
    ).get("session");
    try {
      const syntheticError = new Error(body.message);
      syntheticError.name = body.name ?? "FrontendError";
      if (body.stack) syntheticError.stack = body.stack;
      await captureError(syntheticError, {
        severity: body.severity,
        source: "frontend",
        code: body.code,
        route: body.route,
        userId: session?.user.id ?? null,
        requestId: body.requestId,
        context: body.context,
      });
    } catch {
      // Intentionally swallow. See docstring.
    }
    return c.json({ ok: true });
  });

/** Admin endpoints mounted at `/admin/diagnostics/errors`. Permission gated by
 *  `admin:plugins`. Same shape as the prior `/admin/errors` tree — only the
 *  prefix moved. */
// fallow-ignore-next-line complexity
export const adminErrorsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_PLUGINS))
  // fallow-ignore-next-line complexity
  .get("/", zValidator("query", listSchema), async (c) => {
    const q = c.req.valid("query");
    const db = getDb();
    const filters: SQL[] = [];
    // Default severity filter: show only "error" unless the client asks otherwise.
    const severity = q.severity && q.severity.length > 0 ? q.severity : (["error"] as const);
    filters.push(inArray(errorRecords.severity, severity as unknown as ErrorSeverity[]));
    if (q.source && q.source.length > 0) {
      filters.push(inArray(errorRecords.source, q.source as unknown as ErrorSource[]));
    }
    if (q.pluginId) filters.push(eq(errorRecords.pluginId, q.pluginId));
    if (q.since) filters.push(gte(errorRecords.createdAt, q.since));
    if (q.until) filters.push(sql`${errorRecords.createdAt} <= ${q.until}`);
    if (q.requestId) filters.push(eq(errorRecords.requestId, q.requestId));
    if (q.search && q.search.length > 0) {
      // `instr` does substring containment without wildcards, so a stray `%`
      // or `_` in the user query stays literal. Avoids the SQLite LIKE escape
      // dance (drizzle's `like` doesn't pass through an ESCAPE clause).
      const needle = q.search;
      const searchFilter = or(
        sql`instr(coalesce(${errorRecords.code}, ''), ${needle}) > 0`,
        sql`instr(${errorRecords.devMessage}, ${needle}) > 0`,
      );
      if (searchFilter) filters.push(searchFilter);
    }

    const where = filters.length > 0 ? and(...filters) : undefined;

    const rows = await db
      .select({
        id: errorRecords.id,
        requestId: errorRecords.requestId,
        severity: errorRecords.severity,
        source: errorRecords.source,
        code: errorRecords.code,
        devMessage: errorRecords.devMessage,
        route: errorRecords.route,
        httpStatus: errorRecords.httpStatus,
        userId: errorRecords.userId,
        pluginId: errorRecords.pluginId,
        createdAt: errorRecords.createdAt,
      })
      .from(errorRecords)
      .where(where)
      .orderBy(desc(errorRecords.createdAt))
      .limit(q.limit)
      .offset(q.offset)
      .all();

    const total = await db
      .select({ count: sql<number>`count(*)` })
      .from(errorRecords)
      .where(where)
      .get();

    return c.json({ records: rows, total: total?.count ?? 0 });
  })
  // fallow-ignore-next-line complexity
  .get("/summary", async (c) => {
    const db = getDb();
    const hourAgo = Date.now() - 60 * 60 * 1000;
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;

    const [lastHour, lastDay, sparkRows] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(errorRecords)
        .where(and(eq(errorRecords.severity, "error"), gte(errorRecords.createdAt, hourAgo)))
        .get(),
      db
        .select({ count: sql<number>`count(*)` })
        .from(errorRecords)
        .where(and(eq(errorRecords.severity, "error"), gte(errorRecords.createdAt, dayAgo)))
        .get(),
      // 24-bucket hourly histogram. SQLite has no DATE_TRUNC, so we floor on the client.
      db
        .select({ severity: errorRecords.severity, createdAt: errorRecords.createdAt })
        .from(errorRecords)
        .where(gte(errorRecords.createdAt, dayAgo))
        .all(),
    ]);

    const buckets = Array.from({ length: 24 }, () => ({ error: 0, warning: 0, info: 0 }));
    const bucketMs = 60 * 60 * 1000;
    const now = Date.now();
    for (const row of sparkRows) {
      const idx = 23 - Math.floor((now - row.createdAt) / bucketMs);
      if (idx >= 0 && idx < 24) {
        const bucket = buckets[idx]!;
        if (row.severity === "error") bucket.error += 1;
        else if (row.severity === "warning") bucket.warning += 1;
        else bucket.info += 1;
      }
    }

    return c.json({
      lastHour: lastHour?.count ?? 0,
      last24h: lastDay?.count ?? 0,
      hourlyBuckets: buckets,
    });
  })
  .get("/:id", async (c) => {
    const db = getDb();
    const row = await db
      .select()
      .from(errorRecords)
      .where(eq(errorRecords.id, c.req.param("id")))
      .get();
    if (!row) throw notFound("http.not_found", "error record not found");
    return c.json({ record: row });
  });
