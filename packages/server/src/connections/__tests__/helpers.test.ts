import { describe, it, expect, vi } from "vite-plus/test";

// The helpers module transitively pulls in the env + db layers. Stub them so
// the stripping helpers can be exercised in isolation without real env vars.
vi.mock("../../env", () => ({
  env: {
    ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
    BETTER_AUTH_SECRET: "test-secret",
    BETTER_AUTH_URL: "http://localhost",
  },
}));

const { RESPONSE_STRIPPED_EXTENSIONS, stripExtensionFields, stripResponseFields } =
  await import("../helpers");

// Shapes mirror the subset of JSON Schema the helper cares about.
const schema = {
  type: "object",
  properties: {
    externalUrl: { type: "string", title: "External URL" },
    internalUrl: { type: "string", title: "Internal URL", "x-private": true },
    apiKey: { type: "string", title: "API Key", "x-secret": true },
    accessToken: {
      type: "string",
      title: "Access token",
      "x-secret": true,
      "x-private": true,
    },
  },
} as const;

describe("stripResponseFields", () => {
  it("returns non-objects unchanged", () => {
    expect(stripResponseFields(schema, null)).toBeNull();
    expect(stripResponseFields(schema, undefined)).toBeUndefined();
    expect(stripResponseFields(schema, "hello")).toBe("hello");
    expect(stripResponseFields(schema, 42)).toBe(42);
  });

  it("returns the value unchanged when the schema has no properties", () => {
    const value = { foo: 1 };
    expect(stripResponseFields({}, value)).toEqual(value);
    expect(stripResponseFields(null, value)).toBe(value);
    expect(stripResponseFields("not-a-schema", value)).toBe(value);
  });

  it("strips x-secret fields", () => {
    const value = {
      externalUrl: "https://plex.example.com",
      apiKey: "super-secret",
    };
    expect(stripResponseFields(schema, value)).toEqual({
      externalUrl: "https://plex.example.com",
    });
  });

  it("strips x-private fields", () => {
    const value = {
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
    };
    expect(stripResponseFields(schema, value)).toEqual({
      externalUrl: "https://plex.example.com",
    });
  });

  it("strips both x-secret and x-private in a single pass", () => {
    const value = {
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
      accessToken: "both-flags",
    };
    expect(stripResponseFields(schema, value)).toEqual({
      externalUrl: "https://plex.example.com",
    });
  });

  it("does not mutate the input value", () => {
    const value = {
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
    };
    const snapshot = { ...value };
    stripResponseFields(schema, value);
    expect(value).toEqual(snapshot);
  });

  it("exposes the default extension list for callers", () => {
    expect(RESPONSE_STRIPPED_EXTENSIONS).toEqual(["x-secret", "x-private"]);
  });
});

describe("stripExtensionFields", () => {
  it("accepts a custom extension list", () => {
    const value = {
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
    };
    expect(stripExtensionFields(schema, value, ["x-private"])).toEqual({
      externalUrl: "https://plex.example.com",
      apiKey: "super-secret",
    });
    expect(stripExtensionFields(schema, value, ["x-secret"])).toEqual({
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
    });
  });

  it("treats an empty extension list as a no-op", () => {
    const value = {
      externalUrl: "https://plex.example.com",
      internalUrl: "http://192.168.1.10:32400",
      apiKey: "super-secret",
    };
    expect(stripExtensionFields(schema, value, [])).toEqual(value);
  });
});
