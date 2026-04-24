import { UAParser } from "ua-parser-js";

/**
 * Parsed user-agent broken down into the fields the Security tab cares about.
 */
export interface ParsedUserAgent {
  /** Display string such as "Chrome on macOS" or "Unknown device". */
  label: string;
  browser: string | null;
  os: string | null;
  /** True when both browser and OS were missing from the UA — caller can use
   *  this as a hint to hide adjacent metadata such as IP address. */
  unknown: boolean;
}

const UNKNOWN_LABEL = "Unknown device";

/**
 * Parse a Better Auth session's `userAgent` string into a humanised label plus
 * the underlying browser/os components. Falls back to "Unknown device" when
 * the input is missing, empty, or unrecognised.
 */
export function parseUserAgent(ua: string | null | undefined): ParsedUserAgent {
  if (!ua) {
    return { label: UNKNOWN_LABEL, browser: null, os: null, unknown: true };
  }

  const { browser, os } = UAParser(ua);
  const browserName = browser?.name?.trim() || null;
  const osName = os?.name?.trim() || null;

  if (!browserName && !osName) {
    return { label: UNKNOWN_LABEL, browser: null, os: null, unknown: true };
  }

  let label: string;
  if (browserName && osName) {
    label = `${browserName} on ${osName}`;
  } else if (browserName) {
    label = browserName;
  } else {
    label = osName!;
  }

  return { label, browser: browserName, os: osName, unknown: false };
}
