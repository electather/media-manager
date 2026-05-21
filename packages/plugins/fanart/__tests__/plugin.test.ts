import { describe, it, expect } from "vite-plus/test";
import { validatePluginModule } from "@ent-mcp/plugin-sdk";
import fanartPlugin from "../src/plugin";
import { jsonRes, makeCtx } from "./helpers";

describe("fanart plugin", () => {
  it("passes loader validation", () => {
    expect(validatePluginModule(fanartPlugin)).toBeDefined();
  });

  it("declares the artwork@v1 capability with the documented manifest extras", () => {
    const cap = fanartPlugin.manifest.capabilities.artwork;
    expect(cap).toBeDefined();
    expect(cap?.version).toBe("v1");
    expect(cap?.scope).toBe("global");
    // The dispatcher's `aggregate_per_kind` strategy reads these to filter
    // ineligible providers and order the merge — regressions here silently
    // change merge behaviour, so lock them in.
    expect((cap as { supportedIdTypes: unknown }).supportedIdTypes).toEqual({
      movie: ["tmdb", "imdb"],
      tv: ["tvdb"],
    });
    expect((cap as { providerPriority: number }).providerPriority).toBe(10);
  });
});

describe("fanart plugin verifyShared", () => {
  it("returns ok for a 200 response", async () => {
    const ctx = makeCtx([jsonRes({})]);
    const res = await fanartPlugin.verifyShared!(ctx);
    expect(res.ok).toBe(true);
  });

  it("treats a 404 as 'fanart reachable'", async () => {
    const ctx = makeCtx([new Response("not found", { status: 404 })]);
    const res = await fanartPlugin.verifyShared!(ctx);
    expect(res.ok).toBe(true);
  });

  it("reports a bad key on 401", async () => {
    const ctx = makeCtx([new Response("nope", { status: 401 })]);
    const res = await fanartPlugin.verifyShared!(ctx);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("401");
  });

  it("reports a bad key on 403", async () => {
    const ctx = makeCtx([new Response("nope", { status: 403 })]);
    const res = await fanartPlugin.verifyShared!(ctx);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("403");
  });

  it("returns ok=false with the thrown message on a network error", async () => {
    const ctx = makeCtx([new Error("connection refused")]);
    const res = await fanartPlugin.verifyShared!(ctx);
    expect(res.ok).toBe(false);
    expect(res.message).toBe("connection refused");
  });

  it("reports a non-ok response with the upstream status on 503", async () => {
    const ctx = makeCtx([new Response("unavailable", { status: 503 })]);
    const res = await fanartPlugin.verifyShared!(ctx);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("503");
  });
});
