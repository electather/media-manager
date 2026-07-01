import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

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

describe("fetchSeasonAvailability", () => {
  it("throws MediaApiError with the parsed code on a 4xx response", async () => {
    // Ensures the ErrorBoundary's retry-copy keying off `err.code` (V.CL1)
    // receives a typed error rather than a raw fetch rejection.
    apiMock.availabilityGet.mockResolvedValueOnce(
      jsonResponse({ code: "media.not_found", message: "title not found" }, 404),
    );
    const err = (await fetchSeasonAvailability("12345", new AbortController().signal).catch(
      (e) => e,
    )) as MediaApiError;
    expect(err).toBeInstanceOf(MediaApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("media.not_found");
    expect(err.message).toBe("title not found");
    // Guards against a dropped `tmdbId` or wrong `type` on the error path (#845).
    expect(apiMock.availabilityGet).toHaveBeenCalledWith(
      { param: { type: "tv", tmdbId: "12345" } },
      { init: { signal: expect.any(AbortSignal) } },
    );
  });

  it("throws MediaApiError on 5xx even when the body has no code", async () => {
    apiMock.availabilityGet.mockResolvedValueOnce(jsonResponse({}, 503));
    const err = (await fetchSeasonAvailability("12345", new AbortController().signal).catch(
      (e) => e,
    )) as MediaApiError;
    expect(err).toBeInstanceOf(MediaApiError);
    expect(err.status).toBe(503);
    expect(err.message).toContain("503");
    // Guards against a dropped `tmdbId` or wrong `type` on the error path (#845).
    expect(apiMock.availabilityGet).toHaveBeenCalledWith(
      { param: { type: "tv", tmdbId: "12345" } },
      { init: { signal: expect.any(AbortSignal) } },
    );
  });

  it("returns the parsed JSON payload on a 2xx response", async () => {
    const payload = {
      servers: [
        { serverId: "srv-1", serverLabel: "Plex", episodesPresent: [{ season: 1, episode: 1 }] },
      ],
    };
    apiMock.availabilityGet.mockResolvedValueOnce(jsonResponse(payload));
    await expect(fetchSeasonAvailability("12345", new AbortController().signal)).resolves.toEqual(
      payload,
    );
  });

  it("forwards the AbortSignal to the api call", async () => {
    const payload = { servers: [] };
    apiMock.availabilityGet.mockResolvedValueOnce(jsonResponse(payload));
    const signal = new AbortController().signal;
    await fetchSeasonAvailability("99999", signal);
    expect(apiMock.availabilityGet).toHaveBeenCalledWith(
      { param: { type: "tv", tmdbId: "99999" } },
      { init: { signal } },
    );
  });
});
