// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigateMock = vi.hoisted(() => vi.fn());
const searchState = vi.hoisted(() => ({ value: {} as { peek?: string } }));
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useRouter: () => ({ navigate: navigateMock, history: { length: 1, go: vi.fn() } }),
    useSearch: () => searchState.value,
  };
});

import { MediaDetailModal } from "../media-detail-modal";

beforeEach(() => {
  navigateMock.mockReset();
  searchState.value = {};
});
afterEach(() => cleanup());

describe("MediaDetailModal (V32, V34)", () => {
  it("does not render dialog content when peek is absent", () => {
    render(<MediaDetailModal />);
    expect(screen.queryByText(/Detail view content/i)).toBeNull();
  });

  it("renders dialog content for a valid peek id", () => {
    searchState.value = { peek: "movie:550" };
    render(<MediaDetailModal />);
    expect(screen.getByText(/Detail view content/i)).toBeTruthy();
  });

  it("calls navigate with default replace (true) when closed via Escape", async () => {
    searchState.value = { peek: "movie:550" };
    const user = userEvent.setup();
    render(<MediaDetailModal />);
    await user.keyboard("{Escape}");
    expect(navigateMock).toHaveBeenCalled();
    const arg = navigateMock.mock.calls[0]![0];
    // Close uses the router's default replace strategy — verify replace was not set to false.
    expect(arg.replace).not.toBe(false);
    expect(arg.search({ peek: "movie:550" })).toEqual({ peek: undefined });
  });
});
