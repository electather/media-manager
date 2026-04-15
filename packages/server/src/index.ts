import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { consola } from "consola";
import { env } from "./env";
import { auth } from "./auth/config";
import { appRouter } from "./api/router";
import { createMcpHandler } from "./mcp/server";
import { getDb } from "./db/client";
import { scheduler } from "./jobs/scheduler";

// Initialize database connection.
getDb();

// Start background jobs.
scheduler.start();

const app = new Hono();

// Mount Better Auth at /api/auth/*.
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Mount Hono RPC router at /api/*.
app.route("/api", appRouter);

// Mount MCP Streamable HTTP transport at /mcp.
app.all("/mcp", createMcpHandler());

// Serve static SPA build.
app.use("/*", serveStatic({ root: "../client/dist" }));

// SPA fallback: serve index.html for any non-API GET that hits a 404.
app.get("*", async (c) => {
  return c.html(
    await Bun.file("../client/dist/index.html")
      .text()
      .catch(() => "<h1>Client not built</h1>"),
  );
});

consola.success(`ent-mcp server starting on http://${env.HOST}:${env.PORT}`);

export default {
  port: env.PORT,
  hostname: env.HOST,
  fetch: app.fetch,
};
