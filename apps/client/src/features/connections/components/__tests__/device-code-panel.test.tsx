// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";

import { DeviceCodePanel } from "../device-code-panel";
import type { DeviceState } from "../../lib/types";

afterEach(() => {
  cleanup();
});

function waitingDevice(verifyUrl: string): Extract<DeviceState, { kind: "waiting" }> {
  return {
    kind: "waiting",
    userCode: "ABCD-1234",
    verifyUrl,
    nonce: "n1",
    intervalSec: 5,
    // Fixed in the future so the countdown renders a positive value.
    expiresAt: 10_000,
  };
}

describe("DeviceCodePanel — verifyUrl link safety", () => {
  it("renders the verification link for a safe https verifyUrl", () => {
    render(<DeviceCodePanel device={waitingDevice("https://plex.tv/link")} now={0} />);

    const link = screen.getByRole("link");
    expect(link.getAttribute("href")).toBe("https://plex.tv/link");
    // The host is surfaced in the link copy.
    expect(screen.getByText(/plex\.tv/)).toBeTruthy();
  });

  it("renders no link and shows a host hint for an unsafe (non-https) verifyUrl", () => {
    // A `javascript:` value must never become a rendered `href` — the guard
    // must not produce any anchor element at all. A plain-text hint is shown
    // instead so the user can still identify the target host and complete
    // the flow manually using the code below.
    render(<DeviceCodePanel device={waitingDevice("http://example.com/activate")} now={0} />);

    expect(screen.queryByRole("link")).toBeNull();
    // The hint surfaces the host so the panel does not look broken.
    expect(screen.getByText(/example\.com/)).toBeTruthy();
    // The user code is still shown so the flow remains completable.
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
  });
});
