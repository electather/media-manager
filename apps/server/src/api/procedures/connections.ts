import { Hono } from "hono";
import {
  connectionCreateSchema as createSchema,
  connectionVerifyConfigSchema as verifyConfigSchema,
  connectionDisplayNameSchema as displayNameSchema,
  connectionUserConfigSchema as userConfigSchema,
  connectionEnabledSchema as enabledSchema,
  oauthDeviceStartSchema as deviceStartSchema,
  oauthDevicePollSchema as devicePollSchema,
  oauthRedirectStartSchema as redirectStartSchema,
  oauthRedirectCompleteSchema as redirectCompleteSchema,
} from "@nama/shared/connections";
import { requireSession, requirePermission, sessionUserId, PERMISSIONS } from "../../auth";
import { connectionsService } from "../../connections/service";
import { zValidator } from "../../diagnostics/validator";
import { makeRateLimitMiddleware } from "../rate-limit";
import { TokenBucketLimiter } from "../../mcp/rate-limit";
import { connectionsPrimaryApp } from "./connections-primary";

// Each limiter is per-user (keyed by sessionUserId). Without per-user limiting, one user
// can exhaust the shared per-plugin fetch quota used by verify/test/poll for all others.
// verify-config and test trigger real plugin fetches; poll is a tight polling loop.
const verifyConfigLimiter = new TokenBucketLimiter({ capacity: 10, refillPerSec: 10 / 60 });
const testLimiter = new TokenBucketLimiter({ capacity: 10, refillPerSec: 10 / 60 });
// poll runs on a short interval (typically 5s); 60-burst allows normal OAuth flows while blocking bulk hammering.
const devicePollLimiter = new TokenBucketLimiter({ capacity: 60, refillPerSec: 1 });

const verifyConfigRateLimit = makeRateLimitMiddleware({ limiter: verifyConfigLimiter });
const testRateLimit = makeRateLimitMiddleware({ limiter: testLimiter });
const devicePollRateLimit = makeRateLimitMiddleware({ limiter: devicePollLimiter });

export const connectionsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS))
  // Mount the primary sub-app before any `/:id` routes so `/primary` is
  // matched as a static path. Otherwise Hono routes `DELETE /primary` to the
  // dynamic `.delete("/:id")` handler below with `id = "primary"`.
  .route("/primary", connectionsPrimaryApp)
  .get("/", async (c) => {
    const list = await connectionsService.listForUser(sessionUserId(c));
    return c.json({ connections: list });
  })
  .get("/available", async (c) => {
    const list = await connectionsService.listAvailablePlugins();
    return c.json({ plugins: list });
  })
  .get("/:id/user-config", async (c) => {
    const config = await connectionsService.getUserConfig(sessionUserId(c), c.req.param("id"));
    return c.json({ config });
  })
  .post(
    "/verify-config",
    verifyConfigRateLimit,
    zValidator("json", verifyConfigSchema),
    async (c) => {
      const body = c.req.valid("json");
      const result = await connectionsService.verifyConfig({
        userId: sessionUserId(c),
        pluginId: body.pluginId,
        userConfig: body.userConfig,
      });
      return c.json(result);
    },
  )
  .post("/", zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    const result = await connectionsService.createFormConnection({
      userId: sessionUserId(c),
      pluginId: body.pluginId,
      userConfig: body.userConfig,
      displayName: body.displayName,
    });
    return c.json(result);
  })
  .patch("/:id/display-name", zValidator("json", displayNameSchema), async (c) => {
    await connectionsService.updateDisplayName({
      userId: sessionUserId(c),
      connectionId: c.req.param("id"),
      displayName: c.req.valid("json").displayName,
    });
    return c.json({ ok: true });
  })
  .patch("/:id/user-config", zValidator("json", userConfigSchema), async (c) => {
    await connectionsService.updateUserConfig({
      userId: sessionUserId(c),
      connectionId: c.req.param("id"),
      userConfig: c.req.valid("json").userConfig,
    });
    return c.json({ ok: true });
  })
  .patch("/:id/enabled", zValidator("json", enabledSchema), async (c) => {
    await connectionsService.setEnabled({
      userId: sessionUserId(c),
      connectionId: c.req.param("id"),
      enabled: c.req.valid("json").enabled,
    });
    return c.json({ ok: true });
  })
  .post("/:id/default", async (c) => {
    await connectionsService.setDefault({
      userId: sessionUserId(c),
      connectionId: c.req.param("id"),
    });
    return c.json({ ok: true });
  })
  .post("/:id/test", testRateLimit, async (c) => {
    const result = await connectionsService.test({
      userId: sessionUserId(c),
      connectionId: c.req.param("id"),
    });
    return c.json(result);
  })
  .delete("/:id", async (c) => {
    await connectionsService.delete({
      userId: sessionUserId(c),
      connectionId: c.req.param("id"),
    });
    return c.json({ ok: true });
  })
  .post("/oauth/redirect/start", zValidator("json", redirectStartSchema), async (c) => {
    const result = await connectionsService.initiateRedirectAuth({
      userId: sessionUserId(c),
      pluginId: c.req.valid("json").pluginId,
    });
    return c.json(result);
  })
  .post("/oauth/redirect/complete", zValidator("json", redirectCompleteSchema), async (c) => {
    const body = c.req.valid("json");
    const result = await connectionsService.completeRedirectAuth({
      userId: sessionUserId(c),
      nonce: body.nonce,
      queryParams: body.queryParams,
    });
    return c.json(result);
  })
  .post("/oauth/device/start", zValidator("json", deviceStartSchema), async (c) => {
    const result = await connectionsService.initiateDeviceAuth({
      userId: sessionUserId(c),
      pluginId: c.req.valid("json").pluginId,
    });
    return c.json(result);
  })
  .post(
    "/oauth/device/poll",
    devicePollRateLimit,
    zValidator("json", devicePollSchema),
    async (c) => {
      const result = await connectionsService.pollDeviceAuth({
        userId: sessionUserId(c),
        nonce: c.req.valid("json").nonce,
      });
      return c.json(result);
    },
  );
