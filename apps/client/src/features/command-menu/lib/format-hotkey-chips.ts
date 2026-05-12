import { formatForDisplay } from "@tanstack/react-hotkeys";
import { compact } from "es-toolkit/array";
import { trim } from "es-toolkit/string";

type HotkeyPlatform = "mac" | "windows";

function hotkeyPlatform(): HotkeyPlatform {
  if (typeof navigator === "undefined") return "windows";
  return /mac|iphone|ipad|ipod/i.test(navigator.userAgent) ? "mac" : "windows";
}

export function formatHotkeyChips(hotkey: string): string[] {
  const display = formatForDisplay(hotkey, { platform: hotkeyPlatform() });
  return compact(display.split("+").map((part) => trim(part)));
}
