import { formatForDisplay } from "@tanstack/react-hotkeys";
import { compact } from "es-toolkit/array";
import { trim } from "es-toolkit/string";

type HotkeyPlatform = "mac" | "windows";

// `navigator.userAgentData.platform` is the modern source of truth (Chromium).
// Safari/Firefox still need the userAgent regex; iPadOS reports "MacIntel" in
// desktop mode, so a touch-capable Mac is treated as iPad-class.
type NavigatorWithUAData = Navigator & {
  userAgentData?: { platform?: string };
};

// fallow-ignore-next-line complexity
function hotkeyPlatform(): HotkeyPlatform {
  if (typeof navigator === "undefined") return "windows";
  const probe = (navigator as NavigatorWithUAData).userAgentData?.platform ?? navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(probe) ? "mac" : "windows";
}

export function formatHotkeyChips(hotkey: string): string[] {
  const display = formatForDisplay(hotkey, { platform: hotkeyPlatform() });
  return compact(display.split("+").map((part) => trim(part)));
}
