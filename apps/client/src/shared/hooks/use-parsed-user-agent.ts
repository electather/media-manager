import { useEffect, useState } from "react";

import { parseUserAgent, UNKNOWN_USER_AGENT, type ParsedUserAgent } from "@/shared/lib/user-agent";

// Shown while the parser chunk loads. `unknown: true` suppresses IP while
// parsing — UAs that resolve to unknown would otherwise flash the IP on
// every render (#962). The ~100ms hide for parseable UAs on first load is
// the lesser tradeoff.
const PENDING: ParsedUserAgent = { label: "…", browser: null, os: null, unknown: true };

/**
 * Parses a user-agent string, loading ua-parser-js on demand (see
 * {@link parseUserAgent}). Falsy input resolves synchronously to
 * {@link UNKNOWN_USER_AGENT} without loading the parser.
 */
export function useParsedUserAgent(ua: string | null | undefined): ParsedUserAgent {
  const [parsed, setParsed] = useState<ParsedUserAgent>(() => (ua ? PENDING : UNKNOWN_USER_AGENT));

  useEffect(() => {
    if (!ua) {
      setParsed(UNKNOWN_USER_AGENT);
      return;
    }
    let active = true;
    setParsed(PENDING);
    void parseUserAgent(ua).then((result) => {
      if (active) setParsed(result);
    });
    return () => {
      active = false;
    };
  }, [ua]);

  return parsed;
}
