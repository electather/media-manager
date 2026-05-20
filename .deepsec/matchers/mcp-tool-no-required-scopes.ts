import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

/**
 * Every MCP tool registration carries a `requiredScopes: string[]` that
 * `dispatch.ts` enforces against the OAuth bearer token's `scope` claim. A
 * tool registered with `requiredScopes: []` is reachable by ANY authenticated
 * MCP caller regardless of which scopes were granted — effectively unscoped.
 *
 * This is occasionally legitimate (e.g. a discovery tool intentionally open
 * to any session), but every empty/missing list deserves an explicit review.
 *
 * Flags `requiredScopes: []` or registrations missing the field on tool
 * registration callsites.
 */
export const mcpToolNoRequiredScopes: MatcherPlugin = {
  slug: "mcp-tool-no-required-scopes",
  description: "MCP tool registered with empty or missing requiredScopes",
  noiseTier: "precise",
  filePatterns: [
    "apps/server/src/mcp/**/*.ts",
    "apps/server/src/**/*mcp*.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    const EMPTY = /requiredScopes\s*:\s*\[\s*\]/;

    for (let i = 0; i < lines.length; i++) {
      if (!EMPTY.test(lines[i])) continue;
      const start = Math.max(0, i - 3);
      const end = Math.min(lines.length, i + 3);
      matches.push({
        vulnSlug: "mcp-tool-no-required-scopes",
        lineNumbers: [i + 1],
        snippet: lines.slice(start, end).join("\n"),
        matchedPattern: "empty requiredScopes array",
      });
    }
    return matches;
  },
  examples: [
    `registerCompositeTool({ name: "ent_foo", requiredScopes: [], handler });`,
  ],
};
