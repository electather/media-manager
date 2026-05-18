import { describe, it, expect, vi } from "vite-plus/test";

// Stub heavy transitive imports so dispatch.ts can be loaded in isolation.
vi.mock("consola", () => ({ consola: { error: vi.fn() } }));
vi.mock("../../diagnostics/capture", () => ({ captureError: vi.fn() }));
vi.mock("../../diagnostics/request-context", () => ({
  currentRequestContext: vi.fn(() => null),
  newRequestId: vi.fn(() => "req-test"),
  runWithRequestContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));
vi.mock("../registry", () => ({
  mcpToolRegistry: { get: vi.fn() },
}));
vi.mock("../rate-limit", () => ({
  defaultMcpLimiter: { check: vi.fn(() => null) },
}));
vi.mock("../scopes", () => ({
  hasAllScopes: vi.fn(() => true),
  missingScopes: vi.fn(() => []),
}));
vi.mock("es-toolkit/predicate", () => ({
  isNil: (v: unknown) => v === null || v === undefined,
}));

const { mcpErrorFromUnknown } = await import("../dispatch");
const { McpError } = await import("../errors");

describe("mcpErrorFromUnknown", () => {
  it("passes McpError through unchanged", () => {
    const original = new McpError("http.not_found", "not found");
    expect(mcpErrorFromUnknown(original)).toBe(original);
  });

  it("wraps unknown errors with a generic message to avoid leaking internal details", () => {
    const err = new Error("SELECT * FROM users WHERE id = 'secret-internal-detail'");
    const mcpErr = mcpErrorFromUnknown(err);
    expect(mcpErr.code).toBe("http.internal_error");
    expect(mcpErr.message).toBe("internal error");
    // Sensitive details must not reach the client via devMessage.
    expect(mcpErr.message).not.toContain("users");
    expect(mcpErr.message).not.toContain("SELECT");
  });

  it("preserves the original error via cause for server-side logging", () => {
    const err = new Error("original detail");
    const mcpErr = mcpErrorFromUnknown(err);
    // The native Error `cause` option is forwarded through McpError's super() call.
    expect((mcpErr as unknown as { cause?: unknown }).cause).toBe(err);
  });

  it("handles non-Error thrown values with a generic message", () => {
    const mcpErr = mcpErrorFromUnknown("a raw string error");
    expect(mcpErr.code).toBe("http.internal_error");
    expect(mcpErr.message).toBe("internal error");
  });
});
