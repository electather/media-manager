import { describe, expect, it } from "vite-plus/test";
import { classifyPluginPurpose, isNotificationOnlyPlugin } from "../purpose";

describe("classifyPluginPurpose", () => {
  it("returns `none` for a pure-global plugin with no user-scoped capabilities", () => {
    expect(classifyPluginPurpose([])).toBe("none");
  });

  it("returns `notification` when the only user-scoped capability is notificationDelivery", () => {
    expect(classifyPluginPurpose(["notificationDelivery"])).toBe("notification");
  });

  it("returns `connection` for media/library plugins that do not deliver notifications", () => {
    expect(classifyPluginPurpose(["mediaLibrary", "userIdentity"])).toBe("connection");
  });

  it("returns `both` when a plugin mixes notificationDelivery with another user-scoped capability", () => {
    expect(classifyPluginPurpose(["notificationDelivery", "mediaLibrary"])).toBe("both");
  });
});

describe("isNotificationOnlyPlugin", () => {
  it("is true only for plugins whose only user-scoped capability is notificationDelivery", () => {
    expect(isNotificationOnlyPlugin(["notificationDelivery"])).toBe(true);
    expect(isNotificationOnlyPlugin([])).toBe(false);
    expect(isNotificationOnlyPlugin(["mediaLibrary"])).toBe(false);
    expect(isNotificationOnlyPlugin(["notificationDelivery", "mediaLibrary"])).toBe(false);
  });
});
