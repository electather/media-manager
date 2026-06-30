import { useEffect, useState } from "react";

import { parseUserAgent, UNKNOWN_USER_AGENT, type ParsedUserAgent } from "@/shared/lib/user-agent";

// Shown while the parser chunk loads. Keeps `unknown: false` so adjacent
// metadata (e.g. IP address) isn't briefly hidden for a UA that will resolve
// fine, and the ellipsis reads as "loading" rather than "Unknown device".
const PENDING: ParsedUserAgent = { label: "…", browser: null, os: null, unknown: false };

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
