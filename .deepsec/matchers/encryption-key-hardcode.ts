import type { CandidateMatch, MatcherPlugin } from "deepsec/config";
import { regexMatcher } from "deepsec/config";

/**
 * `ENCRYPTION_KEY` is the AES-256-GCM master key for every plugin credential
 * in the system. Hardcoding a default, fallback, or literal value (anywhere
 * other than `.env.example` or test fixtures) means every deploy that forgets
 * to set the env shares the same key — a one-line credential leak.
 *
 * Flags any assignment of a string literal to a name containing
 * `ENCRYPTION_KEY`, plus `??` / `||` fallbacks that supply a literal.
 */
export const encryptionKeyHardcode: MatcherPlugin = {
  slug: "encryption-key-hardcode",
  description: "Hardcoded literal or fallback for ENCRYPTION_KEY",
  noiseTier: "precise",
  filePatterns: [
    "apps/**/*.ts",
    "packages/**/*.ts",
    "tools/**/*.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];
    if (/\.env\.example$|\.env$/.test(filePath)) return [];
    return regexMatcher(
      "encryption-key-hardcode",
      [
        {
          regex: /ENCRYPTION_KEY\s*[:=]\s*['"`][0-9a-fA-F]{16,}['"`]/,
          label: "literal hex assignment to ENCRYPTION_KEY",
        },
        {
          regex: /env\.ENCRYPTION_KEY\s*(?:\?\?|\|\|)\s*['"`][^'"`\n]+['"`]/,
          label: "fallback literal for env.ENCRYPTION_KEY",
        },
        {
          regex: /process\.env\.ENCRYPTION_KEY\s*(?:\?\?|\|\|)\s*['"`][^'"`\n]+['"`]/,
          label: "fallback literal for process.env.ENCRYPTION_KEY",
        },
      ],
      content,
    );
  },
  examples: [
    `const ENCRYPTION_KEY = "deadbeefdeadbeefdeadbeefdeadbeef";`,
    `const key = env.ENCRYPTION_KEY ?? "fallback";`,
  ],
};
