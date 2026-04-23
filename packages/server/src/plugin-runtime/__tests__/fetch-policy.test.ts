import { describe, it, expect, beforeEach, afterEach, vi } from "vite-plus/test";
import { buildFetch } from "../fetch-policy";
import { resolveAllowedHostsFromSchema } from "../allowed-hosts";
import { isPluginError } from "../types";

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

  it("throws plugin.input_invalid when an x-allowed-host value is not a valid URL", () => {
    const schema = {
      type: "object",
      properties: { baseUrl: { type: "string", "x-allowed-host": true } },
    };
    try {
      resolveAllowedHostsFromSchema("p", schema, { baseUrl: "not-a-url" });
      throw new Error("expected throw");
    } catch (err) {
      expect(isPluginError(err)).toBe(true);
      expect((err as { code: string }).code).toBe("plugin.input_invalid");
    }
  });

  it("skips empty-string values without throwing", () => {
    const schema = {
      type: "object",
      properties: { baseUrl: { type: "string", "x-allowed-host": true } },
    };
    expect(resolveAllowedHostsFromSchema("p", schema, { baseUrl: "" })).toEqual(new Set());
  });
});
