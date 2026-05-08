import { describe, expect, it } from "vite-plus/test";

import { THEMES, THEME_SETTING } from "../theme";

describe("THEME_SETTING", () => {
  it("exposes the canonical theme cycle as options", () => {
    expect(THEME_SETTING.options.map((o) => o.id)).toEqual([...THEMES]);
  });

  it("declares a hotkey + toast key", () => {
    expect(THEME_SETTING.hotkey).toBe("Mod+Shift+T");
    expect(THEME_SETTING.toastKey).toBe("command_menu_setting_theme_toast");
  });

  it("uses unique option ids", () => {
    const ids = THEME_SETTING.options.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
