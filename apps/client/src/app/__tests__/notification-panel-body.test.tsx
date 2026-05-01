// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { NotificationPanelBody } from "../notification-panel-body";
import type { NotificationItemDto } from "../notification-panel-types";

function makeItem(
  overrides: Partial<NotificationItemDto> & { id: string },
): NotificationItemDto {
  return {
    severity: "info",
    category: "media",
    title: `Notification ${overrides.id}`,
    body: "Body text.",
    actionUrl: null,
    image: null,
    createdAt: Date.now(),
    readAt: null,
    audienceKind: "user",
    ...overrides,
  };
}

const noop = vi.fn();

function renderBody(
  items: NotificationItemDto[],
  overrides: Partial<React.ComponentProps<typeof NotificationPanelBody>> = {},
) {
  const props = {
    items,
    density: "comfortable" as const,
    intensity: "subtle" as const,
    onMarkAllRead: noop,
    onMarkRead: noop,
    onDismiss: noop,
    ...overrides,
  };
  return render(<NotificationPanelBody {...props} />);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("NotificationPanelBody", () => {
  describe("rendering", () => {
    it("renders all items", () => {
      const items = [makeItem({ id: "a" }), makeItem({ id: "b" })];
      renderBody(items);
      expect(screen.getByText("Notification a")).toBeTruthy();
      expect(screen.getByText("Notification b")).toBeTruthy();
    });

    it("shows the correct unread count", () => {
      const items = [
        makeItem({ id: "u1", readAt: null }),
        makeItem({ id: "u2", readAt: null }),
        makeItem({ id: "r1", readAt: Date.now() }),
      ];
      renderBody(items);
      expect(screen.getByText(/2 unread/)).toBeTruthy();
    });

    it("shows empty state when items array is empty", () => {
      renderBody([]);
      expect(screen.getByText(/you're all caught up/i)).toBeTruthy();
    });

    it("renders with mobile heading style without crashing", () => {
      renderBody([], { mobile: true });
      expect(screen.getByText("Notifications")).toBeTruthy();
    });
  });

  describe("mark all read button", () => {
    it("is disabled when no unread items exist", () => {
      const items = [makeItem({ id: "r", readAt: Date.now() })];
      renderBody(items);
      const btn = screen.getByRole("button", { name: /mark all read/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);
    });

    it("is enabled when unread items exist", () => {
      const items = [makeItem({ id: "u", readAt: null })];
      renderBody(items);
      const btn = screen.getByRole("button", { name: /mark all read/i }) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });

    it("calls onMarkAllRead when clicked", async () => {
      const onMarkAllRead = vi.fn();
      const user = userEvent.setup();
      renderBody([makeItem({ id: "u", readAt: null })], { onMarkAllRead });
      await user.click(screen.getByRole("button", { name: /mark all read/i }));
      expect(onMarkAllRead).toHaveBeenCalledOnce();
    });
  });

  describe("dismiss", () => {
    it("calls onDismiss with the item id when dismiss button clicked", async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      renderBody([makeItem({ id: "xyz" })], { onDismiss });
      await user.click(screen.getByRole("button", { name: /dismiss notification/i }));
      expect(onDismiss).toHaveBeenCalledWith("xyz");
    });

    it("calls onDismiss for the correct item when multiple items present", async () => {
      const onDismiss = vi.fn();
      const user = userEvent.setup();
      const items = [makeItem({ id: "first" }), makeItem({ id: "second" })];
      renderBody(items, { onDismiss });
      const dismissButtons = screen.getAllByRole("button", { name: /dismiss notification/i });
      await user.click(dismissButtons[1]);
      expect(onDismiss).toHaveBeenCalledWith("second");
    });
  });

  describe("mark read on hover", () => {
    it("calls onMarkRead with item id when hovering over an unread item", () => {
      const onMarkRead = vi.fn();
      renderBody([makeItem({ id: "u", readAt: null })], { onMarkRead });
      fireEvent.mouseEnter(screen.getByRole("listitem"));
      expect(onMarkRead).toHaveBeenCalledWith("u");
    });

    it("does not call onMarkRead when hovering over a read item", () => {
      const onMarkRead = vi.fn();
      renderBody([makeItem({ id: "r", readAt: Date.now() })], { onMarkRead });
      fireEvent.mouseEnter(screen.getByRole("listitem"));
      expect(onMarkRead).not.toHaveBeenCalled();
    });
  });

  describe("unread-only toggle", () => {
    it("filters to unread items only when toggled on", async () => {
      const user = userEvent.setup();
      const items = [
        makeItem({ id: "u", title: "Unread item", readAt: null }),
        makeItem({ id: "r", title: "Read item", readAt: Date.now() }),
      ];
      renderBody(items);
      await user.click(screen.getByRole("button", { name: /unread/i }));
      expect(screen.getByText("Unread item")).toBeTruthy();
      expect(screen.queryByText("Read item")).toBeNull();
    });

    it("restores all items when toggled back off", async () => {
      const user = userEvent.setup();
      const items = [
        makeItem({ id: "u", title: "Unread item", readAt: null }),
        makeItem({ id: "r", title: "Read item", readAt: Date.now() }),
      ];
      renderBody(items);
      const toggle = screen.getByRole("button", { name: /unread/i });
      await user.click(toggle);
      await user.click(toggle);
      expect(screen.getByText("Unread item")).toBeTruthy();
      expect(screen.getByText("Read item")).toBeTruthy();
    });

    it("shows empty state when toggled on but all items are read", async () => {
      const user = userEvent.setup();
      const items = [makeItem({ id: "r", title: "Read item", readAt: Date.now() })];
      renderBody(items);
      await user.click(screen.getByRole("button", { name: /unread/i }));
      expect(screen.getByText(/you're all caught up/i)).toBeTruthy();
    });
  });

  describe("category filter", () => {
    it("shows only items matching the selected category", async () => {
      const user = userEvent.setup();
      const items = [
        makeItem({ id: "m", title: "Media item", category: "media" }),
        makeItem({ id: "s", title: "Sync item", category: "sync" }),
      ];
      renderBody(items);
      await user.click(screen.getByRole("radio", { name: /^media/i }));
      expect(screen.getByText("Media item")).toBeTruthy();
      expect(screen.queryByText("Sync item")).toBeNull();
    });

    it("restores all items when the All chip is selected", async () => {
      const user = userEvent.setup();
      const items = [
        makeItem({ id: "m", title: "Media item", category: "media" }),
        makeItem({ id: "s", title: "Sync item", category: "sync" }),
      ];
      renderBody(items);
      await user.click(screen.getByRole("radio", { name: /^media/i }));
      await user.click(screen.getByRole("radio", { name: /^all/i }));
      expect(screen.getByText("Media item")).toBeTruthy();
      expect(screen.getByText("Sync item")).toBeTruthy();
    });

    it("shows empty state with filter label when no items match the category", async () => {
      const user = userEvent.setup();
      const items = [makeItem({ id: "m", category: "media" })];
      renderBody(items);
      await user.click(screen.getByRole("radio", { name: /^sync/i }));
      expect(screen.getByText(/no sync notifications/i)).toBeTruthy();
    });

    it("updates the unread count to reflect only the filtered category", async () => {
      const user = userEvent.setup();
      const items = [
        makeItem({ id: "mu", category: "media", readAt: null }),
        makeItem({ id: "su", category: "sync", readAt: null }),
        makeItem({ id: "sr", category: "sync", readAt: Date.now() }),
      ];
      renderBody(items);
      expect(screen.getByText(/2 unread/)).toBeTruthy();
    });
  });

  describe("combined category and unread filter", () => {
    it("applies both filters simultaneously", async () => {
      const user = userEvent.setup();
      const items = [
        makeItem({ id: "mu", title: "Media unread", category: "media", readAt: null }),
        makeItem({ id: "mr", title: "Media read", category: "media", readAt: Date.now() }),
        makeItem({ id: "su", title: "Sync unread", category: "sync", readAt: null }),
      ];
      renderBody(items);
      await user.click(screen.getByRole("radio", { name: /^media/i }));
      await user.click(screen.getByRole("button", { name: /unread/i }));
      expect(screen.getByText("Media unread")).toBeTruthy();
      expect(screen.queryByText("Media read")).toBeNull();
      expect(screen.queryByText("Sync unread")).toBeNull();
    });

    it("shows empty state when combined filter yields no results", async () => {
      const user = userEvent.setup();
      const items = [makeItem({ id: "mr", category: "media", readAt: Date.now() })];
      renderBody(items);
      await user.click(screen.getByRole("radio", { name: /^media/i }));
      await user.click(screen.getByRole("button", { name: /unread/i }));
      expect(screen.getByText(/no media notifications/i)).toBeTruthy();
    });
  });
});
