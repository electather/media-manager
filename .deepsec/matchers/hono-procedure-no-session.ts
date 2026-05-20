import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

/**
 * Every Hono sub-app under `apps/server/src/api/procedures/` must apply
 * `requireSession` before handler chains. The convention is `new Hono()
 * .use("*", requireSession).get(...)` (and the admin variants add
 * `.use("*", requirePermission(PERMISSIONS.X))`).
 *
 * Flags procedure files that wire handlers (`.get`/`.post`/`.put`/`.delete`/
 * `.patch`) without a `requireSession` somewhere in the same file. The
 * public OAuth discovery routes and `config/public` are intentionally
 * unauthenticated, so we exclude them by filename — the AI confirms whether
 * unguarded handlers are genuinely public.
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
