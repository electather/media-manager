import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { and, desc, eq, gte, inArray, like, or, sql, type SQL } from "drizzle-orm";
import { requireSession, requirePermission } from "../../auth/middleware";
import { PERMISSIONS } from "../../auth/permissions";
import { getDb } from "../../db/client";
import { errorRecords } from "../../db/schema/errors";
import { captureError } from "../../errors/capture";
import { getAppConfig, setErrorRetentionDays } from "../../errors/retention";
import type { ErrorSeverity, ErrorSource } from "../../errors/types";

interface SessionCtx {
  user: { id: string };
}

// ─── Frontend report endpoint ─────────────────────────────────────────────────

const reportSchema = z.object({
  severity: z.enum(["error", "warning"]),
  name: z.string().optional(),
  message: z.string(),
  stack: z.string().optional(),
  route: z.string().optional(),
  code: z.string().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

/** POST /api/errors — frontend pushes serialized errors here. Scrubbed + written with
 *  source="frontend". Silently accepts even malformed bodies so we never surface
 *  "error capture failed" to the end user. */
export const errorsApp = new Hono()
  .use("*", requireSession)
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
        context: body.context,
      });
    } catch {
      // Intentionally swallow. See docstring.
    }
    return c.json({ ok: true });
  });

// ─── Admin viewer endpoints ───────────────────────────────────────────────────

const severityValues = ["error", "warning"] as const;
const sourceValues = ["frontend", "backend", "plugin", "cron"] as const;

// Accepts comma-separated values (?severity=error,warning) for admin viewer URL sharing.
const commaList = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .optional()
    .transform((raw) => {
      if (!raw) return undefined;
      const parts = raw
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const allowed = new Set<string>(values as readonly string[]);
      return parts.filter((p): p is T[number] => allowed.has(p));
    });

const listSchema = z.object({
  severity: commaList(severityValues),
  source: commaList(sourceValues),
  pluginId: z.string().optional(),
  since: z.coerce.number().optional(),
  until: z.coerce.number().optional(),
  requestId: z.string().optional(),
  search: z.string().optional(),
  limit: z.coerce.number().min(1).max(200).default(50),
  offset: z.coerce.number().min(0).default(0),
});

const retentionSchema = z.object({
  errorRetentionDays: z.coerce.number().min(7).max(365),
});

export const adminErrorsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_PLUGINS))
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
      const pattern = `%${q.search}%`;
      const searchFilter = or(
        like(errorRecords.code, pattern),
        like(errorRecords.devMessage, pattern),
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
        .select({ createdAt: errorRecords.createdAt })
        .from(errorRecords)
        .where(and(eq(errorRecords.severity, "error"), gte(errorRecords.createdAt, dayAgo)))
        .all(),
    ]);

    const buckets = Array.from({ length: 24 }, () => 0);
    const bucketMs = 60 * 60 * 1000;
    const now = Date.now();
    for (const row of sparkRows) {
      const idx = 23 - Math.floor((now - row.createdAt) / bucketMs);
      if (idx >= 0 && idx < 24) buckets[idx] = (buckets[idx] ?? 0) + 1;
    }

    return c.json({
      lastHour: lastHour?.count ?? 0,
      last24h: lastDay?.count ?? 0,
      hourlyBuckets: buckets,
    });
  })
  .get("/config", async (c) => {
    const cfg = await getAppConfig();
    return c.json(cfg);
  })
  .put("/config", zValidator("json", retentionSchema), async (c) => {
    const days = await setErrorRetentionDays(c.req.valid("json").errorRetentionDays);
    return c.json({ errorRetentionDays: days });
  })
  .get("/:id", async (c) => {
    const db = getDb();
    const row = await db
      .select()
      .from(errorRecords)
      .where(eq(errorRecords.id, c.req.param("id")))
      .get();
    if (!row) return c.json({ error: "not found" }, 404);
    return c.json({ record: row });
  });
