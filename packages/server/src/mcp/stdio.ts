/**
 * Stdio transport entry point for the MCP Inspector. Bootstraps the full tool
 * registry without starting the HTTP server or job scheduler. Authentication
 * is bypassed — all scopes are granted to MCP_INSPECTOR_USER_ID.
 *
 * Usage:
 *   bun run inspect   (from project root)
 *   MCP_INSPECTOR_USER_ID=<id> bun run inspect
 */
import { consola } from "consola";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { getDb } from "../db/client";
import { runMigrations } from "../db/migrate";
import { registerBuiltinPlugins } from "../plugins/builtin";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { registerErrorSink } from "../errors/capture";
import { DatabaseSink } from "../errors/database-sink";
import { bootstrapMcpHostTools } from "./bootstrap";
import { mcpToolRegistry } from "./registry";
import { dispatchForMcpHandler } from "./dispatch";
import { MCP_SCOPES } from "./scopes";
import { newRequestId } from "../errors/request-context";

// Redirect all consola output to stderr — stdout is reserved for MCP JSON-RPC.
consola.setReporters([
  {
    log: (logObj) => {
      const msg = logObj.args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
      process.stderr.write(`[${logObj.type ?? "log"}] ${msg}\n`);
    },
  },
]);

const INSPECTOR_USER_ID = process.env.MCP_INSPECTOR_USER_ID ?? "inspector";

getDb();
await runMigrations();
registerErrorSink(new DatabaseSink());
registerBuiltinPlugins();
bootstrapMcpHostTools();
await pluginRuntime.bootstrapBuiltins();

const server = new McpServer({ name: "ent-mcp", version: "0.1.0" });

server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: mcpToolRegistry.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Record<string, unknown>,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema as Record<string, unknown> } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  })),
}));

server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
  return dispatchForMcpHandler(
    request.params.name,
    { userId: INSPECTOR_USER_ID, scopes: [...MCP_SCOPES], requestId: newRequestId() },
    request.params.arguments,
  );
});

const transport = new StdioServerTransport();
await server.connect(transport);
