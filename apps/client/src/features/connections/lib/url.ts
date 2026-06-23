// Security guard: rejects javascript:/http/relative URLs before navigation, protecting against buggy/compromised plugin responses.
export function isSafeAuthUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
