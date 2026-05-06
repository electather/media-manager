// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { JobHandle } from "@ent-mcp/shared/jobs";

vi.mock("@/shared/lib/api", () => ({ api: {} }));
vi.mock("@/shared/components/pickers", () => ({
  UserPicker: () => <div data-testid="user-picker" />,
  ConnectionPicker: () => <div data-testid="connection-picker" />,
}));

import { DynamicTriggerDialog } from "../components/trigger-dialog";

function renderWithClient(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const enumJob = {
  id: "host.notifications.demo",
  name: "Demo",
  kind: "triggerable",
  enabled: true,
  adminTriggerable: true,
  userTriggerable: false,
  inputSchema: {
    type: "object",
    properties: {
      category: {
        type: "string",
        enum: ["media", "sync", "auth", "system"],
        "x-enum-labels": { media: "Media", sync: "Sync", auth: "Auth", system: "System" },
      },
    },
  },
} as unknown as JobHandle;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // happy-dom defaults to undefined for getBoundingClientRect on portal anchors used by base-ui.
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => undefined;
  }
});

describe("DynamicTriggerDialog enum rendering", () => {
  it("renders enum field as a select trigger (not free-text input)", () => {
    renderWithClient(<DynamicTriggerDialog open job={enumJob} onClose={() => undefined} />);
    expect(screen.queryByRole("textbox", { name: /category/i })).toBeNull();
    expect(screen.getByRole("combobox", { name: /category/i })).toBeTruthy();
  });

  it("displays the human label (not the raw value) after a value is selected", async () => {
    const user = userEvent.setup();
    renderWithClient(<DynamicTriggerDialog open job={enumJob} onClose={() => undefined} />);
    const trigger = screen.getByRole("combobox", { name: /category/i });
    await user.click(trigger);
    const option = await screen.findByRole("option", { name: "Sync" });
    await user.click(option);
    // After selection, trigger should show "Sync" — the label — not "sync".
    expect(trigger.textContent).toContain("Sync");
    expect(trigger.textContent).not.toMatch(/^sync$/);
  });
});
