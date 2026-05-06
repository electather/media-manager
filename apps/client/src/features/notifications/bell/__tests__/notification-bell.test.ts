import { describe, expect, it } from "vite-plus/test";

import { bellAriaLabel } from "../notification-bell";

describe("bellAriaLabel", () => {
  it("returns the plain title when there are no unread notifications", () => {
    expect(bellAriaLabel(0)).toBe("Notifications");
  });

  it("includes the unread count for one unread notification", () => {
    expect(bellAriaLabel(1)).toBe("Notifications, 1 unread");
  });

  it("includes the unread count for many unread notifications", () => {
    expect(bellAriaLabel(7)).toBe("Notifications, 7 unread");
  });
});
