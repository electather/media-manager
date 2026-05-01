import { describe, expect, it } from "vite-plus/test";

import { CATEGORY_META, categoryLabel } from "../notification-panel-types";

describe("categoryLabel", () => {
  it("returns the translated label for every notification category", () => {
    expect(categoryLabel("media")).toBe("Media");
    expect(categoryLabel("sync")).toBe("Sync");
    expect(categoryLabel("auth")).toBe("Auth");
    expect(categoryLabel("system")).toBe("System");
  });

  it("covers every key in CATEGORY_META", () => {
    for (const key of Object.keys(CATEGORY_META) as Array<keyof typeof CATEGORY_META>) {
      expect(typeof categoryLabel(key)).toBe("string");
      expect(categoryLabel(key).length).toBeGreaterThan(0);
    }
  });
});
