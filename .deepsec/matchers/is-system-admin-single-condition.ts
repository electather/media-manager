import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

/**
 * The `isSystemAdmin` flag — which short-circuits every permission check in
 * `AuthService.roleHasPermission` — must only be set when BOTH `isSystem === 1`
 * AND `name === "Admin"`. Flagging the flag from only one of those two
 * conditions is immediate privilege escalation.
 *
 * Catches:
 *   - `isSystemAdmin: row.isSystem === 1` (missing name check)
 *   - `isSystemAdmin: row.name === "Admin"` (missing isSystem check)
 *   - `isSystemAdmin: true` not gated by an isSystem/name compound check
 *
 * The canonical correct shape is
 *   `row.isSystem === 1 && row.name === SYSTEM_ADMIN_ROLE_NAME`
 * — anything narrower must be revalidated.
 */
export const isSystemAdminSingleCondition: MatcherPlugin = {
  slug: "is-system-admin-single-condition",
  description: "isSystemAdmin set from only isSystem OR only name, not both",
  noiseTier: "precise",
  filePatterns: [
    "apps/server/src/auth/**/*.ts",
    "apps/server/src/**/*role*.ts",
    "apps/server/src/**/*permission*.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];

    const COMPOUND = /isSystem\s*===\s*1\s*&&\s*[a-zA-Z_$][\w$]*\.?name\s*===/;
    const ASSIGN = /isSystemAdmin\s*[:=]/;
    const SINGLE_ISSYSTEM = /isSystemAdmin\s*[:=]\s*[^,;\n]*isSystem\s*===\s*1\s*[,;}\n]/;
    const SINGLE_NAME =
      /isSystemAdmin\s*[:=]\s*[^,;\n]*\.name\s*===\s*['"](?:Admin|System)['"]\s*[,;}\n]/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!ASSIGN.test(line)) continue;
      if (COMPOUND.test(line)) continue;
      if (!SINGLE_ISSYSTEM.test(line) && !SINGLE_NAME.test(line)) continue;

      const start = Math.max(0, i - 1);
      const end = Math.min(lines.length, i + 4);
      matches.push({
        vulnSlug: "is-system-admin-single-condition",
        lineNumbers: [i + 1],
        snippet: lines.slice(start, end).join("\n"),
        matchedPattern: "isSystemAdmin set from a single condition",
      });
    }
    return matches;
  },
  examples: [
    `return { isSystemAdmin: row.isSystem === 1 };`,
    `info.isSystemAdmin = role.name === "Admin";`,
  ],
};
