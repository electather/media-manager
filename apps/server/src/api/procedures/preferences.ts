import { Hono } from "hono";
import { profileQuerySchema } from "@ent-mcp/shared/preferences";
import { requireSession, sessionUserId } from "../../auth";
import { currentRequestContext } from "../../diagnostics/request-context";
import { zValidator } from "../../diagnostics/validator";
import { getPreferencesService } from "../../preferences";

export const preferencesApp = new Hono()
  .use("*", requireSession)
  .get("/profile", zValidator("query", profileQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const profile = await getPreferencesService().getProfile(
      userId,
      c.req.valid("query").mediaType,
    );
    return c.json({ profile });
  })
  .post("/rebuild", async (c) => {
    const userId = sessionUserId(c);
    const requestId = currentRequestContext()?.requestId;
    const outcome = await getPreferencesService().triggerManualRebuild(
      { userId },
      { triggeredBy: "user", triggeredByUserId: userId, requestId },
    );
    return c.json(outcome);
  })
  .get("/rebuild/status", async (c) => {
    const userId = sessionUserId(c);
    const run = await getPreferencesService().getManualRebuildStatus(userId);
    if (!run) return c.json({ status: "idle" as const });
    return c.json({
      status: run.status,
      ...(run.finishedAt !== null ? { lastRunAt: run.finishedAt } : {}),
    });
  });
