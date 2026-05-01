import { Hono } from "hono";
import {
  jobCancelBodySchema,
  jobConfigBodySchema as configBodySchema,
  jobRunsQuerySchema as runsQuerySchema,
  triggerBodySchema,
} from "@ent-mcp/shared/jobs";
import { requireSession, requirePermission, sessionUserId } from "../../auth/middleware";
import { PERMISSIONS } from "../../auth/permissions";
import { currentRequestContext } from "../../errors/request-context";
import { zValidator } from "../../errors/validator";
import * as jobs from "../../jobs";
import { jobErrors } from "../../jobs/errors";
import type { RegistryEntry } from "../../jobs/registry";
import { recentRunsFiltered, getRunDetail } from "../../jobs/history";

function requireEntry(jobId: string): RegistryEntry {
  const entry = jobs.find(jobId);
  if (!entry) throw jobErrors.notFound(jobId);
  return entry;
}

function requireAdminTriggerable(entry: RegistryEntry): void {
  if (!entry.triggerFromApi) {
    throw jobErrors.wrongKind(entry.id, `job ${entry.id} is not admin-triggerable`);
  }
}

const LIST_CAP = 500;

// ─── Admin endpoints (admin:jobs) ─────────────────────────────────────────────

export const adminJobsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_JOBS))
  .get("/", async (c) => {
    const handles = await jobs.list();
    // fallow-ignore-next-line complexity
    handles.sort((a, b) => (b.lastRun?.startedAt ?? 0) - (a.lastRun?.startedAt ?? 0));
    return c.json({ jobs: handles.slice(0, LIST_CAP) });
  })
  .get("/:id/runs", zValidator("query", runsQuerySchema), async (c) => {
    const id = c.req.param("id");
    requireEntry(id);
    const { limit, scopeKey, status } = c.req.valid("query");
    const runs = await recentRunsFiltered(id, limit, scopeKey, status);
    return c.json({ runs } as const);
  })
  .get("/:id/runs/:runId", async (c) => {
    const id = c.req.param("id");
    const runId = c.req.param("runId");
    requireEntry(id);
    const run = await getRunDetail(runId);
    if (!run || run.jobId !== id) throw jobErrors.notFound(id);
    return c.json({ run });
  })
  // fallow-ignore-next-line complexity
  .post("/:id/trigger", zValidator("json", triggerBodySchema), async (c) => {
    const id = c.req.param("id");
    const entry = requireEntry(id);

    // Admin can trigger:
    // 1. adminTriggerable scheduled / scheduled_per_row jobs (no input)
    // 2. admin:jobs-required triggerable jobs (with input)
    // 3. feature-scoped triggerable jobs (bypasses feature check, admin auth suffices)
    if (entry.kind === "triggerable") {
      // Triggerable jobs always have triggerFromApi wired
      if (!entry.triggerFromApi) {
        throw jobErrors.wrongKind(id, `job ${id} is not triggerable`);
      }
    } else {
      // Scheduled / scheduled_per_row — only if adminTriggerable
      requireAdminTriggerable(entry);
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
  .post("/:id/cancel", zValidator("json", jobCancelBodySchema), async (c) => {
    const id = c.req.param("id");
    const entry = requireEntry(id);
    const scopeKey = c.req.valid("json")?.scopeKey;
    const cancelled = entry.cancel ? entry.cancel(scopeKey) : false;
    if (!cancelled) throw jobErrors.wrongKind(id, "no active run to cancel");
    return c.json({ ok: true });
  })
  // fallow-ignore-next-line complexity
  .post("/:id/config", zValidator("json", configBodySchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    try {
      const handle = await jobs.applyConfigChange(id, {
        enabled: body.enabled,
        scheduleOverride: body.scheduleOverride,
        logLevel: body.logLevel,
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
  // fallow-ignore-next-line complexity
  .post("/:id/trigger-user", zValidator("json", triggerBodySchema), async (c) => {
    const id = c.req.param("id");
    const entry = requireEntry(id);
    if (entry.kind !== "triggerable") {
      throw jobErrors.wrongKind(id, "job is not reachable from user trigger");
    }
    if (
      typeof entry.requiredPermission !== "object" ||
      entry.requiredPermission.kind !== "feature"
    ) {
      throw jobErrors.forbidden();
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
