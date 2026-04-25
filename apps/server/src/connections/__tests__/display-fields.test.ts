import { describe, it, expect, vi } from "vite-plus/test";

// Stub env so importing helpers doesn't require real secrets.
vi.mock("../../env", () => ({
  env: { ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" },
}));

const { computeDisplayFields } = await import("../helpers");

const SCHEMA = {
  type: "object",
  properties: {
    externalUrl: { type: "string", title: "External URL", format: "uri" },
    internalUrl: { type: "string", title: "Internal URL", "x-private": true },
    apiKey: { type: "string", title: "API Key", "x-secret": true },
    libraryFilter: { type: "string" },
    enabled: { type: "boolean", title: "Enabled" },
    tags: { type: "array", title: "Tags" },
    monoNote: { type: "string", title: "Mono Note", "x-mono": true },
    serverHost: { type: "string", title: "Server", "x-allowed-host": true },
  },
} as const;

describe("computeDisplayFields", () => {
  it("preserves schema declaration order", () => {
    const fields = computeDisplayFields(SCHEMA, {
      externalUrl: "https://plex.example.com",
      internalUrl: "http://10.0.0.1",
      libraryFilter: "Movies",
      enabled: true,
      tags: ["a", "b"],
      monoNote: "abc",
      serverHost: "https://host.example.com",
    });
    expect(fields.map((f) => f.label)).toEqual([
      "External URL",
      "Internal URL",
      "Library Filter",
      "Enabled",
      "Tags",
      "Mono Note",
      "Server",
    ]);
  });

  it("excludes x-secret fields entirely", () => {
    const fields = computeDisplayFields(SCHEMA, { apiKey: "leak-me" });
    expect(fields.find((f) => f.label === "API Key")).toBeUndefined();
  });

  it("redacts x-private fields as bullets while keeping the entry", () => {
    const fields = computeDisplayFields(SCHEMA, { internalUrl: "http://10.0.0.1" });
    const internal = fields.find((f) => f.label === "Internal URL");
    expect(internal?.value).toBe("••••");
  });

  it("flags URI-typed fields as mono", () => {
    const fields = computeDisplayFields(SCHEMA, { externalUrl: "https://plex.example.com" });
    expect(fields.find((f) => f.label === "External URL")?.mono).toBe(true);
  });

  it("flags x-mono fields as mono", () => {
    const fields = computeDisplayFields(SCHEMA, { monoNote: "abc" });
    expect(fields.find((f) => f.label === "Mono Note")?.mono).toBe(true);
  });

  it("flags x-allowed-host fields as mono", () => {
    const fields = computeDisplayFields(SCHEMA, { serverHost: "https://host.example.com" });
    expect(fields.find((f) => f.label === "Server")?.mono).toBe(true);
  });

  it("renders booleans as Yes/No", () => {
    const truthy = computeDisplayFields(SCHEMA, { enabled: true });
    expect(truthy.find((f) => f.label === "Enabled")?.value).toBe("Yes");
    const falsy = computeDisplayFields(SCHEMA, { enabled: false });
    expect(falsy.find((f) => f.label === "Enabled")?.value).toBe("No");
  });

  it("joins primitive arrays with commas", () => {
    const fields = computeDisplayFields(SCHEMA, { tags: ["a", "b", 3] });
    expect(fields.find((f) => f.label === "Tags")?.value).toBe("a, b, 3");
  });

  it("titleizes property name when title is missing", () => {
    const fields = computeDisplayFields(SCHEMA, { libraryFilter: "Movies" });
    expect(fields.find((f) => f.value === "Movies")?.label).toBe("Library Filter");
  });

  it("returns [] when schema has no properties", () => {
    expect(computeDisplayFields({}, {})).toEqual([]);
    expect(computeDisplayFields(null, {})).toEqual([]);
  });

  it("renders missing values as empty strings without dropping the entry", () => {
    const fields = computeDisplayFields(SCHEMA, {});
    const external = fields.find((f) => f.label === "External URL");
    expect(external).toBeDefined();
    expect(external?.value).toBe("");
  });
});
