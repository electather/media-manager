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
import { connectionsPrimaryApp } from "./connections-primary";
import { TokenBucketLimiter } from "../../mcp/rate-limit";
import { makeRateLimitMiddleware } from "../rate-limit";

/** Per-user bucket for one-shot plugin-touching endpoints (verify-config, test, oauth start/complete). Capacity 20, refill 20/min: prevents one user from exhausting the shared per-plugin fetch quota while allowing normal use. */
export const connectionPluginLimiter = new TokenBucketLimiter({
  capacity: 20,
  refillPerSec: 20 / 60,
});
const connectionPluginRateLimit = makeRateLimitMiddleware({ limiter: connectionPluginLimiter });

/** Separate, cadence-tolerant bucket for device-code polling. The client polls at the provider-advertised `intervalSec` (Plex = 2s → 30/min), which exceeds the 20/min bucket above and would 429 a valid flow before the PIN expires (#922). Refill 60/min sits above the fastest advertised cadence so legitimate polling never throttles, while still bounding a tight-loop abuser to ~1/s per user. */
export const connectionPollLimiter = new TokenBucketLimiter({
  capacity: 60,
  refillPerSec: 1,
});
const connectionPollRateLimit = makeRateLimitMiddleware({ limiter: connectionPollLimiter });

export const connectionsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS))
  // Rate-limit routes that trigger outbound plugin calls — prevents one user
  // from exhausting the shared per-plugin fetch quota (#922). Debit runs before
  // zValidator so malformed requests still consume a token (probe-spam stays
  // capped); mirror this ordering if adding routes. device/poll is excluded
  // here and gets a cadence-tolerant bucket below — it polls at the advertised
  // interval, which the 20/min bucket would wrongly 429.
  .use("/verify-config", connectionPluginRateLimit)
  .use("/:id/test", connectionPluginRateLimit)
  .use("/oauth/redirect/start", connectionPluginRateLimit)
  .use("/oauth/redirect/complete", connectionPluginRateLimit)
  .use("/oauth/device/start", connectionPluginRateLimit)
  .use("/oauth/device/poll", connectionPollRateLimit)
  // POST `/` (create) and PATCH `/:id/user-config` (update) also run an outbound
  // startAuth/testConnection, but their paths double as cheap GET reads (list,
  // getUserConfig) that must not be throttled — so the limiter is attached inline
  // per-method below rather than via a path-wide `.use()`.
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
  .post("/verify-config", zValidator("json", verifyConfigSchema), async (c) => {
    const body = c.req.valid("json");
    const result = await connectionsService.verifyConfig({
      userId: sessionUserId(c),
      pluginId: body.pluginId,
      userConfig: body.userConfig,
    });
    return c.json(result);
  })
  .post("/", connectionPluginRateLimit, zValidator("json", createSchema), async (c) => {
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
  .patch(
    "/:id/user-config",
    connectionPluginRateLimit,
    zValidator("json", userConfigSchema),
    async (c) => {
      await connectionsService.updateUserConfig({
        userId: sessionUserId(c),
        connectionId: c.req.param("id"),
        userConfig: c.req.valid("json").userConfig,
      });
      return c.json({ ok: true });
    },
  )
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
  .post("/:id/test", async (c) => {
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
  .post("/oauth/device/poll", zValidator("json", devicePollSchema), async (c) => {
    const result = await connectionsService.pollDeviceAuth({
      userId: sessionUserId(c),
      nonce: c.req.valid("json").nonce,
    });
    return c.json(result);
  });
