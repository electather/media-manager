// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiMock = vi.hoisted(() => ({ getLayout: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: {
    home: {
      getLayout: { $post: (args: unknown) => apiMock.getLayout(args) },
    },
  },
}));

import { useHomeLayout } from "../use-home-layout";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function Probe() {
  const q = useHomeLayout();
  if (q.isPending) return <span>loading</span>;
  if (q.isError) return <span>error</span>;
  return <span>rows:{q.data?.rows.length}</span>;
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

beforeEach(() => apiMock.getLayout.mockReset());
afterEach(() => cleanup());

describe("useHomeLayout", () => {
  it("renders the row count once the layout resolves", async () => {
    apiMock.getLayout.mockResolvedValueOnce(
      jsonResponse({
        hero: null,
        rows: [{ rowId: "trendingNow" }, { rowId: "newReleases" }],
        generatedAt: 1,
      }),
    );
    renderProbe();
    await waitFor(() => expect(screen.getByText("rows:2")).toBeTruthy());
  });

  it("falls into the error branch on a non-2xx response", async () => {
    apiMock.getLayout.mockResolvedValueOnce(jsonResponse({}, 500));
    renderProbe();
    await waitFor(() => expect(screen.getByText("error")).toBeTruthy());
  });
});
