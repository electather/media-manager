// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  message: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: toastMock }));

import { Route as DangerRoute } from "@/routes/_authenticated/_settings/settings/danger";

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => cleanup());

describe("Danger zone (mock)", () => {
  it("opens the delete dialog and disables submit until email + password are filled", async () => {
    const user = userEvent.setup();
    const Component = DangerRoute.options.component!;
    render(<Component />);

    await user.click(screen.getByTestId("open-delete"));

    const confirm = await screen.findByTestId("confirm-delete");
    expect((confirm as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByTestId("delete-email"), "alex@example.com");
    await user.type(screen.getByTestId("delete-password"), "anything");
    await waitFor(() =>
      expect((screen.getByTestId("confirm-delete") as HTMLButtonElement).disabled).toBe(false),
    );
  });

  it("toasts when starting an export", async () => {
    const user = userEvent.setup();
    const Component = DangerRoute.options.component!;
    render(<Component />);

    await user.click(screen.getByTestId("export-data"));

    // Reauth dialog opens; confirm to trigger the export toast.
    const confirm = await screen.findByRole("button", { name: /export data/i });
    // Type any password (mock — not validated)
    const inputs = screen.getAllByPlaceholderText(/password/i);
    await user.type(inputs[0]!, "x");
    await user.click(confirm);

    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
  });
});
