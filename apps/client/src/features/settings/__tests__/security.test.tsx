// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { SecurityPage } from "@/routes/_authenticated/_settings/settings/security";

beforeEach(() => {
  toastMock.success.mockReset();
});

afterEach(() => cleanup());

describe("Security (mock)", () => {
  it("expands the change-password form and validates min length", async () => {
    const user = userEvent.setup();
    render(<SecurityPage />);

    await user.click(screen.getByRole("button", { name: /change password/i }));

    await user.type(screen.getByTestId("current-password"), "old");
    await user.type(screen.getByTestId("new-password"), "short");

    expect(await screen.findByText(/at least 12/i)).toBeTruthy();
  });

  it("revokes a non-current session via the confirm dialog", async () => {
    const user = userEvent.setup();
    render(<SecurityPage />);

    const revokeButtons = screen.getAllByRole("button", { name: /^revoke$/i });
    expect(revokeButtons.length).toBeGreaterThan(0);
    await user.click(revokeButtons[0]);

    const confirm = await screen.findByTestId("confirm-revoke");
    await user.click(confirm);

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });
});
