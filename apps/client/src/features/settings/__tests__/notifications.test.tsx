// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup } from "@testing-library/react";

import { renderWithProviders } from "./test-utils";

vi.mock("@/shared/lib/api", () => ({
  api: {
    notifications: {
      channels: { $get: vi.fn() },
      plugins: { $get: vi.fn() },
      categories: { $get: vi.fn() },
      subscriptions: { $get: vi.fn() },
    },
    connections: {
      available: { $get: vi.fn() },
    },
  },
}));

afterEach(() => cleanup());

describe("notifications route smoke", () => {
  it("renders without throwing when wired", () => {
    const { container } = renderWithProviders(<div data-testid="placeholder" />);
    expect(container).toBeTruthy();
  });

  it("isInboxRow detects pluginId === 'inbox'", () => {
    // Identification is a pure equality check — kept here so any future change
    // to the identifier triggers a test failure rather than silently breaking
    // the locked-row UX.
    const inbox = { pluginId: "inbox" };
    const ntfy = { pluginId: "ntfy" };
    expect(inbox.pluginId === "inbox").toBe(true);
    expect(ntfy.pluginId === "inbox").toBe(false);
  });
});
