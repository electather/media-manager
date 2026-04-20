import type { Context } from "hono";
import { consola } from "consola";
import {
  oAuthDiscoveryMetadata,
  oAuthProtectedResourceMetadata,
  withMcpAuth,
} from "better-auth/plugins";
import type { MCPToolAnnotations } from "../plugin-runtime/types";
import { auth } from "../auth/config";
import { dispatchForMcpHandler, dispatchTool } from "./dispatch";
import { mcpToolRegistry } from "./registry";
import { parseScopes } from "./scopes";
import { newRequestId } from "../errors/request-context";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

interface ToolsListEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: MCPToolAnnotations;
}

const PROTOCOL_VERSION = "2025-03-26";
const SERVER_INFO = { name: "ent-mcp", version: "0.1.0" };

function jsonRpcResponse(id: unknown, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: id ?? null, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function jsonRpcError(id: unknown, code: number, message: string, data?: unknown): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id: id ?? null,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function buildToolsList(): ToolsListEntry[] {
  return mcpToolRegistry.list().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    ...(tool.annotations ? { annotations: tool.annotations } : {}),
  }));
}

async function handleJsonRpc(
  body: JsonRpcRequest,
  userId: string,
  scopes: string[],
  requestId: string,
): Promise<Response> {
  switch (body.method) {
    case "initialize": {
      return jsonRpcResponse(body.id, {
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: SERVER_INFO,
        capabilities: { tools: { listChanged: false } },
      });
    }
    case "notifications/initialized": {
      return new Response(null, { status: 202 });
    }
    case "tools/list": {
      return jsonRpcResponse(body.id, { tools: buildToolsList() });
    }
    case "tools/call": {
      const params = body.params ?? {};
      const name = typeof params.name === "string" ? params.name : "";
      const args = (params.arguments ?? {}) as unknown;
      const result = await dispatchForMcpHandler(name, { userId, scopes, requestId }, args);
      return jsonRpcResponse(body.id, result);
    }
    case "ping": {
      return jsonRpcResponse(body.id, {});
    }
    default: {
      return jsonRpcError(body.id, -32601, `method not found: ${body.method ?? "(none)"}`);
    }
  }
}

/**
 * Streamable HTTP transport for the MCP endpoint. Auth is enforced by Better
 * Auth's `withMcpAuth`; the bearer's `userId` and `scopes` flow directly into
 * the dispatcher. This is a JSON-only transport — SSE streaming is not needed
 * for the current synchronous tool set.
 */
export function createMcpHandler() {
  const protectedHandler = withMcpAuth(auth, async (req, session) => {
    const requestId = newRequestId();
    const scopes = parseScopes(session.scopes);
    if (req.method === "GET") {
      return new Response(
        JSON.stringify({ server: SERVER_INFO, transport: "streamable-http-json" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (req.method === "DELETE") {
      return new Response(null, { status: 204 });
    }
    if (req.method !== "POST") {
      return new Response("method not allowed", { status: 405 });
    }

    let body: JsonRpcRequest;
    try {
      body = (await req.json()) as JsonRpcRequest;
    } catch {
      return jsonRpcError(null, -32700, "parse error");
    }

    if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
      return jsonRpcError(body?.id ?? null, -32600, "invalid request");
    }

    try {
      return await handleJsonRpc(body, session.userId, scopes, requestId);
    } catch (err) {
      consola.error("[mcp] handler crashed", err);
      const message = err instanceof Error ? err.message : String(err);
      return jsonRpcError(body.id, -32603, "internal error", { message });
    }
  });

  return async (c: Context) => protectedHandler(c.req.raw);
}

/** Exported for testing — runs a tool call without the HTTP envelope. */
export async function runToolForTests(
  name: string,
  input: unknown,
  caller: { userId: string; scopes: string[] },
) {
  return dispatchTool(name, { ...caller, requestId: newRequestId() }, input);
}

export const oauthProtectedResourceHandler = oAuthProtectedResourceMetadata(auth);
export const oauthAuthorizationServerHandler = oAuthDiscoveryMetadata(auth);
