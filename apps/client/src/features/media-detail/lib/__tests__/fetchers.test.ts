// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const apiMock = vi.hoisted(() => ({
  availabilityGet: vi.fn(),
}));

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

import { fetchSeasonAvailability } from "../fetchers";
import { MediaApiError } from "@/shared/media/error";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  apiMock.availabilityGet.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("fetchSeasonAvailability — error surfacing", () => {
  it("throws MediaApiError with the parsed code on a 4xx response", async () => {
    // Ensures the ErrorBoundary's retry-copy keying off `err.code` (V.CL1)
    // receives a typed error rather than a raw fetch rejection.
    apiMock.availabilityGet.mockResolvedValue(
      jsonResponse({ code: "media.not_found", message: "title not found" }, 404),
    );
    await expect(
      fetchSeasonAvailability("12345", new AbortController().signal),
    ).rejects.toMatchObject({
      name: "MediaApiError",
      status: 404,
      code: "media.not_found",
    });
  });

  it("throws MediaApiError on 5xx even when the body has no code", async () => {
    apiMock.availabilityGet.mockResolvedValue(jsonResponse({}, 503));
    const err = await fetchSeasonAvailability("12345", new AbortController().signal).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(MediaApiError);
    expect((err as MediaApiError).status).toBe(503);
    expect((err as MediaApiError).message).toContain("503");
  });

  it("returns the parsed JSON payload on a 2xx response", async () => {
    const payload = { seasons: [{ seasonNumber: 1, available: true }] };
    apiMock.availabilityGet.mockResolvedValue(jsonResponse(payload));
    await expect(fetchSeasonAvailability("12345", new AbortController().signal)).resolves.toEqual(
      payload,
    );
  });

  it("forwards the AbortSignal to the api call", async () => {
    const payload = { seasons: [] };
    apiMock.availabilityGet.mockResolvedValue(jsonResponse(payload));
    const signal = new AbortController().signal;
    await fetchSeasonAvailability("99999", signal);
    expect(apiMock.availabilityGet).toHaveBeenCalledWith(
      { param: { type: "tv", tmdbId: "99999" } },
      { init: { signal } },
    );
  });
});
