import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { consola } from "consola";
import { env } from "./env";
import { auth } from "./auth/config";
import { appRouter } from "./api/router";
import { createMcpHandler } from "./mcp/server";
import { getDb } from "./db/client";
import { scheduler } from "./jobs/scheduler";
import { registerBuiltinPlugins } from "./plugins/builtin";
import { pluginRuntime } from "./plugin-runtime/runtime";

async function bootstrap(): Promise<void> {
  getDb();
  registerBuiltinPlugins();
  await pluginRuntime.bootstrapBuiltins();
  await scheduler.start();
}

await bootstrap();

const app = new Hono();

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
app.route("/api", appRouter);
app.all("/mcp", createMcpHandler());
app.use("/*", serveStatic({ root: "../client/dist" }));

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
