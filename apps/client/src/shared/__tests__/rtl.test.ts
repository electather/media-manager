import { describe, expect, it } from "vite-plus/test";

import { RTL_LOCALES, htmlDirFor, isRtlLocale } from "../lib/i18n/rtl";

describe("RTL_LOCALES", () => {
  it("contains fa as the v1 RTL validation locale", () => {
    expect(RTL_LOCALES).toEqual(["fa"]);
  });

  it("isRtlLocale returns true for fa, false for en", () => {
    expect(isRtlLocale("fa")).toBe(true);
    expect(isRtlLocale("en")).toBe(false);
  });

  it("htmlDirFor maps RTL locales to rtl, others to ltr", () => {
    expect(htmlDirFor("fa")).toBe("rtl");
    expect(htmlDirFor("en")).toBe("ltr");
    expect(htmlDirFor("de")).toBe("ltr");
  });
});
