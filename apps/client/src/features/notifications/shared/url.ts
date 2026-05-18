/**
 * Returns true only for http: and https: URLs. Relative URLs are resolved
 * against window.location.origin so they inherit the page scheme. Any other
 * scheme — javascript:, data:, vbscript:, etc. — is rejected.
 */
export function isSafeActionUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
