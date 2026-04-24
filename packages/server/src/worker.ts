import { Hono } from "hono";
import { cors } from "hono/cors";
import { appRouter } from "./api/router";
import { authRouteHandler } from "./auth/oauth-handler";
import {
  createMcpHandler,
  oauthAuthorizationServerHandler,
  oauthProtectedResourceHandler,
} from "./mcp/server";
import { bootstrapMcpHostTools } from "./mcp/bootstrap";
import { getDb } from "./db/client";
import { registerBuiltinPlugins } from "./plugins/builtin";
import { pluginRuntime } from "./plugin-runtime/runtime";
import { registerErrorSink } from "./errors/capture";
import { DatabaseSink } from "./errors/database-sink";
import { errorHandler } from "./errors/middleware";

// Cloudflare Workers entry point. Diverges from `index.ts` by excluding the
// pieces of the local server that don't work in the Workers runtime:
//   1. `hono/bun` serveStatic — Cloudflare Assets serves the SPA from the CDN
//      edge and handles SPA fallback; unmatched paths reach this Worker.
//   2. The croner scheduler — there is no persistent process in Workers.
//      Scheduled jobs are not supported in the Cloudflare deployment.
//   3. `markOrphanedRunsFailed()` — without the scheduler there are no orphan
//      runs to reconcile, and Cloudflare's deploy validator rejects any
//      Worker that performs a network DB write at module init.
//   4. Running `migrate.ts` — migrations run as a pre-deploy CI step against
//      the target Turso database instead.
//
// Bootstrap is kept to synchronous, in-memory work so the Worker passes the
// deploy-time validator and cold-starts quickly on the first request.
function bootstrap(): void {
  getDb();
  registerErrorSink(new DatabaseSink());
  registerBuiltinPlugins();
  bootstrapMcpHostTools();
}

bootstrap();

// Plugins that need async setup are loaded on the first request rather than
// at module init so we stay inside the Workers deploy-validator budget.
let pluginsReady: Promise<void> | undefined;
function ensurePluginsReady(): Promise<void> {
  pluginsReady ??= pluginRuntime.bootstrapBuiltins();
  return pluginsReady;
}

const app = new Hono();

const mcpCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version"],
  exposeHeaders: ["Mcp-Session-Id"],
  maxAge: 86400,
});

app.use(async (_c, next) => {
  await ensurePluginsReady();
  await next();
});

app.use("/api/auth/*", mcpCors);
app.use("/.well-known/oauth-authorization-server/*", mcpCors);
app.use("/.well-known/oauth-authorization-server", mcpCors);
app.use("/.well-known/oauth-protected-resource/*", mcpCors);
app.use("/.well-known/oauth-protected-resource", mcpCors);
app.use("/mcp", mcpCors);

app.on(["GET", "POST"], "/api/auth/*", (c) => authRouteHandler(c.req.raw));
app.route("/api", appRouter);
app.get("/.well-known/oauth-authorization-server/*", (c) =>
  oauthAuthorizationServerHandler(c.req.raw),
);
app.get("/.well-known/oauth-authorization-server", (c) =>
  oauthAuthorizationServerHandler(c.req.raw),
);
app.get("/.well-known/oauth-protected-resource/*", (c) => oauthProtectedResourceHandler(c.req.raw));
app.get("/.well-known/oauth-protected-resource", (c) => oauthProtectedResourceHandler(c.req.raw));
app.all("/mcp", createMcpHandler());

app.onError(errorHandler);

export default app;
