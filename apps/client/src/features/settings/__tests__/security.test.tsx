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

import { Route as SecurityRoute } from "@/routes/_authenticated/_settings/settings/security";

beforeEach(() => {
  toastMock.success.mockReset();
});

afterEach(() => cleanup());

describe("Security (mock)", () => {
  it("expands the change-password form and validates min length", async () => {
    const user = userEvent.setup();
    const Component = SecurityRoute.options.component!;
    render(<Component />);

    await user.click(screen.getByRole("button", { name: /change password/i }));

    await user.type(screen.getByTestId("current-password"), "old");
    await user.type(screen.getByTestId("new-password"), "short");

    expect(await screen.findByText(/must be at least 12/i)).toBeTruthy();
  });

  it("revokes a non-current session via the confirm dialog", async () => {
    const user = userEvent.setup();
    const Component = SecurityRoute.options.component!;
    render(<Component />);

    // The mock data has at least one revocable session; click its revoke button.
    const revokeButtons = screen.getAllByRole("button", { name: /^revoke$/i });
    expect(revokeButtons.length).toBeGreaterThan(0);
    await user.click(revokeButtons[0]!);

    const confirm = await screen.findByTestId("confirm-revoke");
    await user.click(confirm);

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });
});
