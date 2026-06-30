export interface ParsedUserAgent {
  /** Display string such as "Chrome 120 on macOS" or "Unknown device". */
  label: string;
  browser: string | null;
  os: string | null;
  /** True when neither browser nor OS were parsed; callers can use this to
   *  suppress adjacent metadata such as IP address. */
  unknown: boolean;
}

export const UNKNOWN_USER_AGENT: ParsedUserAgent = {
  label: "Unknown device",
  browser: null,
  os: null,
  unknown: true,
};

// ua-parser-js (~74 kB) is only needed once there's a real UA string to parse.
// Load it on demand and cache the module promise so it stays out of the entry
// chunk and repeat parses don't re-import.
let parserPromise: Promise<typeof import("ua-parser-js").UAParser> | null = null;

function loadParser() {
  parserPromise ??= import("ua-parser-js").then((m) => m.UAParser);
  return parserPromise;
}

function buildLabel(UAParser: typeof import("ua-parser-js").UAParser, ua: string): ParsedUserAgent {
  const { browser, os } = UAParser(ua);
  const browserName = browser?.name?.trim() || null;
  const browserMajor = browser?.major?.trim() || null;
  const osName = os?.name?.trim() || null;

  if (!browserName && !osName) return UNKNOWN_USER_AGENT;

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

// fallow-ignore-next-line complexity
export async function parseUserAgent(ua: string | null | undefined): Promise<ParsedUserAgent> {
  if (!ua) return UNKNOWN_USER_AGENT;
  const UAParser = await loadParser();
  return buildLabel(UAParser, ua);
}
