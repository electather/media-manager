import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import type { Context } from "hono";
import { MediaService } from "../media/service";
import { PreferenceEngine } from "../preferences/engine";
import { TmdbClient } from "../integrations/tmdb/client";
import { TraktClient } from "../integrations/trakt/client";
import { SerrClient } from "../integrations/seerr/client";
import { MemoryCache } from "../cache/memory";
import { env } from "../env";
import { discoverTool } from "./tools/discover";
import { detailsTool } from "./tools/details";
import { requestTool } from "./tools/request";
import { activityTool } from "./tools/activity";
import { feedbackTool } from "./tools/feedback";
import { accountTool } from "./tools/account";

function buildMediaService(): MediaService {
  const cache = new MemoryCache();
  const preferences = new PreferenceEngine();

  const metadata = new TmdbClient({ apiKey: env.TMDB_API_KEY ?? "" });
  const activity = new TraktClient({ clientId: env.TRAKT_CLIENT_ID ?? "" });
  const downloads = new SerrClient({
    baseUrl: env.SEERR_URL ?? "http://localhost:5055",
    apiKey: env.SEERR_API_KEY ?? "",
  });

  return new MediaService(metadata, activity, downloads, cache, preferences);
}

export function buildMcpServer(): McpServer {
  const mediaService = buildMediaService();
  const preferences = new PreferenceEngine();

  const server = new McpServer({ name: "ent-mcp", version: "0.0.1" });

  const tools = [
    discoverTool(mediaService),
    detailsTool(mediaService),
    requestTool(mediaService),
    activityTool(mediaService),
    feedbackTool(mediaService),
    accountTool(preferences),
  ] as const;

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema.shape as ZodRawShape,
      // @ts-expect-error TODO: type args properly once MCP SDK callback types stabilise.
      async (args: unknown) => {
        const result = await (tool.handler as (a: unknown) => Promise<unknown>)(args);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      },
    );
  }

  return server;
}

/**
 * Returns a Hono handler stub for the MCP Streamable HTTP transport.
 * TODO: Replace with WebStandardStreamableHTTPServerTransport once wired up.
 */
export function createMcpHandler() {
  return async (c: Context) => {
    // Bootstrap stub — returns a valid JSON-RPC error indicating the transport
    // is not yet fully configured. This satisfies curl /mcp returning a protocol response.
    if (c.req.method === "GET") {
      return c.json({
        server: "ent-mcp",
        version: "0.0.1",
        transport: "streamable-http",
        status: "initialising",
      });
    }

    return c.json(
      {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32603,
          message: "MCP Streamable HTTP transport not yet configured",
        },
      },
      501,
    );
  };
}
