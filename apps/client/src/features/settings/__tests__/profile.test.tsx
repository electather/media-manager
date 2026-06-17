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

import {
  NameRow,
  EmailRow,
  VerifyBanner,
} from "@/features/settings-profile/components/settings-profile-page";
import { renderWithProviders } from "@/shared/lib/test-utils";

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => cleanup());

describe("NameRow", () => {
  it("commits the trimmed name and toasts on save", async () => {
    const onSave = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<NameRow currentName="Alex" onSave={onSave} />);

    await user.clear(screen.getByTestId("profile-name"));
    await user.type(screen.getByTestId("profile-name"), "  Alex Morgan  ");
    await user.click(screen.getByTestId("save-name"));

    await waitFor(() => expect(onSave).toHaveBeenCalledWith("Alex Morgan"));
    expect(toastMock.success).toHaveBeenCalled();
  });

  it("shows 'No changes' when the draft equals the current name", () => {
    renderWithProviders(<NameRow currentName="Alex" />);
    expect(screen.getByText(/no changes/i)).toBeTruthy();
  });
});

describe("EmailRow", () => {
  it("opens the confirmation dialog when the draft differs from the current email", async () => {
    const user = userEvent.setup();
    renderWithProviders(
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

  it("calls onCommit with the new email when confirmed", async () => {
    const onCommit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <EmailRow
        currentEmail="me@example.com"
        emailVerified={false}
        emailEnabled={false}
        onCommit={onCommit}
      />,
    );

    await user.clear(screen.getByTestId("profile-email"));
    await user.type(screen.getByTestId("profile-email"), "new@example.com");
    await user.click(screen.getByTestId("change-email"));
    await user.click(await screen.findByTestId("confirm-direct-email"));

    await waitFor(() => expect(onCommit).toHaveBeenCalledWith("new@example.com"));
  });
});

describe("VerifyBanner", () => {
  it("starts a cooldown after a successful resend", async () => {
    const user = userEvent.setup();
    renderWithProviders(<VerifyBanner email="me@example.com" onResend={async () => {}} />);

    await user.click(screen.getByTestId("resend-verification"));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalled());
    expect(await screen.findByText(/resend in 60s/i)).toBeTruthy();
  });
});
