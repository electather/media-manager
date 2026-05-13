/** Maps a range key to the window expected by the diagnostics API. */
export function rangeToWindow(range: "24h" | "7d" | "30d"): { since: number } {
  const now = Date.now();
  switch (range) {
    case "7d":
      return { since: now - 7 * 24 * 60 * 60_000 };
    case "30d":
      return { since: now - 30 * 24 * 60 * 60_000 };
    case "24h":
      return { since: now - 24 * 60 * 60_000 };
  }
}
