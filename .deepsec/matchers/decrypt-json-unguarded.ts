import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

/** Flags unguarded access to `decryptJson` result (returns null for empty/partial rows, risking undefined credentials flowing to plugin calls). */
export const decryptJsonUnguarded: MatcherPlugin = {
  slug: "decrypt-json-unguarded",
  description: "decryptJson result accessed without null guard",
  noiseTier: "normal",
  filePatterns: [
    "apps/server/src/**/*.ts",
    "packages/**/*.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];
    if (!/\bdecryptJson\s*\(/.test(content)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];

    const CALL = /\bdecryptJson\s*\(/;
    const GUARD = /\b(isNil|isNull|=== null|!== null|== null|!= null|\?\?|\?\.)/;

    for (let i = 0; i < lines.length; i++) {
      if (!CALL.test(lines[i])) continue;
      // Look ahead up to 5 lines for a null guard on the result.
      const window = lines.slice(i, Math.min(lines.length, i + 6)).join("\n");
      if (GUARD.test(window)) continue;
      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 5);
      matches.push({
        vulnSlug: "decrypt-json-unguarded",
        lineNumbers: [i + 1],
        snippet: lines.slice(start, end).join("\n"),
        matchedPattern: "decryptJson result without null guard within 5 lines",
      });
    }
    return matches;
  },
  examples: [
    `const creds = await decryptJson(row.credIv, row.credData); return creds.token;`,
  ],
};
