import { describe, it, expect } from "vite-plus/test";
import { handleHttpStatus } from "@nama/plugin-sdk";

function mockResponse(status: number): Response {
  return { status, ok: status >= 200 && status < 300 } as Response;
}

function codeOf(err: unknown): string {
  return (err as Error & { code: string }).code;
}

describe("handleHttpStatus", () => {
  it("does nothing for a successful response", () => {
    expect(() => handleHttpStatus(mockResponse(200), "API")).not.toThrow();
    expect(() => handleHttpStatus(mockResponse(201), "API")).not.toThrow();
    expect(() => handleHttpStatus(mockResponse(204), "API")).not.toThrow();
  });

  describe("401 handling", () => {
    it("throws with on401 code when provided", () => {
      expect(() =>
        handleHttpStatus(mockResponse(401), "SVC", { on401: "plugin.bad_credentials" }),
      ).toThrow();
    });

    it("uses the on401 error code", () => {
      try {
        handleHttpStatus(mockResponse(401), "SVC", { on401: "plugin.bad_credentials" });
      } catch (err) {
        expect(codeOf(err)).toBe("plugin.bad_credentials");
      }
    });

    it("uses token_expired when specified as on401", () => {
      try {
        handleHttpStatus(mockResponse(401), "SVC", { on401: "plugin.token_expired" });
      } catch (err) {
        expect(codeOf(err)).toBe("plugin.token_expired");
      }
    });

    it("does not throw on 401 when on401 is not provided", () => {
      expect(() => handleHttpStatus(mockResponse(401), "SVC")).not.toThrow();
    });
  });

  describe("403 handling", () => {
    it("throws with on403 code when provided", () => {
      expect(() =>
        handleHttpStatus(mockResponse(403), "SVC", { on403: "plugin.bad_credentials" }),
      ).toThrow();
    });

    it("uses the on403 error code", () => {
      try {
        handleHttpStatus(mockResponse(403), "SVC", { on403: "plugin.bad_credentials" });
      } catch (err) {
        expect(codeOf(err)).toBe("plugin.bad_credentials");
      }
    });

    it("does not throw on 403 when on403 is not provided", () => {
      expect(() => handleHttpStatus(mockResponse(403), "SVC")).not.toThrow();
    });
  });

  describe("404 handling", () => {
    it("throws item_not_found", () => {
      try {
        handleHttpStatus(mockResponse(404), "SVC");
      } catch (err) {
        expect(codeOf(err)).toBe("plugin.item_not_found");
      }
    });

    it("includes the service name in the message", () => {
      try {
        handleHttpStatus(mockResponse(404), "MyService");
      } catch (err) {
        expect((err as Error).message).toContain("MyService");
      }
    });
  });

  describe("429 handling", () => {
    it("throws rate_limited", () => {
      try {
        handleHttpStatus(mockResponse(429), "SVC");
      } catch (err) {
        expect(codeOf(err)).toBe("plugin.rate_limited");
      }
    });
  });

  describe("5xx handling", () => {
    it("throws upstream_error on 500", () => {
      try {
        handleHttpStatus(mockResponse(500), "SVC");
      } catch (err) {
        expect(codeOf(err)).toBe("plugin.upstream_error");
      }
    });

    it("throws upstream_error on 503", () => {
      try {
        handleHttpStatus(mockResponse(503), "SVC");
      } catch (err) {
        expect(codeOf(err)).toBe("plugin.upstream_error");
      }
    });

    it("includes the status code in the message", () => {
      try {
        handleHttpStatus(mockResponse(502), "SVC");
      } catch (err) {
        expect((err as Error).message).toContain("502");
      }
    });
  });

  it("does not throw on unexpected non-ok codes without matching opts", () => {
    expect(() => handleHttpStatus(mockResponse(302), "SVC")).not.toThrow();
    expect(() => handleHttpStatus(mockResponse(400), "SVC")).not.toThrow();
  });
});
