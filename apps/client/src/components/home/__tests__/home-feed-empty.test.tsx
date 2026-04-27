// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useNavigate: () => navigateMock };
});

import { HomeFeedEmpty } from "../home-feed-empty";

beforeEach(() => navigateMock.mockReset());
afterEach(() => cleanup());

describe("HomeFeedEmpty", () => {
  it("navigates to /settings/connections when the CTA is clicked", async () => {
    const user = userEvent.setup();
    render(<HomeFeedEmpty />);
    await user.click(screen.getByRole("button", { name: /Connect a service/i }));
    expect(navigateMock).toHaveBeenCalledWith({ to: "/settings/connections" });
  });
});
