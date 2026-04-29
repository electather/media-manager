// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const auth = vi.hoisted(() => ({
  updateUser: vi.fn(),
  changeEmail: vi.fn(),
  sendVerificationEmail: vi.fn(),
}));

vi.mock("@/shared/lib/auth", () => ({
  authClient: auth,
}));

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import {
  EmailField,
  NameField,
  VerificationBanner,
} from "@/routes/_authenticated/_settings/settings/profile";

beforeEach(() => {
  auth.updateUser.mockReset();
  auth.changeEmail.mockReset();
  auth.sendVerificationEmail.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.info.mockReset();
});

afterEach(() => cleanup());

function renderWithClient(node: React.ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

describe("NameField", () => {
  it("saves a trimmed name and toasts on success", async () => {
    auth.updateUser.mockResolvedValue({ data: { status: true }, error: null });

    const user = userEvent.setup();
    renderWithClient(<NameField currentName="Alex" />);

    await user.clear(screen.getByTestId("profile-name"));
    await user.type(screen.getByTestId("profile-name"), "  Alex Morgan  ");
    await user.click(screen.getByTestId("save-name"));

    await waitFor(() => expect(auth.updateUser).toHaveBeenCalledWith({ name: "Alex Morgan" }));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("surfaces an inline error and preserves the draft on failure", async () => {
    auth.updateUser.mockResolvedValue({ data: null, error: { message: "Server said no" } });

    const user = userEvent.setup();
    renderWithClient(<NameField currentName="Alex" />);

    await user.clear(screen.getByTestId("profile-name"));
    await user.type(screen.getByTestId("profile-name"), "Bad Name");
    await user.click(screen.getByTestId("save-name"));

    expect(await screen.findByText("Server said no")).toBeTruthy();
    expect((screen.getByTestId("profile-name") as HTMLInputElement).value).toBe("Bad Name");
  });
});

describe("EmailField", () => {
  it("flips into a confirmation state when emailEnabled and changeEmail succeeds", async () => {
    auth.changeEmail.mockResolvedValue({ data: { status: true }, error: null });

    const user = userEvent.setup();
    renderWithClient(<EmailField currentEmail="me@example.com" emailEnabled />);

    await user.clear(screen.getByTestId("profile-email"));
    await user.type(screen.getByTestId("profile-email"), "new@example.com");
    await user.click(screen.getByTestId("change-email"));

    await waitFor(() =>
      expect(auth.changeEmail).toHaveBeenCalledWith({
        newEmail: "new@example.com",
        callbackURL: "/settings/profile",
      }),
    );
    expect(await screen.findByText(/we've sent a confirmation link/i)).toBeTruthy();
  });

  it("opens a confirm dialog when emailEnabled is false; submitting flips immediately", async () => {
    auth.changeEmail.mockResolvedValue({ data: { status: true }, error: null });

    const user = userEvent.setup();
    renderWithClient(<EmailField currentEmail="me@example.com" emailEnabled={false} />);

    await user.clear(screen.getByTestId("profile-email"));
    await user.type(screen.getByTestId("profile-email"), "new@example.com");
    await user.click(screen.getByTestId("change-email"));

    const confirmButton = await screen.findByTestId("confirm-direct-email");
    await user.click(confirmButton);

    await waitFor(() =>
      expect(auth.changeEmail).toHaveBeenCalledWith({ newEmail: "new@example.com" }),
    );
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("surfaces a server error inline without entering the confirmation state", async () => {
    auth.changeEmail.mockResolvedValue({
      data: null,
      error: { status: 409, message: "already in use" },
    });

    const user = userEvent.setup();
    renderWithClient(<EmailField currentEmail="me@example.com" emailEnabled />);

    await user.clear(screen.getByTestId("profile-email"));
    await user.type(screen.getByTestId("profile-email"), "taken@example.com");
    await user.click(screen.getByTestId("change-email"));

    expect(await screen.findByText("already in use")).toBeTruthy();
    expect(screen.queryByText(/we've sent a confirmation/i)).toBeNull();
  });
});

describe("VerificationBanner", () => {
  it("starts a 60s cooldown after a successful resend", async () => {
    auth.sendVerificationEmail.mockResolvedValue({ data: { status: true }, error: null });

    const user = userEvent.setup();
    renderWithClient(<VerificationBanner email="me@example.com" />);

    await user.click(screen.getByTestId("resend-verification"));

    await waitFor(() =>
      expect(auth.sendVerificationEmail).toHaveBeenCalledWith({ email: "me@example.com" }),
    );
    expect(await screen.findByText(/resend in 60s/i)).toBeTruthy();
  });

  it("can be dismissed", async () => {
    const user = userEvent.setup();
    renderWithClient(<VerificationBanner email="me@example.com" />);

    expect(screen.getByText(/verify your email/i)).toBeTruthy();
    await user.click(screen.getByTestId("dismiss-verification"));
    expect(screen.queryByText(/verify your email/i)).toBeNull();
  });
});
