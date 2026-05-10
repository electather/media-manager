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
  toastMock.message.mockReset();
});

afterEach(() => cleanup());

describe("Authorized apps (mock)", () => {
  it("renders the MCP endpoint card and authorized client list", () => {
    const Component = AppsRoute.options.component!;
    render(<Component />);

    expect(screen.getByText(/mcp endpoint/i)).toBeTruthy();
    expect(screen.getByTestId("authorized-app-claude-desktop")).toBeTruthy();
    expect(screen.getByTestId("filter-active")).toBeTruthy();
  });

  it("opens the revoke dialog from the row menu and confirms removal", async () => {
    const user = userEvent.setup();
    const Component = AppsRoute.options.component!;
    render(<Component />);

    await user.click(screen.getByTestId("actions-claude-desktop"));
    const revokeItem = await screen.findByTestId("revoke-claude-desktop");
    await user.click(revokeItem);

    const confirm = await screen.findByTestId("confirm-revoke-app");
    await user.click(confirm);

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("filters by active status", async () => {
    const user = userEvent.setup();
    const Component = AppsRoute.options.component!;
    render(<Component />);

    await user.click(screen.getByTestId("filter-idle"));
    expect(screen.queryByTestId("authorized-app-claude-desktop")).toBeNull();
    expect(screen.getByTestId("authorized-app-claude-web")).toBeTruthy();
  });

  it("revokes all clients via the bulk dialog", async () => {
    const user = userEvent.setup();
    const Component = AppsRoute.options.component!;
    render(<Component />);

    await user.click(screen.getByTestId("revoke-all"));
    const confirm = await screen.findByTestId("confirm-revoke-all");
    await user.click(confirm);

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(screen.queryByTestId("authorized-app-claude-desktop")).toBeNull();
    expect(screen.getByText(/no authorized applications/i)).toBeTruthy();
  });
});
