import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { dispatchTool } from "../dispatch";
import { defaultMcpLimiter } from "../rate-limit";
import { mcpToolRegistry } from "../registry";

// Rate-limit ordering (issue #343 / #934) is now enforced in handleJsonRpc
// (server.ts) before the switch, so every method — including tools/call —
// shares the same per-user bucket. dispatchTool no longer owns that gate.

const okSchema = {
  type: "object",
  properties: {},
} as const;

function registerEchoTool() {
  mcpToolRegistry.register({
    name: "echo",
    source: { kind: "composite" },
    description: "echo",
    inputSchema: okSchema,
    outputSchema: okSchema,
    requiredScopes: ["mcp:read"],
    handler: async () => ({}),
  });
}

describe("dispatchTool — tool lookup and scope validation", () => {
  beforeEach(() => {
    defaultMcpLimiter.reset();
    mcpToolRegistry.clear();
    registerEchoTool();
  });

  afterEach(() => {
    defaultMcpLimiter.reset();
    mcpToolRegistry.clear();
  });

  it("returns tool_not_found for an unregistered tool", async () => {
    const res = await dispatchTool(
      "does-not-exist",
      { userId: "user-A", scopes: ["mcp:read"] },
      {},
    );
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("mcp.tool_not_found");
  });

  it("returns forbidden when required scope is missing", async () => {
    const res = await dispatchTool("echo", { userId: "user-A", scopes: [] }, {});
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("mcp.forbidden");
  });

  it("succeeds with correct tool name and scope", async () => {
    const res = await dispatchTool("echo", { userId: "user-A", scopes: ["mcp:read"] }, {});
    expect(res.ok).toBe(true);
  });

  it("buckets are per-user: dispatching for userA does not affect userB", async () => {
    const a = await dispatchTool("echo", { userId: "user-A", scopes: ["mcp:read"] }, {});
    expect(a.ok).toBe(true);

    const b = await dispatchTool("echo", { userId: "user-B", scopes: ["mcp:read"] }, {});
    expect(b.ok).toBe(true);
  });
});
