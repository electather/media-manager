import { useEffect } from "react";
import { applyLocaleStyling } from "@/shared/lib/i18n/apply";

// Single root hook owning locale-driven DOM (V64). Sets <html dir>, <html
// lang>, and triggers per-locale Google Fonts injection. No component-local
// dir/lang attrs.
export function useHtmlDir(): void {
  useEffect(() => {
    applyLocaleStyling();
  }, []);
}
