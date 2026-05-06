import { useCallback, useEffect, useRef, useState } from "react";

interface UseCopyFeedbackOptions {
  /**
   * Milliseconds to keep `copied` true before resetting. Defaults to 1500.
   */
  resetMs?: number;
}

interface UseCopyFeedbackResult {
  copied: boolean;
  copy: (value: string) => Promise<void>;
}

/**
 * Wraps `navigator.clipboard.writeText` with a transient `copied` flag that
 * auto-resets after `resetMs`. Rapid invocations debounce the reset so the
 * indicator stays visible for the full window after the latest copy. Clipboard
 * failures are swallowed — secure-context-only APIs throw on http/iframes.
 */
export function useCopyFeedback({
  resetMs = 1500,
}: UseCopyFeedbackOptions = {}): UseCopyFeedbackResult {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copy = useCallback(
    async (value: string) => {
      try {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerRef.current = window.setTimeout(() => {
          setCopied(false);
          timerRef.current = null;
        }, resetMs);
      } catch {
        // Clipboard API unavailable (insecure context or denied); ignore.
      }
    },
    [resetMs],
  );

  return { copied, copy };
}
