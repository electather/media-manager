// @vitest-environment happy-dom
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

vi.mock("@tanstack/react-router", async () => {
  const actual =
    await vi.importActual<typeof import("@tanstack/react-router")>("@tanstack/react-router");
  return {
    ...actual,
    useNavigate: () => async () => {},
    Link: ({ to, ...rest }: { to?: string } & AnchorHTMLAttributes<HTMLAnchorElement>) => (
      <a href={typeof to === "string" ? to : undefined} {...rest} />
    ),
  };
});

import { Route as AppsRoute } from "@/routes/_authenticated/_settings/settings/apps";

beforeEach(() => {
  toastMock.success.mockReset();
});

afterEach(() => cleanup());

describe("Authorized apps (mock)", () => {
  it("renders the MCP endpoint card and authorized client list", () => {
    const Component = AppsRoute.options.component!;
    render(<Component />);

    // Endpoint label and at least one mock app row should be visible.
    expect(screen.getByText(/your mcp endpoint/i)).toBeTruthy();
    expect(screen.getByTestId("authorized-app-claude-desktop")).toBeTruthy();
  });

  it("opens the revoke dialog and confirms removal", async () => {
    const user = userEvent.setup();
    const Component = AppsRoute.options.component!;
    render(<Component />);

    await user.click(screen.getByTestId("revoke-claude-desktop"));

    const confirm = await screen.findByTestId("confirm-revoke-app");
    await user.click(confirm);

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });
});
