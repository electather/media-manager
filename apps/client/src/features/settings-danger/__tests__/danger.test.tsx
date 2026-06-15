// @vitest-environment happy-dom
import type { AnchorHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, screen, waitFor } from "@testing-library/react";
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

// Mock the settings fetchers module so the dialog always calls deleteAccount
// directly without needing a test-only escape hatch prop.
const deleteAccountMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("@/features/settings", async () => {
  const actual = await vi.importActual<typeof import("@/features/settings")>("@/features/settings");
  return { ...actual, deleteAccount: deleteAccountMock };
});

// Spy on the anchor-download seam so the export click can be asserted to
// trigger a browser download (the documented anchor-nav v1 path) without a
// real backend or navigation.
const triggerAnchorDownloadMock = vi.hoisted(() => vi.fn());
vi.mock("@/shared/lib/anchor-download", () => ({
  triggerAnchorDownload: triggerAnchorDownloadMock,
}));

// Stub the auth client so the page can read a session email and the
// sign-out side effect is inert.
const authMock = vi.hoisted(() => ({
  useSession: vi.fn(() => ({ data: { user: { email: "alex@example.com" } } })),
  signOut: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/shared/lib/auth", () => ({ authClient: authMock }));

import {
  DeleteAccountDialog,
  SettingsDangerRoute,
} from "@/features/settings-danger/components/settings-danger-page";
import { renderWithProviders } from "@/features/settings/__tests__/test-utils";

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  deleteAccountMock.mockReset();
  triggerAnchorDownloadMock.mockReset();
});

afterEach(() => cleanup());

describe("export my data", () => {
  it("triggers an anchor download to /api/me/export and shows the started toast", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SettingsDangerRoute />);

    await user.click(await screen.findByTestId("export-data"));

    // Anchor-nav v1: the export must hand off to the browser download pipeline,
    // not buffer the ZIP client-side. See docs/2026-04-24-user-settings-design.md L286.
    expect(triggerAnchorDownloadMock).toHaveBeenCalledWith("/api/me/export");
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });
});

describe("DeleteAccountDialog", () => {
  it("disables submit until both email + password are valid", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DeleteAccountDialog open email="alex@example.com" onClose={() => {}} onDeleted={() => {}} />,
    );

    const confirm = await screen.findByTestId("confirm-delete");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByTestId("delete-email"), "alex@example.com");
    await user.type(screen.getByTestId("delete-password"), "anything");
    await waitFor(() =>
      expect((screen.getByTestId("confirm-delete") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("calls deleteAccount with the trimmed email + password and invokes onDeleted", async () => {
    deleteAccountMock.mockResolvedValue(undefined);
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <DeleteAccountDialog
        open
        email="alex@example.com"
        onClose={() => {}}
        onDeleted={onDeleted}
      />,
    );

    await user.type(screen.getByTestId("delete-email"), "alex@example.com");
    await user.type(screen.getByTestId("delete-password"), "Secret123!");
    await user.click(screen.getByTestId("confirm-delete"));

    await waitFor(() =>
      expect(deleteAccountMock).toHaveBeenCalledWith({
        confirmEmail: "alex@example.com",
        currentPassword: "Secret123!",
      }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it("shows an error message when deleteAccount rejects", async () => {
    deleteAccountMock.mockRejectedValue(new Error("Wrong password"));
    const user = userEvent.setup();
    renderWithProviders(
      <DeleteAccountDialog open email="alex@example.com" onClose={() => {}} onDeleted={() => {}} />,
    );

    await user.type(screen.getByTestId("delete-email"), "alex@example.com");
    await user.type(screen.getByTestId("delete-password"), "BadPass!");
    await user.click(screen.getByTestId("confirm-delete"));

    await waitFor(() => expect(screen.getByText("Wrong password")).toBeTruthy());
  });

  it("toggles the password reveal aria-label between show and hide", async () => {
    // Guards the headline i18n fix: the type-check catches a wrong message key,
    // but only this asserts the localized aria-label is actually rendered and
    // flips on toggle, so dropping the label entirely would fail here.
    const user = userEvent.setup();
    renderWithProviders(
      <DeleteAccountDialog open email="alex@example.com" onClose={() => {}} onDeleted={() => {}} />,
    );

    const reveal = await screen.findByRole("button", { name: /show password/i });
    await user.click(reveal);
    expect(screen.getByRole("button", { name: /hide password/i })).toBeTruthy();
  });
});
