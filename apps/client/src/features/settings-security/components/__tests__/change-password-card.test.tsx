// @vitest-environment happy-dom
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

import { ChangePasswordCard } from "@/features/settings-security";
import { renderWithProviders } from "@/shared/lib/test-utils";

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => cleanup());

describe("ChangePasswordCard", () => {
  it("expands the change-password form and validates min length", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordCard />);

    await user.click(screen.getByRole("button", { name: /change password/i }));

    await user.type(screen.getByTestId("current-password"), "old");
    await user.type(screen.getByTestId("new-password"), "short");

    expect(await screen.findByText(/must be at least 8/i)).toBeTruthy();
  });

  it("requires a letter and a digit even when long enough", async () => {
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordCard />);

    await user.click(screen.getByRole("button", { name: /change password/i }));
    await user.type(screen.getByTestId("current-password"), "old");
    await user.type(screen.getByTestId("new-password"), "abcdefghij");

    // Letters-only password clears the length bound but fails the alphanumeric
    // rule, so submit stays disabled with the composition message shown.
    expect(await screen.findByText(/must contain at least one letter/i)).toBeTruthy();
    expect(screen.getByTestId("submit-password")).toBeDisabled();
  });

  it("calls onChangePassword with the trimmed inputs and toasts on success", async () => {
    const onChange = vi.fn(async () => {});
    const user = userEvent.setup();
    renderWithProviders(<ChangePasswordCard onChangePassword={onChange} />);

    await user.click(screen.getByRole("button", { name: /change password/i }));
    await user.type(screen.getByTestId("current-password"), "OldPassword12!");
    await user.type(screen.getByTestId("new-password"), "NewPassword123!");
    await user.type(screen.getByTestId("confirm-password"), "NewPassword123!");

    await user.click(screen.getByTestId("submit-password"));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        currentPassword: "OldPassword12!",
        newPassword: "NewPassword123!",
      }),
    );
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });
});
