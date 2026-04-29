import { UAParser } from "ua-parser-js";

export interface ParsedUserAgent {
  /** Display string such as "Chrome 120 on macOS" or "Unknown device". */
  label: string;
  browser: string | null;
  os: string | null;
  /** True when neither browser nor OS were parsed; callers can use this to
   *  suppress adjacent metadata such as IP address. */
  unknown: boolean;
}

const UNKNOWN_LABEL = "Unknown device";

// fallow-ignore-next-line complexity
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua) {
    return { label: UNKNOWN_LABEL, browser: null, os: null, unknown: true };
  }

  const { browser, os } = UAParser(ua);
  const browserName = browser?.name?.trim() || null;
  const browserMajor = browser?.major?.trim() || null;
  const osName = os?.name?.trim() || null;

  if (!browserName && !osName) {
    return { label: UNKNOWN_LABEL, browser: null, os: null, unknown: true };
  }

  const browserLabel = browserName
    ? browserMajor
      ? `${browserName} ${browserMajor}`
      : browserName
    : null;

  let label: string;
  if (browserLabel && osName) {
    label = `${browserLabel} on ${osName}`;
  } else if (browserLabel) {
    label = browserLabel;
  } else {
    label = osName!;
  }

  return { label, browser: browserName, os: osName, unknown: false };
}
