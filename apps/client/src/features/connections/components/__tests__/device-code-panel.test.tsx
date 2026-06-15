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

  it("renders no link for an unsafe (non-https) verifyUrl", () => {
    // A `javascript:` value must never become a rendered `href` — the guard
    // drops the anchor entirely. The user code + copy affordance still render,
    // so the panel stays usable.
    render(<DeviceCodePanel device={waitingDevice("javascript:alert(1)")} now={0} />);

    expect(screen.queryByRole("link")).toBeNull();
    // The code itself is still shown so the user can complete the flow manually.
    expect(screen.getByText("ABCD-1234")).toBeTruthy();
  });
});
