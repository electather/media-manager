// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock `@/lib/auth` before importing the components under test so they pick up
// the stub. We use `vi.hoisted` so the stub object is created before the
// vi.mock factory runs and we can drive call results from individual tests.
const mocks = vi.hoisted(() => ({
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  changePassword: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  authClient: {
    listSessions: mocks.listSessions,
    revokeSession: mocks.revokeSession,
    revokeOtherSessions: mocks.revokeOtherSessions,
    changePassword: mocks.changePassword,
    useSession: mocks.useSession,
  },
}));

// Sonner is auto-mounted in main.tsx but not loaded in tests; calling toast()
// without a Toaster is fine, but we silence to avoid noisy output.
const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import {
  ActiveSessionsCard,
  ChangePasswordCard,
} from "@/routes/_authenticated/_settings/settings/security";

const CURRENT_SESSION_ID = "sess-current";
const OTHER_SESSION_ID = "sess-other";

const sessionFixtures = [
  {
    id: CURRENT_SESSION_ID,
    token: "tok-current",
    createdAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 30_000).toISOString(),
    ipAddress: "203.0.113.10",
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
  {
    id: OTHER_SESSION_ID,
    token: "tok-other",
    createdAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    updatedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    ipAddress: "198.51.100.20",
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0",
  },
];

function renderWithClient(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  mocks.listSessions.mockReset();
  mocks.revokeSession.mockReset();
  mocks.revokeOtherSessions.mockReset();
  mocks.changePassword.mockReset();
  mocks.useSession.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();

  mocks.useSession.mockReturnValue({
    data: { session: { id: CURRENT_SESSION_ID } },
    isPending: false,
    error: null,
  });
});

afterEach(() => cleanup());

