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

// Mock the settings shared fetchers module so the hook under test calls our
// mock instead of making a real network request.
const deleteAccountMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
vi.mock("@/features/settings/shared/fetchers", async () => {
  const actual = await vi.importActual<typeof import("@/features/settings/shared/fetchers")>(
    "@/features/settings/shared/fetchers",
  );
  return { ...actual, deleteAccount: deleteAccountMock };
});

import { DeleteAccountDialog } from "@/features/settings-danger/components/settings-danger-page";
import { renderWithProviders } from "@/features/settings/__tests__/test-utils";

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  deleteAccountMock.mockReset();
});

afterEach(() => cleanup());

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
});
