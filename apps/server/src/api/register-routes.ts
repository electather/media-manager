import type { Hono } from "hono";
import { cors } from "hono/cors";
import { appRouter } from "./router";
import { authRouteHandler } from "../auth";
import { HttpError } from "../diagnostics/http-errors";
import {
  createMcpHandler,
  oauthAuthorizationServerHandler,
  oauthProtectedResourceHandler,
} from "../mcp/server";

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
export function registerApiRoutes(app: Hono): void {
  app.use("/api/auth/*", mcpCors);
  app.use("/.well-known/oauth-authorization-server/*", mcpCors);
  app.use("/.well-known/oauth-authorization-server", mcpCors);
  app.use("/.well-known/oauth-protected-resource/*", mcpCors);
  app.use("/.well-known/oauth-protected-resource", mcpCors);
  app.use("/mcp", mcpCors);

  app.on(["GET", "POST"], "/api/auth/*", (c) => authRouteHandler(c.req.raw));
  app.route("/api", appRouter);
  // Catch-all for unmatched /api paths: emits unified `{code,devMessage,requestId}` envelope.
  // Hono's `/*` requires ≥1 char after prefix, so bare `/api` is registered separately.
  const apiNotFound = (): never => {
    throw new HttpError(404, "http.not_found", "route not found");
  };
  app.all("/api", apiNotFound);
  app.all("/api/*", apiNotFound);
  app.get("/.well-known/oauth-authorization-server/*", (c) =>
    oauthAuthorizationServerHandler(c.req.raw),
  );
  app.get("/.well-known/oauth-authorization-server", (c) =>
    oauthAuthorizationServerHandler(c.req.raw),
  );
  app.get("/.well-known/oauth-protected-resource/*", (c) =>
    oauthProtectedResourceHandler(c.req.raw),
  );
  app.get("/.well-known/oauth-protected-resource", (c) => oauthProtectedResourceHandler(c.req.raw));
  app.all("/mcp", createMcpHandler());
}
