import { Hono, type Context } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth/middleware";
import { badRequest } from "../../errors/http-errors";
import { currentRequestContext } from "../../errors/request-context";
import { zValidator } from "../../errors/validator";
import * as jobs from "../../jobs";
import { jobErrors } from "../../jobs/errors";
import { recentRuns } from "../../jobs/history";
import { getPreferenceEngine } from "../../preferences";
import { PREFERENCE_MANUAL_REBUILD_JOB_ID } from "../../preferences/jobs";

const profileQuerySchema = z.object({
  mediaType: z.enum(["movie", "tv", "combined"]).default("combined"),
});

interface SessionCtx {
  user: { id: string };
}

function sessionUserId(c: Context): string {
  const session = c.get("session") as SessionCtx | undefined;
  if (!session) throw badRequest("http.unauthorized", "unauthorized");
  return session.user.id;
}

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
    const runs = await recentRuns(PREFERENCE_MANUAL_REBUILD_JOB_ID, 5);
    const latest = runs.find((r) => r.scopeKey === userId);
    if (!latest) return c.json({ status: "idle" as const });
    const mapped: { status: string; lastRunAt?: number } = {
      status: latest.status === "running" ? "running" : latest.status,
    };
    if (latest.finishedAt) mapped.lastRunAt = latest.finishedAt;
    return c.json(mapped);
  });
