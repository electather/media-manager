import { describe, it, expect, beforeEach } from "vite-plus/test";
import { captureError, registerSink, resetSinks } from "../capture";
import { runWithRequestContext } from "../request-context";
import type { ErrorRecord } from "@ent-mcp/shared/diagnostics";
import type { DiagnosticSink } from "../types";

class CollectingSink implements DiagnosticSink {
  records: ErrorRecord[] = [];
  async captureError(record: ErrorRecord): Promise<void> {
    this.records.push(record);
  }
}

class ThrowingSink implements DiagnosticSink {
  async captureError(): Promise<void> {
    throw new Error("sink boom");
  }
}

describe("captureError", () => {
  let collector: CollectingSink;
  beforeEach(() => {
    resetSinks();
    collector = new CollectingSink();
    registerSink(collector);
  });

  it("writes records with the ambient request id, user id, and route", async () => {
    await runWithRequestContext(
      { requestId: "req-abc", userId: "user-123", route: "/api/test" },
      async () => {
        const id = await captureError(new Error("boom"), {
          severity: "error",
          source: "backend",
          code: "http.internal_error",
        });
        expect(typeof id).toBe("string");
      },
    );

    const record = collector.records.at(-1);
    expect(record).toBeDefined();
    expect(record!.requestId).toBe("req-abc");
    expect(record!.userId).toBe("user-123");
    expect(record!.route).toBe("/api/test");
    expect(record!.code).toBe("http.internal_error");
    expect(record!.severity).toBe("error");
    expect(record!.source).toBe("backend");
    expect(record!.devMessage).toBe("boom");
  });

  it("scrubs sensitive context before persistence", async () => {
    await captureError(new Error("x"), {
      severity: "warning",
      source: "plugin",
      pluginId: "trakt",
      context: { token: "secret", note: "ok" },
    });
    const record = collector.records.at(-1)!;
    const parsed = JSON.parse(record.context!) as { token: string; note: string };
    expect(parsed.token).toBe("[REDACTED]");
    expect(parsed.note).toBe("ok");
  });

  it("is resilient to a downstream sink throwing", async () => {
    registerSink(new ThrowingSink());
    // Should not throw even though one sink fails.
    const id = await captureError(new Error("resilient"), {
      severity: "error",
      source: "backend",
    });
    expect(id).toBeDefined();
    expect(collector.records.at(-1)!.devMessage).toBe("resilient");
  });

  it("derives severity from the codes registry when meta.severity is omitted", async () => {
    // `plugin.upstream_error` → error in the registry.
    await captureError(new Error("upstream boom"), {
      source: "plugin",
      code: "plugin.upstream_error",
      pluginId: "trakt",
    });
    expect(collector.records.at(-1)!.severity).toBe("error");

    // `plugin.output_invalid` → warning.
    await captureError(new Error("bad output"), {
      source: "plugin",
      code: "plugin.output_invalid",
      pluginId: "trakt",
    });
    expect(collector.records.at(-1)!.severity).toBe("warning");

    // `plugin.input_invalid` → info (stored, but filterable).
    await captureError(new Error("bad url"), {
      source: "plugin",
      code: "plugin.input_invalid",
      pluginId: "trakt",
    });
    expect(collector.records.at(-1)!.severity).toBe("info");
  });

  it("defaults unknown codes to error", async () => {
    // `plugin.<pluginId>.<code>` namespaced identifiers are not in the
    // registry; the severity falls back to error so we over-capture rather
    // than silently drop.
    await captureError(new Error("unknown"), {
      source: "plugin",
      code: "plugin.trakt.custom_rare",
      pluginId: "trakt",
    });
    expect(collector.records.at(-1)!.severity).toBe("error");
  });

  it("redacts OAuth-style query params in devMessage and stack", async () => {
    // OAuth flows produce URLs with credential-bearing query params; the
    // capture regex must catch the full family of `*_token` / `*_secret`
    // names, not just the literal `token`/`secret` keys.
    const err = new Error("request to https://idp.example.com/cb?refresh_token=xyz failed");
    err.stack = [
      "Error: oauth boom",
      "    at https://idp.example.com/cb?access_token=abc&state=42",
      "    at next (https://idp.example.com/exchange?client_secret=shh)",
      "    at legacy (https://api.example.com/v1?token=plain)",
    ].join("\n");

    await captureError(err, { source: "backend" });
    const record = collector.records.at(-1)!;

    expect(record.devMessage).toContain("refresh_token=[REDACTED]");
    expect(record.devMessage).not.toContain("xyz");

    expect(record.stack).toContain("access_token=[REDACTED]");
    expect(record.stack).not.toContain("abc");
    expect(record.stack).toContain("client_secret=[REDACTED]");
    expect(record.stack).not.toContain("shh");
    // Bare `token=` still works (regression for the original regex behaviour).
    expect(record.stack).toContain("token=[REDACTED]");
    expect(record.stack).not.toContain("plain");
    // Non-sensitive params are left alone.
    expect(record.stack).toContain("state=42");
  });

  it("redacts Bearer headers and JWT-shaped tokens in devMessage", async () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    await captureError(new Error(`auth failed: Bearer abc123 (jwt=${jwt})`), { source: "backend" });
    const record = collector.records.at(-1)!;
    expect(record.devMessage).toContain("Bearer [REDACTED]");
    expect(record.devMessage).not.toContain("abc123");
    expect(record.devMessage).toContain("[JWT_REDACTED]");
    expect(record.devMessage).not.toContain(jwt);
  });

  it("leaves stack as null when neither meta.stack nor err.stack is set", async () => {
    // Non-Error throw value → stackFrom returns null; scrub must not run on null.
    await captureError("plain string failure", { source: "backend" });
    const record = collector.records.at(-1)!;
    expect(record.stack).toBeNull();
    expect(record.devMessage).toBe("plain string failure");
  });

  it("respects an explicit severity override from the caller", async () => {
    // `plugin.output_invalid` defaults to warning but a caller can bump it
    // up (or down) for a specific path.
    await captureError(new Error("bumped"), {
      severity: "error",
      source: "plugin",
      code: "plugin.output_invalid",
      pluginId: "trakt",
    });
    expect(collector.records.at(-1)!.severity).toBe("error");
  });
});
