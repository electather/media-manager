// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SessionRow } from "../components/session-row";

afterEach(() => cleanup());

const baseSession = {
  id: "sess-1",
  token: "tok-1",
  createdAt: new Date(Date.now() - 60_000),
  updatedAt: new Date(Date.now() - 30_000),
  ipAddress: "203.0.113.10",
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

describe("SessionRow", () => {
  it("shows the parsed device label, IP, and a Revoke button for non-current sessions", async () => {
    const onRevoke = vi.fn();
    render(<SessionRow session={baseSession} isCurrent={false} onRevoke={onRevoke} />);

    // Label resolves after ua-parser-js loads via dynamic import.
    expect(await screen.findByText("Chrome 120 on macOS")).toBeTruthy();
    expect(screen.getByText(/203\.0\.113\.10/)).toBeTruthy();
    expect(screen.queryByText("This device")).toBeNull();

    const revoke = screen.getByRole("button", { name: /revoke/i });
    await userEvent.click(revoke);
    expect(onRevoke).toHaveBeenCalledWith("tok-1");
  });

  it("badges the current session and hides the Revoke button", () => {
    render(<SessionRow session={baseSession} isCurrent onRevoke={() => {}} />);

    expect(screen.getByText("This device")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });

  it("falls back to 'Unknown device' and hides the IP fragment when both UA and IP are missing", () => {
    render(
      <SessionRow
        session={{ ...baseSession, userAgent: null, ipAddress: null }}
        isCurrent={false}
        onRevoke={() => {}}
      />,
    );

    expect(screen.getByText("Unknown device")).toBeTruthy();
    // The meta line must not start with a leading separator like " · ".
    const metaLines = screen.getAllByText(/Signed in/i);
    for (const line of metaLines) {
      expect(line.textContent?.startsWith(" · ")).toBe(false);
      expect(line.textContent ?? "").not.toMatch(/^·/);
    }
  });

  it("hides the IP fragment when only the UA is missing", () => {
    render(
      <SessionRow
        session={{ ...baseSession, userAgent: null, ipAddress: "203.0.113.10" }}
        isCurrent={false}
        onRevoke={() => {}}
      />,
    );

    // IP must not render alongside an "Unknown device" label.
    expect(screen.queryByText(/203\.0\.113\.10/)).toBeNull();
  });
});
