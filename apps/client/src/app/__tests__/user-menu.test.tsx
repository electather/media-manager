// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    useRouter: () => ({ navigate: navigateMock }),
    Link: ({
      to,
      children,
      ...props
    }: { to: string; children?: React.ReactNode } & React.ComponentProps<"a">) => (
      <a href={to} {...props}>
        {children}
      </a>
    ),
  };
});

const auth = vi.hoisted(() => ({
  signOut: vi.fn(),
  useSession: vi.fn(),
}));
vi.mock("@/shared/lib/auth", () => ({ authClient: auth }));

import { UserMenu } from "../user-menu";

beforeEach(() => {
  auth.useSession.mockReturnValue({
    data: { user: { name: "Test User", email: "test@example.com" } },
  });
  auth.signOut.mockResolvedValue(undefined);
  navigateMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("UserMenu", () => {
  it("calls signOut then navigates to /auth/login on sign out", async () => {
    const user = userEvent.setup();
    render(<UserMenu />);

    await user.click(screen.getByRole("button", { name: /account menu/i }));
    await user.click(await screen.findByText(/sign out/i));

    await waitFor(() => expect(auth.signOut).toHaveBeenCalledOnce());
    expect(navigateMock).toHaveBeenCalledWith({ to: "/auth/login" });
  });

  it("shows the user name from the session", () => {
    render(<UserMenu />);
    expect(screen.getByRole("button", { name: /account menu/i })).toBeTruthy();
  });
});
