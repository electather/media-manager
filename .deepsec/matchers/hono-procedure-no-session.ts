import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

/**
 * Flags Hono procedure files that wire handlers without `requireSession`.
 * Required shape: `new Hono().use("*", requireSession).get(...)`;
 * admin variants also add `.use("*", requirePermission(PERMISSIONS.X))`.
 * `config/public` and OAuth discovery paths are intentionally excluded by filename
 * and confirmed by AI review (deliberately unauthenticated, not accidental).
 */
export const honoProcedureNoSession: MatcherPlugin = {
  slug: "hono-procedure-no-session",
  description: "Hono procedure file wires handlers without requireSession",
  noiseTier: "normal",
  filePatterns: ["apps/server/src/api/procedures/**/*.ts"],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];
    // Public endpoints by design.
    if (/\/config\.ts$/.test(filePath)) return [];

    if (/\brequireSession\b/.test(content)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    const HANDLER = /\.(get|post|put|delete|patch)\s*\(/;
    const HONO_NEW = /\bnew\s+Hono\s*\(/;

    let hasHonoNew = false;
    for (const line of lines) {
      if (HONO_NEW.test(line)) {
        hasHonoNew = true;
        break;
      }
    }
    if (!hasHonoNew) return [];

    for (let i = 0; i < lines.length; i++) {
      if (!HANDLER.test(lines[i])) continue;
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length, i + 4);
      matches.push({
        vulnSlug: "hono-procedure-no-session",
        lineNumbers: [i + 1],
        snippet: lines.slice(start, end).join("\n"),
        matchedPattern: "Hono handler defined without requireSession in file",
      });
      break; // one candidate per file is enough; AI reads the whole file
    }
    return matches;
  },
  examples: [
    `export const fooApp = new Hono().get("/", async (c) => c.json({ ok: true }));`,
  ],
};
