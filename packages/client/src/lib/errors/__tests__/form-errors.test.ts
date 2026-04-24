import { describe, expect, it } from "vite-plus/test";

import { splitFormError } from "../form-errors";

const KNOWN_FIELDS = ["externalServerUrl", "username"] as const;

describe("splitFormError", () => {
  it("routes errors with a matching params.field to fieldErrors", () => {
    const body = {
      code: "connection.verify_failed",
      devMessage: "auth failed: ...",
      params: {
        message: "[jellyfin] x-allowed-host field 'externalServerUrl' is not a valid URL: asdad",
        field: "externalServerUrl",
      },
    };

    expect(splitFormError(body, KNOWN_FIELDS, "fallback")).toEqual({
      message: null,
      fieldErrors: {
        externalServerUrl:
          "[jellyfin] x-allowed-host field 'externalServerUrl' is not a valid URL: asdad",
      },
    });
  });

  it("accepts a top-level field hint (verify-config shape)", () => {
    const body = {
      ok: false,
      message: "host not in allowlist: unknown.example.com",
      field: "externalServerUrl",
    };

    expect(splitFormError(body, KNOWN_FIELDS, "fallback")).toEqual({
      message: null,
      fieldErrors: {
        externalServerUrl: "host not in allowlist: unknown.example.com",
      },
    });
  });

  it("routes to the top-level banner when the field is not in knownFields", () => {
    const body = {
      code: "connection.verify_failed",
      devMessage: "outer envelope",
      params: { message: "inner cause", field: "someUnknownProperty" },
    };

    expect(splitFormError(body, KNOWN_FIELDS, "fallback")).toEqual({
      message: "inner cause",
      fieldErrors: {},
    });
  });

  it("prefers params.message over devMessage and top-level message", () => {
    const body = {
      devMessage: "wrapped: envelope text",
      message: "generic",
      params: { message: "the real cause" },
    };

    expect(splitFormError(body, KNOWN_FIELDS, "fallback").message).toBe("the real cause");
  });

  it("falls back to devMessage when params.message is absent", () => {
    const body = { devMessage: "dev only", params: {} };

    expect(splitFormError(body, KNOWN_FIELDS, "fallback").message).toBe("dev only");
  });

  it("falls back to the provided fallback when the body has no message at all", () => {
    expect(splitFormError(null, KNOWN_FIELDS, "default fallback")).toEqual({
      message: "default fallback",
      fieldErrors: {},
    });
    expect(splitFormError({}, KNOWN_FIELDS, "default fallback").message).toBe("default fallback");
  });

  it("ignores a non-string field hint", () => {
    const body = { params: { field: 42, message: "oops" } } as unknown as {
      params: { message: string; field: number };
    };

    expect(splitFormError(body, KNOWN_FIELDS, "fallback")).toEqual({
      message: "oops",
      fieldErrors: {},
    });
  });
});
