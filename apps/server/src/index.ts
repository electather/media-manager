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
import * as library from "./library";
import * as media from "./media";
import * as notifications from "./notifications";
import * as preferences from "./preferences";
import * as pluginRuntime from "./plugin-runtime";
import * as watchlist from "./watchlist";
import { registerSink } from "./diagnostics/capture";
import { DatabaseSink } from "./diagnostics/database-sink";
import { errorHandler } from "./diagnostics/middleware";
import { newRequestId } from "./diagnostics/request-context";

async function bootstrap(): Promise<void> {
  getDb();
  await initDb();
  // Run pending migrations before accepting traffic. Self-hosters deploying
  // via `docker compose pull && docker compose up -d` get the schema applied
  // automatically.
  await runMigrations();
  // On a fresh install (zero users) this issues a one-time setup token and
  // prints the plaintext to the boot log; it is a no-op once any user exists.
  await auth.ensureBootstrapToken();
  registerSink(new DatabaseSink());

  // Phase 2 boundaries: every domain module exposes registerJobs() via its
  // barrel. Called in fixed alphabetical order so handler fan-out timing is
  // deterministic — boot.test.ts enforces this ordering. Modules without
  // jobs yet expose a no-op (artwork, auth, media); Phase 3 fills them in.
  artwork.registerJobs();
  auth.registerJobs();
  catalog.registerJobs();

  home.registerJobs();
  library.registerJobs();
  media.registerJobs();
  notifications.registerJobs();
  pluginRuntime.registerJobs();
  preferences.registerJobs();
  watchlist.registerJobs();

  // The error sink publishes via the notifications service, so register it
  // after notifications.registerJobs() so the delivery job is already in the
  // job registry by the time the first error fires.
  notifications.registerNotificationErrorSink();

  const orphaned = await markOrphanedRunsFailed();
  if (orphaned > 0) consola.warn(`[jobs] marked ${orphaned} orphaned run(s) as failed on startup`);
  registerBuiltinPlugins();
  bootstrapMcpHostTools();
  await pluginRuntime.pluginRuntime.bootstrapBuiltins();

  // Seed today's discover snapshot at startup so the home feed has data on
  // first boot (or a restart before the 6 AM cron). Runs AFTER bootstrapBuiltins
  // (#890): discoverFeed dispatches to metadata plugins, so seeding before they
  // load would write zero snapshots. The "newReleases" tuple is the sentinel;
  // a prior run that crashed mid-job may leave other feeds absent until cron,
  // but discoverFeed falls back to the live path so that is degraded, not broken.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const todayBucket = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const catalogService = catalog.getCatalogService();
  const snapshotExists = await catalogService.hasDiscoverFeed(
    "newReleases",
    "popularity_desc",
    todayBucket,
  );
  if (!snapshotExists) {
    consola.info("[catalog:discover-snapshot] seeding today's snapshot at bootstrap");
    await catalog
      .runCatalogDiscoverSnapshot(
        { catalog: catalogService },
        {
          runId: "bootstrap",
          // Server-initiated administrative run, not a scheduler tick — "cron"
          // would misreport origin in job-history audit filtering.
          triggeredBy: "admin",
          requestId: newRequestId(),
          logger: consola,
          // Bound the seed so a hung/unconfigured metadata plugin cannot block
          // startup indefinitely; server always finishes booting within 60s.
          abortSignal: AbortSignal.timeout(60_000),
        },
      )
      .catch((err) => {
        consola.warn("[catalog:discover-snapshot] bootstrap seed failed (non-fatal)", err);
      });
  }

  await scheduler.start();
}

await bootstrap();

const app = new Hono();

registerApiRoutes(app);
// Defence in depth: never serve sourcemaps to browsers. The client build moves
// hidden `.map` files out of `dist/`, but a stale or hand-copied build could
// leave one behind — refuse them here so the maps stay private diagnostics
// inputs regardless of what is on disk.
app.use("/*", async (c, next) => {
  if (c.req.path.endsWith(".map")) return c.notFound();
  await next();
});
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

consola.success(`nama server starting on http://${env.HOST}:${env.PORT}`);

export default {
  port: env.PORT,
  hostname: env.HOST,
  fetch: app.fetch,
};
