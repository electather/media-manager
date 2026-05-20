import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

/**
 * Anything wired under the `/mcp` route or that returns a `Response` for
 * MCP traffic MUST flow through `withOAuthAuth(req, handler)` — the entry
 * point that verifies the Bearer JWT (audience, issuer, JWKS) and resolves
 * `userId` + `scopes`. A handler that produces an MCP `Response` without
 * that wrapper is reachable unauthenticated.
 *
 * Flags MCP server files that export an `app.all("/mcp"`, `createMcpHandler`
 * or `mcpFetch`-shaped function without referencing `withOAuthAuth` in the
 * same file.
 */
export const mcpHandlerNoOAuth: MatcherPlugin = {
  slug: "mcp-handler-no-oauth",
  description: "MCP handler/route without withOAuthAuth wrapper",
  noiseTier: "precise",
  filePatterns: [
    "apps/server/src/mcp/**/*.ts",
    "apps/server/src/**/*mcp*.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];
    // The `auth.ts` file itself defines `withOAuthAuth`.
    if (/mcp\/auth\.ts$/.test(filePath)) return [];

    const REFERENCES_MCP_HANDLER =
      /\/mcp['"]|createMcpHandler\s*\(|MCPHandler|StreamableHTTP/;
    if (!REFERENCES_MCP_HANDLER.test(content)) return [];

    if (/\bwithOAuthAuth\s*\(/.test(content)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (!/\/mcp['"]|createMcpHandler|StreamableHTTP/.test(lines[i])) continue;
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length, i + 5);
      matches.push({
        vulnSlug: "mcp-handler-no-oauth",
        lineNumbers: [i + 1],
        snippet: lines.slice(start, end).join("\n"),
        matchedPattern: "MCP handler/route without withOAuthAuth in file",
      });
      break;
    }
    return matches;
  },
  examples: [
    `app.all("/mcp", async (c) => c.json({ ok: true }));`,
  ],
};
