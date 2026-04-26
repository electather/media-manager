import { Hono } from "hono";
import { cors } from "hono/cors";
import { serveStatic } from "hono/bun";
import { consola } from "consola";
import { env } from "./env";
import { appRouter } from "./api/router";
import { authRouteHandler } from "./auth/oauth-handler";
import {
  createMcpHandler,
  oauthAuthorizationServerHandler,
  oauthProtectedResourceHandler,
} from "./mcp/server";
import { bootstrapMcpHostTools } from "./mcp/bootstrap";
import { getDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { scheduler } from "./jobs/scheduler";
import { markOrphanedRunsFailed } from "./jobs/history";
import { registerBuiltinPlugins } from "./plugins/registry";
import { pluginRuntime } from "./plugin-runtime/runtime";
import { registerErrorSink } from "./errors/capture";
import { DatabaseSink } from "./errors/database-sink";
import { errorHandler } from "./errors/middleware";
import { NotificationErrorSink } from "./notifications/error-sink";

async function bootstrap(): Promise<void> {
  getDb();
  // Run pending migrations before accepting traffic. Self-hosters deploying
  // via `docker compose pull && docker compose up -d` get the schema applied
  // automatically; the Cloudflare workflow runs migrations as a pre-deploy
  // step instead and uses a separate Workers entry point.
  await runMigrations();
  registerErrorSink(new DatabaseSink());
  registerErrorSink(new NotificationErrorSink());
  const orphaned = await markOrphanedRunsFailed();
  if (orphaned > 0) consola.warn(`[jobs] marked ${orphaned} orphaned run(s) as failed on startup`);
  registerBuiltinPlugins();
  bootstrapMcpHostTools();
  await pluginRuntime.bootstrapBuiltins();
  await scheduler.start();
}

await bootstrap();

const app = new Hono();

// CORS for MCP and OAuth discovery — required for browser-based MCP clients.
// Allowed origins are sourced from BETTER_AUTH_TRUSTED_ORIGINS (comma-separated)
// so a single env variable governs both auth and MCP access.
// MCP auth is Bearer-token-based, so any origin is safe to allow.
// Origin restrictions would provide no security benefit here.
const mcpCors = cors({
  origin: "*",
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  allowHeaders: ["Authorization", "Content-Type", "Mcp-Session-Id", "Mcp-Protocol-Version"],
  exposeHeaders: ["Mcp-Session-Id"],
  maxAge: 86400,
});

// RFC 9728: clients append the resource path, e.g. /.well-known/oauth-protected-resource/mcp
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
app.use("/*", serveStatic({ root: "../client/dist" }));

app.get("*", async (c) => {
  return c.html(
    await Bun.file("../client/dist/index.html")
      .text()
      .catch(() => "<h1>Client not built</h1>"),
  );
});

// Last-resort handler for errors on routes outside /api (auth, mcp, static).
// Re-uses the unified response shape so every surface looks the same.
app.onError(errorHandler);

consola.success(`ent-mcp server starting on http://${env.HOST}:${env.PORT}`);

export default {
  port: env.PORT,
  hostname: env.HOST,
  fetch: app.fetch,
};
