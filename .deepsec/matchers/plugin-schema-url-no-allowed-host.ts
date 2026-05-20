import type { CandidateMatch, MatcherPlugin } from "deepsec/config";

/**
 * Plugins declare `userConfigSchema` properties for upstream URLs (e.g.
 * Jellyfin `externalServerUrl`, Plex `baseUrl`, ntfy `serverUrl`). Every
 * such field MUST carry `"x-allowed-host": true` so the plugin runtime can
 * union the resolved hostname into the per-call `ctx.fetch` allowlist.
 * Without that flag, the field is parsed but never gated — the plugin can't
 * reach the user-configured host (visible bug) AND no allowlist narrowing
 * runs (latent SSRF window if any code path uses the URL directly).
 *
 * Flags JSON-schema property declarations inside `packages/plugins/**` whose
 * property name looks URL-shaped (`baseUrl`, `serverUrl`, `endpoint`,
 * `*Url`) or whose schema sets `format: "uri"` but whose surrounding object
 * literal does NOT carry `"x-allowed-host"`.
 */
export const pluginSchemaUrlNoAllowedHost: MatcherPlugin = {
  slug: "plugin-schema-url-no-allowed-host",
  description: "Plugin userConfigSchema URL field missing x-allowed-host",
  noiseTier: "normal",
  filePatterns: [
    "packages/plugins/**/src/**/*.ts",
    "packages/plugins/**/*.ts",
  ],
  match(content, filePath): CandidateMatch[] {
    if (/\.(test|spec)\.(ts|tsx)$/.test(filePath)) return [];
    if (/\/__tests__\//.test(filePath)) return [];

    const lines = content.split("\n");
    const matches: CandidateMatch[] = [];
    // Look for a property declaration that looks URL-shaped.
    const URL_PROP = /^\s*([a-zA-Z_$][\w$]*[Uu]rl|baseUrl|serverUrl|endpoint)\s*:\s*\{/;
    const URI_FORMAT = /format\s*:\s*['"]uri['"]/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isUrlProp = URL_PROP.test(line);
      const hasUriFormat = URI_FORMAT.test(line);
      if (!isUrlProp && !hasUriFormat) continue;

      // Inspect the next 12 lines for a closing `}` and an `x-allowed-host`.
      let depth = 0;
      let end = i;
      for (let j = i; j < Math.min(lines.length, i + 20); j++) {
        const ln = lines[j];
        depth += (ln.match(/\{/g) ?? []).length;
        depth -= (ln.match(/\}/g) ?? []).length;
        end = j;
        if (depth <= 0 && j > i) break;
      }
      const block = lines.slice(i, end + 1).join("\n");
      if (/"x-allowed-host"\s*:\s*true|'x-allowed-host'\s*:\s*true/.test(block)) continue;
      // Skip non-string URL fields (e.g. an enum).
      if (!/\btype\s*:\s*['"]string['"]/.test(block) && !hasUriFormat) continue;

      matches.push({
        vulnSlug: "plugin-schema-url-no-allowed-host",
        lineNumbers: [i + 1],
        snippet: lines.slice(i, Math.min(lines.length, end + 1)).join("\n"),
        matchedPattern: "URL-shaped schema property without x-allowed-host: true",
      });
    }
    return matches;
  },
  examples: [
    `baseUrl: { type: "string", title: "Base URL" },`,
    `endpoint: { type: "string", format: "uri" },`,
  ],
};
