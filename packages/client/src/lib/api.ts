import { hc } from "hono/client";
import type { AppType } from "@ent-mcp/server/api/router";

/** Typed Hono RPC client pointing at the server's /api endpoint. */
export const api = hc<AppType>("/api");
