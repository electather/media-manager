/**
 * Returns true only for an absolute https URL. The OAuth redirect and
 * device-code verification URLs are server-controlled today, but the client
 * navigates to / renders them unconditionally, so a buggy or compromised
 * plugin response (e.g. `javascript:` or an http downgrade) would otherwise
 * become an unguarded navigation. Requiring https rejects those schemes
 * before the value reaches `window.location.assign` or an anchor `href`.
 */
export function isSafeAuthUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
