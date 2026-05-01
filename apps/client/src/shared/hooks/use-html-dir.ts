import { useEffect } from "react";
import { applyHtmlDir } from "@/shared/lib/i18n/rtl";

// Single root hook owning <html dir>; per V64, no component-local dir attrs.
export function useHtmlDir(): void {
  useEffect(() => {
    applyHtmlDir();
  }, []);
}
