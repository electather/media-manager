import { describe, expect, it } from "vite-plus/test";
import { isToastable } from "../is-toastable";
import type { NotificationItemDto } from "../../shared/types";

function makeItem(severity: NotificationItemDto["severity"]): NotificationItemDto {
  return {
    id: "x",
    title: "t",
    body: "b",
    severity,
    category: "media",
    createdAt: 1,
    readAt: null,
    actionUrl: null,
    image: null,
  };
}

describe("isToastable", () => {
  it("returns true for warn severity", () => {
    expect(isToastable(makeItem("warn"))).toBe(true);
  });

  it("returns true for error severity", () => {
    expect(isToastable(makeItem("error"))).toBe(true);
  });

  it("returns false for info severity", () => {
    expect(isToastable(makeItem("info"))).toBe(false);
  });
});
