import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { consola } from "consola";
import { env } from "./env";
import { auth } from "./auth/config";
import { appRouter } from "./api/router";
import {
  createMcpHandler,
  oauthAuthorizationServerHandler,
  oauthProtectedResourceHandler,
} from "./mcp/server";
import { bootstrapMcpHostTools } from "./mcp/bootstrap";
import { getDb } from "./db/client";
import { scheduler } from "./jobs/scheduler";
import { registerBuiltinPlugins } from "./plugins/builtin";
import { pluginRuntime } from "./plugin-runtime/runtime";
import { registerErrorSink } from "./errors/capture";
import { DatabaseSink } from "./errors/database-sink";
import { errorHandler } from "./errors/middleware";

async function bootstrap(): Promise<void> {
  getDb();
  registerErrorSink(new DatabaseSink());
  registerBuiltinPlugins();
  bootstrapMcpHostTools();
  await pluginRuntime.bootstrapBuiltins();
  await scheduler.start();
}

await bootstrap();

const app = new Hono();

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api", appRouter);
app.get("/.well-known/oauth-authorization-server", (c) =>
  oauthAuthorizationServerHandler(c.req.raw),
);
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
