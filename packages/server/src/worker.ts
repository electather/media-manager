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
// so subsequent requests skip straight to the handler.
let runtimeReady: Promise<void> | undefined;
function ensureRuntimeReady(): Promise<void> {
  runtimeReady ??= (async () => {
    getDb();
    registerErrorSink(new DatabaseSink());
    await pluginRuntime.bootstrapBuiltins();
  })();
  return runtimeReady;
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
  await ensureRuntimeReady();
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
