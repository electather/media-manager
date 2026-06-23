import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

// Admin sub-apps must call requirePermission after requireSession — missing it allows any authenticated user. Flags admin-named apps without requirePermission.
export const honoAdminNoPermission: MatcherPlugin = {
  slug: "hono-admin-no-permission",
  description: "Admin Hono app without requirePermission middleware",
  noiseTier: "precise",
  filePatterns: ["apps/server/src/api/procedures/**/*.ts"],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];
    // router.ts / register-routes.ts merely mount admin sub-apps; the actual
    // requirePermission middleware lives inside the sub-app files themselves.
    if (/\/api\/(router|register-routes)\.ts$/.test(filePath)) return [];

    const isAdminFile =
      /export\s+const\s+\w*[Aa]dmin\w*App\b/.test(content) ||
      /admin/i.test(filePath);
    if (!isAdminFile) return [];
    // Require the file to actually declare a Hono sub-app — pure mount files
    // wouldn't.
    if (!/\bnew\s+Hono\s*\(/.test(content)) return [];

    if (/\brequirePermission\s*\(/.test(content)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    const HANDLER = /\.(get|post|put|delete|patch)\s*\(/;
    const ADMIN_EXPORT =
      /export\s+const\s+\w*[Aa]dmin\w*App\b|\.route\(\s*['"]\/admin\//;

    for (let i = 0; i < lines.length; i++) {
      if (!HANDLER.test(lines[i]) && !ADMIN_EXPORT.test(lines[i])) continue;
      const start = Math.max(0, i - 2);
      const end = Math.min(lines.length, i + 4);
      matches.push({
        vulnSlug: "hono-admin-no-permission",
        lineNumbers: [i + 1],
        snippet: lines.slice(start, end).join("\n"),
        matchedPattern: "admin-named app without requirePermission in file",
      });
      break;
    }
    return matches;
  },
  examples: [
    `export const adminUsersApp = new Hono().use("*", requireSession).get("/", listUsers);`,
  ],
};
