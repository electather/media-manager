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

import { DeleteAccountDialog } from "@/features/settings-danger/components/settings-danger-page";
import { renderWithProviders } from "./test-utils";

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => cleanup());

describe("DeleteAccountDialog", () => {
  it("disables submit until both email + password are valid", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <DeleteAccountDialog
        open
        email="alex@example.com"
        onClose={() => {}}
        onDeleted={() => {}}
        onSubmit={async () => {}}
      />,
    );

    const confirm = await screen.findByTestId("confirm-delete");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByTestId("delete-email"), "alex@example.com");
    await user.type(screen.getByTestId("delete-password"), "anything");
    await waitFor(() =>
      expect((screen.getByTestId("confirm-delete") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("calls onSubmit with the trimmed email + password", async () => {
    const onSubmit = vi.fn(async () => {});
    const onDeleted = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <DeleteAccountDialog
        open
        email="alex@example.com"
        onClose={() => {}}
        onDeleted={onDeleted}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByTestId("delete-email"), "alex@example.com");
    await user.type(screen.getByTestId("delete-password"), "Secret123!");
    await user.click(screen.getByTestId("confirm-delete"));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        confirmEmail: "alex@example.com",
        currentPassword: "Secret123!",
      }),
    );
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });
});
