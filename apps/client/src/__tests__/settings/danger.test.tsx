// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const apiMock = vi.hoisted(() => ({ delete: vi.fn() }));
vi.mock("@/lib/api", () => ({
  api: {
    me: {
      delete: { $post: (args: unknown) => apiMock.delete(args) },
    },
  },
}));

const auth = vi.hoisted(() => ({
  signOut: vi.fn(),
  useSession: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ authClient: auth }));

const navigateMock = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, useNavigate: () => navigateMock };
});

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const downloadMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/anchor-download", () => ({ triggerAnchorDownload: downloadMock }));

import { DeleteCard, ExportCard } from "@/routes/_authenticated/_settings/settings/danger";

beforeEach(() => {
  apiMock.delete.mockReset();
  auth.signOut.mockReset();
  navigateMock.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.info.mockReset();
  downloadMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderWithClient(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

function jsonResponse<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("ExportCard", () => {
  it("triggers an anchor navigation to /api/me/export", async () => {
    const user = userEvent.setup();
    renderWithClient(<ExportCard />);

    await user.click(screen.getByTestId("export-data"));

    expect(downloadMock).toHaveBeenCalledWith("/api/me/export");
  });
});

describe("DeleteCard", () => {
  it("disables the delete button until both email and password validate", async () => {
    const user = userEvent.setup();
    renderWithClient(<DeleteCard currentEmail="me@example.com" />);

    await user.click(screen.getByTestId("open-delete"));

    const confirm = screen.getByTestId("confirm-delete") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await user.type(screen.getByTestId("delete-email"), "wrong@example.com");
    await user.type(screen.getByTestId("delete-password"), "secret");
    expect(confirm.disabled).toBe(true);

    await user.clear(screen.getByTestId("delete-email"));
    await user.type(screen.getByTestId("delete-email"), "me@example.com");
    expect(confirm.disabled).toBe(false);
  });

  it("on 401 keeps the dialog open with an inline password error and retains inputs", async () => {
    apiMock.delete.mockResolvedValue(jsonResponse({ code: "me.delete.invalid_password" }, 401));

    const user = userEvent.setup();
    renderWithClient(<DeleteCard currentEmail="me@example.com" />);

    await user.click(screen.getByTestId("open-delete"));
    await user.type(screen.getByTestId("delete-email"), "me@example.com");
    await user.type(screen.getByTestId("delete-password"), "wrong");
    await user.click(screen.getByTestId("confirm-delete"));

    expect(await screen.findByText(/that password is incorrect/i)).toBeTruthy();
    expect((screen.getByTestId("delete-email") as HTMLInputElement).value).toBe("me@example.com");
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("on success toasts, calls signOut, and navigates to /auth/login", async () => {
    apiMock.delete.mockResolvedValue(jsonResponse({ ok: true }));
    auth.signOut.mockResolvedValue(undefined);

    const user = userEvent.setup();
    renderWithClient(<DeleteCard currentEmail="me@example.com" />);

    await user.click(screen.getByTestId("open-delete"));
    await user.type(screen.getByTestId("delete-email"), "me@example.com");
    await user.type(screen.getByTestId("delete-password"), "secret");
    await user.click(screen.getByTestId("confirm-delete"));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(auth.signOut).toHaveBeenCalled();
    expect(navigateMock).toHaveBeenCalledWith({ to: "/auth/login", replace: true });
  });
});
