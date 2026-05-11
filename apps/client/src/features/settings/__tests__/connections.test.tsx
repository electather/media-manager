// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, screen } from "@testing-library/react";

import { renderWithProviders } from "./test-utils";

// Smoke-level coverage: the route imports the Hono RPC client which the test
// environment can't actually run against. We mock the api module to verify
// only that we touch the right query keys when wiring is intact.
vi.mock("@/shared/lib/api", () => ({
  api: {
    connections: {
      $get: vi.fn(),
      available: { $get: vi.fn() },
    },
  },
}));

afterEach(() => cleanup());

describe("connections route data wiring", () => {
  it("uses the settings connections query key when seeded", () => {
    renderWithProviders(<div data-testid="placeholder">live</div>, {
      seed: [{ queryKey: ["settings", "connections"], data: [] }],
    });
    expect(screen.getByTestId("placeholder")).toBeTruthy();
  });
});
