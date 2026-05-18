import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { dispatchTool } from "../dispatch";
import { defaultMcpLimiter } from "../rate-limit";
import { mcpToolRegistry } from "../registry";

// Regression coverage for issue #343: the rate limiter is the first gate
// after caller identity is known. Unknown-tool and missing-scope branches
// must still consume a token; otherwise an authenticated client can
// amplify CPU work (JWT verify, registry lookup, context allocation) and
// enumerate scope requirements without ever being throttled.

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

describe("dispatchTool — rate limit ordering (issue #343)", () => {
  beforeEach(() => {
    defaultMcpLimiter.reset();
    mcpToolRegistry.clear();
    registerEchoTool();
  });

  afterEach(() => {
    defaultMcpLimiter.reset();
    mcpToolRegistry.clear();
  });

  it("consumes a token on unknown-tool dispatch", async () => {
    // Drain the bucket via 60 unknown-tool calls.
    for (let i = 0; i < 60; i += 1) {
      const res = await dispatchTool("does-not-exist", { userId: "user-A", scopes: [] }, {});
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("mcp.tool_not_found");
    }

    // 61st call must be rate-limited, not tool-not-found.
    const res = await dispatchTool("does-not-exist", { userId: "user-A", scopes: [] }, {});
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("mcp.rate_limited");
  });

  it("consumes a token on missing-scope dispatch", async () => {
    for (let i = 0; i < 60; i += 1) {
      const res = await dispatchTool("echo", { userId: "user-A", scopes: [] }, {});
      expect(res.ok).toBe(false);
      expect(res.error?.code).toBe("mcp.forbidden");
    }

    const res = await dispatchTool("echo", { userId: "user-A", scopes: [] }, {});
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe("mcp.rate_limited");
  });

  it("rate-limit gate runs before tool lookup", async () => {
    // Exhaust the bucket with successful calls.
    for (let i = 0; i < 60; i += 1) {
      const res = await dispatchTool("echo", { userId: "user-A", scopes: ["mcp:read"] }, {});
      expect(res.ok).toBe(true);
    }

    // A subsequent unknown-tool request must surface rate_limited rather
    // than tool_not_found — the limiter sits in front of registry lookup.
    const res = await dispatchTool("does-not-exist", { userId: "user-A", scopes: [] }, {});
    expect(res.error?.code).toBe("mcp.rate_limited");
  });

  it("rate-limit gate runs before scope validation", async () => {
    for (let i = 0; i < 60; i += 1) {
      await dispatchTool("echo", { userId: "user-A", scopes: ["mcp:read"] }, {});
    }

    // Caller is missing the required scope, but the bucket is empty —
    // rate_limited must win over forbidden.
    const res = await dispatchTool("echo", { userId: "user-A", scopes: [] }, {});
    expect(res.error?.code).toBe("mcp.rate_limited");
  });

  it("buckets are per-user: exhausting userA leaves userB unaffected", async () => {
    for (let i = 0; i < 60; i += 1) {
      await dispatchTool("does-not-exist", { userId: "user-A", scopes: [] }, {});
    }

    const exhausted = await dispatchTool("echo", { userId: "user-A", scopes: ["mcp:read"] }, {});
    expect(exhausted.error?.code).toBe("mcp.rate_limited");

    const fresh = await dispatchTool("echo", { userId: "user-B", scopes: ["mcp:read"] }, {});
    expect(fresh.ok).toBe(true);
  });
});
