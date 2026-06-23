import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

// Client payloads MUST be stripped via stripRequestFields before runAuth("startAuth") or writeConnection
// — missing this allows spoofing plugin-owned userConfig fields (e.g., userId). The AI verifies call path feeds unsanitized input.
export const connectionStartAuthNoStrip: MatcherPlugin = {
  slug: "connection-start-auth-no-strip",
  description: "startAuth/writeConnection callsite without stripRequestFields",
  noiseTier: "normal",
  filePatterns: [
    "apps/server/src/connections/**/*.ts",
    "apps/server/src/plugin-runtime/**/*.ts",
    "apps/server/src/api/procedures/connections.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];

    if (/\bstripRequestFields\s*\(/.test(content)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    const RISKY =
      /\brunAuth\s*\([^)]*['"]startAuth['"]|\bwriteConnection\s*\(|\.startAuth\s*\(/;

    for (let i = 0; i < lines.length; i++) {
      if (!RISKY.test(lines[i])) continue;
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length, i + 5);
      matches.push({
        vulnSlug: "connection-start-auth-no-strip",
        lineNumbers: [i + 1],
        snippet: lines.slice(start, end).join("\n"),
        matchedPattern: "startAuth/writeConnection without stripRequestFields in file",
      });
    }
    return matches;
  },
  examples: [
    `const result = await pluginRuntime.runAuth(args.pluginId, "startAuth", args.userId, args.userConfig);`,
    `await writeConnection({ userId, pluginId, credentials, userConfig, displayName });`,
  ],
};
