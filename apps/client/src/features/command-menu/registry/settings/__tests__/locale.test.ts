import { describe, expect, it } from "vite-plus/test";

import { locales } from "@/paraglide/runtime";

import { LOCALE_SETTING } from "../locale";

describe("LOCALE_SETTING", () => {
  it("offers one option per supported locale", () => {
    const ids = LOCALE_SETTING.options.map((o) => o.id).sort();
    expect(ids).toEqual([...locales].sort());
  });

  it("declares a label key per option", () => {
    for (const opt of LOCALE_SETTING.options) {
      expect(opt.labelKey).toMatch(/^locale_[a-z]+_label$/);
    }
  });
});
