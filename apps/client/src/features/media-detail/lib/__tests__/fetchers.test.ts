// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

// Mock the Hono client transport (rule 11: mock the fetcher's transport, never
// React Query). `throwOnError` runs for real against the mocked Response so the
// full error-surfacing path is exercised.
const apiMock = vi.hoisted(() => ({ availabilityGet: vi.fn() }));

vi.mock("@/shared/lib/api", () => ({
  api: {
    media: {
      ":type": {
        ":tmdbId": {
          availability: {
            $get: (args: unknown, opts: unknown) => apiMock.availabilityGet(args, opts),
          },
        },
      },
    },
  },
}));

const { fetchSeasonAvailability } = await import("../fetchers");
const { MediaApiError } = await import("@/shared/media/error");

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => apiMock.availabilityGet.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("fetchSeasonAvailability", () => {
  it("passes type=tv and the caller's tmdbId to the availability endpoint", async () => {
    // Season availability is TV-only; a refactor that changed the type param
    // would silently fetch the wrong resource, so pin the forwarded params.
    const body = { servers: [], errors: [] };
    apiMock.availabilityGet.mockResolvedValueOnce(jsonResponse(body));
    await fetchSeasonAvailability("1396", new AbortController().signal);
    expect(apiMock.availabilityGet).toHaveBeenCalledWith(
      { param: { type: "tv", tmdbId: "1396" } },
      expect.objectContaining({ init: expect.objectContaining({ signal: expect.anything() }) }),
    );
  });

  it("returns the parsed JSON on a successful response", async () => {
    const body = {
      servers: [{ serverId: "plex-1", serverLabel: "Plex", seasons: [] }],
    };
    apiMock.availabilityGet.mockResolvedValueOnce(jsonResponse(body));
    const result = await fetchSeasonAvailability("1396", new AbortController().signal);
    expect(result).toEqual(body);
  });

  it("throws MediaApiError on a non-OK response (error-surfacing path)", async () => {
    // V.CL1: a raw Error would fall through to the generic ErrorBoundary branch
    // and show the URL instead of the server's localised message; pin that the
    // typed envelope is always thrown so retry copy reads the `code` field.
    apiMock.availabilityGet.mockResolvedValueOnce(
      jsonResponse({ code: "media.not_found", message: "Title not found" }, 404),
    );
    const err = await fetchSeasonAvailability("9999", new AbortController().signal).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MediaApiError);
    expect(err).toMatchObject({ status: 404, code: "media.not_found" });
  });

  it("surfaces the server message in the thrown MediaApiError", async () => {
    apiMock.availabilityGet.mockResolvedValueOnce(
      jsonResponse({ message: "Internal server error" }, 500),
    );
    const err = await fetchSeasonAvailability("1", new AbortController().signal).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MediaApiError);
    expect((err as InstanceType<typeof MediaApiError>).status).toBe(500);
    expect((err as InstanceType<typeof MediaApiError>).message).toBe("Internal server error");
  });
});
