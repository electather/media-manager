// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { JobHandle } from "@nama/shared/jobs";

vi.mock("@/shared/lib/api", () => ({ api: {} }));
vi.mock("@/shared/components/pickers", () => ({
  UserPicker: () => <div data-testid="user-picker" />,
  ConnectionPicker: () => <div data-testid="connection-picker" />,
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

// Mock the fetcher so tests control success vs. failure without a real HTTP layer.
vi.mock("../lib/fetchers", () => ({
  fetchTriggerJob: vi.fn(),
}));

import { fetchTriggerJob } from "../lib/fetchers";
import { toast } from "sonner";
import { DynamicTriggerDialog } from "../components/trigger-dialog";

const mockFetchTriggerJob = vi.mocked(fetchTriggerJob);
const mockToastError = vi.mocked(toast.error);

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

const requiredJob = {
  id: "host.thing",
  name: "Thing",
  kind: "triggerable",
  enabled: true,
  adminTriggerable: true,
  userTriggerable: false,
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", description: "Target id" },
      note: { type: "string", description: "Optional note" },
    },
    required: ["target"],
  },
} as unknown as JobHandle;

describe("DynamicTriggerDialog required validation", () => {
  it("marks required field labels with an asterisk", () => {
    renderWithClient(<DynamicTriggerDialog open job={requiredJob} onClose={() => undefined} />);
    const targetLabel = screen.getByText("target", { selector: "label" });
    expect(targetLabel.textContent).toContain("*");
    const noteLabel = screen.getByText("note", { selector: "label" });
    expect(noteLabel.textContent).not.toContain("*");
  });

  it("blocks submit and shows error message when required field is empty", async () => {
    const user = userEvent.setup();
    renderWithClient(<DynamicTriggerDialog open job={requiredJob} onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /run now/i }));
    expect(screen.getByText(/this field is required/i)).toBeTruthy();
    const input = screen.getByRole("textbox", { name: /target/i });
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("clears the error once the required field is filled", async () => {
    const user = userEvent.setup();
    renderWithClient(<DynamicTriggerDialog open job={requiredJob} onClose={() => undefined} />);
    await user.click(screen.getByRole("button", { name: /run now/i }));
    expect(screen.getByText(/this field is required/i)).toBeTruthy();
    const input = screen.getByRole("textbox", { name: /target/i });
    await user.type(input, "abc");
    expect(screen.queryByText(/this field is required/i)).toBeNull();
  });
});

const numberJob = {
  id: "host.math.compute",
  name: "Compute",
  kind: "triggerable",
  enabled: true,
  adminTriggerable: true,
  userTriggerable: false,
  inputSchema: {
    type: "object",
    properties: {
      count: { type: "number", description: "How many items" },
    },
    required: ["count"],
  },
} as unknown as JobHandle;

describe("DynamicTriggerDialog number coercion", () => {
  it("submits a numeric value (not a string) for number-typed fields", async () => {
    // Arrange: fetchTriggerJob resolves so the mutation reaches onSuccess.
    mockFetchTriggerJob.mockResolvedValueOnce({});
    const user = userEvent.setup();
    renderWithClient(<DynamicTriggerDialog open job={numberJob} onClose={() => undefined} />);

    const input = screen.getByRole("spinbutton", { name: /count/i });
    await user.type(input, "5");
    await user.click(screen.getByRole("button", { name: /run now/i }));

    // The fetcher should have been called with the number 5, not the string "5".
    await waitFor(() => {
      expect(mockFetchTriggerJob).toHaveBeenCalledWith(
        numberJob.id,
        expect.objectContaining({ count: 5 }),
      );
    });
  });
});

describe("DynamicTriggerDialog error handling", () => {
  it("shows an error toast when the trigger fetch rejects", async () => {
    // Arrange: simulate a server error so the mutation fires onError.
    mockFetchTriggerJob.mockRejectedValueOnce(new Error("network error"));
    const user = userEvent.setup();
    renderWithClient(<DynamicTriggerDialog open job={numberJob} onClose={() => undefined} />);

    const input = screen.getByRole("spinbutton", { name: /count/i });
    await user.type(input, "3");
    await user.click(screen.getByRole("button", { name: /run now/i }));

    // The user must see an error toast so the failure is not silent.
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("network error");
    });
  });
});
