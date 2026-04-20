import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireSession, requirePermission } from "../../auth/middleware";
import { PERMISSIONS } from "../../auth/permissions";
import { badRequest } from "../../errors/http-errors";
import { currentRequestContext } from "../../errors/request-context";
import { zValidator } from "../../errors/validator";
import * as jobs from "../../jobs";
import { jobErrors } from "../../jobs/errors";
import type { RegistryEntry } from "../../jobs/registry";
import { recentRuns } from "../../jobs/history";

const triggerBodySchema = z.unknown().optional();

const configBodySchema = z.object({
  enabled: z.boolean().optional(),
  scheduleOverride: z.string().nullable().optional(),
});

const runsQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(20),
});

interface SessionCtx {
  user: { id: string };
}

function sessionUserId(c: Context): string {
  const session = c.get("session") as SessionCtx | undefined;
  if (!session) throw badRequest("http.unauthorized", "unauthorized");
  return session.user.id;
}

function requireEntry(jobId: string): RegistryEntry {
  const entry = jobs.find(jobId);
  if (!entry) throw jobErrors.notFound(jobId);
  return entry;
}

function requireTriggerable(entry: RegistryEntry): void {
  if (entry.kind !== "triggerable") {
    throw jobErrors.wrongKind(entry.id, `job ${entry.id} is not triggerable`);
  }
}

async function loadRuns(jobId: string, limit: number) {
  return recentRuns(jobId, limit);
}

// ─── Admin endpoints (admin:jobs) ─────────────────────────────────────────────

export const adminJobsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_JOBS))
  .get("/", async (c) => {
    const handles = await jobs.list();
    return c.json({ jobs: handles });
  })
  .get("/:id", zValidator("query", runsQuerySchema), async (c) => {
    const id = c.req.param("id");
    const handle = await jobs.describe(id);
    if (!handle) throw jobErrors.notFound(id);
    const runs = await loadRuns(id, c.req.valid("query").limit);
    return c.json({ job: handle, runs });
  })
  .post("/:id/trigger", zValidator("json", triggerBodySchema), async (c) => {
    const id = c.req.param("id");
    const entry = requireEntry(id);
    requireTriggerable(entry);
    if (entry.requiredPermission !== "admin:jobs") {
      throw jobErrors.wrongKind(id, "job is not reachable from admin trigger");
    }
    const userId = sessionUserId(c);
    const requestId = currentRequestContext()?.requestId;
    const input = c.req.valid("json") ?? null;
    const out = await entry.triggerFromApi!(input, {
      triggeredBy: "admin",
      triggeredByUserId: userId,
      requestId,
    });
    return c.json(out);
  })
  .post("/:id/cancel", async (c) => {
    const id = c.req.param("id");
    const entry = requireEntry(id);
    const cancelled = entry.cancel ? entry.cancel() : false;
    if (!cancelled) throw jobErrors.wrongKind(id, "no active run to cancel");
    return c.json({ ok: true });
  })
  .post("/:id/config", zValidator("json", configBodySchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    try {
      const handle = await jobs.applyConfigChange(id, {
        enabled: body.enabled,
        scheduleOverride: body.scheduleOverride,
        updatedBy: sessionUserId(c),
      });
      if (!handle) throw jobErrors.notFound(id);
      return c.json({ job: handle });
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("invalid cron")) {
        throw jobErrors.badInput(err.message);
      }
      throw err;
    }
  });

// ─── User-scoped endpoint (authenticated users) ───────────────────────────────

export const userJobsApp = new Hono()
  .use("*", requireSession)
  .post("/:id/trigger-user", zValidator("json", triggerBodySchema), async (c) => {
    const id = c.req.param("id");
    const entry = requireEntry(id);
    requireTriggerable(entry);
    if (
      typeof entry.requiredPermission !== "object" ||
      entry.requiredPermission.kind !== "feature"
    ) {
      throw jobErrors.wrongKind(id, "job is not reachable from user trigger");
    }
    const userId = sessionUserId(c);
    const input = c.req.valid("json") ?? null;
    const allowed = await entry.requiredPermission.check(userId, input);
    if (!allowed) throw jobErrors.forbidden();

    const requestId = currentRequestContext()?.requestId;
    const out = await entry.triggerFromApi!(input, {
      triggeredBy: "user",
      triggeredByUserId: userId,
      requestId,
    });
    return c.json(out);
  });
