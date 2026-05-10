// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { NameRow, EmailRow, VerifyBanner } from "@/routes/_authenticated/_settings/settings/profile";

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => cleanup());

describe("NameRow (mock)", () => {
  it("commits the trimmed name and toasts on save", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    render(<NameRow currentName="Alex" onSave={onSave} />);

    await user.clear(screen.getByTestId("profile-name"));
    await user.type(screen.getByTestId("profile-name"), "  Alex Morgan  ");
    await user.click(screen.getByTestId("save-name"));

    expect(onSave).toHaveBeenCalledWith("Alex Morgan");
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("shows 'No changes' when the draft equals the current name", () => {
    render(<NameRow currentName="Alex" onSave={() => {}} />);
    expect(screen.getByText(/no changes/i)).toBeTruthy();
  });
});

describe("EmailRow (mock)", () => {
  it("opens the confirmation dialog when the draft differs from the current email", async () => {
    const user = userEvent.setup();
    render(
      <EmailRow
        currentEmail="me@example.com"
        emailVerified={false}
        emailEnabled
        onCommit={() => {}}
      />,
    );

    await user.clear(screen.getByTestId("profile-email"));
    await user.type(screen.getByTestId("profile-email"), "new@example.com");
    await user.click(screen.getByTestId("change-email"));

    expect(await screen.findByTestId("confirm-direct-email")).toBeTruthy();
  });
});

describe("VerifyBanner (mock)", () => {
  it("starts a cooldown after a successful resend", async () => {
    const user = userEvent.setup();
    render(<VerifyBanner email="me@example.com" />);

    await user.click(screen.getByTestId("resend-verification"));
    expect(toastMock.success).toHaveBeenCalled();
    expect(await screen.findByText(/resend in 60s/i)).toBeTruthy();
  });
});
