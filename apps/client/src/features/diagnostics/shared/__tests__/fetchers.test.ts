// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ErrorsFilters } from "../types";

const apiMock = vi.hoisted(() => ({
  errorsGet: vi.fn(),
}));

vi.mock("@/shared/lib/api", () => ({
  api: {
    admin: {
      diagnostics: {
        errors: {
          $get: (args: unknown) => apiMock.errorsGet(args),
        },
      },
    },
  },
}));

import { fetchErrorList } from "../fetchers";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const ALL: ErrorsFilters = {
  severity: ["error", "warning", "info"],
  source: ["frontend", "backend", "plugin", "cron"],
  pluginId: null,
  range: "24h",
  requestId: "",
  search: "",
};

beforeEach(() => apiMock.errorsGet.mockReset());
afterEach(() => vi.restoreAllMocks());

describe("fetchErrorList — empty selection", () => {
  // Why this matters: deselecting every severity (or source) means "show
  // nothing". If the query param were simply omitted, the backend would fall
  // back to its defaults and return rows the user explicitly filtered out, the
  // opposite of their intent. The fetcher must resolve to an empty result
  // without hitting the network.
  it("returns an empty result when no severities are selected, without fetching", async () => {
    await expect(fetchErrorList({ ...ALL, severity: [] })).resolves.toEqual({
      records: [],
      total: 0,
    });
    expect(apiMock.errorsGet).not.toHaveBeenCalled();
  });

  it("returns an empty result when no sources are selected, without fetching", async () => {
    await expect(fetchErrorList({ ...ALL, source: [] })).resolves.toEqual({
      records: [],
      total: 0,
    });
    expect(apiMock.errorsGet).not.toHaveBeenCalled();
  });
});

describe("fetchErrorList — query construction", () => {
  it("omits severity and source params when every value is selected", async () => {
    apiMock.errorsGet.mockResolvedValue(jsonResponse({ records: [], total: 0 }));
    await fetchErrorList(ALL);
    const query = apiMock.errorsGet.mock.calls[0]![0].query as Record<string, string>;
    expect(query.severity).toBeUndefined();
    expect(query.source).toBeUndefined();
  });

  it("sends the explicit list for a partial selection", async () => {
    apiMock.errorsGet.mockResolvedValue(jsonResponse({ records: [], total: 0 }));
    await fetchErrorList({ ...ALL, severity: ["error"], source: ["backend", "plugin"] });
    const query = apiMock.errorsGet.mock.calls[0]![0].query as Record<string, string>;
    expect(query.severity).toBe("error");
    expect(query.source).toBe("backend,plugin");
  });
});