describe("ActiveSessionsCard", () => {
  it("renders sessions, badges the current one, and revokes another via the confirmation dialog", async () => {
    // First call returns both sessions; after revoke, the refetch returns only
    // the current session so the row is expected to disappear.
    mocks.listSessions
      .mockResolvedValueOnce({ data: sessionFixtures, error: null })
      .mockResolvedValue({ data: [sessionFixtures[0]], error: null });
    mocks.revokeSession.mockResolvedValue({ data: { status: true }, error: null });

    const user = userEvent.setup();
    renderWithClient(<ActiveSessionsCard />);

    await waitFor(() => {
      expect(screen.getByTestId(`session-row-${CURRENT_SESSION_ID}`)).toBeTruthy();
      expect(screen.getByTestId(`session-row-${OTHER_SESSION_ID}`)).toBeTruthy();
    });

    const currentRow = screen.getByTestId(`session-row-${CURRENT_SESSION_ID}`);
    expect(within(currentRow).getByText("This device")).toBeTruthy();
    expect(within(currentRow).queryByRole("button", { name: /revoke/i })).toBeNull();

    const otherRow = screen.getByTestId(`session-row-${OTHER_SESSION_ID}`);
    const revokeButton = within(otherRow).getByRole("button", { name: /revoke/i });
    await user.click(revokeButton);

    const confirm = await screen.findByTestId("confirm-revoke");
    await user.click(confirm);

    await waitFor(() => expect(mocks.revokeSession).toHaveBeenCalledWith({ token: "tok-other" }));

    await waitFor(() => {
      expect(screen.queryByTestId(`session-row-${OTHER_SESSION_ID}`)).toBeNull();
    });
  });

  it("hides 'Sign out everywhere' when only the current session exists", async () => {
    mocks.listSessions.mockResolvedValue({
      data: [sessionFixtures[0]],
      error: null,
    });

    renderWithClient(<ActiveSessionsCard />);

    await waitFor(() => {
      expect(screen.getByTestId(`session-row-${CURRENT_SESSION_ID}`)).toBeTruthy();
    });

    expect(screen.queryByTestId("sign-out-everywhere")).toBeNull();
  });

  it("signs out other sessions via the confirmation dialog and refetches the list", async () => {
    // First call returns both; after revokeOtherSessions, the refetch returns
    // only the current session.
    mocks.listSessions
      .mockResolvedValueOnce({ data: sessionFixtures, error: null })
      .mockResolvedValue({ data: [sessionFixtures[0]], error: null });
    mocks.revokeOtherSessions.mockResolvedValue({ data: { status: true }, error: null });

    const user = userEvent.setup();
    renderWithClient(<ActiveSessionsCard />);

    const trigger = await screen.findByTestId("sign-out-everywhere");
    await user.click(trigger);

    const confirm = await screen.findByTestId("confirm-sign-out-everywhere");
    await user.click(confirm);

    await waitFor(() => expect(mocks.revokeOtherSessions).toHaveBeenCalledTimes(1));

    // The refetch removes the other session and the trigger button should
    // disappear once only the current session remains.
    await waitFor(() => {
      expect(screen.queryByTestId(`session-row-${OTHER_SESSION_ID}`)).toBeNull();
      expect(screen.queryByTestId("sign-out-everywhere")).toBeNull();
    });
  });

  it("toasts and leaves the row in place when revokeSession fails", async () => {
    mocks.listSessions.mockResolvedValue({ data: sessionFixtures, error: null });
    mocks.revokeSession.mockResolvedValue({
      data: null,
      error: { message: "boom" },
    });

    const user = userEvent.setup();
    renderWithClient(<ActiveSessionsCard />);

    const otherRow = await screen.findByTestId(`session-row-${OTHER_SESSION_ID}`);
    await user.click(within(otherRow).getByRole("button", { name: /revoke/i }));
    await user.click(await screen.findByTestId("confirm-revoke"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("boom"));
    // Row stays after a failed revoke.
    expect(screen.getByTestId(`session-row-${OTHER_SESSION_ID}`)).toBeTruthy();
  });

  it("toasts and keeps the list when revokeOtherSessions fails", async () => {
    mocks.listSessions.mockResolvedValue({ data: sessionFixtures, error: null });
    mocks.revokeOtherSessions.mockResolvedValue({
      data: null,
      error: { message: "kapow" },
    });

    const user = userEvent.setup();
    renderWithClient(<ActiveSessionsCard />);

    await user.click(await screen.findByTestId("sign-out-everywhere"));
    await user.click(await screen.findByTestId("confirm-sign-out-everywhere"));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("kapow"));
    // Both sessions still present after a failed sign-out-everywhere.
    expect(screen.getByTestId(`session-row-${CURRENT_SESSION_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`session-row-${OTHER_SESSION_ID}`)).toBeTruthy();
  });

  it("renders an error surface with a Retry button when listSessions fails", async () => {
    mocks.listSessions
      .mockResolvedValueOnce({ data: null, error: { message: "boom" } })
      .mockResolvedValue({ data: sessionFixtures, error: null });

    const user = userEvent.setup();
    renderWithClient(<ActiveSessionsCard />);

    const errorSurface = await screen.findByText(/could not load active sessions/i);
    expect(errorSurface).toBeTruthy();

    const retry = screen.getByRole("button", { name: /retry/i });
    await user.click(retry);

    await waitFor(() => {
      expect(screen.getByTestId(`session-row-${CURRENT_SESSION_ID}`)).toBeTruthy();
      expect(screen.getByTestId(`session-row-${OTHER_SESSION_ID}`)).toBeTruthy();
    });
  });
});

describe("ChangePasswordCard", () => {
  it("shows an inline error under 'Current password' when the API returns INVALID_PASSWORD", async () => {
    const user = userEvent.setup();
    mocks.changePassword.mockResolvedValue({
      data: null,
      error: { status: 400, code: "INVALID_PASSWORD", message: "Invalid password" },
    });

    renderWithClient(<ChangePasswordCard />);

    await user.click(screen.getByTestId("open-change-password"));

    await user.type(screen.getByTestId("current-password"), "wrong-password");
    await user.type(screen.getByTestId("new-password"), "brand-new-password-123");
    await user.type(screen.getByTestId("confirm-password"), "brand-new-password-123");

    await user.click(screen.getByTestId("save-password"));

    const inlineError = await screen.findByText(/that password is incorrect/i);
    expect(inlineError).toBeTruthy();

    expect(screen.getByTestId("save-password")).toBeTruthy();
    expect((screen.getByTestId("new-password") as HTMLInputElement).value).toBe(
      "brand-new-password-123",
    );

    expect(mocks.changePassword).toHaveBeenCalledWith({
      currentPassword: "wrong-password",
      newPassword: "brand-new-password-123",
      revokeOtherSessions: true,
    });
  });

  it("does NOT mistake other 400 codes for the wrong-current-password case", async () => {
    const user = userEvent.setup();
    mocks.changePassword.mockResolvedValue({
      data: null,
      error: { status: 400, code: "RATE_LIMITED", message: "Too many requests" },
    });

    renderWithClient(<ChangePasswordCard />);

    await user.click(screen.getByTestId("open-change-password"));
    await user.type(screen.getByTestId("current-password"), "any-current-password");
    await user.type(screen.getByTestId("new-password"), "brand-new-password-123");
    await user.type(screen.getByTestId("confirm-password"), "brand-new-password-123");
    await user.click(screen.getByTestId("save-password"));

    // The server message lands on the new-password field, not the current-password field.
    const inlineError = await screen.findByText(/too many requests/i);
    expect(inlineError).toBeTruthy();
    expect(screen.queryByText(/that password is incorrect/i)).toBeNull();
  });

  it("collapses the form, toasts, and refetches sessions on a successful change", async () => {
    const user = userEvent.setup();
    mocks.changePassword.mockResolvedValue({ data: { status: true }, error: null });
    // The mutation invalidates SESSIONS_QUERY_KEY; even though
    // ChangePasswordCard is mounted in isolation here, the invalidation can
    // trigger a listSessions call, so it needs a stub return.
    mocks.listSessions.mockResolvedValue({ data: [], error: null });

    renderWithClient(<ChangePasswordCard />);

    await user.click(screen.getByTestId("open-change-password"));
    await user.type(screen.getByTestId("current-password"), "old-password");
    await user.type(screen.getByTestId("new-password"), "brand-new-password-123");
    await user.type(screen.getByTestId("confirm-password"), "brand-new-password-123");
    await user.click(screen.getByTestId("save-password"));

    // Form collapses back to the trigger button.
    await waitFor(() => {
      expect(screen.getByTestId("open-change-password")).toBeTruthy();
      expect(screen.queryByTestId("save-password")).toBeNull();
    });

    expect(toastMock.success).toHaveBeenCalled();
    expect(mocks.changePassword).toHaveBeenCalledWith({
      currentPassword: "old-password",
      newPassword: "brand-new-password-123",
      revokeOtherSessions: true,
    });
  });

  it("rejects a too-short new password client-side without calling the API", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChangePasswordCard />);

    await user.click(screen.getByTestId("open-change-password"));
    await user.type(screen.getByTestId("current-password"), "old-password");
    await user.type(screen.getByTestId("new-password"), "short");
    await user.type(screen.getByTestId("confirm-password"), "short");
    await user.click(screen.getByTestId("save-password"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/at least 12 characters/i);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation client-side without calling the API", async () => {
    const user = userEvent.setup();
    renderWithClient(<ChangePasswordCard />);

    await user.click(screen.getByTestId("open-change-password"));
    await user.type(screen.getByTestId("current-password"), "old-password");
    await user.type(screen.getByTestId("new-password"), "brand-new-password-123");
    await user.type(screen.getByTestId("confirm-password"), "different-password-456");
    await user.click(screen.getByTestId("save-password"));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/passwords do not match/i);
    expect(mocks.changePassword).not.toHaveBeenCalled();
  });
});
