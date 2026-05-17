import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { consola } from "consola";
import { env } from "./env";
import { registerApiRoutes } from "./api/register-routes";
import { bootstrapMcpHostTools } from "./mcp/bootstrap";
import { getDb, initDb } from "./db/client";
import { runMigrations } from "./db/migrate";
import { scheduler } from "./jobs/scheduler";
import { markOrphanedRunsFailed } from "./jobs/history";
import { registerBuiltinPlugins } from "./plugins/registry";
import * as artwork from "./artwork";
import * as auth from "./auth";
import * as catalog from "./catalog";
import * as home from "./home";
import * as media from "./media";
import * as notifications from "./notifications";
import * as preferences from "./preferences";
import * as pluginRuntime from "./plugin-runtime";
import { registerSink } from "./diagnostics/capture";
import { DatabaseSink } from "./diagnostics/database-sink";
import { errorHandler } from "./diagnostics/middleware";

async function bootstrap(): Promise<void> {
  getDb();
  await initDb();
  // Run pending migrations before accepting traffic. Self-hosters deploying
  // via `docker compose pull && docker compose up -d` get the schema applied
  // automatically; the Cloudflare workflow runs migrations as a pre-deploy
  // step instead and uses a separate Workers entry point.
  await runMigrations();
  registerSink(new DatabaseSink());

  // Phase 2 boundaries: every domain module exposes registerJobs() via its
  // barrel. Called in fixed alphabetical order so handler fan-out timing is
  // deterministic — boot.test.ts enforces this ordering. Modules without
  // jobs yet expose a no-op (artwork, auth, media); Phase 3 fills them in.
  artwork.registerJobs();
  auth.registerJobs();
  catalog.registerJobs();
  home.registerJobs();
  media.registerJobs();
  notifications.registerJobs();
  pluginRuntime.registerJobs();
  preferences.registerJobs();

  // The error sink publishes via the notifications service, so register it
  // after notifications.registerJobs() so the delivery job is already in the
  // job registry by the time the first error fires.
  notifications.registerNotificationErrorSink();

  const orphaned = await markOrphanedRunsFailed();
  if (orphaned > 0) consola.warn(`[jobs] marked ${orphaned} orphaned run(s) as failed on startup`);
  registerBuiltinPlugins();
  bootstrapMcpHostTools();
  await pluginRuntime.pluginRuntime.bootstrapBuiltins();
  await scheduler.start();
}

await bootstrap();

const app = new Hono();

registerApiRoutes(app);
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
