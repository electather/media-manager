// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const fetchersMock = vi.hoisted(() => ({
  fetchSessions: vi.fn(),
  fetchRevokeSession: vi.fn(),
  fetchRevokeOtherSessions: vi.fn(),
}));
vi.mock("../../lib/fetchers", () => fetchersMock);

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { ActiveSessionsCard } from "@/features/settings-security";
import { settingsSecurityKeys } from "../../lib/query-keys";
import type { DisplaySession } from "../../lib/types";
import { renderWithProviders } from "@/shared/lib/test-utils";

function session(over: Partial<DisplaySession> = {}): DisplaySession {
  return {
    id: "sess-1",
    token: "tok-1",
    userId: "user-1",
    ipAddress: "203.0.113.10",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    createdAt: new Date(Date.now() - 60_000),
    updatedAt: new Date(Date.now() - 30_000),
    expiresAt: new Date(Date.now() + 60_000),
    current: false,
    ...over,
  };
}

beforeEach(() => {
  for (const fn of Object.values(fetchersMock)) fn.mockReset();
  for (const fn of Object.values(toastMock)) fn.mockReset();
});

afterEach(() => cleanup());

describe("ActiveSessionsCard", () => {
  it("revokes a single session by token after confirming and toasts on success", async () => {
    fetchersMock.fetchRevokeSession.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const other = session({ id: "sess-2", token: "tok-2", current: false });
    renderWithProviders(<ActiveSessionsCard sessions={[session({ current: true }), other]} />, {
      seed: [
        { queryKey: settingsSecurityKeys.sessions(), data: [session({ current: true }), other] },
      ],
    });

    await user.click(screen.getByRole("button", { name: /^revoke$/i }));
    await user.click(screen.getByTestId("confirm-revoke"));

    // React Query passes the mutate options as a second argument, so assert on
    // the token positionally rather than the full call shape.
    await waitFor(() => expect(fetchersMock.fetchRevokeSession).toHaveBeenCalled());
    expect(fetchersMock.fetchRevokeSession.mock.calls[0]?.[0]).toBe("tok-2");
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("does not offer a revoke control for the current session", () => {
    renderWithProviders(<ActiveSessionsCard sessions={[session({ current: true })]} />, {
      seed: [{ queryKey: settingsSecurityKeys.sessions(), data: [session({ current: true })] }],
    });

    expect(screen.queryByRole("button", { name: /^revoke$/i })).toBeNull();
  });

  it("revokes every other session and toasts on success", async () => {
    fetchersMock.fetchRevokeOtherSessions.mockResolvedValue(undefined);
    const user = userEvent.setup();
    const sessions = [
      session({ id: "cur", token: "cur", current: true }),
      session({ id: "a", token: "a" }),
      session({ id: "b", token: "b" }),
    ];
    renderWithProviders(<ActiveSessionsCard sessions={sessions} />, {
      seed: [{ queryKey: settingsSecurityKeys.sessions(), data: sessions }],
    });

    await user.click(screen.getByRole("button", { name: /sign out everywhere else/i }));
    await user.click(screen.getByTestId("confirm-revoke-all"));

    await waitFor(() => expect(fetchersMock.fetchRevokeOtherSessions).toHaveBeenCalled());
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });

  it("surfaces a revoke failure as an error toast", async () => {
    fetchersMock.fetchRevokeSession.mockRejectedValue(new Error("revoke boom"));
    const user = userEvent.setup();
    const other = session({ id: "sess-2", token: "tok-2" });
    renderWithProviders(<ActiveSessionsCard sessions={[session({ current: true }), other]} />, {
      seed: [
        {
          queryKey: settingsSecurityKeys.sessions(),
          data: [session({ current: true }), other],
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: /^revoke$/i }));
    await user.click(screen.getByTestId("confirm-revoke"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("revoke boom"));
  });
});
