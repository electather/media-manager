import { describe, expect, it } from "vite-plus/test";

import { parseFormErrorResponse, splitFormError } from "../form-errors";

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

  it("falls back to body.error when no other message key is present", () => {
    // Some legacy endpoints returned a bare `{ error: "..." }` envelope.
    // The helper still extracts the string so callers don't see the fallback.
    const body = { error: "legacy error envelope" };

    expect(splitFormError(body, KNOWN_FIELDS, "fallback")).toEqual({
      message: "legacy error envelope",
      fieldErrors: {},
    });
  });
});

describe("parseFormErrorResponse", () => {
  it("extracts fieldErrors from a well-formed Response body", async () => {
    const res = new Response(
      JSON.stringify({
        code: "connection.verify_failed",
        params: { message: "bad url", field: "externalServerUrl" },
      }),
      { status: 422, headers: { "content-type": "application/json" } },
    );

    const result = await parseFormErrorResponse(res, KNOWN_FIELDS, "fallback");
    expect(result).toEqual({
      message: null,
      fieldErrors: { externalServerUrl: "bad url" },
    });
  });

  it("falls back to the provided message when the response body is not JSON", async () => {
    // A proxy error page (HTML) or an empty 502 won't parse as JSON. The
    // helper should swallow the parse error and surface the fallback so the
    // UI still shows *something* rather than going silent.
    const res = new Response("<html>oops</html>", {
      status: 502,
      headers: { "content-type": "text/html" },
    });

    const result = await parseFormErrorResponse(res, KNOWN_FIELDS, "Upstream unavailable.");
    expect(result).toEqual({
      message: "Upstream unavailable.",
      fieldErrors: {},
    });
  });
});
