import { Hono } from "hono";
import { profileQuerySchema } from "@ent-mcp/shared/preferences";
import { requireSession, sessionUserId } from "../../auth";
import { currentRequestContext } from "../../diagnostics/request-context";
import { zValidator } from "../../diagnostics/validator";
import * as jobs from "../../jobs";
import { jobErrors } from "../../jobs/errors";
import { latestRun } from "../../jobs/history";
import { getPreferenceEngine, PREFERENCE_MANUAL_REBUILD_JOB_ID } from "../../preferences";

export const preferencesApp = new Hono()
  .use("*", requireSession)
  .get("/profile", zValidator("query", profileQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const profile = await getPreferenceEngine().getProfile(userId, c.req.valid("query").mediaType);
    return c.json({ profile });
  })
  .post("/rebuild", async (c) => {
    const userId = sessionUserId(c);
    const entry = jobs.find(PREFERENCE_MANUAL_REBUILD_JOB_ID);
    if (!entry || entry.kind !== "triggerable")
      throw jobErrors.notFound(PREFERENCE_MANUAL_REBUILD_JOB_ID);
    const requestId = currentRequestContext()?.requestId;
    const outcome = await entry.triggerFromApi!(
      { userId },
      { triggeredBy: "user", triggeredByUserId: userId, requestId },
    );
    return c.json(outcome);
  })
  .get("/rebuild/status", async (c) => {
    const userId = sessionUserId(c);
    const run = await latestRun(PREFERENCE_MANUAL_REBUILD_JOB_ID, userId);
    if (!run) return c.json({ status: "idle" as const });
    return c.json({
      status: run.status,
      ...(run.finishedAt !== null ? { lastRunAt: run.finishedAt } : {}),
    });
  });
