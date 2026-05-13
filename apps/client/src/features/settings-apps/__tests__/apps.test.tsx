// @vitest-environment happy-dom
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { AuthorizedAppRow } from "../components/authorized-app-row";
import type { AuthorizedApp } from "@ent-mcp/shared/users";

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

import { renderWithProviders } from "../../settings/__tests__/test-utils";

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.message.mockReset();
});

afterEach(() => cleanup());

const NOW = Date.now();

const ACTIVE_APP: AuthorizedApp = {
  clientId: "claude-desktop",
  name: "Claude Desktop",
  scopes: ["mcp.read", "mcp.write.feedback"],
  connectedAt: NOW - 1000 * 60 * 60 * 24 * 18,
  lastUsedAt: NOW - 1000 * 60 * 2,
  ownedByUser: false,
  status: "active",
};

describe("AuthorizedAppRow (live shape)", () => {
  it("renders the app name, status pill, and scope chips", () => {
    renderWithProviders(
      <ul>
        <AuthorizedAppRow app={ACTIVE_APP} onRevoke={() => {}} />
      </ul>,
    );

    expect(screen.getByTestId(`authorized-app-${ACTIVE_APP.clientId}`)).toBeTruthy();
    expect(screen.getByText("Claude Desktop")).toBeTruthy();
    expect(screen.getByText(/mcp\.read/)).toBeTruthy();
  });

  it("invokes onRevoke from the row menu", async () => {
    const user = userEvent.setup();
    const onRevoke = vi.fn();
    renderWithProviders(
      <ul>
        <AuthorizedAppRow app={ACTIVE_APP} onRevoke={onRevoke} />
      </ul>,
    );

    await user.click(screen.getByTestId(`actions-${ACTIVE_APP.clientId}`));
    const item = await screen.findByTestId(`revoke-${ACTIVE_APP.clientId}`);
    await user.click(item);

    await waitFor(() => expect(onRevoke).toHaveBeenCalledWith(ACTIVE_APP));
  });
});
