import type { CandidateMatch, MatcherPlugin } from "deepsec/config";
import { regexMatcher } from "deepsec/config";

/** Critical: hardcoded ENCRYPTION_KEY (AES-256-GCM master) in non-test code = credential leak across all deploys. */
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
