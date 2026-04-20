/**
 * Coarse, outcome-oriented MCP scopes. See `docs/mcp-server.md` §6.4.
 * Tools map 1:N to scopes; the dispatcher rejects calls whose JWT scope claim
 * lacks every `requiredScopes` entry for the tool.
 */
export const MCP_SCOPES = [
  "mcp.read",
  "mcp.write.feedback",
  "mcp.write.request",
  "mcp.ext",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

/**
 * Defaults applied to dynamically-registered public clients. `mcp.ext` and
 * `mcp.write.request` must be requested explicitly on the authorization call.
 */
export const MCP_DEFAULT_SCOPES: McpScope[] = ["mcp.read", "mcp.write.feedback"];

export function parseScopes(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function hasAllScopes(granted: readonly string[], required: readonly string[]): boolean {
  if (required.length === 0) return true;
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}

export function missingScopes(granted: readonly string[], required: readonly string[]): string[] {
  const set = new Set(granted);
  return required.filter((s) => !set.has(s));
}
