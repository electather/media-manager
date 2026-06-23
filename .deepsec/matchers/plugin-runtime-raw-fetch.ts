import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

/** Any bare `fetch()` inside `plugin-runtime/` bypasses security controls (allowlist, headers, rate-limit, redirect-mode). Critical SSRF/redirect-bypass candidate. */
export const pluginRuntimeRawFetch: MatcherPlugin = {
  slug: "plugin-runtime-raw-fetch",
  description: "Direct global fetch() inside plugin-runtime bypassing buildFetch",
  noiseTier: "precise",
  filePatterns: ["apps/server/src/plugin-runtime/**/*.ts"],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];
    if (/internal\/fetch-policy\.ts$/.test(filePath)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    // Match bare `fetch(` calls but skip `ctx.fetch(`, `await ctx.fetch(`,
    // `module.fetch(`, `buildFetch(`, `fetchNoRedirect(`, etc.
    const BARE_FETCH = /(?<![.\w])fetch\s*\(/;
    const ALLOWED = /\b(buildFetch|fetchNoRedirect|ctx\.fetch|\.fetch)\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!BARE_FETCH.test(line)) continue;
      if (ALLOWED.test(line)) continue;
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 4);
      matches.push({
        vulnSlug: "plugin-runtime-raw-fetch",
        lineNumbers: [i + 1],
        snippet: lines.slice(start, end).join("\n"),
        matchedPattern: "bare fetch() inside plugin-runtime",
      });
    }
    return matches;
  },
  examples: [
    `const resp = await fetch("https://" + userHost + "/api");`,
  ],
};
