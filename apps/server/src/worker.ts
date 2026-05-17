import { Hono } from "hono";
import { registerApiRoutes } from "./api/register-routes";
import { bootstrapMcpHostTools } from "./mcp/bootstrap";
import { getDb } from "./db/client";
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
// Module init only runs in-memory registration. `getDb()` and the error sink
// touch `env` (secrets/vars), which Cloudflare only populates at request
// time — calling them during the deploy validator's module-scope sweep
// would either crash or bind a client to an empty URL.
function bootstrap(): void {
  registerBuiltinPlugins();
  bootstrapMcpHostTools();
}

bootstrap();

// First-request initialisation: everything that reads `env` or makes a
// network call is deferred here so the Workers deploy validator never sees
// a Worker that touches the database at module init. The promise is cached
// so subsequent requests skip straight to the handler; a rejection clears
// the cache so a transient failure (e.g. Turso timeout) doesn't poison
// every subsequent request with the same error until the Worker is
// redeployed.
let runtimeReady: Promise<void> | undefined;
function ensureRuntimeReady(): Promise<void> {
  runtimeReady ??= (async () => {
    getDb();
    registerSink(new DatabaseSink());

    // Phase 2 boundaries: register module jobs in alphabetical order, same
    // contract as index.ts. Modules without jobs (artwork, auth, media) are
    // no-ops in Phase 2.
    artwork.registerJobs();
    auth.registerJobs();
    catalog.registerJobs();
    home.registerJobs();
    media.registerJobs();
    notifications.registerJobs();
    pluginRuntime.registerJobs();
    preferences.registerJobs();

    notifications.registerNotificationErrorSink();
    await pluginRuntime.pluginRuntime.bootstrapBuiltins();
  })().catch((err) => {
    runtimeReady = undefined;
    throw err;
  });
  return runtimeReady;
}

const app = new Hono();

app.use(async (_c, next) => {
  await ensureRuntimeReady();
  await next();
});

registerApiRoutes(app);

app.onError(errorHandler);

export default app;
